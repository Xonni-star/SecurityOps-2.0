import { describe, expect, test } from 'vitest';
import { buildActivitySeries, buildScheduledHoursBySite } from '../dashboardMetrics';
import { GuardBookEntry, Shift, Site } from '../types';

const entry = (timestamp: string, category: GuardBookEntry['category']) => ({
  timestamp, category
} as GuardBookEntry);

describe('dashboard metrics use real tenant events and shifts', () => {
  test('groups patrol and incident entries in the rolling 24-hour window only', () => {
    const now = new Date('2026-11-12T12:00:00.000Z');
    const series = buildActivitySeries([
      entry('2026-11-12T11:00:00.000Z', 'Kontrollgang'),
      entry('2026-11-12T11:30:00.000Z', 'Vorkommnis'),
      entry('2026-11-11T12:00:00.000Z', 'Polizeieinsatz'), // start boundary is inclusive
      entry('2026-11-11T11:59:59.000Z', 'Fehlalarm'),
      entry('not-a-date', 'Kontrollgang')
    ], now);

    expect(series).toHaveLength(6);
    expect(series.reduce((sum, bucket) => sum + bucket.patrols, 0)).toBe(1);
    expect(series.reduce((sum, bucket) => sum + bucket.incidents, 0)).toBe(2);
  });

  test("sums today's valid shifts by site, including overnight shifts without inventing targets", () => {
    const now = new Date(2026, 10, 12, 12);
    const sites = [{ id: 'site-a', name: 'Objekt Alpha' }, { id: 'site-b', name: 'Objekt Beta' }] as Site[];
    const shifts = [
      { siteId: 'site-a', date: '2026-11-12', startTime: '08:00', endTime: '16:00' },
      { siteId: 'site-a', date: '2026-11-12', startTime: '22:00', endTime: '06:00' },
      { siteId: 'site-a', date: '2026-11-11', startTime: '08:00', endTime: '16:00' },
      { siteId: 'site-b', date: '2026-11-12', startTime: 'bad', endTime: '16:00' }
    ] as Shift[];

    expect(buildScheduledHoursBySite(shifts, sites, now)).toEqual([
      { name: 'Objekt Alpha', plannedHours: 16 }
    ]);
  });
});
