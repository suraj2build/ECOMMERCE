import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { GiftCard, GiftCardLedgerEntry } from '@fcp/db';
import { GiftCardService } from './service.js';
import { resolveCartIdentity } from '../cart/identity.js';

// Decimal fields serialize as strings through Prisma's own default JSON
// behavior - every other money-bearing view in this codebase (e.g.
// CheckoutService.toView) explicitly converts to Number before sending
// the HTTP response, so gift cards follow the same convention rather
// than leaking a raw Decimal/string.
// codeHash is omitted: it is the stored form of the spendable secret and,
// per security/PII_DATA_INVENTORY.md, is only ever compared, never read
// back (it was previously returned here; found by the P1 admin build).
function giftCardView({ codeHash: _codeHash, ...giftCard }: GiftCard & { entries?: GiftCardLedgerEntry[] }) {
  return {
    ...giftCard,
    initialValue: Number(giftCard.initialValue),
    balance: Number(giftCard.balance),
    entries: giftCard.entries?.map((e) => ({ ...e, amount: Number(e.amount), balanceAfter: Number(e.balanceAfter) })),
  };
}
function ledgerEntryView(entry: GiftCardLedgerEntry) {
  return { ...entry, amount: Number(entry.amount), balanceAfter: Number(entry.balanceAfter) };
}

const issueSchema = z.object({
  initialValue: z.number().positive(),
  currency: z.string().length(3).optional(),
  purchasedByCustomerId: z.string().uuid().optional(),
  recipientEmail: z.string().email().optional(),
  expiresAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1),
});

const disableSchema = z.object({ reason: z.string().min(1).max(500) });

const adjustSchema = z.object({
  delta: z.number().refine((n) => n !== 0, 'delta must be non-zero'),
  reason: z.string().min(1).max(500),
  idempotencyKey: z.string().min(1),
});

const refundToGiftCardSchema = z.object({
  amount: z.number().positive(),
  referenceType: z.string().min(1).max(50),
  referenceId: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

const purchaseSchema = z.object({
  amount: z.number().positive(),
  recipientEmail: z.string().email().optional(),
  idempotencyKey: z.string().min(1),
});

/**
 * Gift Card routes (M30, specs/33-store-credit-gift-cards.md). Two
 * distinct surfaces, same split as every other stored-value domain in
 * this codebase: a storefront purchase endpoint (guest-or-customer,
 * CHK-001's own identity pattern) and a staff administration surface
 * gated by the dedicated `giftcard:manage`/`giftcard:read` permissions -
 * deliberately never a read of the full plaintext code anywhere here
 * (issuance returns it exactly once, in the issue response itself).
 * Redemption at checkout is NOT a route on this file - it is
 * CheckoutService's own `giftCardCode`/`giftCardAmountToApply` input,
 * the same reduction-chain integration store credit/loyalty use.
 */
const giftCardRoutes: FastifyPluginAsync = async (fastify) => {
  const giftCard = new GiftCardService(fastify);
  const identityAuth = { preHandler: fastify.tryCustomerAuth };
  const manageAuth = [fastify.requireStaffAuth, fastify.requirePermission('giftcard:manage')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('giftcard:read')];

  // --- Storefront purchase ---

  fastify.post('/storefront/gift-cards/purchase', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const body = purchaseSchema.parse(request.body);
    reply.status(201).send(await giftCard.initiatePurchase(identity, body.amount, body.recipientEmail, body.idempotencyKey));
  });

  // --- Staff administration ---

  fastify.post('/gift-cards/issue', { preHandler: manageAuth }, async (request, reply) => {
    const body = issueSchema.parse(request.body);
    const result = await giftCard.issue({
      initialValue: body.initialValue,
      currency: body.currency,
      purchasedByCustomerId: body.purchasedByCustomerId,
      recipientEmail: body.recipientEmail,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      actorStaffId: request.staffUser!.id,
      referenceType: 'STAFF_ISSUE',
      idempotencyKey: body.idempotencyKey,
    });
    // The plaintext code is returned here ONLY, exactly once - see
    // GiftCardService.issue's own docblock. Never logged, never re-
    // derivable from any other route.
    reply.status(201).send({ giftCard: giftCardView(result.giftCard), entry: ledgerEntryView(result.entry), code: result.code || undefined });
  });

  fastify.get('/gift-cards/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(giftCardView(await giftCard.getById(id)));
  });

  fastify.post('/gift-cards/:id/disable', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = disableSchema.parse(request.body);
    reply.status(200).send(giftCardView(await giftCard.disable(id, request.staffUser!.id, body.reason)));
  });

  fastify.post('/gift-cards/:id/adjust', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = adjustSchema.parse(request.body);
    reply.status(200).send(ledgerEntryView(await giftCard.adjust(id, body.delta, body.reason, request.staffUser!.id, body.idempotencyKey)));
  });

  fastify.post('/gift-cards/:id/refund-to-gift-card', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = refundToGiftCardSchema.parse(request.body);
    reply
      .status(200)
      .send(ledgerEntryView(await giftCard.refundToGiftCard(id, body.amount, body.referenceType, body.referenceId, request.staffUser!.id, body.idempotencyKey)));
  });

  // Callable sweep (M30, same idempotent/concurrency-safe/callable-
  // directly-or-by-a-future-scheduler shape as every other sweep in
  // this codebase).
  fastify.post('/gift-cards/sweep/release-stale-holds', { preHandler: manageAuth }, async (_request, reply) => {
    reply.status(200).send({ released: await giftCard.releaseStaleRedemptionHolds() });
  });
};

export default giftCardRoutes;
