import { GuardBookEntry, Shift, Site } from './types';

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/** Builds a rolling 24-hour series only from persisted/cached tenant events. */
export function buildActivitySeries(entries: GuardBookEntry[], now = new Date()) {
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const buckets = Array.from({ length: 6 }, (_, index) => ({
    time: new Date(start.getTime() + index * FOUR_HOURS_MS).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    patrols: 0,
    incidents: 0
  }));

  for (const entry of entries) {
    const timestamp = Date.parse(entry.timestamp);
    const elapsed = timestamp - start.getTime();
    if (!Number.isFinite(timestamp) || elapsed < 0 || elapsed >= 24 * 60 * 60 * 1000) continue;
    const bucket = buckets[Math.floor(elapsed / FOUR_HOURS_MS)];
    if (entry.category === 'Kontrollgang') bucket.patrols += 1;
    if (entry.category === 'Vorkommnis' || entry.category === 'Polizeieinsatz' || entry.category === 'Fehlalarm') {
      bucket.incidents += 1;
    }
  }

  return buckets;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDurationHours(start: string, end: string): number {
  const timeMinutes = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) return NaN;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : NaN;
  };
  const startMinutes = timeMinutes(start);
  const endMinutes = timeMinutes(end);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes === endMinutes) return 0;
  const durationMinutes = endMinutes > startMinutes ? endMinutes - startMinutes : 24 * 60 - startMinutes + endMinutes;
  return durationMinutes / 60;
}

/** Planned hours from today's shift records; no synthetic site target is inferred. */
export function buildScheduledHoursBySite(shifts: Shift[], sites: Site[], now = new Date()) {
  const hoursBySite = new Map<string, number>();
  const today = localDateKey(now);
  for (const shift of shifts) {
    if (shift.date !== today) continue;
    const duration = shiftDurationHours(shift.startTime, shift.endTime);
    if (duration > 0) hoursBySite.set(shift.siteId, (hoursBySite.get(shift.siteId) ?? 0) + duration);
  }

  return sites
    .filter((site) => hoursBySite.has(site.id))
    .map((site) => ({ name: site.name, plannedHours: hoursBySite.get(site.id) ?? 0 }));
}
