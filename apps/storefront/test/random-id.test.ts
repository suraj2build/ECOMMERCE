import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUuid } from '@/lib/random-id';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUuid outside a secure context', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes a v4 UUID when the browser withholds crypto.randomUUID (plain http on a Wi-Fi address)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    expect(() => (globalThis.crypto as Crypto).randomUUID()).toThrow();
    const ids = new Set(Array.from({ length: 200 }, () => randomUuid()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
  });

  it('uses crypto.randomUUID where it exists', () => {
    expect(randomUuid()).toMatch(V4);
  });
});
