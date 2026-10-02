import { describe, it, expect, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SearchIndexService } from '../../src/modules/search/index-service.js';

function fixture() {
  let documents = 10;
  let capacity = 1000;
  const getStats = vi.fn(async () => ({ numberOfDocuments: documents }));
  const getPagination = vi.fn(async () => ({ maxTotalHits: capacity }));
  const updatePagination = vi.fn(({ maxTotalHits }: { maxTotalHits: number }) => ({ waitTask: async () => { capacity = maxTotalHits; } }));
  const service = new SearchIndexService({ meilisearch: { index: () => ({ getStats, getPagination, updatePagination }) } } as unknown as FastifyInstance);
  return { service, getStats, getPagination, updatePagination, grow: (count: number) => { documents = count; } };
}

describe('Search result-window synchronization', () => {
  it('does not repeat metadata round trips for ordinary concurrent reads', async () => {
    const f = fixture();
    await Promise.all(Array.from({ length: 100 }, () => f.service.ensureCompletePagination(false, 24)));
    await f.service.ensureCompletePagination(false, 24);
    expect(f.getStats).toHaveBeenCalledTimes(1);
    expect(f.getPagination).toHaveBeenCalledTimes(1);
  });

  it('grows beyond 1000 on writes and refreshes when requesting a deeper page', async () => {
    const f = fixture();
    await f.service.ensureCompletePagination();
    f.grow(1005);
    await f.service.ensureCompletePagination(true);
    expect(f.updatePagination).toHaveBeenLastCalledWith({ maxTotalHits: 1005 });
    f.grow(2005);
    await f.service.ensureCompletePagination(false, 1020);
    expect(f.updatePagination).toHaveBeenLastCalledWith({ maxTotalHits: 2005 });
  });

  it('retries failed metadata reads instead of treating incomplete results as ready', async () => {
    const f = fixture();
    f.getStats.mockRejectedValueOnce(new Error('temporary outage'));
    await expect(f.service.ensureCompletePagination()).rejects.toThrow('temporary outage');
    await f.service.ensureCompletePagination();
    expect(f.getStats).toHaveBeenCalledTimes(2);
  });
});
