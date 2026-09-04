/**
 * Envelope encryption for secrets at rest (router credentials).
 *
 * APP_MASTER_KEY (32 bytes, base64) lives OUTSIDE PostgreSQL (env/secret
 * manager). Per-secret DEKs are sealed by the master key; the DEK seals the
 * payload. Authenticated encryption (aes-256-gcm) — tampering fails safely.
 *
 * Envelope layout (base64: base64 JSON):
 *   { v: 1, edek, iv, tag, ct }
 *
 * APP_MASTER_KEY never appears in logs, responses, or audit metadata.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SealedSecret {
  v: 1;
  edek: string;
  iv: string;
  tag: string;
  ct: string;
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

export function parseMasterKey(encoded: string | undefined): Buffer {
  if (!encoded || encoded.length === 0) {
    throw new EnvelopeError(
      'APP_MASTER_KEY is not configured. Generate one with: openssl rand -base64 32'
    );
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new EnvelopeError('APP_MASTER_KEY must decode to exactly 32 bytes (base64 of 44 chars).');
  }
  return key;
}

function sealBytes(masterKey: Buffer, plaintext: Buffer): SealedSecret {
  // Data encryption key + its own IV, sealed under the master key.
  const dek = randomBytes(32);
  const dekIv = randomBytes(12);
  const dekCipher = createCipheriv('aes-256-gcm', masterKey, dekIv);
  const edek = Buffer.concat([
    dekIv,
    dekCipher.update(dek),
    dekCipher.final(),
    dekCipher.getAuthTag()
  ]);

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    v: 1,
    edek: edek.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64')
  };
}

function openBytes(masterKey: Buffer, sealed: SealedSecret): Buffer {
  if (sealed.v !== 1) throw new EnvelopeError(`Unsupported envelope version: ${sealed.v}`);
  const edek = Buffer.from(sealed.edek, 'base64');
  if (edek.length !== 12 + 32 + 16) throw new EnvelopeError('Malformed sealed DEK.');
  const dekIv = edek.subarray(0, 12);
  const dekCt = edek.subarray(12, 12 + 32);
  const dekTag = edek.subarray(12 + 32);
  const dekDecipher = createDecipheriv('aes-256-gcm', masterKey, dekIv);
  dekDecipher.setAuthTag(dekTag);
  let dek: Buffer;
  try {
    dek = Buffer.concat([dekDecipher.update(dekCt), dekDecipher.final()]);
  } catch {
    throw new EnvelopeError('Sealed secret could not be opened (wrong master key or tampered).');
  }

  const decipher = createDecipheriv('aes-256-gcm', dek, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ct, 'base64')),
      decipher.final()
    ]);
  } catch {
    throw new EnvelopeError('Sealed secret could not be opened (tampered or wrong key).');
  }
}

export function sealSecret(masterKey: string | Buffer, plaintext: string): string {
  const key = typeof masterKey === 'string' ? parseMasterKey(masterKey) : masterKey;
  return JSON.stringify(sealBytes(key, Buffer.from(plaintext, 'utf8')));
}

export function openSecret(masterKey: string | Buffer, sealedJson: string): string {
  const key = typeof masterKey === 'string' ? parseMasterKey(masterKey) : masterKey;
  let sealed: SealedSecret;
  try {
    sealed = JSON.parse(sealedJson) as SealedSecret;
  } catch {
    throw new EnvelopeError('Malformed sealed secret JSON.');
  }
  return openBytes(key, sealed).toString('utf8');
}
