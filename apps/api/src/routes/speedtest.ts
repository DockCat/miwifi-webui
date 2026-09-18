import type { FastifyInstance } from 'fastify';
import type { SpeedtestRunRequest, SpeedtestProviderType } from '@miwifi-webui/contracts';
import { requireAuth } from '../auth/plugin.js';
import type { SpeedtestService } from '../speedtest/service.js';

export interface SpeedtestRoutesOptions {
  readonly speedtestService: SpeedtestService;
}

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

      if (speedtestService.isRunning) {
        return reply.code(409).send({ error: 'speedtest_already_running' });
      }

      const body = (request.body as SpeedtestRunRequest | undefined) ?? {};
      const provider = body.provider as SpeedtestProviderType | undefined;

      try {
        const result = await speedtestService.runTest({
          provider,
          triggeredBy: 'manual'
        });
        return reply.code(200).send({ result });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already in progress')) {
          return reply.code(409).send({ error: 'speedtest_already_running' });
        }
        return reply.code(500).send({ error: msg });
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
      const latest = await speedtestService.getLatest(query?.routerId);
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
      const limit = query?.limit ? Number.parseInt(query.limit, 10) : 10;
      const since = query?.since ? new Date(query.since) : undefined;

      const history = await speedtestService.getHistory(
        Number.isInteger(limit) ? limit : 10,
        query?.routerId,
        since && !Number.isNaN(since.getTime()) ? since : undefined
      );
      return reply.code(200).send({ history });
    }
  );
}
