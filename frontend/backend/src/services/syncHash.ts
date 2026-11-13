import crypto from 'crypto';

export function canonicalStringify(data: unknown): string {
  if (data === null || typeof data !== 'object') return JSON.stringify(data);
  if (Array.isArray(data)) return `[${data.map(canonicalStringify).join(',')}]`;
  const record = data as Record<string, unknown>;
  const entries = Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalStringify(record[key])}`
  );
  return `{${entries.join(',')}}`;
}

export function computePayloadHash(payload: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(canonicalStringify(payload), 'utf8').digest('hex');
}
