import { loadEnv } from '@fcp/config';
import { buildApp } from './app.js';
import { startServer } from './server.js';

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

  try {
    await startServer(app, { production: env.NODE_ENV === 'production', port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    await app.close().catch(() => undefined);
    throw err;
  }
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
