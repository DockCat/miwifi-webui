/**
 * Password hashing: Argon2id via the native @node-rs/argon2 binding.
 *
 * Hashes are opaque to the rest of the application. Verification failures
 * must always be generic (no user-enumeration signal beyond audit rows).
 */
import { hash, verify } from '@node-rs/argon2';

const ARGON2_OPTS = {
  // OWASP 2024 guidance for Argon2id: 19 MiB memory, 2 iterations, p=1.
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** v1 password policy: 10+ chars. Deliberately minimal, message-safe. */
export function validatePasswordPolicy(password: string): string | null {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Password must be at least 10 characters long.';
  }
  if (password.length > 512) {
    return 'Password is too long.';
  }
  return null;
}
