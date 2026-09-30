import { randomInt, randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { __resetEnvCacheForTests } from '@fcp/config';
import { createTestApp } from '../helpers/app.js';
import { mintGuestSessionToken } from '../../src/modules/cart/identity.js';

/**
 * M31 certification repair - rate-limit keying (finding 3).
 *
 * The checkout/payment limiter previously used the raw Authorization or
 * guest header as the bucket key, so every fresh string was a fresh
 * bucket. Now only a VERIFIED identity earns its own bucket; anything
 * unverifiable shares the caller's IP bucket. Proven here against the
 * real Redis-backed limiter on POST /storefront/checkout/preview
 * (30 requests / minute). The limiter counts a request before the route
 * rejects it, so the outcome that matters is 429 vs not-429.
 *
 * Unsigned guest ids are disabled (production semantics). Every test
 * uses its own fresh client IP so buckets never leak between tests,
 * files or runs.
 */
process.env.GUEST_SESSION_ALLOW_UNSIGNED = 'false';
__resetEnvCacheForTests();

const PREVIEW_LIMIT = 30;
const GUEST = 'x-guest-session-id';

function freshIp(): string {
  return `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`;
}

function forgedGuestToken(): string {
  return `gs1.${randomUUID()}.1900000000.1902592000.${'A'.repeat(43)}`;
}

describe('Rate-limit keying on verified identity only (M31 finding 3)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.GUEST_SESSION_ALLOW_UNSIGNED;
    __resetEnvCacheForTests();
  });

  const preview = (ip: string, headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/v1/storefront/checkout/preview', remoteAddress: ip, headers, payload: {} } as InjectOptions);

  async function burst(n: number, ip: string, headersFor: (i: number) => Record<string, string>): Promise<number[]> {
    const codes: number[] = [];
    for (let i = 0; i < n; i++) codes.push((await preview(ip, headersFor(i))).statusCode);
    return codes;
  }

  it('A: a valid guest credential is limited on its own stable bucket', async () => {
    const ip = freshIp();
    const { token } = mintGuestSessionToken();
    const codes = await burst(PREVIEW_LIMIT, ip, () => ({ [GUEST]: token }));
    expect(codes).not.toContain(429);
    expect((await preview(ip, { [GUEST]: token })).statusCode).toBe(429);
    // Same guest from another address is the same bucket - it is keyed on the guest, not the IP.
    expect((await preview(freshIp(), { [GUEST]: token })).statusCode).toBe(429);
  });

  it('B: rotating forged guest tokens from one address cannot mint fresh buckets', async () => {
    const ip = freshIp();
    const codes = await burst(PREVIEW_LIMIT, ip, () => ({ [GUEST]: forgedGuestToken() }));
    expect(codes).not.toContain(429);
    expect((await preview(ip, { [GUEST]: forgedGuestToken() })).statusCode).toBe(429);
    expect((await preview(ip, { [GUEST]: `raw-client-chosen-${randomUUID()}` })).statusCode).toBe(429);
  });

  it('B: an expired (genuinely signed) guest token is unverifiable and also falls back to the IP bucket', async () => {
    const ip = freshIp();
    const now = Math.floor(Date.now() / 1000);
    await burst(PREVIEW_LIMIT, ip, () => ({ [GUEST]: mintGuestSessionToken(now - 2_592_000 - 10 - randomInt(0, 1000)).token }));
    expect((await preview(ip, { [GUEST]: forgedGuestToken() })).statusCode).toBe(429);
  });

  it('C: rotating garbage bearer tokens cannot reset the limiter', async () => {
    const ip = freshIp();
    const codes = await burst(PREVIEW_LIMIT, ip, () => ({ authorization: `Bearer ${randomUUID()}.${randomUUID()}` }));
    expect(codes).not.toContain(429);
    expect((await preview(ip, { authorization: `Bearer ${randomUUID()}` })).statusCode).toBe(429);
    // A forged JWT (right shape, wrong signature) is no better.
    const forgedJwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: randomUUID() })).toString('base64url')}.${'x'.repeat(43)}`;
    expect((await preview(ip, { authorization: `Bearer ${forgedJwt}` })).statusCode).toBe(429);
  });

  it('D: an authenticated customer is keyed on the verified customer id, not the address', async () => {
    const customerId = randomUUID();
    const token = await app.jwt.sign({ sub: customerId, mobile: '9000000000' });
    const auth = { authorization: `Bearer ${token}` };
    const codes = await burst(PREVIEW_LIMIT, freshIp(), () => auth);
    expect(codes).not.toContain(429);
    expect((await preview(freshIp(), auth)).statusCode).toBe(429); // new address, same customer
    const other = await app.jwt.sign({ sub: randomUUID(), mobile: '9000000001' });
    expect((await preview(freshIp(), { authorization: `Bearer ${other}` })).statusCode).not.toBe(429);
  });

  it('E: several legitimate users behind one shared address are not throttled together, and an attacker on that address cannot starve them', async () => {
    const sharedIp = freshIp();
    const guests = [mintGuestSessionToken().token, mintGuestSessionToken().token, mintGuestSessionToken().token];
    const customer = await app.jwt.sign({ sub: randomUUID(), mobile: '9000000002' });
    for (const token of guests) {
      expect(await burst(20, sharedIp, () => ({ [GUEST]: token }))).not.toContain(429); // 60 guest requests on one IP
    }
    expect(await burst(20, sharedIp, () => ({ authorization: `Bearer ${customer}` }))).not.toContain(429);

    await burst(PREVIEW_LIMIT + 5, sharedIp, () => ({ [GUEST]: forgedGuestToken() })); // attacker exhausts the IP bucket
    expect((await preview(sharedIp, { [GUEST]: forgedGuestToken() })).statusCode).toBe(429);
    expect((await preview(sharedIp, { [GUEST]: guests[0]! })).statusCode).not.toBe(429);
    expect((await preview(sharedIp, { authorization: `Bearer ${customer}` })).statusCode).not.toBe(429);
  });

  it('a client-supplied X-Forwarded-For prefix cannot choose the IP bucket (one trusted proxy hop)', async () => {
    const loadBalancer = freshIp();
    const realClient = freshIp();
    const viaLb = (spoofed: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout/preview',
        remoteAddress: loadBalancer,
        headers: { 'x-forwarded-for': `${spoofed}, ${realClient}`, [GUEST]: forgedGuestToken() },
        payload: {},
      } as InjectOptions);
    for (let i = 0; i < PREVIEW_LIMIT; i++) expect((await viaLb(freshIp())).statusCode).not.toBe(429);
    expect((await viaLb(freshIp())).statusCode).toBe(429);
  });

  it('guest-session issuance is limited per address; renewal is limited per verified owner', async () => {
    const ip = freshIp();
    const issue = (addr: string) => app.inject({ method: 'POST', url: '/api/v1/storefront/guest-session', remoteAddress: addr } as InjectOptions);
    for (let i = 0; i < 60; i++) expect((await issue(ip)).statusCode).toBe(201);
    expect((await issue(ip)).statusCode).toBe(429);
    expect((await issue(freshIp())).statusCode).toBe(201);

    const renew = (addr: string, token: string) =>
      app.inject({ method: 'POST', url: '/api/v1/storefront/guest-session/renew', remoteAddress: addr, headers: { [GUEST]: token } } as InjectOptions);
    const renewIp = freshIp();
    for (let i = 0; i < 10; i++) expect((await renew(renewIp, forgedGuestToken())).statusCode).toBe(401);
    expect((await renew(renewIp, forgedGuestToken())).statusCode).toBe(429); // rotating forgeries share the IP bucket
    expect((await renew(renewIp, mintGuestSessionToken().token)).statusCode).toBe(200); // a real guest on that IP is unaffected
  });
});
