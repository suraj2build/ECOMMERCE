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
  return {
    service, getStats, getPagination, updatePagination,
    grow: (count: number) => { documents = count; },
    setWindow: (value: number) => { capacity = value; },
    // What Meilisearch reports for a query matching every document.
    search: vi.fn(async () => ({ totalHits: Math.min(documents, capacity) })),
  };
}

describe('Search result-window synchronization', () => {
  it('does not repeat metadata round trips for ordinary concurrent reads', async () => {
    const f = fixture();
    await Promise.all(Array.from({ length: 100 }, () => f.service.ensureCompletePagination(false, 24)));
    await f.service.ensureCompletePagination(false, 24);
    expect(f.getStats).toHaveBeenCalledTimes(1);
    expect(f.getPagination).toHaveBeenCalledTimes(1);
  });

  it('keeps the window above the document count on writes and deeper pages', async () => {
    const f = fixture();
    f.grow(1000);
    await f.service.ensureCompletePagination();
    expect(f.updatePagination).toHaveBeenLastCalledWith({ maxTotalHits: 1001 });
    f.grow(1005);
    await f.service.ensureCompletePagination(true);
    expect(f.updatePagination).toHaveBeenLastCalledWith({ maxTotalHits: 1006 });
    f.grow(2005);
    await f.service.ensureCompletePagination(false, 1020);
    expect(f.updatePagination).toHaveBeenLastCalledWith({ maxTotalHits: 2006 });
  });

  it('retries failed metadata reads instead of treating incomplete results as ready', async () => {
    const f = fixture();
    f.getStats.mockRejectedValueOnce(new Error('temporary outage'));
    await expect(f.service.ensureCompletePagination()).rejects.toThrow('temporary outage');
    await f.service.ensureCompletePagination();
    expect(f.getStats).toHaveBeenCalledTimes(2);
  });
});

describe('Complete search results', () => {
  it('returns a result below the live window after one search', async () => {
    const f = fixture();
    const result = await f.service.searchComplete(24, f.search);
    expect(result.totalHits).toBe(10);
    expect(f.search).toHaveBeenCalledTimes(1);
  });

  it('never returns a result capped by a window reset outside the API, even immediately after it', async () => {
    const f = fixture();
    f.grow(1005);
    await f.service.ensureCompletePagination(true);
    f.setWindow(1000); // e.g. Meilisearch restored with its default 1,000-hit window
    const result = await f.service.searchComplete(24, f.search);
    expect(result.totalHits).toBe(1005);
    expect(f.search).toHaveBeenCalledTimes(2);
    expect(f.updatePagination).toHaveBeenLastCalledWith({ maxTotalHits: 1006 });
  });

  it('reruns a search that ran on a window another request grew while it was in flight', async () => {
    const f = fixture();
    f.grow(1005);
    await f.service.ensureCompletePagination(true);
    f.setWindow(1000);
    let first = true;
    const search = vi.fn(async () => {
      if (!first) return f.search();
      first = false;
      f.setWindow(1006); // grown by another request before this one re-reads the window
      return { totalHits: 1000 }; // what the search saw on the 1,000-hit window
    });
    const result = await f.service.searchComplete(24, search);
    expect(result.totalHits).toBe(1005);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('fails rather than return a possibly truncated result when the window keeps being reset', async () => {
    const f = fixture();
    f.grow(1005);
    const search = vi.fn(async () => { f.setWindow(1000); return { totalHits: 1000 }; });
    await expect(f.service.searchComplete(24, search)).rejects.toThrow('could not be confirmed complete');
    expect(search).toHaveBeenCalledTimes(3);
  });
});
