/**
 * Envelope encryption unit tests.
 *
 * Uses a sentinel plaintext and verifies it never appears in the sealed
 * output; tampering must fail closed with a safe error message.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  EnvelopeError,
  openSecret,
  parseMasterKey,
  sealSecret
} from '../src/crypto/envelope.js';

const SENTINEL_SECRET = 'ROUTER-PW-SEN[1]TINEL-42';

function validMasterKey(): string {
  return randomBytes(32).toString('base64');
}

describe('parseMasterKey', () => {
  it('accepts a 32-byte base64 key', () => {
    const key = validMasterKey();
    assert.equal(parseMasterKey(key).length, 32);
  });

  it('rejects missing or malformed keys', () => {
    assert.throws(() => parseMasterKey(undefined), EnvelopeError);
    assert.throws(() => parseMasterKey(''), EnvelopeError);
    assert.throws(() => parseMasterKey('not-base64!!'), EnvelopeError);
    assert.throws(() => parseMasterKey(Buffer.from('short').toString('base64')), EnvelopeError);
  });
});

describe('sealSecret / openSecret roundtrip', () => {
  it('round-trips and never leaks the plaintext', () => {
    const masterKey = validMasterKey();
    const sealed = sealSecret(masterKey, SENTINEL_SECRET);
    assert.ok(!sealed.includes(SENTINEL_SECRET), 'sealed output must not contain plaintext');
    const opened = openSecret(masterKey, sealed);
    assert.equal(opened, SENTINEL_SECRET);
  });

  it('fails closed with the wrong master key', () => {
    const sealed = sealSecret(validMasterKey(), SENTINEL_SECRET);
    assert.throws(() => openSecret(validMasterKey(), sealed), EnvelopeError);
  });

  it('fails closed on tampered ciphertext', () => {
    const masterKey = validMasterKey();
    const sealed = sealSecret(masterKey, SENTINEL_SECRET);
    const parsed = JSON.parse(sealed) as { ct: string };
    const flipped = parsed.ct.slice(0, -2) + (parsed.ct.endsWith('AA') ? 'BB' : 'AA');
    const tampered = JSON.stringify({ ...parsed, ct: flipped });
    assert.throws(() => openSecret(masterKey, tampered), EnvelopeError);
    assert.ok(!sealed.includes(SENTINEL_SECRET));
  });

  it('uses fresh randomness: two seals of the same secret differ', () => {
    const masterKey = validMasterKey();
    const a = sealSecret(masterKey, SENTINEL_SECRET);
    const b = sealSecret(masterKey, SENTINEL_SECRET);
    assert.notEqual(a, b);
  });
});
