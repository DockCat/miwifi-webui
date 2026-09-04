/**
 * Local administrative recovery CLI (ADR 0003).
 *
 * Runs on the host/container: creates the first administrator when
 * bootstrap is unavailable, or resets a forgotten password. Audit-logged.
 *
 * Usage:
 *   pnpm --filter @miwifi-webui/api admin:create <username>
 *   pnpm --filter @miwifi-webui/api admin:reset-password <username>
 * Password is read from ADMIN_PASSWORD env var, never from argv.
 */
import process from 'node:process';
import { loadConfig } from '../config.js';
import { createPool, closePool } from '../db/pool.js';
import { AuthRepository } from '../auth/repository.js';
import { hashPassword, validatePasswordPolicy } from '../auth/passwords.js';
import { AuditWriter } from '../audit/writer.js';

async function main(): Promise<void> {
  const [command, username] = process.argv.slice(2);
  if (!command || !username) {
    console.error('Usage: admin <create|reset-password> <username>');
    process.exit(2);
  }

  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('Set ADMIN_PASSWORD in the environment (never pass it as an argument).');
    process.exit(2);
  }
  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    console.error(policyError);
    process.exit(2);
  }

  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const repository = new AuthRepository(pool);
  const audit = new AuditWriter(pool);

  try {
    if (command === 'create') {
      const count = await repository.userCount();
      if (count > 0) {
        console.error('An administrator already exists; use reset-password instead.');
        process.exit(1);
      }
      const user = await repository.createUser(username, await hashPassword(password));
      await audit.record({
        action: 'auth.cli_admin_created',
        actorId: user.id,
        targetType: 'user',
        targetId: user.id,
        outcome: 'success',
        metadata: { channel: 'cli' }
      });
      console.log(`Administrator created: ${user.username}`);
    } else if (command === 'reset-password') {
      const user = await repository.findUserByUsername(username);
      if (!user) {
        console.error('User not found.');
        process.exit(1);
      }
      await repository.updateUserPassword(user.id, await hashPassword(password));
      const revoked = await repository.revokeAllSessionsForUser(user.id);
      await audit.record({
        action: 'auth.cli_password_reset',
        actorId: user.id,
        targetType: 'user',
        targetId: user.id,
        outcome: 'success',
        metadata: { channel: 'cli', sessions_revoked: revoked }
      });
      console.log(`Password updated for ${user.username}; ${revoked} session(s) revoked.`);
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(2);
    }
  } finally {
    await closePool(pool);
  }
}

void main();
