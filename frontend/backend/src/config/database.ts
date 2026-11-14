import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';
import { getRequestAuthorizationContext } from '../middleware/requestAuthorizationContext';

// 1. Unprivilegierter Verbindungspool für den normalen Anwendungsbetrieb (secops_app_user)
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', () => {
  console.error('[POSTGRES POOL FEHLER] Idle database client reported an error.');
});

// 2. Privilegierter Pool AUSSCHLIESSLICH für Migrationen (secops_admin)
export const migrationPool = new Pool({
  connectionString: env.DATABASE_MIGRATION_URL,
  max: 3,
  connectionTimeoutMillis: 5000
});

migrationPool.on('error', () => {
  console.error('[POSTGRES MIGRATION POOL FEHLER] Idle migration client reported an error.');
});

const NO_CONTEXT_ID = '00000000-0000-0000-0000-000000000000';

async function releaseContextClient(client: PoolClient): Promise<void> {
  try {
    await client.query(
      `SELECT set_config('app.current_tenant',$1,false),
              set_config('app.current_user_id',$1,false),
              set_config('app.current_permission','',false),
              set_config('app.session_lookup_hash','',false)`,
      [NO_CONTEXT_ID]
    );
  } catch {
    client.release(new Error('Database request context reset failed.'));
    throw new Error('Database request context reset failed.');
  }
  client.release();
}

/**
 * 3. Verbindliche Rollenprüfung vor Start des HTTP-Servers:
 * Stellt sicher, dass secops_app_user weder SUPERUSER noch BYPASSRLS besitzt.
 * Bei Feststellung von unzulässigen Rechten wird der Prozess sofort abgebrochen!
 */
export async function verifyAppDatabaseRole(): Promise<void> {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT current_user as app_user, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb 
      FROM pg_roles 
      WHERE rolname = current_user
    `);

    if (res.rows.length === 0) {
      throw new Error('[SICHERHEITSABBRUCH] Aktuelle Datenbankrolle konnte nicht ermittelt werden.');
    }

    const { app_user, rolsuper, rolbypassrls } = res.rows[0];

    if (rolsuper === true) {
      throw new Error(`[SICHERHEITSABBRUCH] Die Anwendungs-Rolle '${app_user}' besitzt SUPERUSER-Rechte! Start verweigert.`);
    }

    if (rolbypassrls === true) {
      throw new Error(`[SICHERHEITSABBRUCH] Die Anwendungs-Rolle '${app_user}' besitzt BYPASSRLS-Rechte! RLS wird dadurch ausgehebelt. Start verweigert.`);
    }

    console.log(`[POSTGRES SICHERHEIT] Anwendungsrolle '${app_user}' erfolgreich verifiziert (NOSUPERUSER, NOBYPASSRLS).`);
  } finally {
    await releaseContextClient(client);
  }
}

/**
 * Führt alle Abfragen innerhalb einer isolierten Datenbanktransaktion mit RLS aus.
 * SET LOCAL app.current_tenant aktiviert die PostgreSQL Row-Level-Security für exakt diese Transaktion.
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const requestContext = getRequestAuthorizationContext();
    await client.query(
      `SELECT set_config('app.current_user_id',$1,true),
              set_config('app.current_permission',$2,true)`,
      [requestContext?.userId ?? NO_CONTEXT_ID, requestContext?.permissionCode ?? '']
    );

    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      console.error('[POSTGRES ROLLBACK FEHLER] Transaction rollback failed.');
    }
    throw error;
  } finally {
    await releaseContextClient(client);
  }
}

export async function withUserContextTransaction<T>(
  userId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    await client.query("SELECT set_config('app.current_permission','',true)");
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { console.error('[POSTGRES ROLLBACK FEHLER] User transaction rollback failed.'); }
    throw error;
  } finally {
    await releaseContextClient(client);
  }
}

export async function withSessionLookupTransaction<T>(
  tokenHash: string,
  callback: (client: PoolClient, session: { user_id: string; tenant_id: string }) => Promise<T>
): Promise<T | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.session_lookup_hash', $1, true)", [tokenHash]);
    const session = await client.query<{ user_id: string; tenant_id: string }>(
      `SELECT user_id,tenant_id FROM user_sessions
        WHERE token_hash=$1 AND revoked=false AND expires_at>CURRENT_TIMESTAMP`,
      [tokenHash]
    );
    if (!session.rows.length) {
      await client.query('COMMIT');
      return null;
    }
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [session.rows[0].tenant_id]);
    await client.query(
      `SELECT set_config('app.current_user_id',$1,true),
              set_config('app.current_permission','',true)`,
      [session.rows[0].user_id]
    );
    const result = await callback(client, session.rows[0]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { console.error('[POSTGRES ROLLBACK FEHLER] Session transaction rollback failed.'); }
    throw error;
  } finally {
    await releaseContextClient(client);
  }
}

/**
 * Führt eine isolierte Transaktion OHNE Mandantenkontext aus (z. B. für Login, System-Bootstrap).
 */
export async function withSystemTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // NULL-UUID statt Leerstring: RLS-Policies casten app.current_tenant nach uuid.
    // Ein Leerstring würde die Abfrage mit "invalid input syntax for type uuid" abbrechen.
    await client.query("SELECT set_config('app.current_tenant', '00000000-0000-0000-0000-000000000000', true)");
    await client.query(
      `SELECT set_config('app.current_user_id',$1,true),
              set_config('app.current_permission','',true)`,
      [NO_CONTEXT_ID]
    );
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      console.error('[POSTGRES ROLLBACK FEHLER] System transaction rollback failed.');
    }
    throw error;
  } finally {
    await releaseContextClient(client);
  }
}

/**
 * Parametrisierte Standardabfrage
 */
export async function query<R extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<R>> {
  return pool.query<R>(text, params);
}
