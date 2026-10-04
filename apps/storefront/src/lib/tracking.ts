'use client';

/**
 * Consent-aware GA4 and Meta Pixel (LR-003, specs/27-analytics-reporting.md).
 *
 * - Nothing is loaded and nothing is sent until the visitor consents:
 *   `analytics` enables GA4, `marketing` enables the Meta Pixel.
 * - Withdrawing consent stops every further call at once, revokes the tags'
 *   consent state and deletes their cookies, and tells the server, which
 *   stops every server-side event for that purpose not yet sent (orders
 *   placed in this browser are found by the random consent-subject ID that
 *   travelled with their checkout). An unsent withdrawal is retried on the
 *   next page load.
 * - Item IDs are SKU codes; style-level views use the style code as
 *   item_group_id (GA4) / product_group (Meta). Currency is INR.
 * - No name, email, phone or address is ever passed to either tag.
 * - GA4 `purchase` is sent by the server only (Measurement Protocol, after the
 *   order is confirmed) so it is never counted twice. For a prepaid order the
 *   browser sends the Meta Purchase with the same event_id as the Conversions
 *   API, which Meta deduplicates. A COD order is never a browser purchase
 *   (LR-009: the server reports it once delivered and the cash collected).
 */

import { getStoredSession } from './customer-auth';
import { randomUuid } from './random-id';

export const GA4_ID = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID ?? '';
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '';
export const trackingConfigured = () => Boolean(GA4_ID || META_PIXEL_ID);

const CONSENT_KEY = 'vanya_consent_v1';
const PENDING_WITHDRAWAL_ITEM = 'vanya_consent_withdrawal_pending';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const CONSENT_EVENT = 'vanya:consent-changed';
export const OPEN_CHOICES_EVENT = 'vanya:open-privacy-choices';

export interface Consent { analytics: boolean; marketing: boolean; decidedAt: string; subjectId?: string }

export function readConsent(): Consent | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Consent;
    return typeof parsed.analytics === 'boolean' && typeof parsed.marketing === 'boolean' ? parsed : null;
  } catch {
    return null;
  }
}

export function onConsentChange(listener: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, listener);
  return () => window.removeEventListener(CONSENT_EVENT, listener);
}

type Gtag = (...args: unknown[]) => void;
type Fbq = ((...args: unknown[]) => void) & { callMethod?: unknown; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: Gtag; fbq?: Fbq; _fbq?: Fbq }
}

const granted = (on: boolean) => (on ? 'granted' : 'denied');

function deleteCookies(prefixes: string[]) {
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]!.trim();
    if (!prefixes.some((prefix) => name === prefix || name.startsWith(prefix))) continue;
    const host = location.hostname;
    const parts = host.split('.');
    const domains = ['', host, ...parts.map((_, i) => `.${parts.slice(i).join('.')}`)];
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
    }
  }
}

function loadScript(src: string) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

let ga4Loaded = false;
let pixelLoaded = false;

function startGa4(consent: Consent) {
  if (!GA4_ID) return;
  window.dataLayer = window.dataLayer ?? [];
  // gtag must push the Arguments object itself, as Google's snippet does.
  // eslint-disable-next-line prefer-rest-params
  window.gtag = window.gtag ?? function gtag() { window.dataLayer!.push(arguments); };
  (window as unknown as Record<string, boolean>)[`ga-disable-${GA4_ID}`] = false;
  const state = { analytics_storage: 'granted', ad_storage: granted(consent.marketing), ad_user_data: granted(consent.marketing), ad_personalization: granted(consent.marketing) };
  if (!ga4Loaded) {
    window.gtag('consent', 'default', state);
    window.gtag('js', new Date());
    // Ecommerce events are sent explicitly; page views come from the config call.
    window.gtag('config', GA4_ID, { allow_google_signals: consent.marketing, allow_ad_personalization_signals: consent.marketing });
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID)}`);
    ga4Loaded = true;
  } else {
    window.gtag('consent', 'update', state);
  }
}

function stopGa4() {
  if (!GA4_ID) return;
  (window as unknown as Record<string, boolean>)[`ga-disable-${GA4_ID}`] = true;
  window.gtag?.('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  deleteCookies(['_ga', '_gid', '_gat']);
}

function startPixel() {
  if (!META_PIXEL_ID) return;
  if (!pixelLoaded) {
    if (!window.fbq) {
      // Meta's standard queueing stub, so calls made before the script loads are kept.
      const fbq: Fbq = function fbqStub(...args: unknown[]) {
        if (fbq.callMethod) (fbq.callMethod as (...a: unknown[]) => void)(...args);
        else fbq.queue!.push(args);
      } as Fbq;
      fbq.push = fbq; fbq.loaded = true; fbq.version = '2.0'; fbq.queue = [];
      window.fbq = fbq; window._fbq = fbq;
    }
    window.fbq('consent', 'grant');
    window.fbq('init', META_PIXEL_ID);
    window.fbq('track', 'PageView');
    loadScript('https://connect.facebook.net/en_US/fbevents.js');
    pixelLoaded = true;
  } else {
    window.fbq?.('consent', 'grant');
  }
}

function stopPixel() {
  window.fbq?.('consent', 'revoke');
  deleteCookies(['_fbp', '_fbc']);
}

/** Applies the stored choice: loads what was granted, stops what was not. */
export function applyConsent(consent: Consent | null = readConsent()) {
  if (consent && !consent.subjectId) {
    // A choice saved before subject IDs existed gets one now, so checkouts
    // from here on can be found again if this browser withdraws.
    consent.subjectId = newSubjectId();
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(consent)); } catch { /* still applies to this page */ }
  }
  if (consent?.analytics) startGa4(consent); else if (ga4Loaded) stopGa4();
  if (consent?.marketing) startPixel(); else if (pixelLoaded) stopPixel();
  void retryPendingWithdrawals();
}

function newSubjectId(): string {
  return randomUuid();
}

/** One withdrawal; `id` only identifies it in this browser's queue. */
interface Withdrawal { id: string; subjectId?: string; analytics: boolean; marketing: boolean; requestedAt: string }

async function sendWithdrawal(item: Withdrawal, signedIn = true): Promise<boolean> {
  // A signed-in customer's withdrawal also covers their orders from other
  // browsers placed up to requestedAt.
  const token = signedIn ? getStoredSession()?.accessToken : undefined;
  const body = { subjectId: item.subjectId, analytics: item.analytics, marketing: item.marketing, requestedAt: item.requestedAt };
  try {
    const res = await fetch(`${API_URL}/api/v1/storefront/consent/withdrawal`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    // An expired sign-in: still withdraw for this browser's own orders.
    if (res.status === 401 && token) return sendWithdrawal(item, false);
    return res.ok;
  } catch {
    return false;
  }
}

function pendingWithdrawals(): Withdrawal[] {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_WITHDRAWAL_ITEM) ?? '[]') as unknown;
    return Array.isArray(list) ? (list as Withdrawal[]).filter((w) => typeof w?.id === 'string') : [];
  } catch {
    return [];
  }
}

function updatePending(change: (list: Withdrawal[]) => Withdrawal[]) {
  try {
    const next = change(pendingWithdrawals());
    if (next.length) localStorage.setItem(PENDING_WITHDRAWAL_ITEM, JSON.stringify(next));
    else localStorage.removeItem(PENDING_WITHDRAWAL_ITEM);
  } catch { /* storage blocked: nothing more can be kept */ }
}

/** Sends one queued withdrawal and removes only that one once the server confirms it. */
async function deliver(item: Withdrawal) {
  if (await sendWithdrawal(item)) updatePending((list) => list.filter((w) => w.id !== item.id));
}

async function retryPendingWithdrawals() {
  await Promise.all(pendingWithdrawals().map(deliver));
}

export function saveConsent(choice: { analytics: boolean; marketing: boolean }) {
  const previous = readConsent();
  const withdrawn = Boolean((previous?.analytics && !choice.analytics) || (previous?.marketing && !choice.marketing));
  // After a withdrawal this browser starts a new subject: the withdrawal
  // (even one resent later) then covers only checkouts made before it.
  const subjectId = withdrawn || !previous?.subjectId ? newSubjectId() : previous.subjectId;
  const consent: Consent = { ...choice, decidedAt: new Date().toISOString(), subjectId };
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(consent)); } catch { /* the choice still applies to this page */ }
  if (!choice.analytics) stopGa4();
  if (!choice.marketing) stopPixel();
  if (withdrawn) {
    const item: Withdrawal = { id: newSubjectId(), subjectId: previous?.subjectId, analytics: choice.analytics, marketing: choice.marketing, requestedAt: consent.decidedAt };
    updatePending((list) => [...list, item]);
  }
  // applyConsent sends every queued withdrawal, including this one.
  applyConsent(consent);
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

/** Consent and identifiers sent with the order so server events honour them. */
export function checkoutTracking() {
  const consent = readConsent();
  const cookie = (name: string) => document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
  const ga = cookie('_ga')?.match(/^GA\d\.\d\.(\d+\.\d+)$/)?.[1];
  return {
    analytics: consent?.analytics === true,
    marketing: consent?.marketing === true,
    analyticsClientId: consent?.analytics && ga ? ga : undefined,
    metaBrowserId: consent?.marketing ? cookie('_fbp') : undefined,
    metaClickId: consent?.marketing ? cookie('_fbc') : undefined,
    consentSubjectId: consent?.analytics || consent?.marketing ? consent.subjectId : undefined,
  };
}

export interface TrackItem { skuCode?: string; styleCode: string; name: string; variant?: string; price?: number; quantity?: number }

const ga4Item = (item: TrackItem, index: number) => ({
  ...(item.skuCode ? { item_id: item.skuCode } : {}),
  item_name: item.name,
  item_group_id: item.styleCode,
  ...(item.variant ? { item_variant: item.variant } : {}),
  ...(item.price !== undefined ? { price: item.price } : {}),
  quantity: item.quantity ?? 1,
  index,
});

const value = (items: TrackItem[]) => Math.round(items.reduce((sum, i) => sum + (i.price ?? 0) * (i.quantity ?? 1), 0) * 100) / 100;

function ga4(event: string, params: Record<string, unknown>) {
  if (readConsent()?.analytics && GA4_ID) {
    startGa4(readConsent()!);
    window.gtag?.('event', event, params);
  }
}

function pixel(event: string, params: Record<string, unknown>, eventId?: string) {
  if (readConsent()?.marketing && META_PIXEL_ID) {
    startPixel();
    window.fbq?.('track', event, params, eventId ? { eventID: eventId } : undefined);
  }
}

export const track = {
  viewItemList(listName: string, items: TrackItem[]) {
    ga4('view_item_list', { item_list_name: listName, items: items.slice(0, 50).map(ga4Item) });
  },
  search(term: string, items: TrackItem[]) {
    ga4('search', { search_term: term });
    pixel('Search', { search_string: term, content_type: 'product_group', content_ids: items.slice(0, 20).map((i) => i.styleCode) });
  },
  viewItem(item: TrackItem) {
    ga4('view_item', { currency: 'INR', value: value([item]), items: [ga4Item(item, 0)] });
    pixel('ViewContent', { content_type: 'product_group', content_ids: [item.styleCode], content_name: item.name, currency: 'INR', value: item.price ?? 0 });
  },
  addToCart(item: TrackItem) {
    ga4('add_to_cart', { currency: 'INR', value: value([item]), items: [ga4Item(item, 0)] });
    pixel('AddToCart', { content_type: 'product', content_ids: item.skuCode ? [item.skuCode] : [], currency: 'INR', value: value([item]) });
  },
  addToWishlist(item: TrackItem) {
    ga4('add_to_wishlist', { currency: 'INR', value: value([item]), items: [ga4Item(item, 0)] });
    pixel('AddToWishlist', { content_type: 'product', content_ids: item.skuCode ? [item.skuCode] : [], currency: 'INR', value: value([item]) });
  },
  viewCart(items: TrackItem[]) {
    ga4('view_cart', { currency: 'INR', value: value(items), items: items.map(ga4Item) });
  },
  beginCheckout(items: TrackItem[]) {
    ga4('begin_checkout', { currency: 'INR', value: value(items), items: items.map(ga4Item) });
    pixel('InitiateCheckout', { content_type: 'product', content_ids: items.flatMap((i) => (i.skuCode ? [i.skuCode] : [])), currency: 'INR', value: value(items), num_items: items.reduce((n, i) => n + (i.quantity ?? 1), 0) });
  },
  /** Only for a confirmed order (COD placed / prepaid captured), once per
   * order per browser. Meta only: GA4's purchase comes from the server. */
  purchase(orderNumber: string, total: number, items: TrackItem[]) {
    const key = 'vanya_tracked_orders';
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]; } catch { /* treat as unseen */ }
    if (seen.includes(orderNumber)) return;
    pixel('Purchase', { content_type: 'product', content_ids: items.flatMap((i) => (i.skuCode ? [i.skuCode] : [])), currency: 'INR', value: total, num_items: items.reduce((n, i) => n + (i.quantity ?? 1), 0) }, `purchase:${orderNumber}`);
    try { localStorage.setItem(key, JSON.stringify([...seen, orderNumber].slice(-50))); } catch { /* best effort */ }
  },
};

/** Cart lines as tracking items (SKU code as item ID, style code as group). */
export function cartItems(items: { skuCode: string; styleCode: string; styleName: string; colourName: string; sizeLabel: string; quantity: number; currentPrice: number | null; priceAtAdd: number }[]): TrackItem[] {
  return items.map((i) => ({ skuCode: i.skuCode, styleCode: i.styleCode, name: i.styleName, variant: `${i.colourName} / ${i.sizeLabel}`, price: i.currentPrice ?? i.priceAtAdd, quantity: i.quantity }));
}
