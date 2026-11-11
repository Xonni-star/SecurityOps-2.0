import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';

// 1. Unprivilegierter Verbindungspool für den normalen Anwendungsbetrieb (secops_app_user)
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('[POSTGRES POOL FEHLER]', err);
});

// 2. Privilegierter Pool AUSSCHLIESSLICH für Migrationen (secops_admin)
export const migrationPool = new Pool({
  connectionString: env.DATABASE_MIGRATION_URL,
  max: 3,
  connectionTimeoutMillis: 5000
});

migrationPool.on('error', (err) => {
  console.error('[POSTGRES MIGRATION POOL FEHLER]', err);
});

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
    client.release();
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
      // Ignorieren falls Verbindung bereits beendet
    }
    client.release();
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

/**
 * Parametrisierte Standardabfrage
 */
export async function query<R extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<R>> {
  return pool.query<R>(text, params);
}
