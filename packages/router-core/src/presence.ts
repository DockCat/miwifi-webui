/**
 * Presence transition logic (pure domain).
 *
 * Presence is event-based (plan section 20.3 / CONTEXT.md): one row per
 * FIRST_SEEN / ONLINE / OFFLINE transition. Reconciliation compares the
 * latest inventory snapshot with stored device state:
 *
 * - new mac/ip appearing        -> FIRST_SEEN (+ ONLINE)
 * - stored offline, now online  -> ONLINE
 * - stored online, now missing  -> OFFLINE
 * - unchanged                   -> no event
 */

export type PresenceEventKind = 'FIRST_SEEN' | 'ONLINE' | 'OFFLINE';

export interface PresenceTransition {
  readonly kind: PresenceEventKind;
}

export interface StoredDeviceState {
  readonly online: boolean;
}

/** Transition for an inventory device vs. its stored state. */
export function transitionForExisting(
  stored: StoredDeviceState,
  observedOnline: boolean
): PresenceTransition | null {
  if (stored.online && !observedOnline) return { kind: 'OFFLINE' };
  if (!stored.online && observedOnline) return { kind: 'ONLINE' };
  return null;
}

/** First observation of a device that is online. */
export function firstSeenTransition(): PresenceTransition {
  return { kind: 'FIRST_SEEN' };
}

export type KeyedTransition = PresenceTransition & { readonly key: string };

/**
 * Full reconciliation: computes the set of presence events for an
 * inventory pass. Unknown-keyed devices (by mac when present, else ip)
 * that were not observed this pass are marked OFFLINE.
 */
export function reconcilePresence(
  observed: ReadonlyMap<string, { online: boolean }>,
  stored: ReadonlyMap<string, StoredDeviceState>
): { events: KeyedTransition[] } {
  const events: KeyedTransition[] = [];

  for (const [key, observedDevice] of observed) {
    const storedState = stored.get(key);
    if (storedState === undefined) {
      if (observedDevice.online) {
        events.push({ key, kind: 'FIRST_SEEN' });
      }
      continue;
    }
    const transition = transitionForExisting(storedState, observedDevice.online);
    if (transition) events.push({ key, ...transition });
  }

  // Observed-now-missing: devices stored online but absent from inventory.
  for (const [key, storedState] of stored) {
    if (storedState.online && !observed.has(key)) {
      events.push({ key, kind: 'OFFLINE' });
    }
  }

  return { events };
}

/** Stable per-router key for a device within one inventory pass. */
export function deviceKey(mac: string | undefined, ip: string | undefined): string | null {
  if (mac) return `mac:${mac}`;
  if (ip) return `ip:${ip}`;
  return null;
}
