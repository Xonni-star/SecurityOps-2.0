import { migrationPool } from '../config/database';

export function authHeaders(credential: string): Record<string, string> {
  // Opaque random session fixtures are accepted only after the server resolves
  // their database hash; Authorization headers are deliberately not used.
  const [sessionId, csrfToken = 'test-csrf-token'] = credential.split('|', 2);
  return { Cookie: `secops_session=${sessionId}; secops_csrf=${csrfToken}`, 'X-CSRF-Token': csrfToken, Origin: 'http://localhost:3000' };
}

/**
 * Administrative Testbereinigung.
 *
 * secops_app_user besitzt bewusst kein DELETE auf Mandanten/Stammdaten.
 * Zusätzlich verhindern die Append-Only-Trigger in guardbook_entries das
 * kaskadierende Löschen eines Mandanten. Für die Testbereinigung wird daher
 * die administrative Rolle mit deaktivierter Trigger-Auswertung verwendet –
 * ausschließlich innerhalb der ephemeren Testdatenbank.
 */
export async function cleanupTestData(tenantIds: Array<string | undefined>, userIds: Array<string | undefined> = []): Promise<void> {
  const client = await migrationPool.connect();
  try {
    await client.query('SET session_replication_role = replica');
    for (const id of tenantIds) {
      if (id) {
        await client.query('DELETE FROM tenants WHERE id = $1', [id]);
      }
    }
    for (const id of userIds) {
      if (id) {
        await client.query('DELETE FROM users WHERE id = $1', [id]);
      }
    }
  } finally {
    await client.query('SET session_replication_role = origin');
    client.release();
  }
}
