import type { FastifyInstance } from 'fastify';
import { Prisma, type ConversionEvent, type ConversionProvider, type PrismaClient } from '@fcp/db';
import { loadEnv, type Env } from '@fcp/config';
import { ga4Purchase, ga4Refund, metaPurchase, metaPurchaseEventId, type ConversionLine, type ConversionOrder } from './payloads.js';

/**
 * Server-side conversion events (LR-003, specs/27-analytics-reporting.md).
 *
 * Events are written to the `conversion_events` outbox in the SAME
 * transaction as the state change they report, so a confirmed order or a
 * completed refund can never lose its event to a crash, and the
 * (provider, eventId) unique key means one can never be queued twice.
 * `dispatchDue` sends them later; nothing here runs on the request path.
 *
 * Purchase semantics: an order row only exists once it is confirmed —
 * COD at placement, prepaid only after Razorpay capture — so enqueuing at
 * order creation is exactly "purchase = confirmed order". A payment-button
 * click never creates an order and never produces a purchase.
 */

type Db = Prisma.TransactionClient | PrismaClient;

export type SendOutcome =
  | { kind: 'SENT' }
  // The provider definitively refused the event (bad payload, bad credentials).
  | { kind: 'REJECTED'; error: string }
  // Definitely not processed (rate limited): always safe to try again.
  | { kind: 'RETRY'; error: string }
  // Unknown whether the provider recorded it (timeout, network, 5xx).
  | { kind: 'UNKNOWN'; error: string };

export interface ConversionSender {
  send(event: Pick<ConversionEvent, 'provider' | 'payload'>): Promise<SendOutcome>;
}

export function enabledProviders(env: Env = loadEnv()): ConversionProvider[] {
  const providers: ConversionProvider[] = [];
  if (env.GA4_MEASUREMENT_ID && env.GA4_API_SECRET) providers.push('GA4');
  if (env.META_PIXEL_ID && env.META_CAPI_ACCESS_TOKEN && env.STOREFRONT_PUBLIC_URL) providers.push('META');
  return providers;
}

const truncate = (value: string, max = 500) => (value.length > max ? `${value.slice(0, max)}…` : value);

/** Real HTTP sender. Credentials never appear in stored errors: the GA4
 * secret is only in the request URL (never logged), the Meta token only in
 * the request body. */
export class HttpConversionSender implements ConversionSender {
  constructor(private readonly env: Env = loadEnv()) {}

  async send(event: Pick<ConversionEvent, 'provider' | 'payload'>): Promise<SendOutcome> {
    const { env } = this;
    let url: string;
    let body: unknown;
    if (event.provider === 'GA4') {
      const params = new URLSearchParams({ measurement_id: env.GA4_MEASUREMENT_ID!, api_secret: env.GA4_API_SECRET! });
      url = `${env.GA4_MP_URL}?${params}`;
      body = event.payload;
    } else {
      url = `${env.META_GRAPH_URL.replace(/\/$/, '')}/${env.META_PIXEL_ID}/events`;
      body = {
        data: [event.payload],
        access_token: env.META_CAPI_ACCESS_TOKEN,
        ...(env.META_TEST_EVENT_CODE ? { test_event_code: env.META_TEST_EVENT_CODE } : {}),
      };
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(env.CONVERSION_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      return { kind: 'UNKNOWN', error: `request failed: ${(err as Error).name}` };
    }
    const text = truncate(await res.text().catch(() => ''));
    if (res.status === 429) return { kind: 'RETRY', error: `HTTP 429 ${text}` };
    if (res.status >= 500) return { kind: 'UNKNOWN', error: `HTTP ${res.status} ${text}` };
    if (!res.ok) return { kind: 'REJECTED', error: `HTTP ${res.status} ${text}` };
    if (event.provider === 'META') {
      let received: number | undefined;
      try { received = (JSON.parse(text) as { events_received?: number }).events_received; } catch { /* not JSON */ }
      if (received !== 1) return { kind: 'REJECTED', error: `events_received=${received ?? 'missing'} ${text}` };
    }
    return { kind: 'SENT' };
  }
}

const lineInclude = { sku: { include: { style: true, colour: true, size: true } } } as const;

function toLines(lines: Prisma.OrderLineGetPayload<{ include: typeof lineInclude }>[]): ConversionLine[] {
  return lines.map((line) => ({
    skuCode: line.sku.skuCode,
    styleCode: line.sku.style.styleCode,
    styleName: line.sku.style.name,
    colourName: line.sku.colour.name,
    sizeLabel: line.sku.size.label,
    quantity: line.quantity,
    unitPriceInclusive: Number(line.unitPriceInclusive),
    discountAmount: Number(line.discountAmountSnapshot),
  }));
}

function toOrder(order: Prisma.OrderGetPayload<object>): ConversionOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    grandTotal: Number(order.grandTotal),
    taxAmount: Number(order.taxAmount),
    shippingCost: Number(order.shippingCost),
    currency: order.currency,
    marketingConsent: order.marketingConsent,
    analyticsClientId: order.analyticsClientId,
    contactEmail: order.contactEmail,
    contactMobile: order.contactMobile,
    metaBrowserId: order.metaBrowserId,
    metaClickId: order.metaClickId,
    paymentMethod: order.paymentMethod,
  };
}

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

export class ConversionService {
  constructor(
    private readonly fastify: FastifyInstance,
    private readonly sender: ConversionSender = new HttpConversionSender(),
  ) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  /** Inside the order-creation transaction: queue the purchase for each
   * enabled provider the customer consented to at checkout. */
  async enqueuePurchase(tx: Db, orderId: string): Promise<void> {
    const env = loadEnv();
    const providers = enabledProviders(env);
    if (providers.length === 0) return;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: { include: lineInclude } } });
    const data = toOrder(order);
    const lines = toLines(order.lines);
    const rows: Prisma.ConversionEventCreateManyInput[] = [];
    if (providers.includes('GA4') && order.analyticsConsent) {
      rows.push({ provider: 'GA4', eventName: 'purchase', eventId: `purchase:${order.orderNumber}`, orderId, retrySafe: true, payload: ga4Purchase(data, lines) as Prisma.InputJsonValue });
    }
    if (providers.includes('META') && order.marketingConsent) {
      rows.push({ provider: 'META', eventName: 'Purchase', eventId: metaPurchaseEventId(order.orderNumber), orderId, retrySafe: true, payload: metaPurchase(data, lines, env.STOREFRONT_PUBLIC_URL!) as Prisma.InputJsonValue });
    }
    if (rows.length) await tx.conversionEvent.createMany({ data: rows, skipDuplicates: true });
  }

  /** Inside the refund-completion transaction: GA4 `refund` (Meta has no
   * refund event). GA4 does not deduplicate refunds, so an unknown outcome
   * is never resent automatically. */
  async enqueueRefund(tx: Db, refundId: string): Promise<void> {
    if (!enabledProviders().includes('GA4')) return;
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { orderLine: { include: lineInclude }, order: true } });
    if (!refund.order.analyticsConsent || refund.status !== 'COMPLETED') return;
    const payload = ga4Refund(toOrder(refund.order), { amount: Number(refund.amount), processedAt: refund.processedAt ?? new Date() }, toLines([refund.orderLine]));
    await tx.conversionEvent.createMany({
      data: [{ provider: 'GA4', eventName: 'refund', eventId: `refund:${refund.id}`, orderId: refund.orderId, refundId, retrySafe: false, payload: payload as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
  }

  /** A SENDING claim whose dispatcher died: resend it if the provider
   * deduplicates, otherwise flag it for a human. */
  async reclaimStale(now = new Date()): Promise<{ requeued: number; ambiguous: number }> {
    const cutoff = new Date(now.getTime() - loadEnv().CONVERSION_SENDING_STALE_SECONDS * 1000);
    const requeued = await this.prisma.conversionEvent.updateMany({
      where: { status: 'SENDING', claimedAt: { lt: cutoff }, retrySafe: true },
      data: { status: 'PENDING', claimedAt: null, nextAttemptAt: now, lastError: 'dispatcher stopped before recording an outcome' },
    });
    const ambiguous = await this.prisma.conversionEvent.updateMany({
      where: { status: 'SENDING', claimedAt: { lt: cutoff }, retrySafe: false },
      data: { status: 'AMBIGUOUS_RECONCILIATION_REQUIRED', lastError: 'dispatcher stopped before recording an outcome' },
    });
    return { requeued: requeued.count, ambiguous: ambiguous.count };
  }

  /** Claims due events (row locks, SKIP LOCKED: replicas never share one),
   * sends each once, records the outcome. Disabled providers' events wait. */
  async dispatchDue(limit = 50): Promise<{ sent: number; failed: number; retrying: number; ambiguous: number; withdrawn: number }> {
    const env = loadEnv();
    const providers = enabledProviders(env);
    const result = { sent: 0, failed: 0, retrying: 0, ambiguous: 0, withdrawn: 0 };
    if (providers.length === 0) return result;
    await this.reclaimStale();
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE conversion_events SET status = 'SENDING', "claimedAt" = now(), attempts = attempts + 1, "updatedAt" = now()
      WHERE id IN (
        SELECT id FROM conversion_events
        WHERE status = 'PENDING' AND "nextAttemptAt" <= now() AND provider::text = ANY(${providers})
        ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    for (const { id } of claimed) {
      const event = await this.prisma.conversionEvent.findUniqueOrThrow({ where: { id }, include: { order: { select: { analyticsConsent: true, marketingConsent: true } } } });
      const owned = { id, status: 'SENDING' as const };
      // Consent is checked again at send time: a withdrawal that arrived
      // after this event was queued (or claimed) stops it here.
      if (!(event.provider === 'GA4' ? event.order.analyticsConsent : event.order.marketingConsent)) {
        await this.prisma.conversionEvent.updateMany({ where: owned, data: { status: 'WITHDRAWN', lastError: 'consent withdrawn' } });
        result.withdrawn++;
        continue;
      }
      // GA4 events also state the ad purposes; send them as they are now.
      const payload = event.provider === 'GA4' && !event.order.marketingConsent
        ? { ...(event.payload as object), consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' } }
        : event.payload;
      const outcome = await this.sender.send({ provider: event.provider, payload: payload as Prisma.JsonValue }).catch((err: Error): SendOutcome => ({ kind: 'UNKNOWN', error: `sender error: ${err.name}` }));
      if (outcome.kind === 'SENT') {
        await this.prisma.conversionEvent.updateMany({ where: owned, data: { status: 'SENT', sentAt: new Date(), lastError: null } });
        result.sent++;
      } else if (outcome.kind === 'REJECTED') {
        await this.prisma.conversionEvent.updateMany({ where: owned, data: { status: 'FAILED', lastError: outcome.error } });
        result.failed++;
        this.fastify.log.warn({ conversionEventId: id, provider: event.provider, error: outcome.error }, 'conversion event rejected by provider');
      } else if (outcome.kind === 'UNKNOWN' && !event.retrySafe) {
        await this.prisma.conversionEvent.updateMany({ where: owned, data: { status: 'AMBIGUOUS_RECONCILIATION_REQUIRED', lastError: outcome.error } });
        result.ambiguous++;
      } else if (event.attempts >= env.CONVERSION_MAX_ATTEMPTS) {
        await this.prisma.conversionEvent.updateMany({ where: owned, data: { status: 'FAILED', lastError: `retries exhausted: ${outcome.error}` } });
        result.failed++;
      } else {
        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (event.attempts - 1));
        await this.prisma.conversionEvent.updateMany({ where: owned, data: { status: 'PENDING', claimedAt: null, nextAttemptAt: new Date(Date.now() + delay), lastError: outcome.error } });
        result.retrying++;
      }
    }
    return result;
  }

  /**
   * Consent withdrawal (LR-003 review). Called by the browser when the
   * shopper turns a purpose off, with the random consent-subject ID that
   * travelled with their checkouts; a signed-in customer's own orders are
   * covered too. For each purpose now off, every matching checkout and
   * order loses the consent flag and the identifiers kept for it, and
   * every event for that purpose that has not been sent yet is marked
   * WITHDRAWN, so neither the dispatcher nor a retry sends it. Sent events
   * cannot be recalled. Withdrawal never grants anything.
   */
  async withdrawConsent(who: { subjectId?: string; customerId?: string }, now: { analytics: boolean; marketing: boolean }): Promise<{ orders: number; withdrawnEvents: number }> {
    const scopes: Prisma.OrderWhereInput[] = [];
    if (who.subjectId) scopes.push({ consentSubjectId: who.subjectId });
    if (who.customerId) scopes.push({ customerId: who.customerId });
    if (scopes.length === 0 || (now.analytics && now.marketing)) return { orders: 0, withdrawnEvents: 0 };
    const sessionScopes = scopes as Prisma.CheckoutSessionWhereInput[];
    const analyticsOff = !now.analytics;
    const marketingOff = !now.marketing;

    const sessionData = {
      ...(analyticsOff ? { analyticsConsent: false, analyticsClientId: null } : {}),
      ...(marketingOff ? { marketingConsent: false, metaBrowserId: null, metaClickId: null } : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      // Sessions first: a prepaid capture creating an order holds its
      // session's row lock, so this waits for it and the order lookup
      // below (a fresh snapshot) then sees that order; a capture that
      // starts later reads the session with consent already removed.
      await tx.checkoutSession.updateMany({ where: { OR: sessionScopes }, data: sessionData });
      const orders = await tx.order.findMany({ where: { OR: scopes }, select: { id: true } });
      const orderIds = orders.map((o) => o.id);
      await tx.order.updateMany({ where: { id: { in: orderIds } }, data: sessionData });
      const providers: ConversionProvider[] = [...(analyticsOff ? ['GA4' as const] : []), ...(marketingOff ? ['META' as const] : [])];
      // PENDING covers first attempts and scheduled retries. A SENDING event
      // is re-checked by the dispatcher before it is sent.
      const withdrawn = await tx.conversionEvent.updateMany({
        where: { orderId: { in: orderIds }, provider: { in: providers }, status: 'PENDING' },
        data: { status: 'WITHDRAWN', lastError: 'consent withdrawn', claimedAt: null },
      });
      if (marketingOff && !analyticsOff && orderIds.length) {
        // GA4 events still queued must no longer tell Google the ad purposes are granted.
        await tx.$executeRaw`
          UPDATE conversion_events
          SET payload = jsonb_set(payload::jsonb, '{consent}', '{"ad_user_data":"DENIED","ad_personalization":"DENIED"}'::jsonb), "updatedAt" = now()
          WHERE provider = 'GA4' AND status = 'PENDING' AND "orderId" = ANY(${orderIds})`;
      }
      return { orders: orderIds.length, withdrawnEvents: withdrawn.count };
    });
  }

  /** Staff view: which integrations are on, and counts per provider/status. */
  async status() {
    const groups = await this.prisma.conversionEvent.groupBy({ by: ['provider', 'status'], _count: { _all: true } });
    const recentProblems = await this.prisma.conversionEvent.findMany({
      where: { status: { in: ['FAILED', 'AMBIGUOUS_RECONCILIATION_REQUIRED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, provider: true, eventName: true, eventId: true, status: true, attempts: true, lastError: true, updatedAt: true },
    });
    return {
      enabled: enabledProviders(),
      counts: groups.map((g) => ({ provider: g.provider, status: g.status, count: g._count._all })),
      recentProblems,
    };
  }
}
