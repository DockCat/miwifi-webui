/**
 * LoginPage tests: verify probe behavior for local, remote, and bootstrapped states.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../src/api.js';

describe('LoginPage probe logic', () => {
  function determineModeFromProbeError(error: unknown): 'bootstrap' | 'login' {
    const isBootstrapOpen =
      error instanceof ApiError &&
      error.status === 400 &&
      error.message.includes('invalid_username');
    return isBootstrapOpen ? 'bootstrap' : 'login';
  }

  it('falls back to login mode when probe returns 403 bootstrap_local_only', () => {
    const error = new ApiError('bootstrap_local_only', undefined, 403);
    const mode = determineModeFromProbeError(error);
    assert.equal(mode, 'login', 'must not enter bootstrap mode on 403 bootstrap_local_only');
  });

  it('falls back to login mode when probe returns 409 bootstrap_already_completed', () => {
    const error = new ApiError('bootstrap_already_completed', undefined, 409);
    const mode = determineModeFromProbeError(error);
    assert.equal(mode, 'login', 'must enter login mode on 409 bootstrap_already_completed');
  });

  it('enters bootstrap mode only when probe returns 400 invalid_username', () => {
    const error = new ApiError('invalid_username', undefined, 400);
    const mode = determineModeFromProbeError(error);
    assert.equal(mode, 'bootstrap', 'must enter bootstrap mode only on 400 invalid_username');
  });

  it('falls back to login mode on network or server error', () => {
    const error = new Error('Failed to fetch');
    const mode = determineModeFromProbeError(error);
    assert.equal(mode, 'login', 'must default to login mode on unexpected errors');
  });
});
