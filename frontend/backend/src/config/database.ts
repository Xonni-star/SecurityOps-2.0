import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('[POSTGRES POOL FEHLER]', err);
});

/**
 * Überprüft beim Backend-Start die tatsächlich aktive PostgreSQL-Rolle.
 * Bricht ab, wenn der Anwendungsbenutzer über SUPERUSER oder BYPASSRLS verfügt.
 */
export async function verifyAppDatabaseRole(): Promise<{ currentUser: string; isLeastPrivilege: boolean }> {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT current_user, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb 
      FROM pg_roles 
      WHERE rolname = current_user;
    `);

    if (res.rows.length === 0) {
      throw new Error(`Rolle des aktuellen Datenbankbenutzers konnte nicht ermittelt werden.`);
    }

    const { current_user: currentUser, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb } = res.rows[0];

    // Sicherheitsprüfung: Anwendungsbenutzer darf NIEMALS Superuser sein oder RLS umgehen können!
    if (rolsuper || rolbypassrls) {
      const msg = `[SICHERHEITSABBRUCH] Anwendungs-Datenbankverbindung läuft als '${currentUser}' mit unzulässigen Rechten (SUPERUSER: ${rolsuper}, BYPASSRLS: ${rolbypassrls}). RLS-Schutz wäre kompromittiert! Verwenden Sie 'secops_app_user'.`;
      console.error(msg);
      if (env.NODE_ENV === 'production' || env.NODE_ENV === 'test') {
        throw new Error(msg);
      }
    }

    const isLeastPrivilege = !rolsuper && !rolbypassrls && !rolcreaterole && !rolcreatedb;
    return { currentUser, isLeastPrivilege };
  } finally {
    client.release();
  }
}

/**
 * Führt alle Abfragen innerhalb einer isolierten Transaktion mit gesetztem RLS-Mandantenkontext aus.
 * SET LOCAL app.current_tenant aktiviert die PostgreSQL Row-Level-Security für diese Transaktion.
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      console.error('[POSTGRES ROLLBACK FEHLER]', rbErr);
    }
    throw error;
  } finally {
    try {
      await client.query("SELECT set_config('app.current_tenant', '', false)");
    } catch {
      // Ignorieren falls Verbindung beendet
    }
    client.release();
  }
}

/**
 * Führt eine Transaktion ohne Mandantenkontext aus (z. B. für Login, System-Bootstrap).
 * RLS blockiert hierbei jeden mandantengebundenen Datensatz.
 */
export async function withSystemTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', '', true)");
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      console.error('[POSTGRES ROLLBACK FEHLER]', rbErr);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function query<R extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<R>> {
  return pool.query<R>(text, params);
}
