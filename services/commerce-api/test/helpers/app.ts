import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/app.js';

export async function createTestApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = await buildApp(options);
  await app.ready();
  return app;
}
