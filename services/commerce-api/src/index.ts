import { loadEnv } from '@fcp/config';
import { buildApp } from './app.js';
import { startServer } from './server.js';
import { createAppMaintenance } from './maintenance.js';

async function main() {
  const env = loadEnv();
  const app = await buildApp();
  const maintenance = createAppMaintenance(app);
  // Register before listen. Fastify runs close hooks in reverse order,
  // so this drains before the database/Redis plugin close hooks.
  app.addHook('onClose', async () => { await maintenance.stop(); });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await startServer(app, { production: env.NODE_ENV === 'production', port: env.PORT, host: '0.0.0.0' });
    // Integration suites control clock/expiry explicitly; actual dev and
    // production servers always start maintenance without a manual cron.
    if (env.NODE_ENV !== 'test') void maintenance.start();
  } catch (err) {
    await app.close().catch(() => undefined);
    throw err;
  }
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
