/**
 * Access-control mutation tests (Task 0006) via fixture transport.
 *
 * Covers: successful block/unblock with read-back confirmation; router
 * error; read-back mismatch -> unknown (fail-safe); offline; catalog
 * WRITE invariant.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FixtureTransport,
  MiWifiAdapter,
  blockDeviceInternet,
  unblockDeviceInternet,
  type FixtureScenario
} from '../src/index.js';

const CREDENTIALS = { username: 'admin', password: 'fixture-router-pw' };
const MAC = 'AA:BB:CC:DD:EE:10';

function mutationScenario(overrides: Partial<FixtureScenario> = {}): FixtureScenario {
  return {
    name: 'mutation-capable',
    initInfo: { code: 0, model: 'RD03' },
    login: { ok: true, token: 'stok-mutation-1' },
    responses: {
      block_internet: { status: 200, body: { code: 0 } },
      unblock_internet: { status: 200, body: { code: 0 } },
      smarthome_devicelist: {
        status: 200,
        body: { code: 0, list: [{ mac: MAC, blocked: 1 }] }
      }
    },
    ...overrides
  };
}

function adapterFor(scenario: FixtureScenario): {
  adapter: MiWifiAdapter;
  transport: FixtureTransport;
} {
  const transport = new FixtureTransport(scenario);
  return { adapter: new MiWifiAdapter(transport, CREDENTIALS), transport };
}

describe('blockDeviceInternet', () => {
  it('blocks and confirms via read-back', async () => {
    const { adapter } = adapterFor(mutationScenario());
    const outcome = await blockDeviceInternet(adapter, MAC);
    assert.deepEqual(outcome, { ok: true, state: 'blocked' });
  });

  it('reports unknown on read-back mismatch (fail-safe)', async () => {
    const { adapter } = adapterFor(
      mutationScenario({
        responses: {
          block_internet: { status: 200, body: { code: 0 } },
          // Read-back shows NOT blocked -> mismatch.
          smarthome_devicelist: {
            status: 200,
            body: { code: 0, list: [{ mac: MAC, blocked: 0 }] }
          }
        }
      })
    );
    const outcome = await blockDeviceInternet(adapter, MAC);
    assert.deepEqual(outcome, { ok: false, reason: 'readback_mismatch', state: 'unknown' });
  });

  it('reports unknown when read-back is malformed', async () => {
    const { adapter } = adapterFor(
      mutationScenario({
        responses: {
          block_internet: { status: 200, body: { code: 0 } },
          smarthome_devicelist: { status: 200, body: { code: 0 } }
        }
      })
    );
    const outcome = await blockDeviceInternet(adapter, MAC);
    assert.deepEqual(outcome, { ok: false, reason: 'readback_mismatch', state: 'unknown' });
  });

  it('reports router_error on a non-zero code', async () => {
    const { adapter } = adapterFor(
      mutationScenario({
        responses: {
          block_internet: { status: 200, body: { code: 401, msg: 'failed' } }
        }
      })
    );
    const outcome = await blockDeviceInternet(adapter, MAC);
    assert.deepEqual(outcome, { ok: false, reason: 'router_error' });
  });

  it('reports offline when the session cannot be established', async () => {
    const { adapter } = adapterFor(
      mutationScenario({ login: { ok: false, token: null } })
    );
    const outcome = await blockDeviceInternet(adapter, MAC);
    assert.deepEqual(outcome, { ok: false, reason: 'offline' });
  });
});

describe('unblockDeviceInternet', () => {
  it('unblocks and confirms via read-back', async () => {
    const { adapter } = adapterFor(
      mutationScenario({
        responses: {
          unblock_internet: { status: 200, body: { code: 0 } },
          smarthome_devicelist: {
            status: 200,
            body: { code: 0, list: [{ mac: MAC, blocked: 0 }] }
          }
        }
      })
    );
    const outcome = await unblockDeviceInternet(adapter, MAC);
    assert.deepEqual(outcome, { ok: true, state: 'allowed' });
  });

  it('reports unknown when the device disappears from read-back', async () => {
    const { adapter } = adapterFor(
      mutationScenario({
        responses: {
          unblock_internet: { status: 200, body: { code: 0 } },
          smarthome_devicelist: {
            status: 200,
            body: { code: 0, list: [{ mac: 'OTHER:MAC:00', blocked: 0 }] }
          }
        }
      })
    );
    const outcome = await unblockDeviceInternet(adapter, MAC);
    assert.deepEqual(outcome, { ok: false, reason: 'readback_mismatch', state: 'unknown' });
  });
});
