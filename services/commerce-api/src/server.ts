import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { assertMfaStartupSafety, MfaStartupBlockedError } from './modules/auth/mfa-secret-backfill.js';

export interface StartServerOptions {
  production: boolean;
  port: number;
  host: string;
  /** Test seam: the client the MFA startup gate reads through (defaults to the app's). */
  prisma?: PrismaClient;
}

/**
 * The only path from a built app to a listening server: startup safety
 * gates run first, and listen() is not called if any of them refuses.
 */
export async function startServer(app: FastifyInstance, options: StartServerOptions): Promise<void> {
  try {
    await assertMfaStartupSafety(options.prisma ?? app.prisma, app.log, options.production);
  } catch (err) {
    if (err instanceof MfaStartupBlockedError) {
      app.log.fatal({ pendingMfaUpgrades: err.pendingMfaUpgrades }, err.message);
    }
    throw err;
  }
  await app.listen({ port: options.port, host: options.host });
}
