import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RouterTransportError } from '@miwifi-webui/router-core';
import { classifyRouterPollingFailure } from '../src/observability/polling-failure.js';

describe('safe router polling failure classification', () => {
  const failure = (kind: 'offline' | 'timeout' | 'authentication' | 'session-expired' | 'malformed' | 'aborted') =>
    new RouterTransportError({ kind }, 'status');

  it('distinguishes transport failures from credentials and API errors', () => {
    assert.equal(classifyRouterPollingFailure(failure('offline')), 'ROUTER_OFFLINE');
    assert.equal(classifyRouterPollingFailure(failure('timeout')), 'TIMEOUT');
    assert.equal(classifyRouterPollingFailure(failure('authentication')), 'AUTH_FAILED');
    assert.equal(classifyRouterPollingFailure(failure('session-expired')), 'AUTH_FAILED');
    assert.equal(classifyRouterPollingFailure(failure('malformed')), 'API_ERROR');
    assert.equal(classifyRouterPollingFailure(failure('aborted')), 'API_ERROR');
    assert.equal(classifyRouterPollingFailure(new Error('stok=secret-token')), 'API_ERROR');
  });

  it('classifies HTTP errors from bounded status codes only', () => {
    for (const status of [401, 403]) {
      assert.equal(classifyRouterPollingFailure(new RouterTransportError({ kind: 'http-status', status }, 'status')), 'AUTH_FAILED');
    }
    for (const status of [408, 504]) {
      assert.equal(classifyRouterPollingFailure(new RouterTransportError({ kind: 'http-status', status }, 'status')), 'TIMEOUT');
    }
    for (const status of [404, 429, 500, 503]) {
      assert.equal(classifyRouterPollingFailure(new RouterTransportError({ kind: 'http-status', status }, 'status')), 'API_ERROR');
    }
  });
});
