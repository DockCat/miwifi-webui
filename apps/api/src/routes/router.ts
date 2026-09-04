/**
 * Router onboarding + management routes (ADR 0001 / Task 0003).
 *
 * Onboarding accepts a host/address — NEVER an arbitrary URL — validated by
 * validateRouterTarget against the local/private-network policy. The probe
 * runs read-only; the password is sealed under APP_MASTER_KEY immediately
 * and never returned, logged, or audited.
 */
import type { FastifyInstance } from 'fastify';
import type { RouterSummary } from '@miwifi-webui/contracts';
import {
  HttpRouterTransport,
  MiWifiAdapter,
  validateRouterTarget
} from '@miwifi-webui/router-core';
import { requireAuth } from '../auth/plugin.js';
import type { RouterRepository, RouterRow } from '../router/repository.js';
import { parseMasterKey } from '../crypto/envelope.js';
import type { AuditWriter } from '../audit/writer.js';

export interface RouterRoutesOptions {
  repository: RouterRepository;
  audit: AuditWriter;
}

function toSummary(row: RouterRow): RouterSummary {
  return {
    id: row.id,
    host: row.host,
    model: row.model,
    hardware: row.hardware,
    romVersion: row.romVersion,
    compatibility: row.compatibility,
    capabilities: [...row.capabilities],
    lastProbedAt: row.lastProbedAt ? row.lastProbedAt.toISOString() : null
  };
}

interface OnboardBody {
  host?: unknown;
  username?: unknown;
  password?: unknown;
}

export function registerRouterRoutes(
  app: FastifyInstance,
  options: RouterRoutesOptions
): void {
  const { repository, audit } = options;

  // --- List routers (browser-safe summaries). ---
  app.get('/api/routers', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    const routers = await repository.listRouters();
    return { routers: routers.map(toSummary) };
  });

  // --- Onboard / re-probe a router. ---
  app.post('/api/routers/onboard', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;

    const body = (request.body ?? {}) as OnboardBody;
    const host = typeof body.host === 'string' ? body.host.trim() : '';
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    // Target validation: local/private policy, no arbitrary URLs.
    const target = validateRouterTarget(host);
    if (!target) {
      return await reply.code(400).send({ error: 'invalid_router_target' });
    }
    if (username.length === 0 || password.length === 0) {
      return await reply.code(400).send({ error: 'invalid_credentials' });
    }

    let masterKey: Buffer;
    try {
      masterKey = parseMasterKey(process.env.APP_MASTER_KEY);
    } catch {
      return await reply.code(503).send({ error: 'master_key_not_configured' });
    }

    // Probe via a real HTTP transport against the validated host.
    const transport = new HttpRouterTransport({ host: target.host });
    const adapter = new MiWifiAdapter(transport, { username, password });
    const probe = await adapter.probe();

    if (!probe.authenticated) {
      await audit.record({
        action: 'router.onboarding',
        targetType: 'router',
        targetId: target.host,
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: probe.status.toLowerCase() }
      });
      const code =
        probe.status === 'INCOMPATIBLE' ? 422 : 502;
      return await reply.code(code).send({
        error: probe.status === 'INCOMPATIBLE' ? 'incompatible_router' : 'router_unreachable',
        probe: {
          status: probe.status,
          model: probe.identity.model ?? null
        }
      });
    }

    const routerRow = await repository.upsertRouter({
      host: target.host,
      model: probe.identity.model ?? null,
      hardware: probe.identity.hardware ?? null,
      romVersion: probe.identity.romVersion ?? null,
      channel: probe.identity.channel ?? null,
      compatibility: probe.status,
      capabilities: probe.capabilities
    });
    // Seal the credential immediately; plaintext not retained after this.
    await repository.saveCredential(routerRow.id, username, password, masterKey.toString('base64'));

    await audit.record({
      action: 'router.onboarding',
      actorId: request.authUser!.id,
      targetType: 'router',
      targetId: routerRow.id,
      routerId: routerRow.id,
      outcome: 'success',
      requestId: request.id,
      metadata: {
        compatibility: probe.status,
        capabilities: probe.capabilities.join(',')
      }
    });

    const summary = toSummary(routerRow);
    const responseBlob = JSON.stringify(summary);
    if (responseBlob.includes(password)) {
      // Defense in depth: must be impossible; fail closed.
      return await reply.code(500).send({ error: 'internal' });
    }
    return { router: summary };
  });
}
