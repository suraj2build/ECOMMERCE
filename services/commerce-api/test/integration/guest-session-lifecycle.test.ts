import { randomInt } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { __resetEnvCacheForTests } from '@fcp/config';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff, createAuthenticatedCustomer } from '../helpers/auth.js';
import { mintGuestSessionToken } from '../../src/modules/cart/identity.js';

/**
 * CART-004 guest-session lifecycle over real HTTP + Postgres (M31
 * certification repair). Runs with unsigned guest ids DISABLED - the
 * exact code path production takes - so every assertion here is about
 * production behaviour. Time is controlled deterministically: tokens
 * are minted at explicit instants, and where the server's own clock
 * must move, only `Date` is faked (vi.setSystemTime) - no sleeps.
 */
process.env.GUEST_SESSION_ALLOW_UNSIGNED = 'false';
__resetEnvCacheForTests();

const GUEST = 'x-guest-session-id';
const TTL = 2_592_000;
const DAY = 86_400;

describe('Guest-session lifecycle (CART-004, production semantics)', () => {
  let app: FastifyInstance;
  // A client address of this run's own, so per-IP limiter buckets left in
  // the shared Redis by other files or earlier runs can never interfere.
  const clientIp = `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`;
  const inject = (opts: InjectOptions) => app.inject({ ...opts, remoteAddress: clientIp });

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.GUEST_SESSION_ALLOW_UNSIGNED;
    __resetEnvCacheForTests();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function publishedSku(): Promise<string> {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const h = { authorization: `Bearer ${token}` };
    const { brand, category, size, location } = await seedBrandAndLocation();
    const styleId = (
      await inject({ method: 'POST', url: '/api/v1/products/styles', headers: h, payload: { styleCode: 'GS-001', name: 'Tee', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' } })
    ).json().id as string;
    const colourId = (await inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/colours`, headers: h, payload: { name: 'Black', colourCode: 'BLK' } })).json().id as string;
    const skuId = (await inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/skus/generate`, headers: h, payload: { sizeIds: [size.id] } })).json()[0].skuId as string;
    await inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/media`, headers: h, payload: { colourId, url: 'https://example.com/x.jpg' } });
    for (const step of ['ready-for-enrichment', 'qa-check', 'publish']) {
      await inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/${step}`, headers: h });
    }
    await inject({ method: 'POST', url: '/api/v1/catalog/prices', headers: h, payload: { styleId, mrp: 999, sellingPrice: 999 } });
    await testPrisma.inventoryBalance.create({ data: { skuId, locationId: location.id, onHand: 50, reserved: 0 } });
    return skuId;
  }

  async function issue() {
    const res = await inject({ method: 'POST', url: '/api/v1/storefront/guest-session' });
    expect(res.statusCode).toBe(201);
    return res.json() as { guestSessionId: string; issuedAt: string; expiresAt: string };
  }

  function ownerOf(token: string): string {
    return token.split('.')[1]!;
  }

  const addItem = (token: string, skuId: string, quantity = 1) =>
    inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers: { [GUEST]: token }, payload: { skuId, quantity } });
  const getCart = (token: string) => inject({ method: 'GET', url: '/api/v1/storefront/cart', headers: { [GUEST]: token } });
  const renew = (token: string, payload?: object) =>
    inject({ method: 'POST', url: '/api/v1/storefront/guest-session/renew', headers: { [GUEST]: token }, payload: payload ?? {} });

  it('A: an issued token works across cart operations and the cart is stored under its server-generated owner', async () => {
    const skuId = await publishedSku();
    const session = await issue();
    expect(new Date(session.expiresAt).getTime() - new Date(session.issuedAt).getTime()).toBe(TTL * 1000);

    expect((await addItem(session.guestSessionId, skuId)).statusCode).toBe(201);
    const cart = await getCart(session.guestSessionId);
    expect(cart.statusCode).toBe(200);
    expect(cart.json().items).toHaveLength(1);
    const row = await testPrisma.cart.findUniqueOrThrow({ where: { guestSessionId: ownerOf(session.guestSessionId) } });
    expect(row.customerId).toBeNull();
  });

  it('B-F: tampered owner, issuedAt, expiry, version or signature are all rejected with 401 on real routes', async () => {
    const { guestSessionId: token } = await issue();
    const victim = ownerOf((await issue()).guestSessionId);
    const parts = token.split('.');
    const variants = [
      [parts[0], victim, parts[2], parts[3], parts[4]],
      [parts[0], parts[1], String(Number(parts[2]) + 1), parts[3], parts[4]],
      [parts[0], parts[1], parts[2], String(Number(parts[3]) + DAY), parts[4]],
      ['gs2', parts[1], parts[2], parts[3], parts[4]],
      [parts[0], parts[1], parts[2], parts[3], (parts[4]![0] === 'A' ? 'B' : 'A') + parts[4]!.slice(1)],
    ].map((p) => p.join('.'));
    for (const forged of variants) {
      expect((await getCart(forged)).statusCode).toBe(401);
      expect((await renew(forged)).statusCode).toBe(401);
    }
  });

  it('G: an expired token is rejected by the server and cannot be renewed; the guest data itself is untouched', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = mintGuestSessionToken(now - TTL - 1).token; // legitimately signed, lifetime over
    await testPrisma.cart.create({ data: { guestSessionId: ownerOf(expired) } });

    expect((await getCart(expired)).statusCode).toBe(401);
    expect((await renew(expired)).statusCode).toBe(401);
    expect(await testPrisma.cart.count({ where: { guestSessionId: ownerOf(expired) } })).toBe(1); // credential TTL is not data retention
  });

  it('H-K: renewal yields a new credential for the same owner; the existing cart continues and no duplicate or orphan cart appears; the old token still expires on schedule', async () => {
    const skuId = await publishedSku();
    const t0 = new Date('2031-01-01T00:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(t0);

    const original = (await issue()).guestSessionId;
    expect((await addItem(original, skuId, 2)).statusCode).toBe(201);
    const cartBefore = await testPrisma.cart.findUniqueOrThrow({ where: { guestSessionId: ownerOf(original) } });
    const totalCartsBefore = await testPrisma.cart.count();

    vi.setSystemTime(new Date(t0.getTime() + 29 * DAY * 1000)); // day 29 of 30
    const renewedRes = await renew(original, { ownerId: 'ignored' });
    expect(renewedRes.statusCode).toBe(200);
    const renewed = renewedRes.json().guestSessionId as string;

    expect(renewed).not.toBe(original); // H
    expect(ownerOf(renewed)).toBe(ownerOf(original)); // I
    const view = (await getCart(renewed)).json();
    expect(view.items).toEqual([expect.objectContaining({ skuId, quantity: 2 })]); // J
    expect((await addItem(renewed, skuId, 1)).statusCode).toBe(201);

    const cartAfter = await testPrisma.cart.findUniqueOrThrow({ where: { guestSessionId: ownerOf(renewed) } });
    expect(cartAfter.id).toBe(cartBefore.id); // J: same cart row
    expect(await testPrisma.cart.count()).toBe(totalCartsBefore); // K: nothing duplicated or orphaned

    vi.setSystemTime(new Date(t0.getTime() + (30 * DAY + 60) * 1000)); // past the ORIGINAL expiry
    expect((await getCart(original)).statusCode).toBe(401);
    const stillValid = await getCart(renewed);
    expect(stillValid.statusCode).toBe(200);
    expect(stillValid.json().items[0].quantity).toBe(3);
  });

  it('L: the server never signs an owner the caller chose', async () => {
    const victim = (await issue()).guestSessionId;
    const victimOwner = ownerOf(victim);

    const issued = await inject({
      method: 'POST',
      url: '/api/v1/storefront/guest-session',
      headers: { [GUEST]: victimOwner },
      payload: { ownerId: victimOwner, guestSessionId: victimOwner },
    });
    expect(ownerOf(issued.json().guestSessionId)).not.toBe(victimOwner);

    expect((await renew(victimOwner)).statusCode).toBe(401); // raw victim owner id
    const attacker = (await issue()).guestSessionId;
    const renewedAttacker = await renew(attacker, { ownerId: victimOwner, guestSessionId: victim });
    expect(ownerOf(renewedAttacker.json().guestSessionId)).toBe(ownerOf(attacker));
    expect((await getCart(victimOwner)).statusCode).toBe(401);
  });

  it('M: concurrent first requests on one guest credential converge on a single cart and a single wishlist', async () => {
    const skuId = await publishedSku();
    const token = (await issue()).guestSessionId;
    const cartResults = await Promise.all(Array.from({ length: 6 }, () => addItem(token, skuId)));
    const wishlistResults = await Promise.all(
      Array.from({ length: 6 }, () => inject({ method: 'POST', url: '/api/v1/storefront/wishlist/items', headers: { [GUEST]: token }, payload: { skuId } })),
    );
    for (const r of [...cartResults, ...wishlistResults]) expect(r.statusCode).toBe(201);
    expect(await testPrisma.cart.count({ where: { guestSessionId: ownerOf(token) } })).toBe(1);
    expect(await testPrisma.wishlist.count({ where: { guestSessionId: ownerOf(token) } })).toBe(1);
  });

  it('N: concurrent renewals of one credential all keep the same owner and the same cart', async () => {
    const skuId = await publishedSku();
    const token = (await issue()).guestSessionId;
    await addItem(token, skuId);
    const results = await Promise.all(Array.from({ length: 5 }, () => renew(token)));
    for (const r of results) {
      expect(r.statusCode).toBe(200);
      const next = r.json().guestSessionId as string;
      expect(ownerOf(next)).toBe(ownerOf(token));
      expect((await getCart(next)).json().items).toHaveLength(1);
    }
    expect(await testPrisma.cart.count({ where: { guestSessionId: ownerOf(token) } })).toBe(1);
  });

  it('O: raw client-chosen guest ids and the pre-lifecycle <uuid>.<hex> format are rejected', async () => {
    expect((await getCart('guest-arbitrary-123')).statusCode).toBe(401);
    expect((await getCart(`1b4e28ba-2fa1-4d2b-883f-0016d3cca427.${'ab'.repeat(32)}`)).statusCode).toBe(401);
    expect((await getCart('   ')).statusCode).toBe(400);
  });

  it('login merge accepts only a verified guest credential - never a raw owner id or a forged token', async () => {
    const skuId = await publishedSku();
    const victim = (await issue()).guestSessionId;
    await addItem(victim, skuId, 2);
    const attacker = await createAuthenticatedCustomer(app);
    const bearer = { authorization: `Bearer ${attacker.token}` };

    const rawMerge = await inject({ method: 'POST', url: '/api/v1/storefront/cart/merge', headers: { ...bearer, [GUEST]: ownerOf(victim) } });
    expect(rawMerge.statusCode).toBe(401);
    const forged = victim.split('.').slice(0, 4).join('.') + '.' + 'A'.repeat(43);
    const forgedMerge = await inject({ method: 'POST', url: '/api/v1/storefront/wishlist/merge', headers: { ...bearer, [GUEST]: forged } });
    expect(forgedMerge.statusCode).toBe(401);
    expect(await testPrisma.cart.count({ where: { guestSessionId: ownerOf(victim) } })).toBe(1); // victim cart untouched

    const owner = await createAuthenticatedCustomer(app);
    const merged = await inject({ method: 'POST', url: '/api/v1/storefront/cart/merge', headers: { authorization: `Bearer ${owner.token}`, [GUEST]: victim } });
    expect(merged.statusCode).toBe(200);
    expect(merged.json().items).toEqual([expect.objectContaining({ skuId, quantity: 2 })]);
    expect(await testPrisma.cart.count({ where: { guestSessionId: ownerOf(victim) } })).toBe(0);
  });
});
