import type { FastifyInstance } from 'fastify';
import type { SpeedtestRunRequest, SpeedtestProviderType } from '@miwifi-webui/contracts';
import { requireAuth } from '../auth/plugin.js';
import type { SpeedtestService } from '../speedtest/service.js';
import { isValidUuid } from '../utils/uuid.js';

export interface SpeedtestRoutesOptions {
  readonly speedtestService: SpeedtestService;
}

// Keeps in sync with SpeedtestProviderType union in @miwifi-webui/contracts.
const VALID_PROVIDERS = new Set<string>(['auto', 'cloudflare', 'mlab']);

export function registerSpeedtestRoutes(
  app: FastifyInstance,
  options: SpeedtestRoutesOptions
): void {
  const { speedtestService } = options;

  // POST /api/speedtest/run
  app.post(
    '/api/speedtest/run',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      if (!requireAuth(request, reply)) return;

      const body = (request.body as SpeedtestRunRequest | undefined) ?? {};

      // H-3: Reject unknown provider values rather than silently falling back.
      const provider = body.provider as SpeedtestProviderType | undefined;
      if (provider !== undefined && !VALID_PROVIDERS.has(provider)) {
        return reply.code(400).send({ error: 'invalid_provider' });
      }

      // H-1: routerId must be a well-formed UUID when provided.
      const routerId = body.routerId;
      if (routerId !== undefined && !isValidUuid(routerId)) {
        return reply.code(400).send({ error: 'invalid_router_id' });
      }

      try {
        const result = await speedtestService.runTest({
          provider,
          triggeredBy: 'manual',
          routerId,
          actorId: request.authUser?.id
        });
        return reply.code(200).send({ result });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already in progress')) {
          return reply.code(409).send({ error: 'speedtest_already_running' });
        }
        // Do not expose provider errors, internal network paths, database
        // strings or exception stacks to the browser or central log collector.
        app.log.warn({ event: 'speedtest_provider_failed' }, 'speedtest request failed');
        return reply.code(500).send({ error: 'speedtest_failed' });
      }
    }
  );

  // GET /api/speedtest/latest
  app.get(
    '/api/speedtest/latest',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      if (!requireAuth(request, reply)) return;

      const query = request.query as { routerId?: string } | undefined;

      // H-1: routerId must be a well-formed UUID when provided.
      const routerId = query?.routerId;
      if (routerId !== undefined && !isValidUuid(routerId)) {
        return reply.code(400).send({ error: 'invalid_router_id' });
      }

      const latest = await speedtestService.getLatest(routerId);
      return reply.code(200).send({ latest });
    }
  );

  // GET /api/speedtest/history
  app.get(
    '/api/speedtest/history',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      if (!requireAuth(request, reply)) return;

      const query = request.query as { limit?: string; routerId?: string; since?: string } | undefined;

      // H-1: routerId must be a well-formed UUID when provided.
      const routerId = query?.routerId;
      if (routerId !== undefined && !isValidUuid(routerId)) {
        return reply.code(400).send({ error: 'invalid_router_id' });
      }

      const limit = query?.limit ? Number.parseInt(query.limit, 10) : 10;
      const since = query?.since ? new Date(query.since) : undefined;

      const history = await speedtestService.getHistory(
        Number.isInteger(limit) ? limit : 10,
        routerId,
        since && !Number.isNaN(since.getTime()) ? since : undefined
      );
      return reply.code(200).send({ history });
    }
  );
}
