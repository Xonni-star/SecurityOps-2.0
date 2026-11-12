import { describe, expect, test } from 'vitest';
import { isPatrolCheckpointRecentlyScanned } from '../components/MobilePatrolScanner';

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
});
