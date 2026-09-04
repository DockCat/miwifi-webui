/**
 * Device Internet-access control (Task 0006) — the ONLY v1 mutation.
 *
 * Both operations are declared WRITE (reversible) in the catalog. After
 * every mutation the adapter re-reads the device state (read-back
 * verification, plan section 25); if confirmation cannot be established,
 * the result is 'unknown' — the UI must never trust the mutation response
 * alone.
 */
import { specFor } from './operations.js';
import type { MiWifiAdapter } from './adapter.js';
import type { RouterTransportResponse } from './transport.js';

export type InternetAccessState = 'allowed' | 'blocked' | 'unknown';

export type MutationOutcome =
  | { ok: true; state: InternetAccessState }
  | { ok: false; reason: 'device_not_found' | 'router_error' | 'offline' }
  | { ok: false; reason: 'readback_mismatch'; state: 'unknown' };

/** Payload shape for the xqsmarthome request endpoints. */
function controlPayload(
  mac: string,
  command: 'block' | 'unblock'
): Record<string, string> {
  return {
    payload: JSON.stringify({
      command,
      mac
    })
  };
}

/** Read back a device's block state from the smart-home device list. */
async function readBackState(
  adapter: MiWifiAdapter,
  mac: string
): Promise<InternetAccessState | null> {
  try {
    const response: RouterTransportResponse = await adapter.call(
      'smartHomeDeviceList',
      { payload: JSON.stringify({ command: 'device_list' }) }
    );
    if (response.status !== 200) return null;
    const body = response.body as { list?: Array<Record<string, unknown>> } | null;
    if (body === null || typeof body !== 'object' || !Array.isArray(body.list)) {
      return null;
    }
    const target = body.list.find((item) => item['mac'] === mac);
    if (target === undefined) return null;
    // xqsmarthome exposes "onbrush"/"privo" style flags across firmwares;
    // treat any explicit blocked/allowed flag as confirmation.
    const blocked = target['blocked'] ?? target['privo'] ?? target['onbrush'];
    if (blocked === 1 || blocked === '1' || blocked === true) return 'blocked';
    if (blocked === 0 || blocked === '0' || blocked === false) return 'allowed';
    return null;
  } catch {
    return null;
  }
}

/** Block a device's Internet access, then verify by read-back. */
export async function blockDeviceInternet(
  adapter: MiWifiAdapter,
  mac: string
): Promise<MutationOutcome> {
  return controlInternet(adapter, mac, 'block');
}

/** Restore a device's Internet access, then verify by read-back. */
export async function unblockDeviceInternet(
  adapter: MiWifiAdapter,
  mac: string
): Promise<MutationOutcome> {
  return controlInternet(adapter, mac, 'unblock');
}

async function controlInternet(
  adapter: MiWifiAdapter,
  mac: string,
  command: 'block' | 'unblock'
): Promise<MutationOutcome> {
  const spec = specFor(command === 'block' ? 'blockInternet' : 'unblockInternet');
  // WRITE effect must be asserted by the catalog, never the HTTP method.
  if (spec.effect !== 'WRITE') {
    throw new Error(`catalog invariant violated: ${spec.id} must be WRITE`);
  }

  if (!(await adapter.ensureSession())) {
    return { ok: false, reason: 'offline' };
  }

  let response: RouterTransportResponse;
  try {
    response = await adapter.call(
      command === 'block' ? 'blockInternet' : 'unblockInternet',
      controlPayload(mac, command)
    );
  } catch {
    return { ok: false, reason: 'router_error' };
  }

  if (response.status !== 200) {
    return { ok: false, reason: 'router_error' };
  }
  const body = response.body as { code?: number } | null;
  if (typeof body === 'object' && body !== null && body.code !== undefined && body.code !== 0) {
    return { ok: false, reason: 'router_error' };
  }

  // Read-back verification.
  const state = await readBackState(adapter, mac);
  if (state === null) {
    return { ok: false, reason: 'readback_mismatch', state: 'unknown' };
  }
  const expected = command === 'block' ? 'blocked' : 'allowed';
  if (state !== expected) {
    return { ok: false, reason: 'readback_mismatch', state: 'unknown' };
  }
  return { ok: true, state };
}
