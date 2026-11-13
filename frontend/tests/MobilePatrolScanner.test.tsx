import { describe, expect, test } from 'vitest';
import { isPatrolCheckpointRecentlyScanned, parsePatrolQrPayload } from '../components/MobilePatrolScanner';

describe('Mobile patrol scan duplicate window', () => {
  const now = Date.parse('2026-11-12T12:00:00.000Z');

  test('permits scanning a checkpoint again after the two-minute window', () => {
    expect(isPatrolCheckpointRecentlyScanned(
      [{ checkpointId: 'checkpoint-1', scannedAt: '2026-11-12T11:57:59.999Z' }],
      'checkpoint-1',
      now
    )).toBe(false);
  });

  test('blocks only scans of the same checkpoint within the two-minute window', () => {
    const scans = [
      { checkpointId: 'checkpoint-1', scannedAt: '2026-11-12T11:59:00.000Z' },
      { checkpointId: 'checkpoint-2', scannedAt: '2026-11-12T11:59:30.000Z' }
    ];

    expect(isPatrolCheckpointRecentlyScanned(scans, 'checkpoint-1', now)).toBe(true);
    expect(isPatrolCheckpointRecentlyScanned(scans, 'checkpoint-3', now)).toBe(false);
  });

  test('parses only versioned QR tokens with site, checkpoint and random credential', () => {
    const token = 'A'.repeat(43);
    expect(parsePatrolQrPayload(
      `secops:patrol:v1:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:${token}`
    )).toEqual({
      siteId: '11111111-1111-4111-8111-111111111111',
      checkpointId: '22222222-2222-4222-8222-222222222222',
      token
    });
    expect(parsePatrolQrPayload('CP-01')).toBeNull();
    expect(parsePatrolQrPayload(
      `secops:patrol:v1:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:guessable`
    )).toBeNull();
  });
});
