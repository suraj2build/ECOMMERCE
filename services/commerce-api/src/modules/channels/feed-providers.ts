import { createSign } from 'node:crypto';
import { loadEnv, type Env } from '@fcp/config';
import type { ChannelFeedItem, ChannelProvider, ChannelPublishInput, ChannelPublishResult, ChannelUnpublishInput } from './provider.js';

/**
 * Real product-feed providers (LR-004, specs/25-social-channel-publishing.md):
 * Google Merchant Center (Merchant API) and the Meta catalogue (Graph API
 * items_batch). One item per SKU, grouped by style (item_group_id), with
 * title, description, image, product URL, INR price (and sale price when
 * marked down) and live availability.
 *
 * Outcome contract with ChannelService: a returned FAILURE is a definite
 * rejection (missing configuration, invalid item, a 4xx from the provider);
 * a THROWN error (timeout, network, 429, 5xx) means the outcome is unknown
 * and the listing is recorded AMBIGUOUS_RECONCILIATION_REQUIRED. Both
 * providers upsert by SKU code, so re-issuing the same publish is safe.
 *
 * No GTIN/MPN is invented: Google gets identifierExists=false.
 */

class ProviderUnavailableError extends Error {}

const truncate = (value: string, max = 500) => (value.length > max ? `${value.slice(0, max)}…` : value);

async function request(url: string, init: RequestInit, env: Env): Promise<{ status: number; body: string }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(env.CHANNEL_REQUEST_TIMEOUT_MS) });
  } catch (err) {
    throw new ProviderUnavailableError(`request failed: ${(err as Error).name}`);
  }
  const body = truncate(await res.text().catch(() => ''));
  if (res.status === 429 || res.status >= 500) throw new ProviderUnavailableError(`HTTP ${res.status} ${body}`);
  return { status: res.status, body };
}

/** Fields every real feed needs that the core feed item may lack. */
function missingFields(item: ChannelFeedItem): string[] {
  const missing: string[] = [];
  if (!item.title?.trim()) missing.push('title');
  if (!(item.price > 0)) missing.push('price');
  if (!item.link) missing.push('link (set STOREFRONT_PUBLIC_URL)');
  if (!item.imageUrl) missing.push('image');
  if (!item.brand) missing.push('brand');
  return missing;
}

/** Regular price and, when marked down, the sale price. */
function prices(item: ChannelFeedItem): { regular: number; sale: number | null } {
  const regular = item.regularPrice && item.regularPrice > item.price ? item.regularPrice : item.price;
  return { regular, sale: regular > item.price ? item.price : null };
}

// ---------------------------------------------------------------- Google --

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** Service-account OAuth (RFC 7523 JWT bearer), cached until shortly before expiry. */
export class GoogleServiceAccountToken {
  private cached: { token: string; expiresAt: number } | null = null;
  constructor(private readonly env: Env) {}

  async get(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.token;
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify({
      iss: this.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scope: 'https://www.googleapis.com/auth/content',
      aud: this.env.GOOGLE_OAUTH_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }));
    const key = this.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, '\n');
    const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key).toString('base64url');
    const res = await request(this.env.GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
    }, this.env);
    if (res.status !== 200) throw new GoogleAuthError(`token request rejected: HTTP ${res.status} ${res.body}`);
    const parsed = JSON.parse(res.body) as { access_token: string; expires_in: number };
    this.cached = { token: parsed.access_token, expiresAt: Date.now() + parsed.expires_in * 1000 };
    return parsed.access_token;
  }
}

class GoogleAuthError extends Error {}

export function googleProductInput(item: ChannelFeedItem) {
  const { regular, sale } = prices(item);
  const money = (amount: number) => ({ amountMicros: String(Math.round(amount * 1_000_000)), currencyCode: item.currency });
  return {
    offerId: item.externalId,
    contentLanguage: 'en',
    feedLabel: 'IN',
    productAttributes: {
      title: item.title,
      description: item.description,
      link: item.link,
      imageLink: item.imageUrl,
      availability: item.availability === 'in_stock' ? 'IN_STOCK' : 'OUT_OF_STOCK',
      condition: 'NEW',
      price: money(regular),
      ...(sale !== null ? { salePrice: money(sale) } : {}),
      itemGroupId: item.itemGroupId,
      brand: item.brand,
      ...(item.color ? { color: item.color } : {}),
      ...(item.size ? { sizes: [item.size] } : {}),
      ...(item.gender ? { gender: item.gender.toUpperCase() } : {}),
      identifierExists: false,
    },
  };
}

export class GoogleMerchantProvider implements ChannelProvider {
  private tokens: GoogleServiceAccountToken | null = null;
  private tokensEnv: Env | null = null;

  private config() {
    const env = loadEnv();
    const missing = ['GOOGLE_MERCHANT_ACCOUNT_ID', 'GOOGLE_MERCHANT_DATA_SOURCE_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY']
      .filter((key) => !env[key as keyof Env]);
    if (this.tokensEnv !== env) {
      this.tokens = new GoogleServiceAccountToken(env);
      this.tokensEnv = env;
    }
    return { env, missing, base: `${env.GOOGLE_MERCHANT_API_URL.replace(/\/$/, '')}/products/v1/accounts/${env.GOOGLE_MERCHANT_ACCOUNT_ID}` };
  }

  private async token(): Promise<string | ChannelPublishResult> {
    try {
      return await this.tokens!.get();
    } catch (err) {
      if (err instanceof GoogleAuthError) return { status: 'FAILURE', errorMessage: err.message };
      throw err;
    }
  }

  async publish(input: ChannelPublishInput): Promise<ChannelPublishResult> {
    const { env, missing, base } = this.config();
    if (missing.length) return { status: 'FAILURE', errorMessage: `Google Merchant is not configured: ${missing.join(', ')}` };
    const absent = missingFields(input.item);
    if (absent.length) return { status: 'FAILURE', errorMessage: `Missing required feed fields: ${absent.join(', ')}` };
    const token = await this.token();
    if (typeof token !== 'string') return token;
    const dataSource = `accounts/${env.GOOGLE_MERCHANT_ACCOUNT_ID}/dataSources/${env.GOOGLE_MERCHANT_DATA_SOURCE_ID}`;
    const res = await request(`${base}/productInputs:insert?dataSource=${encodeURIComponent(dataSource)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(googleProductInput(input.item)),
    }, env);
    if (res.status >= 200 && res.status < 300) return { status: 'SUCCESS', externalId: input.item.externalId };
    return { status: 'FAILURE', errorMessage: `Google Merchant rejected the product: HTTP ${res.status} ${res.body}` };
  }

  async unpublish(input: ChannelUnpublishInput): Promise<ChannelPublishResult> {
    const { env, missing, base } = this.config();
    if (missing.length) return { status: 'FAILURE', errorMessage: `Google Merchant is not configured: ${missing.join(', ')}` };
    const token = await this.token();
    if (typeof token !== 'string') return token;
    const dataSource = `accounts/${env.GOOGLE_MERCHANT_ACCOUNT_ID}/dataSources/${env.GOOGLE_MERCHANT_DATA_SOURCE_ID}`;
    const name = encodeURIComponent(`en~IN~${input.externalId}`);
    const res = await request(`${base}/productInputs/${name}?dataSource=${encodeURIComponent(dataSource)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    }, env);
    // Already gone is the desired end state.
    if ((res.status >= 200 && res.status < 300) || res.status === 404) return { status: 'SUCCESS', externalId: input.externalId };
    return { status: 'FAILURE', errorMessage: `Google Merchant rejected the delete: HTTP ${res.status} ${res.body}` };
  }
}

// ------------------------------------------------------------------ Meta --

const metaMoney = (amount: number, currency: string) => `${amount.toFixed(2)} ${currency}`;

export function metaCatalogItem(item: ChannelFeedItem) {
  const { regular, sale } = prices(item);
  return {
    id: item.externalId,
    title: item.title,
    description: item.description,
    availability: item.availability === 'in_stock' ? 'in stock' : 'out of stock',
    condition: 'new',
    price: metaMoney(regular, item.currency),
    ...(sale !== null ? { sale_price: metaMoney(sale, item.currency) } : {}),
    link: item.link,
    image_link: item.imageUrl,
    brand: item.brand,
    item_group_id: item.itemGroupId,
    ...(item.color ? { color: item.color } : {}),
    ...(item.size ? { size: item.size } : {}),
    ...(item.gender ? { gender: item.gender.toLowerCase() } : {}),
  };
}

interface MetaBatchResponse {
  handles?: string[];
  validation_status?: { retailer_id?: string; errors?: { message: string }[] }[];
}

export class MetaCatalogProvider implements ChannelProvider {
  private async send(requests: unknown[], env: Env): Promise<ChannelPublishResult> {
    const res = await request(`${env.META_GRAPH_URL.replace(/\/$/, '')}/${env.META_CATALOG_ID}/items_batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The token travels in the body, never the URL.
      body: JSON.stringify({ access_token: env.META_CATALOG_ACCESS_TOKEN, item_type: 'PRODUCT_ITEM', allow_upsert: true, requests }),
    }, env);
    if (res.status < 200 || res.status >= 300) return { status: 'FAILURE', errorMessage: `Meta rejected the batch: HTTP ${res.status} ${res.body}` };
    let parsed: MetaBatchResponse = {};
    try { parsed = JSON.parse(res.body) as MetaBatchResponse; } catch { /* handled below */ }
    const errors = (parsed.validation_status ?? []).flatMap((s) => s.errors ?? []).map((e) => e.message);
    if (errors.length) return { status: 'FAILURE', errorMessage: `Meta rejected the item: ${errors.join('; ')}` };
    if (!parsed.handles?.length) throw new ProviderUnavailableError(`Meta accepted the request without a batch handle: ${res.body}`);
    // Accepted for processing: Meta ingests batches asynchronously, so a
    // later ingestion error shows in Commerce Manager, not here.
    return { status: 'SUCCESS' };
  }

  private configured(env: Env): string | null {
    const missing = ['META_CATALOG_ID', 'META_CATALOG_ACCESS_TOKEN'].filter((key) => !env[key as keyof Env]);
    return missing.length ? `Meta catalogue is not configured: ${missing.join(', ')}` : null;
  }

  async publish(input: ChannelPublishInput): Promise<ChannelPublishResult> {
    const env = loadEnv();
    const notConfigured = this.configured(env);
    if (notConfigured) return { status: 'FAILURE', errorMessage: notConfigured };
    const absent = missingFields(input.item);
    if (absent.length) return { status: 'FAILURE', errorMessage: `Missing required feed fields: ${absent.join(', ')}` };
    const result = await this.send([{ method: 'UPDATE', data: metaCatalogItem(input.item) }], env);
    return result.status === 'SUCCESS' ? { status: 'SUCCESS', externalId: input.item.externalId } : result;
  }

  async unpublish(input: ChannelUnpublishInput): Promise<ChannelPublishResult> {
    const env = loadEnv();
    const notConfigured = this.configured(env);
    if (notConfigured) return { status: 'FAILURE', errorMessage: notConfigured };
    const result = await this.send([{ method: 'DELETE', data: { id: input.externalId } }], env);
    return result.status === 'SUCCESS' ? { status: 'SUCCESS', externalId: input.externalId } : result;
  }
}
