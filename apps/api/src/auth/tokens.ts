/**
 * Opaque session tokens.
 *
 * Raw token: 32 bytes of crypto randomness, base64url-encoded. Only the
 * sha256 hash is persisted; the raw value exists solely inside the HttpOnly
 * cookie. Raw tokens must never be logged or stored server-side.
 */
import { createHash, randomBytes } from 'node:crypto';

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
