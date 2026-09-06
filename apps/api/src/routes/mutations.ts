/**
 * Device Internet block/unblock routes (Task 0006) — the only v1 mutation.
 *
 * Flow (plan section 25): auth -> audit attempt -> mutation (WRITE, via
 * adapter) -> read-back verification -> audit result -> UI state update.
 * Offered only when the router has the device-internet-access-control
 * capability (checked against the stored capability profile).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  HttpRouterTransport,
  MiWifiAdapter,
  blockDeviceInternet,
  unblockDeviceInternet
} from '@miwifi-webui/router-core';
import type { MutationOutcome } from '@miwifi-webui/router-core';
import { requireAuth } from '../auth/plugin.js';
import { parseMasterKey } from '../crypto/envelope.js';
import type { RouterRepository } from '../router/repository.js';
import type { ObservabilityRepository } from '../observability/repository.js';
import type { AuditWriter } from '../audit/writer.js';

export interface MutationRoutesOptions {
  routerRepository: RouterRepository;
  observabilityRepository: ObservabilityRepository;
  audit: AuditWriter;
}

interface AdapterSetup {
  adapter: MiWifiAdapter;
}

export function registerMutationRoutes(
  app: FastifyInstance,
  options: MutationRoutesOptions
): void {
  const { routerRepository, observabilityRepository, audit } = options;

  async function ensureAdapter(
    routerId: string
  ): Promise<AdapterSetup | { error: string; code: number }> {
    const router = await routerRepository.findRouterById(routerId);
    if (!router) return { error: 'router_not_found', code: 404 };
    if (!router.capabilities.includes('device-internet-access-control')) {
      return { error: 'capability_unavailable', code: 422 };
    }
    let masterKey: Buffer;
    try {
      masterKey = parseMasterKey(process.env.APP_MASTER_KEY);
    } catch {
      return { error: 'master_key_not_configured', code: 503 };
    }
    const credential = await routerRepository.loadCredential(
      routerId,
      masterKey.toString('base64')
    );
    if (!credential) return { error: 'credential_missing', code: 503 };
    const transport = new HttpRouterTransport({ host: router.host });
    return { adapter: new MiWifiAdapter(transport, credential) };
  }

  async function handle(
    request: FastifyRequest,
    reply: FastifyReply,
    action: 'block' | 'unblock'
  ): Promise<unknown> {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;

    const { routerId, deviceId } = request.params as {
      routerId: string;
      deviceId: string;
    };

    // Device must belong to this router.
    const devices = await observabilityRepository.listDevicesForRouter(routerId);
    const device = devices.find((entry) => entry.id === deviceId);
    if (!device) {
      return await reply.code(404).send({ error: 'device_not_found' });
    }
    if (!device.mac) {
      return await reply.code(422).send({ error: 'device_has_no_mac' });
    }

    const setup = await ensureAdapter(routerId);
    if ('error' in setup) {
      return await reply.code(setup.code).send({ error: setup.error });
    }

    // The attempt is recorded as informational; the definitive success /
    // failure record follows once the router round-trip completes.
    await audit.record({
      action: `router.mutation_${action}_attempt`,
      actorId: request.authUser!.id,
      targetType: 'device',
      targetId: deviceId,
      routerId,
      outcome: 'info',
      requestId: request.id
    });

    const outcome: MutationOutcome =
      action === 'block'
        ? await blockDeviceInternet(setup.adapter, device.mac)
        : await unblockDeviceInternet(setup.adapter, device.mac);

    if (!outcome.ok) {
      await audit.record({
        action: `router.mutation_${action}`,
        actorId: request.authUser!.id,
        targetType: 'device',
        targetId: deviceId,
        routerId,
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: outcome.reason }
      });
      const code =
        outcome.reason === 'offline' ? 502 : outcome.reason === 'device_not_found' ? 404 : 500;
      return await reply.code(code).send({
        error: outcome.reason,
        state: 'state' in outcome ? outcome.state : undefined
      });
    }

    // Persist the application-side view of Internet access.
    await observabilityRepository.setInternetAccess(deviceId, outcome.state === 'blocked');

    await audit.record({
      action: `router.mutation_${action}`,
      actorId: request.authUser!.id,
      targetType: 'device',
      targetId: deviceId,
      routerId,
      outcome: 'success',
      requestId: request.id,
      metadata: { state: outcome.state }
    });

    return { status: 'ok', state: outcome.state };
  }

  app.post(
    '/api/routers/:routerId/devices/:deviceId/block',
    async (request, reply) => handle(request, reply, 'block')
  );

  app.post(
    '/api/routers/:routerId/devices/:deviceId/unblock',
    async (request, reply) => handle(request, reply, 'unblock')
  );
}
