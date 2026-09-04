/**
 * Observability routes: live status, device inventory, presence history,
 * telemetry history, and the SSE stream.
 *
 * Read endpoints NEVER write telemetry — persistence is scheduler-only
 * (Task 0004 acceptance). SSE events are browser-safe by construction
 * (EventBridge carries no secrets).
 */
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import type { ObservabilityRepository } from '../observability/repository.js';
import type { EventBridge } from '../observability/event-bridge.js';
import type { PollingScheduler } from '../observability/scheduler.js';

export interface ObservabilityRoutesOptions {
  repository: ObservabilityRepository;
  events: EventBridge;
  /** Absent in test apps; the live-status endpoint reports accordingly. */
  scheduler: PollingScheduler | undefined;
}

export function registerObservabilityRoutes(
  app: FastifyInstance,
  options: ObservabilityRoutesOptions
): void {
  const { repository, events, scheduler } = options;

  // --- Live router status (from the scheduler's in-memory cache). ---
  app.get('/api/routers/:routerId/status', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    const { routerId } = request.params as { routerId: string };
    if (!scheduler) {
      return await reply.code(503).send({ error: 'polling_not_running' });
    }
    const status = scheduler.getStatus(routerId);
    if (!status) {
      return await reply.code(404).send({ error: 'no_status_yet' });
    }
    return { routerId, status };
  });

  // --- Device inventory. ---
  app.get('/api/routers/:routerId/devices', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    const { routerId } = request.params as { routerId: string };
    const devices = await repository.listDevicesForRouter(routerId);
    return {
      devices: devices.map((device) => ({
        id: device.id,
        mac: device.mac,
        name: device.name,
        ip: device.ip,
        online: device.online,
        internetAccess: device.internetAccess,
        firstSeenAt: device.firstSeenAt.toISOString(),
        lastSeenAt: device.lastSeenAt.toISOString()
      }))
    };
  });

  // --- Presence event history. ---
  app.get('/api/routers/:routerId/presence', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    const { routerId } = request.params as { routerId: string };
    const query = request.query as { deviceId?: string; limit?: string };
    const presence = await repository.listPresenceEvents(routerId, {
      deviceId: query.deviceId,
      limit: query.limit ? Number(query.limit) : undefined
    });
    return {
      events: presence.map((event) => ({
        id: event.id,
        deviceId: event.deviceId,
        routerId: event.routerId,
        kind: event.kind,
        occurredAt: event.occurredAt.toISOString()
      }))
    };
  });

  // --- Telemetry history (read-only; rows come from the scheduler). ---
  app.get('/api/routers/:routerId/telemetry', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    const { routerId } = request.params as { routerId: string };
    const query = request.query as { limit?: string };
    const limit = query.limit ? Math.min(Number(query.limit) || 60, 500) : 60;
    const snapshots = await repository.listTelemetrySnapshots(routerId, limit);
    return {
      snapshots: snapshots.map((snapshot) => ({
        id: snapshot.id,
        routerId: snapshot.routerId,
        capturedAt: snapshot.capturedAt.toISOString(),
        payload: snapshot.payload
      }))
    };
  });

  // --- SSE live stream. ---
  app.get('/api/events', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });

    // Last-Event-ID replay (reconnect support).
    const lastEventIdHeader = request.headers['last-event-id'];
    const afterId =
      typeof lastEventIdHeader === 'string'
        ? Number.parseInt(lastEventIdHeader, 10)
        : Number.NaN;
    if (Number.isInteger(afterId)) {
      for (const event of events.eventsAfter(afterId)) {
        writeSse(reply.raw, event);
      }
    }

    const unsubscribe = events.subscribe((event) => writeSse(reply.raw, event));
    request.raw.on('close', () => {
      unsubscribe();
    });
  });
}

function writeSse(
  raw: { write: (chunk: string) => boolean },
  event: { id: number; type: string; data: Record<string, unknown>; at: string }
): void {
  raw.write(`id: ${event.id}\n`);
  raw.write(`event: ${event.type}\n`);
  raw.write(`data: ${JSON.stringify({ ...event.data, at: event.at })}\n\n`);
}
