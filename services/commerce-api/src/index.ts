import { loadEnv } from '@fcp/config';
import { buildApp } from './app.js';
import { countNonV1MfaSecrets } from './modules/auth/mfa-secret-backfill.js';

async function main() {
  const env = loadEnv();
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Safety net for the MFA upgrade deployment step (DEPLOYMENT.md): if the
  // backfill was skipped, affected staff cannot complete MFA login (the
  // reader never falls back to plaintext), so say so loudly - count only.
  const pendingMfaUpgrades = await countNonV1MfaSecrets(app.prisma).catch(() => 0);
  if (pendingMfaUpgrades > 0) {
    app.log.warn(
      { pendingMfaUpgrades },
      'Stored MFA secrets not yet in v1 encrypted format - run the MFA backfill (npm run mfa:backfill) before serving staff logins',
    );
  }

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
