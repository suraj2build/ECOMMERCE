import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { __resetEnvCacheForTests } from '@fcp/config';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { ChannelService } from '../../src/modules/channels/service.js';

/**
 * LR-004 product feeds (specs/25-social-channel-publishing.md): the
 * GOOGLE_MERCHANT (Merchant API, service-account OAuth) and META_CATALOG
 * (Graph API items_batch) providers on the existing channel architecture.
 * Google and Meta are replaced by a stub at the HTTP boundary; the OAuth JWT
 * is really signed and verified here with the service account's public key.
 */

const GOOGLE_API = 'https://merchant.stub.test';
const TOKEN_URL = 'https://oauth.stub.test/token';
const GRAPH = 'https://graph.stub.test/v21.0';
const SITE = 'https://shop.example.test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const ENV: Record<string, string> = {
  STOREFRONT_PUBLIC_URL: SITE,
  GOOGLE_MERCHANT_ACCOUNT_ID: '123456',
  GOOGLE_MERCHANT_DATA_SOURCE_ID: '987',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'feeds@vanya-test.iam.gserviceaccount.com',
  // Stored the way most secret stores hold a PEM: newlines escaped.
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: PEM.replace(/\n/g, '\\n'),
  GOOGLE_MERCHANT_API_URL: GOOGLE_API,
  GOOGLE_OAUTH_TOKEN_URL: TOKEN_URL,
  META_CATALOG_ID: '555000111',
  META_CATALOG_ACCESS_TOKEN: 'catalog-test-catalog-test-catalog',
  META_GRAPH_URL: GRAPH,
};

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  __resetEnvCacheForTests();
}

type Reply = { status: number; body?: unknown } | 'network-error';

describe('Product feeds: Google Merchant and Meta catalogue (LR-004)', () => {
  let app: FastifyInstance;
  let staffId: string;
  let calls: { method: string; url: string; body: string; headers: Record<string, string> }[];
  let googleReplies: Reply[];
  let metaReplies: Reply[];

  beforeAll(async () => {
    setEnv(ENV);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
    setEnv(Object.fromEntries(Object.keys(ENV).map((k) => [k, undefined])));
  });

  beforeEach(async () => {
    setEnv(ENV);
    await resetDatabase();
    await seedRbac();
    staffId = (await createAuthenticatedStaff(app, ['MERCHANDISING'])).staffUserId;
    calls = [];
    googleReplies = [];
    metaReplies = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      const body = typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '';
      calls.push({ method: init?.method ?? 'GET', url: href, body, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      let reply: Reply;
      if (href === TOKEN_URL) reply = { status: 200, body: { access_token: 'google-access-token', expires_in: 3600 } };
      else if (href.startsWith(GOOGLE_API)) reply = googleReplies.shift() ?? { status: 200, body: { name: 'ok' } };
      else if (href.startsWith(GRAPH)) reply = metaReplies.shift() ?? { status: 200, body: { handles: ['h1'], validation_status: [] } };
      else throw new Error(`Unexpected fetch in test: ${href}`);
      if (reply === 'network-error') throw new TypeError('fetch failed');
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
    }));
  });

  async function fixture(opts: { mrp?: number; selling?: number; onHand?: number } = {}) {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: `FEED-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: 'Linen Kurta', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', lifecycleState: 'PUBLISHED', publishedAt: new Date(), gender: 'MEN' as never },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Sage', colourCode: 'SGE' } });
    const sku = await testPrisma.sku.create({ data: { skuCode: `${style.styleCode}-SGE-M`, styleId: style.id, colourId: colour.id, sizeId: size.id, isActive: true } });
    await testPrisma.price.create({ data: { styleId: style.id, colourId: colour.id, mrp: opts.mrp ?? 2499, sellingPrice: opts.selling ?? 1999 } });
    await testPrisma.productMedia.create({ data: { styleId: style.id, colourId: colour.id, url: '/demo/linen-kurta-sage.jpg', type: 'IMAGE', sortOrder: 0 } });
    await testPrisma.inventoryBalance.create({ data: { skuId: sku.id, locationId: location.id, onHand: opts.onHand ?? 5, reserved: 0 } });
    return { style, colour, sku, size, location, brand };
  }

  const service = () => new ChannelService(app);

  async function channel(providerName: 'GOOGLE_MERCHANT' | 'META_CATALOG', config: Record<string, unknown> = {}) {
    return service().createChannel({ key: `${providerName.toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`, name: providerName, providerName, config }, staffId);
  }

  it('publishes a SKU to Google Merchant as a grouped variant with link, image, sale price and live availability, signed with the service account', async () => {
    const { style, sku, brand } = await fixture();
    const google = await channel('GOOGLE_MERCHANT');
    const listing = await service().publishSku(google.id, sku.id, staffId);
    expect(listing.status).toBe('PUBLISHED');
    expect(listing.externalId).toBe(sku.skuCode);

    const tokenCall = calls.find((c) => c.url === TOKEN_URL)!;
    const assertion = new URLSearchParams(tokenCall.body).get('assertion')!;
    const [header, claims, signature] = assertion.split('.');
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({ iss: ENV.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/content', aud: TOKEN_URL });

    const insert = calls.find((c) => c.url.startsWith(GOOGLE_API))!;
    expect(insert.method).toBe('POST');
    expect(insert.url).toBe(`${GOOGLE_API}/products/v1/accounts/123456/productInputs:insert?dataSource=${encodeURIComponent('accounts/123456/dataSources/987')}`);
    expect(insert.headers.authorization).toBe('Bearer google-access-token');
    const body = JSON.parse(insert.body);
    expect(body).toMatchObject({ offerId: sku.skuCode, contentLanguage: 'en', feedLabel: 'IN' });
    expect(body.productAttributes).toMatchObject({
      link: `${SITE}/product/${style.id}`,
      imageLink: `${SITE}/demo/linen-kurta-sage.jpg`,
      availability: 'IN_STOCK',
      condition: 'NEW',
      price: { amountMicros: '2499000000', currencyCode: 'INR' },
      salePrice: { amountMicros: '1999000000', currencyCode: 'INR' },
      itemGroupId: style.styleCode,
      brand: brand.name,
      color: 'Sage',
      identifierExists: false,
    });
    expect(body.productAttributes.gtin).toBeUndefined();
  });

  it('publishes to the Meta catalogue through items_batch with the token in the body, and unpublishes with DELETE', async () => {
    const { style, sku } = await fixture({ mrp: 1999, selling: 1999, onHand: 0 });
    const meta = await channel('META_CATALOG');
    const listing = await service().publishSku(meta.id, sku.id, staffId);
    expect(listing.status).toBe('PUBLISHED');
    const call = calls.find((c) => c.url.startsWith(GRAPH))!;
    expect(call.url).toBe(`${GRAPH}/555000111/items_batch`);
    expect(call.url).not.toContain('access_token');
    const body = JSON.parse(call.body);
    expect(body).toMatchObject({ access_token: ENV.META_CATALOG_ACCESS_TOKEN, item_type: 'PRODUCT_ITEM', allow_upsert: true });
    expect(body.requests).toEqual([{ method: 'UPDATE', data: expect.objectContaining({
      id: sku.skuCode, availability: 'out of stock', condition: 'new', price: '1999.00 INR', item_group_id: style.styleCode,
      link: `${SITE}/product/${style.id}`, image_link: `${SITE}/demo/linen-kurta-sage.jpg`, color: 'Sage', gender: 'men',
    }) }]);
    expect(body.requests[0].data.sale_price).toBeUndefined();

    const removed = await service().unpublishSku(meta.id, sku.id, staffId);
    expect(removed.status).toBe('NOT_PUBLISHED');
    expect(JSON.parse(calls.at(-1)!.body).requests).toEqual([{ method: 'DELETE', data: { id: sku.skuCode } }]);
  });

  it('records a provider rejection as a definite failure and a timeout or 5xx as ambiguous', async () => {
    const { sku } = await fixture();
    const google = await channel('GOOGLE_MERCHANT');
    googleReplies = [{ status: 400, body: { error: { message: 'Invalid price' } } }];
    const rejected = await service().publishSku(google.id, sku.id, staffId);
    expect(rejected.status).toBe('FAILED');
    expect(rejected.lastError).toContain('HTTP 400');

    googleReplies = ['network-error'];
    const unknown = await service().publishSku(google.id, sku.id, staffId);
    expect(unknown.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');

    // Re-issuing the same publish is the reconcile path (the provider upserts by offerId).
    const retried = await service().publishSku(google.id, sku.id, staffId);
    expect(retried.status).toBe('PUBLISHED');

    const meta = await channel('META_CATALOG');
    metaReplies = [{ status: 200, body: { handles: ['h2'], validation_status: [{ retailer_id: sku.skuCode, errors: [{ message: 'image_link is invalid' }] }] } }];
    const metaRejected = await service().publishSku(meta.id, sku.id, staffId);
    expect(metaRejected.status).toBe('FAILED');
    expect(metaRejected.lastError).toContain('image_link is invalid');
    metaReplies = [{ status: 503, body: {} }];
    expect((await service().publishSku(meta.id, sku.id, staffId)).status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
  });

  it('fails clearly, without calling the provider, when credentials or the public URL are missing', async () => {
    const { sku } = await fixture();
    const google = await channel('GOOGLE_MERCHANT');
    setEnv({ GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: undefined });
    const missingKey = await service().publishSku(google.id, sku.id, staffId);
    expect(missingKey.status).toBe('FAILED');
    expect(missingKey.lastError).toContain('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');

    setEnv({ ...ENV, STOREFRONT_PUBLIC_URL: undefined, META_PIXEL_ID: undefined });
    const meta = await channel('META_CATALOG');
    const missingLink = await service().publishSku(meta.id, sku.id, staffId);
    expect(missingLink.status).toBe('FAILED');
    expect(missingLink.lastError).toContain('link');
    expect(calls.filter((c) => c.url.startsWith(GOOGLE_API) || c.url.startsWith(GRAPH))).toHaveLength(0);
  });

  it('the resync sweep pushes price and stock changes, removes unpublished styles, and adds new products for publish-all channels', async () => {
    const { style, sku, location, colour } = await fixture();
    const meta = await channel('META_CATALOG', { publishAll: true });

    // New product: added by the sweep without a manual publish.
    const first = await service().resyncStaleListings(staffId);
    expect(first.published).toBe(1);
    expect((await testPrisma.channelListing.findFirstOrThrow({ where: { channelId: meta.id, skuId: sku.id } })).status).toBe('PUBLISHED');
    calls = [];

    // Nothing changed: nothing is sent.
    expect(await service().resyncStaleListings(staffId)).toMatchObject({ resynced: 0, unpublished: 0, published: 0 });
    expect(calls).toHaveLength(0);

    // Price change.
    await testPrisma.price.create({ data: { styleId: style.id, colourId: colour.id, mrp: 2499, sellingPrice: 1499, isMarkdown: true } });
    expect((await service().resyncStaleListings(staffId)).resynced).toBe(1);
    expect(JSON.parse(calls.at(-1)!.body).requests[0].data.sale_price).toBe('1499.00 INR');

    // Stock sells out.
    await testPrisma.inventoryBalance.update({ where: { skuId_locationId: { skuId: sku.id, locationId: location.id } }, data: { onHand: 0 } });
    expect((await service().resyncStaleListings(staffId)).resynced).toBe(1);
    expect(JSON.parse(calls.at(-1)!.body).requests[0].data.availability).toBe('out of stock');

    // Style unpublished: removed from the channel and not re-added.
    await testPrisma.style.update({ where: { id: style.id }, data: { lifecycleState: 'ARCHIVED' as never } });
    expect((await service().resyncStaleListings(staffId)).unpublished).toBe(1);
    expect(JSON.parse(calls.at(-1)!.body).requests).toEqual([{ method: 'DELETE', data: { id: sku.skuCode } }]);
    expect((await service().resyncStaleListings(staffId)).published).toBe(0);
  });
});
