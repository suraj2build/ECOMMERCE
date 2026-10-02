import Fastify from 'fastify';
import { describe, it, expect, vi } from 'vitest';
import searchRoutes from '../../src/modules/search/routes.js';

async function fixture() {
  const app = Fastify();
  const search = vi.fn();
  app.decorate('requireStaffAuth', async () => {});
  app.decorate('requirePermission', () => async () => {});
  // Window completeness is covered by search-pagination.test.ts; here it passes through.
  app.decorate('searchIndex', { searchComplete: vi.fn((_minimum: number, run: () => Promise<unknown>) => run()) });
  app.decorate('meilisearch', { index: () => ({ search }) });
  await app.register(searchRoutes);
  await app.ready();
  return { app, search };
}
const result = (price: number) => ({ hits: [{ sellingPrice: price }], page: 1, hitsPerPage: 24, totalHits: 1, totalPages: 1 });

describe('Concurrent public search reads', () => {
  it('shares 200 identical pending reads and discards settled results', async () => {
    const { app, search } = await fixture();
    try {
      let release!: (value: ReturnType<typeof result>) => void;
      search.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
      const requests = Array.from({ length: 200 }, () => app.inject('/storefront/search?q=coat'));
      const all = Promise.all(requests);
      await new Promise((resolve) => setImmediate(resolve));
      expect(search).toHaveBeenCalledTimes(1);
      release(result(1999));
      const replies = await all;
      expect(replies.every((reply) => reply.json().hits[0].sellingPrice === 1999)).toBe(true);
      search.mockResolvedValueOnce(result(1499));
      expect((await app.inject('/storefront/search?q=coat')).json().hits[0].sellingPrice).toBe(1499);
      expect(search).toHaveBeenCalledTimes(2);
    } finally { await app.close(); }
  });

  it('keeps filters separate and retries failed reads', async () => {
    const { app, search } = await fixture();
    try {
      search.mockResolvedValue(result(1999));
      await Promise.all([app.inject('/storefront/search?brand=A'), app.inject('/storefront/search?brand=B')]);
      expect(search).toHaveBeenCalledTimes(2);
      search.mockRejectedValueOnce(new Error('temporary outage'));
      expect((await app.inject('/storefront/search?q=coat')).json().unavailable).toBe(true);
      expect((await app.inject('/storefront/search?q=coat')).json().unavailable).toBeUndefined();
      expect(search).toHaveBeenCalledTimes(4);
    } finally { await app.close(); }
  });
});
