import { resolveShiftTime } from '../services/planningService';

describe('IANA local shift-time resolution', () => {
  test('resolves an unambiguous local time and overnight shift to UTC instants', () => {
    const result = resolveShiftTime({
      date: '2026-07-14',
      startTime: '22:00',
      endTime: '06:00'
    }, 'Europe/Berlin');

    expect(result.timeZone).toBe('Europe/Berlin');
    expect(result.startsAt.toISOString()).toBe('2026-07-14T20:00:00.000Z');
    expect(result.endsAt.toISOString()).toBe('2026-07-15T04:00:00.000Z');
    expect(result.endDate).toBe('2026-07-15');
  });

  test('rejects local wall times inside a DST spring-forward gap', () => {
    expect(() => resolveShiftTime({
      date: '2026-03-29',
      startTime: '02:30',
      endTime: '04:00'
    }, 'Europe/Berlin')).toThrow(/Zeitumstellungslücke/);
  });

  test('requires an explicit offset for the repeated fall-back hour', () => {
    const ambiguous = {
      date: '2026-10-25',
      startTime: '02:30',
      endTime: '03:30'
    };
    expect(() => resolveShiftTime(ambiguous, 'Europe/Berlin')).toThrow(/mehrdeutig/);

    const summerOccurrence = resolveShiftTime({
      ...ambiguous, startOffsetMinutes: 120
    }, 'Europe/Berlin');
    const standardOccurrence = resolveShiftTime({
      ...ambiguous, startOffsetMinutes: 60
    }, 'Europe/Berlin');

    expect(summerOccurrence.startsAt.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(standardOccurrence.startsAt.toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });

  test('rejects invalid IANA zones and non-positive shift intervals', () => {
    expect(() => resolveShiftTime({
      date: '2026-01-01', startTime: '08:00', endTime: '09:00'
    }, 'Mars/Olympus')).toThrow(/IANA-Zeitzone/);
    expect(() => resolveShiftTime({
      date: '2026-01-01', startTime: '08:00', endTime: '08:00', endDate: '2026-01-01'
    }, 'UTC')).toThrow(/Schichtende/);
  });
});
