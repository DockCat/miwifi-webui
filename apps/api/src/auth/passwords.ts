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

/**
 * Well-formed Argon2id hash at the same parameters as ARGON2_OPTS, used to
 * equalize login timing when the username is unknown: verification still
 * runs (and fails) at full cost, so response time does not reveal account
 * existence. The plaintext behind it was randomly generated and discarded —
 * the value is not a secret; it only needs to parse and cost the same.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$esoyzEGmVUzpIZHUEIvHxg$7zSxSjW1hRH3NR/kHS8j/i+EKKxShc4oL3LXMLDBFCA';

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
