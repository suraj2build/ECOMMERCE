import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyConsent, checkoutTracking, readConsent, saveConsent } from '@/lib/tracking';

/**
 * LR-003 review: the browser half of consent withdrawal. Browser globals are
 * replaced with small fakes; the API is a fetch mock that records bodies.
 */

const PENDING = 'vanya_consent_withdrawal_pending';
let store: Map<string, string>;
let sent: Record<string, unknown>[];
let online: boolean | ((body: Record<string, unknown>) => boolean);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  store = new Map();
  sent = [];
  online = true;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const up = typeof online === 'function' ? online(body) : online;
    if (!up) throw new TypeError('Failed to fetch');
    sent.push(body);
    return new Response(null, { status: 204 });
  }));
});

const pending = () => JSON.parse(store.get(PENDING) ?? '[]') as Record<string, unknown>[];

describe('consent withdrawal in the browser (LR-003)', () => {
  it('gives a consent saved before subject IDs existed a subject, so later checkouts can be withdrawn', () => {
    store.set('vanya_consent_v1', JSON.stringify({ analytics: true, marketing: true, decidedAt: '2026-01-01T00:00:00.000Z' }));
    applyConsent();
    const subject = readConsent()!.subjectId;
    expect(subject).toMatch(/^[0-9a-f-]{36}$/);
    expect(checkoutTracking().consentSubjectId).toBe(subject);
  });

  it('a withdrawal sent late cannot reach checkouts made after consenting again: the subject changes', async () => {
    saveConsent({ analytics: true, marketing: true });
    const before = readConsent()!.subjectId!;
    online = false;
    saveConsent({ analytics: true, marketing: false }); // withdrawn while offline
    await flush();
    expect(pending()).toHaveLength(1);
    saveConsent({ analytics: true, marketing: true }); // consents again
    await flush();
    const after = readConsent()!.subjectId!;
    expect(after).not.toBe(before);
    expect(checkoutTracking().consentSubjectId).toBe(after);

    online = true;
    applyConsent(); // next page load
    await flush();
    expect(sent).toEqual([{ subjectId: before, analytics: true, marketing: false, requestedAt: expect.any(String) }]);
    expect(store.has(PENDING)).toBe(false);
  });

  it('two queued withdrawals are tracked separately: one succeeding never drops the other', async () => {
    saveConsent({ analytics: true, marketing: true });
    online = false;
    saveConsent({ analytics: false, marketing: true }); // first, queued
    await flush();
    // Now only the analytics withdrawal gets through; the marketing one fails.
    online = (body) => body.analytics === false && body.marketing === true;
    saveConsent({ analytics: false, marketing: false });
    await flush();
    expect(sent).toEqual([expect.objectContaining({ analytics: false, marketing: true })]);
    expect(pending()).toEqual([expect.objectContaining({ analytics: false, marketing: false })]);
    online = true;
    applyConsent();
    await flush();
    expect(sent).toHaveLength(2);
    expect(store.has(PENDING)).toBe(false);
  });
});
