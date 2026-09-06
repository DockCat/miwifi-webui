/**
 * Investigation routes (Task 0007).
 *
 * POST /api/investigations        — start an investigation (read-only AI)
 * GET  /api/investigations        — list sessions
 * GET  /api/investigations/:id    — session + evidence links
 *
 * AI is disabled by default: without a configured provider the create
 * endpoint returns 503. Audit records who/when/provider/status; question
 * text goes to audit metadata only when short (bounded, non-secret).
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAuth } from '../auth/plugin.js';
import type { AuditWriter } from '../audit/writer.js';
import type { InvestigationRepository } from '../ai/repository.js';
import { loadProviderConfig, runInvestigation } from '../ai/provider.js';
import type { ToolContextBase } from '../ai/tools.js';

export interface InvestigationRoutesOptions {
  repository: InvestigationRepository;
  audit: AuditWriter;
  /** Tool queries run against this pool (bounded, fixed SQL — no raw access). */
  pool: pg.Pool;
}

export function registerInvestigationRoutes(
  app: FastifyInstance,
  options: InvestigationRoutesOptions
): void {
  const { repository, audit } = options;

  app.get('/api/investigations', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    const rows = await repository.list();
    return {
      investigations: rows.map((row) => ({
        id: row.id,
        status: row.status,
        question: row.question,
        finding: row.finding,
        provider: row.provider,
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null
      }))
    };
  });

  app.get('/api/investigations/:id', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    const { id } = request.params as { id: string };
    const row = await repository.find(id);
    if (!row) return await reply.code(404).send({ error: 'not_found' });
    const evidence = await repository.listEvidence(id);
    return {
      investigation: {
        id: row.id,
        status: row.status,
        question: row.question,
        finding: row.finding,
        provider: row.provider,
        model: row.model,
        aliasLegend: row.aliasLegend,
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null
      },
      evidence: evidence.map((link) => ({
        id: link.id,
        kind: link.evidenceKind,
        evidenceId: link.evidenceId
      }))
    };
  });

  app.post('/api/investigations', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;

    const body = (request.body ?? {}) as { question?: unknown; routerId?: unknown };
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const routerId = typeof body.routerId === 'string' ? body.routerId : '';
    if (question.length < 3 || question.length > 2000) {
      return await reply.code(400).send({ error: 'invalid_question' });
    }
    if (routerId.length === 0) {
      return await reply.code(400).send({ error: 'invalid_router' });
    }

    const provider = loadProviderConfig();
    if (provider.mode === 'disabled') {
      return await reply.code(503).send({ error: 'ai_disabled' });
    }

    const investigation = await repository.create({
      startedBy: request.authUser!.id,
      provider: provider.mode,
      model: provider.model,
      question
    });
    await audit.record({
      action: 'ai.investigation_started',
      actorId: request.authUser!.id,
      targetType: 'investigation',
      targetId: investigation.id,
      routerId,
      outcome: 'success',
      requestId: request.id,
      metadata: { provider: provider.mode, model: provider.model ?? '' }
    });

    // Base context only: runInvestigation fills in privacy + aliases (the
  // route must not need to know the privacy policy details).
  const ctx: ToolContextBase = { pool: options.pool, routerId };
    try {
      const result = await runInvestigation(provider, ctx, question);
      for (const link of result.evidence) {
        await repository.addEvidence(investigation.id, link);
      }
      await repository.complete(
        investigation.id,
        'completed',
        result.finding,
        result.aliasLegend
      );
      await audit.record({
        action: 'ai.investigation_completed',
        actorId: request.authUser!.id,
        targetType: 'investigation',
        targetId: investigation.id,
        routerId,
        outcome: 'success',
        requestId: request.id,
        metadata: {
          provider: provider.mode,
          evidence_count: result.evidence.length
        }
      });
      return { investigationId: investigation.id, status: 'completed', finding: result.finding };
    } catch (error) {
      await repository.complete(
        investigation.id,
        'failed',
        null
      );
      await audit.record({
        action: 'ai.investigation_failed',
        actorId: request.authUser!.id,
        targetType: 'investigation',
        targetId: investigation.id,
        routerId,
        outcome: 'failure',
        requestId: request.id,
        metadata: {
          provider: provider.mode,
          reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown'
        }
      });
      return await reply.code(502).send({ error: 'provider_error' });
    }
  });
}
