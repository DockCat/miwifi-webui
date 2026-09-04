/**
 * Session authentication plugin.
 *
 * - Parses the single session cookie (strict minimal parser, no dependency).
 * - Decorates request.session / request.authUser when a valid session exists.
 * - requireAuth preHandler for protected routes.
 * - Origin check on state-changing methods (CSRF defense): when an Origin
 *   header is present (browsers always send it cross-site), it must match
 *   the request Host.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthRepository } from './repository.js';
import type { SessionRow, UserRow } from './repository.js';

export const SESSION_COOKIE = 'miwifi_session';

declare module 'fastify' {
  interface FastifyRequest {
    rawToken: string;
    session: SessionRow | undefined;
    authUser: UserRow | undefined;
  }
}

export interface AuthPluginOptions {
  repository: AuthRepository;
}

export function registerAuth(app: FastifyInstance, options: AuthPluginOptions): void {
  const { repository } = options;

  app.decorateRequest('rawToken', '');
  app.decorateRequest('session', undefined);
  app.decorateRequest('authUser', undefined);

  // Strict cookie parse: only our own cookie matters; ignore everything else.
  app.addHook('onRequest', async (request) => {
    const cookieHeader = request.headers.cookie;
    if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return;
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === SESSION_COOKIE) {
        request.rawToken = part.slice(eq + 1).trim();
        return;
      }
    }
  });

  // CSRF / origin defense for state-changing methods.
  app.addHook('onRequest', async (request, reply) => {
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    const origin = request.headers.origin;
    if (!origin) return; // Non-browser clients (curl, healthchecks) send none.
    const host = request.headers.host;
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // fall through to reject
    }
    if (!host || !originHost || originHost !== host) {
      await reply.code(403).send({ error: 'forbidden' });
    }
  });

  // Resolve session + user on every request (two cheap PK lookups).
  app.addHook('preHandler', async (request) => {
    if (!request.rawToken) return;
    const session = await repository.findValidSession(request.rawToken);
    if (!session) return;
    const user = await repository.findUserById(session.userId);
    if (!user) return;
    request.session = session;
    request.authUser = user;
    await repository.touchSession(session.id);
  });
}

export function sessionCookieOptions(request: FastifyRequest) {
  const secure =
    request.protocol === 'https' ||
    (request.headers['x-forwarded-proto'] ?? '') === 'https';
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/'
  };
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!request.session || !request.authUser) {
    void reply.code(401).send({ error: 'unauthenticated' });
    return false;
  }
  return true;
}
