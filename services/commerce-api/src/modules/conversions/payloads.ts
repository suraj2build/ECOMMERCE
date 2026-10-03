import { createHash } from 'node:crypto';

/**
 * Server-side conversion payloads (LR-003, specs/27-analytics-reporting.md).
 * Pure functions so the exact data sent to Google and Meta is unit-tested.
 *
 * - Item IDs are SKU codes, item_group_id the style code, currency INR, the
 *   transaction ID the order number.
 * - GA4 payloads never carry a name, email, phone or address.
 * - Meta payloads carry email/phone only SHA-256 hashed, and are only built
 *   for orders whose checkout granted `marketing` consent.
 */

export interface ConversionLine {
  skuCode: string;
  styleCode: string;
  styleName: string;
  colourName: string;
  sizeLabel: string;
  quantity: number;
  unitPriceInclusive: number;
  discountAmount: number;
}

export interface ConversionOrder {
  id: string;
  orderNumber: string;
  createdAt: Date;
  grandTotal: number;
  taxAmount: number;
  shippingCost: number;
  currency: string;
  marketingConsent: boolean;
  analyticsClientId: string | null;
  contactEmail: string | null;
  contactMobile: string;
  metaBrowserId: string | null;
  metaClickId: string | null;
  paymentMethod: 'PREPAID' | 'COD';
}

/** COD orders are confirmed when placed, before any money is collected;
 * prepaid orders only after the payment is captured. The tag lets reports
 * separate "COD placed" from "paid" revenue. */
export const paymentType = (order: Pick<ConversionOrder, 'paymentMethod'>) => (order.paymentMethod === 'COD' ? 'cod' : 'prepaid');

const money = (value: number) => Math.round(value * 100) / 100;

/** GA4 needs a client_id; without the browser's own (_ga cookie) one, a
 * stable per-order ID keeps retries and the later refund on one client. */
export function ga4ClientId(order: Pick<ConversionOrder, 'id' | 'analyticsClientId' | 'createdAt'>): string {
  if (order.analyticsClientId) return order.analyticsClientId;
  const digits = BigInt(`0x${createHash('sha256').update(order.id).digest('hex').slice(0, 12)}`) % 2_147_483_647n;
  return `${digits}.${Math.floor(order.createdAt.getTime() / 1000)}`;
}

function ga4Items(lines: ConversionLine[]) {
  return lines.map((line, index) => ({
    item_id: line.skuCode,
    item_name: line.styleName,
    item_group_id: line.styleCode,
    item_variant: `${line.colourName} / ${line.sizeLabel}`,
    index,
    price: money(line.unitPriceInclusive),
    discount: money(line.quantity > 0 ? line.discountAmount / line.quantity : 0),
    quantity: line.quantity,
  }));
}

function ga4Consent(order: Pick<ConversionOrder, 'marketingConsent'>) {
  const value = order.marketingConsent ? 'GRANTED' : 'DENIED';
  return { ad_user_data: value, ad_personalization: value };
}

export function ga4Purchase(order: ConversionOrder, lines: ConversionLine[]) {
  return {
    client_id: ga4ClientId(order),
    timestamp_micros: order.createdAt.getTime() * 1000,
    consent: ga4Consent(order),
    events: [{
      name: 'purchase',
      params: {
        transaction_id: order.orderNumber,
        currency: order.currency,
        value: money(order.grandTotal),
        tax: money(order.taxAmount),
        shipping: money(order.shippingCost),
        // Custom parameter: register it as an event-scoped custom dimension in GA4.
        payment_type: paymentType(order),
        items: ga4Items(lines),
      },
    }],
  };
}

export function ga4Refund(order: ConversionOrder, refund: { amount: number; processedAt: Date }, lines: ConversionLine[]) {
  return {
    client_id: ga4ClientId(order),
    timestamp_micros: refund.processedAt.getTime() * 1000,
    consent: ga4Consent(order),
    events: [{
      name: 'refund',
      params: {
        transaction_id: order.orderNumber,
        currency: order.currency,
        value: money(refund.amount),
        items: ga4Items(lines),
      },
    }],
  };
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Meta normalisation: email trimmed and lowercased; phone as digits with
 * the country code (Indian 10-digit numbers get 91). */
export function hashedEmail(email: string | null): string | undefined {
  const normalised = email?.trim().toLowerCase();
  return normalised ? sha256(normalised) : undefined;
}

export function hashedPhone(mobile: string | null): string | undefined {
  const digits = (mobile ?? '').replace(/\D/g, '');
  if (!digits) return undefined;
  return sha256(digits.length === 10 ? `91${digits}` : digits);
}

/** Shared with the browser Pixel, so Meta keeps one of the two copies. */
export const metaPurchaseEventId = (orderNumber: string) => `purchase:${orderNumber}`;

export function metaPurchase(order: ConversionOrder, lines: ConversionLine[], storefrontUrl: string) {
  if (!order.marketingConsent) throw new Error('Meta events require marketing consent');
  const em = hashedEmail(order.contactEmail);
  const ph = hashedPhone(order.contactMobile);
  return {
    event_name: 'Purchase',
    event_time: Math.floor(order.createdAt.getTime() / 1000),
    event_id: metaPurchaseEventId(order.orderNumber),
    action_source: 'website',
    event_source_url: `${storefrontUrl.replace(/\/$/, '')}/checkout`,
    user_data: {
      ...(em ? { em: [em] } : {}),
      ...(ph ? { ph: [ph] } : {}),
      ...(order.metaBrowserId ? { fbp: order.metaBrowserId } : {}),
      ...(order.metaClickId ? { fbc: order.metaClickId } : {}),
    },
    custom_data: {
      currency: order.currency,
      value: money(order.grandTotal),
      order_id: order.orderNumber,
      content_type: 'product',
      content_ids: lines.map((line) => line.skuCode),
      contents: lines.map((line) => ({ id: line.skuCode, quantity: line.quantity, item_price: money(line.unitPriceInclusive) })),
      num_items: lines.reduce((sum, line) => sum + line.quantity, 0),
      payment_type: paymentType(order),
    },
  };
}
