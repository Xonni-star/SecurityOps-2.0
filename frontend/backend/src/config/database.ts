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
 * Führt alle Abfragen innerhalb einer isolierten Datenbanktransaktion mit RLS aus.
 * SET LOCAL app.current_tenant aktiviert die PostgreSQL Row-Level-Security für exakt diese Transaktion.
 * Verhindert Verbindungslecks durch garantiertes ROLLBACK und Freigabe im finally-Block.
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Setzen der Session-Variable für PostgreSQL Row-Level-Security (RLS).
    // Der dritte Parameter 'true' bewirkt, dass die Einstellung auf die aktuelle Transaktion beschränkt ist.
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
    client.release();
  }
}

/**
 * Parametrisierte Standardabfrage für systemweite oder unbeschränkte Leseoperationen (z. B. Authentifizierung)
 */
export async function query<R extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<R>> {
  return pool.query<R>(text, params);
}
