import { createHash } from 'node:crypto'

/** Stable JSON for configuration digests and plan identifiers. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/** Lowercase SHA-256 digest. */
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
