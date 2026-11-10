import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000
});

pool.on('error', (err) => {
  console.error('[POSTGRES POOL ERROR]', err);
});

/**
 * Führt Abfragen innerhalb einer Transaktion mit gesetztem RLS-Mandantenkontext aus.
 * SET LOCAL app.current_tenant aktiviert die PostgreSQL Row-Level-Security für diese Transaktion.
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Setzen der Session-Variable für PostgreSQL Row-Level-Security (RLS)
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Standardisierte parametrisierte Abfrage
 */
export async function query<R extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<R>> {
  return pool.query<R>(text, params);
}
