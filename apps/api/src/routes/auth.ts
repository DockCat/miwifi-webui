/**
 * Auth routes: bootstrap, login, logout, session info, password change.
 *
 * Security notes:
 * - Bootstrap: only when the user table is empty AND request is loopback;
 *   permanently closed (409) once an administrator exists (ADR 0003).
 * - Login failures are generic (no username-existence signal in responses);
 *   detail goes to audit only.
 * - Passwords never appear in responses, logs, or audit metadata.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthRepository } from '../auth/repository.js';
import type { AuditWriter } from '../audit/writer.js';
import { hashPassword, validatePasswordPolicy, verifyPassword, DUMMY_PASSWORD_HASH } from '../auth/passwords.js';
import { generateSessionToken } from '../auth/tokens.js';
import {
  requireAuth,
  registerAuth,
  SESSION_COOKIE,
  sessionCookieOptions
} from '../auth/plugin.js';

export interface AuthRoutesOptions {
  repository: AuthRepository;
  audit: AuditWriter;
}

function isLoopback(request: FastifyRequest): boolean {
  const ip = request.ip;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

interface CredentialsBody {
  username?: unknown;
  password?: unknown;
  currentPassword?: unknown;
  newPassword?: unknown;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions
): void {
  const { repository, audit } = options;

  registerAuth(app, { repository });

  const issueSession = async (
    request: FastifyRequest,
    reply: FastifyReply,
    userId: string,
    rotatedFrom: string | null
  ) => {
    // Rotation: revoke existing sessions, then issue a fresh token.
    await repository.revokeAllSessionsForUser(userId);
    const token = generateSessionToken();
    const session = await repository.createSession(userId, token, rotatedFrom);
    request.session = session;
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(request));
  };

  const readCredentials = (request: FastifyRequest): CredentialsBody =>
    (request.body ?? {}) as CredentialsBody;

  // --- Bootstrap: create the first (and only) bootstrap administrator. ---
  app.post('/api/auth/bootstrap', async (request, reply) => {
    const count = await repository.userCount();
    if (count > 0) {
      return await reply.code(409).send({ error: 'bootstrap_already_completed' });
    }
    if (!isLoopback(request)) {
      return await reply.code(403).send({ error: 'bootstrap_local_only' });
    }

    const body = readCredentials(request);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^[a-z0-9_.-]{3,32}$/i.test(username)) {
      return await reply.code(400).send({ error: 'invalid_username' });
    }
    const policyError = validatePasswordPolicy(password);
    if (policyError) {
      return await reply.code(400).send({ error: 'invalid_password', message: policyError });
    }

    const passwordHash = await hashPassword(password);
    const user = await repository.createUser(username, passwordHash);
    await audit.record({
      action: 'auth.bootstrap_admin_created',
      actorId: user.id,
      targetType: 'user',
      targetId: user.id,
      outcome: 'success',
      requestId: request.id
    });
    await issueSession(request, reply, user.id, null);
    return await reply.code(201).send({ status: 'created', username: user.username });
  });

  // --- Login ---
  app.post('/api/auth/login', async (request, reply) => {
    const body = readCredentials(request);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    // Always run one Argon2id verification (unknown users verify against a
    // dummy hash) so response timing cannot reveal account existence.
    const user = username ? await repository.findUserByUsername(username) : null;
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

    if (!user || !ok) {
      await audit.record({
        action: 'auth.login',
        targetType: 'user',
        targetId: username,
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'invalid_credentials' }
      });
      return await reply.code(401).send({ error: 'invalid_credentials' });
    }

    await issueSession(request, reply, user.id, request.session?.id ?? null);
    await audit.record({
      action: 'auth.login',
      actorId: user.id,
      targetType: 'user',
      targetId: user.id,
      outcome: 'success',
      requestId: request.id
    });
    return { status: 'ok' };
  });

  // --- Logout ---
  app.post('/api/auth/logout', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    await repository.revokeSession(request.session!.id);
    await audit.record({
      action: 'auth.logout',
      actorId: request.authUser!.id,
      targetType: 'session',
      targetId: request.session!.id,
      outcome: 'success',
      requestId: request.id
    });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { status: 'ok' };
  });

  // --- Current session info ---
  app.get('/api/auth/session', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    return {
      username: request.authUser!.username,
      session: {
        createdAt: request.session!.createdAt,
        absoluteExpiresAt: request.session!.absoluteExpiresAt
      }
    };
  });

  // --- Password change (revokes all sessions, forces re-login) ---
  app.post('/api/auth/password', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply.sent as unknown as object;
    const body = readCredentials(request);
    const currentPassword =
      typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    const ok = await verifyPassword(currentPassword, request.authUser!.passwordHash);
    if (!ok) {
      await audit.record({
        action: 'auth.password_change',
        actorId: request.authUser!.id,
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'invalid_credentials' }
      });
      return await reply.code(401).send({ error: 'invalid_credentials' });
    }
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) {
      return await reply.code(400).send({ error: 'invalid_password', message: policyError });
    }

    const newHash = await hashPassword(newPassword);
    await repository.updateUserPassword(request.authUser!.id, newHash);
    const revoked = await repository.revokeAllSessionsForUser(request.authUser!.id);
    await audit.record({
      action: 'auth.password_change',
      actorId: request.authUser!.id,
      outcome: 'success',
      requestId: request.id,
      metadata: { sessions_revoked: revoked }
    });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { status: 'ok', sessionsRevoked: revoked };
  });
}
