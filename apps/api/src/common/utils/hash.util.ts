import { createHash } from 'node:crypto';

/** Deterministic hash used to look up opaque tokens by exact match (not for passwords — use bcrypt for those). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
