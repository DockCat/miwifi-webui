/**
 * Investigation routes (Task 0007; sessions in Task 0011).
 *
 * POST /api/investigations                    — start/append a turn (read-only AI)
 * GET  /api/investigations                    — list investigations (legacy)
 * GET  /api/investigations/:id                — investigation + evidence links
 * GET  /api/investigations/sessions           — session list (sidebar)
 * GET  /api/investigations/sessions/:id       — session + turns
 * POST /api/investigations/sessions/:id/close — end a session (read-only)
 *
 * AI is disabled by default: without a configured provider the create
 * endpoint returns 503. Audit records who/when/provider/status; question
 * text is never copied into audit metadata.
 *
 * A turn in an open session replays all completed exchanges as
 * conversation context and seeds the alias map from the session's earlier
 * legends so device_01 keeps meaning the same device across turns.
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAuth } from '../auth/plugin.js';
import type { AuditWriter } from '../audit/writer.js';
import type { InvestigationRepository } from '../ai/repository.js';
import { AliasMap, LOCAL_PRIVACY, pseudonymize } from '../ai/privacy.js';
import {
  loadProviderConfig,
  runInvestigation,
  type HistoryTurn,
  type ResponseLocale,
  type RunInvestigationOptions
} from '../ai/provider.js';
import type { ToolContextBase } from '../ai/tools.js';
import type { PollingScheduler } from '../observability/scheduler.js';

/** Application UTF-8 byte budget; not a model-specific token count. */
export const SESSION_CONTEXT_BYTES = 48_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function historyBytes(history: readonly HistoryTurn[], question: string): number {
  return Buffer.byteLength(JSON.stringify(history) + question, 'utf8');
}

export interface InvestigationRoutesOptions {
  repository: InvestigationRepository;
  audit: AuditWriter;
  /** Tool queries run against this pool (bounded, fixed SQL — no raw access). */
  pool: pg.Pool;
  /** Live in-memory observations for the device tools; absent in tests. */
  scheduler?: PollingScheduler;
}

/**
 * Prior completed exchanges as conversation context, oldest first.
 * Failed/running turns are skipped — error text is not conversation.
 */
export function historyFromInvestigations(
  rows: ReadonlyArray<{ status: string; question: string; finding: string | null; transcript?: HistoryTurn['transcript'] }>
): HistoryTurn[] {
  return rows.filter((row) => row.status === 'completed' && typeof row.finding === 'string')
    .map((row) => {
      const transcript = Array.isArray(row.transcript)
        ? row.transcript.filter((message) =>
            message !== null && typeof message === 'object' &&
            (message.role === 'user' || message.role === 'assistant' || message.role === 'tool') &&
            typeof message.content === 'string'
          )
        : [];
      return {
        question: row.question,
        finding: row.finding as string,
        ...(transcript.length ? { transcript } : {})
      };
    });
}

export function registerInvestigationRoutes(
  app: FastifyInstance,
  options: InvestigationRoutesOptions
): void {
  const { repository, audit } = options;
  // ponytail: one API process per ADR 0004; use DB locks if replicas are introduced.
  const activeSessions = new Set<string>();

  // --- Session routes (registered before the :id investigation routes so
  //     the static "sessions" segment is never captured as :id). ---

  app.get('/api/investigations/sessions', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    const rows = await repository.listSessions();
    return {
      sessions: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        turnCount: row.turnCount,
        lastQuestion: row.lastQuestion,
        createdAt: row.createdAt.toISOString(),
        lastActivityAt: row.lastActivityAt.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null
      }))
    };
  });

  app.get('/api/investigations/sessions/:id', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    const { id } = request.params as { id: string };
    if (!UUID_PATTERN.test(id)) return await reply.code(404).send({ error: 'session_not_found' });
    const session = await repository.findSession(id);
    if (!session) return await reply.code(404).send({ error: 'session_not_found' });
    const turns = await repository.listSessionInvestigations(id);
    return {
      session: {
        id: session.id,
        title: session.title,
        status: session.status,
        createdAt: session.createdAt.toISOString(),
        lastActivityAt: session.lastActivityAt.toISOString(),
        closedAt: session.closedAt?.toISOString() ?? null
      },
      investigations: turns.map((row) => ({
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

  app.post('/api/investigations/sessions/:id/close', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    const { id } = request.params as { id: string };
    if (!UUID_PATTERN.test(id)) return await reply.code(404).send({ error: 'session_not_found' });
    const session = await repository.findSession(id);
    if (!session) return await reply.code(404).send({ error: 'session_not_found' });
    if (session.status === 'closed') {
      return await reply.code(409).send({ error: 'session_already_closed' });
    }
    if (activeSessions.has(id)) return await reply.code(409).send({ error: 'session_busy' });
    const closed = await repository.closeSession(id);
    if (!closed) return await reply.code(409).send({ error: 'session_already_closed' });
    await audit.record({
      action: 'ai.session_closed',
      actorId: request.authUser!.id,
      targetType: 'investigation_session',
      targetId: id,
      routerId: session.routerId,
      outcome: 'success',
      requestId: request.id,
      metadata: {}
    });
    return { sessionId: id, status: 'closed' };
  });

  // --- Investigations (turns) ---

  app.get('/api/investigations', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    const rows = await repository.list();
    return {
      investigations: rows.map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
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
    if (!UUID_PATTERN.test(id)) return await reply.code(404).send({ error: 'not_found' });
    const row = await repository.find(id);
    if (!row) return await reply.code(404).send({ error: 'not_found' });
    const evidence = await repository.listEvidence(id);
    return {
      investigation: {
        id: row.id,
        sessionId: row.sessionId,
        status: row.status,
        question: row.question,
        finding: row.finding,
        provider: row.provider,
        model: row.model,
        aliasLegend: row.aliasLegend,
        transcript: row.transcript,
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null
      },
      evidence: evidence.map((link) => ({
        id: link.id,
        kind: link.evidenceKind,
        evidenceId: link.evidenceId,
        note: link.note
      }))
    };
  });

  app.post('/api/investigations', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;

    const body = (request.body ?? {}) as {
      question?: unknown;
      routerId?: unknown;
      sessionId?: unknown;
      locale?: unknown;
    };
    const question = typeof body.question === 'string'
      ? pseudonymize(body.question.trim(), LOCAL_PRIVACY, new AliasMap()) as string : '';
    const routerId = typeof body.routerId === 'string' ? body.routerId : '';
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0 ? body.sessionId : null;
    const locale: ResponseLocale = body.locale === 'zh-CN' ? 'zh-CN' : 'en';
    if (question.length < 3 || question.length > 2000) {
      return await reply.code(400).send({ error: 'invalid_question' });
    }
    if (!UUID_PATTERN.test(routerId)) {
      return await reply.code(400).send({ error: 'invalid_router' });
    }
    if (sessionId && !UUID_PATTERN.test(sessionId)) {
      return await reply.code(404).send({ error: 'session_not_found' });
    }

    const provider = loadProviderConfig();
    // Do not create an empty session while AI is disabled. Existing session
    // ids are resolved first so unknown/closed ids retain their stable 404/409
    // contract even when the provider is unavailable.
    if (!sessionId && provider.mode === 'disabled') {
      return await reply.code(503).send({ error: 'ai_disabled' });
    }
    if (sessionId && activeSessions.has(sessionId)) return await reply.code(409).send({ error: 'session_busy' });
    if (sessionId) activeSessions.add(sessionId);
    let lockedSessionId: string | null = sessionId;
    try {
      // Session resolution: append to an open one, or lazily create — the
      // first question names the session.
      let session: { id: string } | null = null;
      if (sessionId) {
        const existing = await repository.findSession(sessionId);
        if (!existing) return await reply.code(404).send({ error: 'session_not_found' });
        if (existing.status === 'closed') {
          return await reply.code(409).send({ error: 'session_closed' });
        }
        if (existing.routerId !== routerId) {
          return await reply.code(400).send({ error: 'session_router_mismatch' });
        }
        session = { id: existing.id };
      } else {
        const created = await repository.createSession({
          routerId,
          startedBy: request.authUser!.id,
          title: question.slice(0, 60)
        });
        session = { id: created.id };
      }
      if (provider.mode === 'disabled') {
        return await reply.code(503).send({ error: 'ai_disabled' });
      }

      let priorTurns = await repository.listSessionInvestigations(session.id);
      let history = historyFromInvestigations(priorTurns);
      let rotatedFrom: string | null = null;
      if (historyBytes(history, question) > SESSION_CONTEXT_BYTES) {
        rotatedFrom = session.id;
        try {
          session = await repository.rotateSession(session.id, {
            routerId, startedBy: request.authUser!.id, title: question.slice(0, 60)
          });
        } catch (error) {
          if (error instanceof Error && error.message === 'session_closed') {
            return await reply.code(409).send({ error: 'session_closed' });
          }
          throw error;
        }
        priorTurns = [];
        history = [];
      }
      if (!lockedSessionId) lockedSessionId = session.id;
      activeSessions.add(session.id);
      const currentSessionId = session.id;
      try {
        const investigation = await repository.create({
          startedBy: request.authUser!.id,
          provider: provider.mode,
          model: provider.model,
          question,
          sessionId: session.id
        });
        await repository.touchSession(session.id);
        await audit.record({
          action: 'ai.investigation_started',
          actorId: request.authUser!.id,
          targetType: 'investigation',
          targetId: investigation.id,
          routerId,
          outcome: 'success',
          requestId: request.id,
          metadata: {
            provider: provider.mode,
            model: provider.model ?? '',
            sessionId: session.id,
            locale
          }
        });

        // Conversation context: replay prior completed exchanges and seed the
        // alias map from their legends so aliases stay stable across turns.
        const aliases = new AliasMap();
        aliases.seedFromLegend(priorTurns.flatMap((row) => row.aliasLegend));

        // Base context only: runInvestigation fills in privacy (the route must
        // not need to know the privacy policy details).
        const ctx: ToolContextBase = {
          pool: options.pool,
          routerId,
          scheduler: options.scheduler
        };
        const runOptions: RunInvestigationOptions = { locale, history, aliases,
          onTool: async (name, succeeded) => {
            await audit.record({ action: 'ai.tool_invoked', actorId: request.authUser!.id,
              targetType: 'investigation', targetId: investigation.id, routerId,
              outcome: succeeded ? 'success' : 'failure', requestId: request.id,
              metadata: { operation: name } });
          }
        };
        try {
          const result = await runInvestigation(provider, ctx, question, runOptions);
          for (const link of result.evidence) {
            await repository.addEvidence(investigation.id, link);
          }
          await repository.complete(
            investigation.id,
            'completed',
            result.finding,
            result.aliasLegend,
            result.transcript
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
          return {
            investigationId: investigation.id,
            sessionId: session.id,
            status: 'completed',
            rotatedFrom,
            contextBudgetBytes: SESSION_CONTEXT_BYTES,
            finding: result.finding
          };
        } catch (error) {
          const reason = error instanceof Error && error.message === 'context_budget_exceeded'
            ? 'context_budget_exceeded' : 'provider_error';
          request.log.warn({ investigationId: investigation.id, reason }, 'AI investigation failed');
          await repository.complete(
            investigation.id,
            'failed',
            reason
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
              reason: reason.slice(0, 120)
            }
          });
          return await reply.code(502).send({ error: 'provider_error', detail: reason });
        }
      } finally { activeSessions.delete(currentSessionId); }
    } finally { if (lockedSessionId) activeSessions.delete(lockedSessionId); }
  });
}
