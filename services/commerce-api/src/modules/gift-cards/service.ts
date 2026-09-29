import { randomBytes, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type GiftCard, type GiftCardLedgerEntry, type Order } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { ValidationError, NotFoundError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import type { CartOwnerIdentity } from '../cart/identity.js';
import { resolvePaymentProvider } from '../checkout/payment-provider.js';

// A high-entropy, display-friendly code (33-character alphabet excluding
// 0/1/O/I to avoid ambiguity when read aloud/typed by a customer support
// agent) - 16 alphabet characters ~= 80 bits of entropy, comfortably
// beyond brute-force range even before rate limiting (M31) is applied.
// Never derived from the row's own id/sequence - a predictable code
// would make every other control here pointless.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_SEGMENT_LENGTH = 4;
const CODE_SEGMENTS = 4;

function generateGiftCardCode(): string {
  const bytes = randomBytes(32);
  let raw = '';
  for (const b of bytes) {
    if (raw.length >= CODE_SEGMENT_LENGTH * CODE_SEGMENTS) break;
    raw += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  const segments: string[] = [];
  for (let i = 0; i < CODE_SEGMENTS; i++) {
    segments.push(raw.slice(i * CODE_SEGMENT_LENGTH, (i + 1) * CODE_SEGMENT_LENGTH));
  }
  return `GC-${segments.join('-')}`;
}

// The same unsalted SHA-256 convention this codebase already uses for
// OTP codes and refresh/session tokens (services/commerce-api/src/
// modules/auth/service.ts) - reserved for high-entropy, randomly
// generated, non-guessable secrets. The plaintext code is NEVER
// persisted anywhere (not in this table, not in an AuditLog payload, not
// in a log line) - only this hash, looked up by exact match.
function hashGiftCardCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

const GENERIC_REDEMPTION_ERROR = 'This gift card code is invalid or unavailable';

export interface IssueGiftCardInput {
  initialValue: number;
  currency?: string;
  purchasedByCustomerId?: string;
  purchasedByGuestSessionId?: string;
  recipientEmail?: string;
  expiresAt?: Date;
  actorStaffId?: string;
  referenceType?: string;
  referenceId?: string;
  idempotencyKey: string;
}

/**
 * Gift Cards (M30, specs/33-store-credit-gift-cards.md). A DISTINCT
 * instrument from store credit - purchasable by a customer (a genuinely
 * new value-creation event), whereas store credit is only ever
 * platform-issued. Reuses the exact account/entry/hold ledger MECHANICS
 * StoreCreditService/LoyaltyService already established (row-lock before
 * mutate, preview outside a transaction + authoritative reserve inside
 * one, ACTIVE/CONVERTED/RELEASED holds, a stale-hold sweep) but as
 * structurally separate tables - see the schema's own model-group
 * docblock for the full "why separate, not shared" reasoning.
 *
 * A gift card has no owning "account" the way store credit/loyalty do -
 * its own row IS the account, addressed by the caller's possession of
 * the plaintext code (never trusted from a client-supplied balance or
 * id - always re-derived server-side from the code's hash). Locking is
 * therefore always `SELECT ... FOR UPDATE` on the GiftCard row itself by
 * id, exactly mirroring InventoryService.lockBalance/
 * StoreCreditService.lockOrCreateAccount's own row-lock-before-mutate
 * discipline.
 */
export class GiftCardService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  private async lockById(tx: Prisma.TransactionClient, giftCardId: string): Promise<GiftCard> {
    const rows = await tx.$queryRaw<GiftCard[]>`SELECT * FROM "gift_cards" WHERE "id" = ${giftCardId} FOR UPDATE`;
    if (!rows[0]) throw new NotFoundError('GiftCard', giftCardId);
    return rows[0];
  }

  // --- Issuance ---

  /**
   * Issues a gift card - either immediately (staff-initiated) or at
   * purchase-capture time (applyPurchaseCaptureOutcome below). Returns
   * the plaintext code exactly ONCE, here, in the return value only -
   * it is never persisted, never logged, and the caller (a route
   * handler) is responsible for returning it to the one legitimate
   * recipient of this response and never echoing it into an audit
   * payload. Idempotent per `idempotencyKey` - the same discipline
   * every other ledger-issuance method in this codebase uses.
   */
  async issue(input: IssueGiftCardInput): Promise<{ giftCard: GiftCard; entry: GiftCardLedgerEntry; code: string }> {
    if (input.initialValue <= 0) throw new ValidationError('Gift card value must be positive');
    if (!input.idempotencyKey?.trim()) throw new ValidationError('An idempotency key is required');
    if (!input.purchasedByCustomerId && !input.purchasedByGuestSessionId && !input.actorStaffId) {
      throw new ValidationError('A gift card must be attributed to a purchaser or an issuing staff member');
    }

    const priorEntry = await this.prisma.giftCardLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (priorEntry) {
      const giftCard = await this.prisma.giftCard.findUniqueOrThrow({ where: { id: priorEntry.giftCardId } });
      // A replayed issuance never re-reveals the plaintext code (it was
      // already returned once, at genuine creation time) - the caller
      // gets the card's metadata back, never a fabricated/re-derived
      // secret.
      return { giftCard, entry: priorEntry, code: '' };
    }

    const code = generateGiftCardCode();
    const codeHash = hashGiftCardCode(code);
    const codeLast4 = code.slice(-4);

    const { giftCard, entry } = await this.prisma.$transaction(async (tx) => {
      const giftCard = await tx.giftCard.create({
        data: {
          codeHash,
          codeLast4,
          initialValue: input.initialValue,
          balance: input.initialValue,
          currency: input.currency ?? 'INR',
          purchasedByCustomerId: input.purchasedByCustomerId,
          purchasedByGuestSessionId: input.purchasedByGuestSessionId,
          recipientEmail: input.recipientEmail,
          expiresAt: input.expiresAt,
          issuedAt: new Date(),
        },
      });

      const entry = await tx.giftCardLedgerEntry.create({
        data: {
          giftCardId: giftCard.id,
          type: 'ISSUE',
          amount: input.initialValue,
          balanceAfter: input.initialValue,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          reason: input.actorStaffId ? 'Issued by staff' : 'Purchased',
          actorStaffId: input.actorStaffId,
          idempotencyKey: input.idempotencyKey,
        },
      });

      await recordAudit(tx, {
        actorType: input.actorStaffId ? 'STAFF' : input.purchasedByCustomerId ? 'CUSTOMER' : 'SYSTEM',
        actorStaffId: input.actorStaffId,
        action: 'gift_card.issue',
        entityType: 'GiftCard',
        entityId: giftCard.id,
        // Deliberately NEVER includes the code or codeHash - see this
        // method's own docblock. Only non-sensitive metadata.
        newValue: { initialValue: input.initialValue, currency: giftCard.currency, codeLast4 },
        reference: input.referenceId,
      });

      return { giftCard, entry };
    });

    return { giftCard, entry, code };
  }

  async disable(giftCardId: string, actorStaffId: string, reason: string): Promise<GiftCard> {
    if (!reason?.trim()) throw new ValidationError('A reason is required to disable a gift card');
    return this.prisma.$transaction(async (tx) => {
      const giftCard = await this.lockById(tx, giftCardId);
      if (giftCard.status === 'DISABLED') return giftCard;

      const updated = await tx.giftCard.update({
        where: { id: giftCardId },
        data: { status: 'DISABLED', disabledAt: new Date(), disabledReason: reason, disabledByStaffId: actorStaffId },
      });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'gift_card.disable',
        entityType: 'GiftCard',
        entityId: giftCardId,
        newValue: { reason },
      });
      return updated;
    });
  }

  /**
   * A manual staff correction - the one SIGNED-delta ledger entry type
   * (positive credits, negative debits), mirroring
   * LoyaltyService.manualAdjust's own reasoning for why a single signed
   * amount is the correct shape for a goodwill/correction action, rather
   * than two separate always-positive types. Never lets the balance go
   * negative (the DB's own gift_cards_balance_non_negative_check is the
   * authoritative guard; this is a friendlier pre-check).
   */
  async adjust(giftCardId: string, delta: number, reason: string, actorStaffId: string, idempotencyKey: string): Promise<GiftCardLedgerEntry> {
    if (delta === 0) throw new ValidationError('An adjustment delta must be non-zero');
    if (!reason?.trim()) throw new ValidationError('A reason is required for a manual adjustment');
    if (!idempotencyKey?.trim()) throw new ValidationError('An idempotency key is required');

    const prior = await this.prisma.giftCardLedgerEntry.findUnique({ where: { idempotencyKey } });
    if (prior) return prior;

    return this.prisma.$transaction(async (tx) => {
      const giftCard = await this.lockById(tx, giftCardId);
      const newBalance = Number(giftCard.balance) + delta;
      if (newBalance < 0) throw new ValidationError(`Adjustment would take the balance below zero (current balance: ₹${giftCard.balance})`);

      const entry = await tx.giftCardLedgerEntry.create({
        data: {
          giftCardId,
          type: 'ADJUSTMENT',
          amount: delta,
          balanceAfter: newBalance,
          reason,
          actorStaffId,
          idempotencyKey,
        },
      });
      await tx.giftCard.update({
        where: { id: giftCardId },
        data: { balance: newBalance, status: newBalance === 0 && giftCard.status === 'ACTIVE' ? 'DEPLETED' : undefined },
      });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'gift_card.adjust',
        entityType: 'GiftCard',
        entityId: giftCardId,
        newValue: { delta, reason, newBalance },
      });
      return entry;
    });
  }

  /**
   * A staff-initiated refund settled back onto the SAME gift card it was
   * originally redeemed from - deliberately never automatic (M30's own
   * explicit instruction: deciding refund tender allocation across
   * multiple payment sources on one order is a business policy this
   * milestone does not invent - see specs/33's own "refund interaction"
   * section). A staff member with `giftcard:manage` who has already
   * decided (per whatever process governs that decision) that THIS
   * refund should land back on THIS card calls this directly.
   */
  async refundToGiftCard(
    giftCardId: string,
    amount: number,
    referenceType: string,
    referenceId: string,
    actorStaffId: string,
    idempotencyKey: string,
  ): Promise<GiftCardLedgerEntry> {
    if (amount <= 0) throw new ValidationError('Refund amount must be positive');
    if (!idempotencyKey?.trim()) throw new ValidationError('An idempotency key is required');

    const prior = await this.prisma.giftCardLedgerEntry.findUnique({ where: { idempotencyKey } });
    if (prior) return prior;

    return this.prisma.$transaction(async (tx) => {
      const giftCard = await this.lockById(tx, giftCardId);
      const newBalance = Number(giftCard.balance) + amount;

      const entry = await tx.giftCardLedgerEntry.create({
        data: {
          giftCardId,
          type: 'REFUND_TO_GIFT_CARD',
          amount,
          balanceAfter: newBalance,
          referenceType,
          referenceId,
          reason: `Refund settled to gift card`,
          actorStaffId,
          idempotencyKey,
        },
      });
      await tx.giftCard.update({
        where: { id: giftCardId },
        data: { balance: newBalance, status: giftCard.status === 'DEPLETED' ? 'ACTIVE' : undefined },
      });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'gift_card.refund_to_gift_card',
        entityType: 'GiftCard',
        entityId: giftCardId,
        newValue: { amount, referenceType, referenceId, newBalance },
        reference: referenceId,
      });
      return entry;
    });
  }

  // --- Lookup ---

  /** Staff-facing metadata lookup (giftcard:read) - never returns or requires the plaintext code. */
  async getById(giftCardId: string) {
    const giftCard = await this.prisma.giftCard.findUnique({
      where: { id: giftCardId },
      include: { entries: { orderBy: { createdAt: 'desc' } } },
    });
    if (!giftCard) throw new NotFoundError('GiftCard', giftCardId);
    return giftCard;
  }

  private async findActiveByCode(code: string) {
    const codeHash = hashGiftCardCode(code);
    return this.prisma.giftCard.findUnique({ where: { codeHash } });
  }

  // --- M30 checkout-time redemption (same preview/reserve/convert/
  // release/sweep shape as StoreCreditService/LoyaltyService) ---

  private async availableBalance(tx: Prisma.TransactionClient | PrismaClient, giftCard: { id: string; balance: unknown }): Promise<number> {
    const held = await tx.giftCardRedemptionHold.aggregate({ where: { giftCardId: giftCard.id, status: 'ACTIVE' }, _sum: { amount: true } });
    return Number(giftCard.balance) - Number(held._sum.amount ?? 0);
  }

  private assertRedeemable(giftCard: GiftCard): void {
    // Deliberately the SAME generic error for every ineligible reason
    // (not found, wrong code, disabled, depleted, expired) - a
    // differentiated message would let an attacker distinguish "this
    // code doesn't exist" from "this code exists but is disabled",
    // which is itself information leakage about a stored secret's
    // validity (the exact enumeration concern M30/M31 both call out).
    if (giftCard.status !== 'ACTIVE') throw new ValidationError(GENERIC_REDEMPTION_ERROR);
    if (giftCard.expiresAt && giftCard.expiresAt.getTime() < Date.now()) throw new ValidationError(GENERIC_REDEMPTION_ERROR);
  }

  /** Non-authoritative preview - mirrors LoyaltyService/StoreCreditService's own previewRedemptionValue docblocks exactly. */
  async previewRedemptionValue(code: string, requestedAmount: number, grandTotal: number): Promise<number> {
    if (requestedAmount <= 0) throw new ValidationError('Gift card amount to apply must be positive');
    const giftCard = await this.findActiveByCode(code);
    if (!giftCard) throw new ValidationError(GENERIC_REDEMPTION_ERROR);
    this.assertRedeemable(giftCard);
    const available = await this.availableBalance(this.prisma, giftCard);
    if (available <= 0) throw new ValidationError(GENERIC_REDEMPTION_ERROR);
    return Math.min(requestedAmount, available, grandTotal);
  }

  /**
   * Authoritative reserve, called from inside CheckoutService.startCheckout's
   * own transaction, right after the CheckoutSession row exists - applied
   * LAST in the reduction chain (promotion -> loyalty -> store credit ->
   * gift card), same two-stage preview/reserve split as loyalty/store
   * credit for the same reason (the payment-provider amount must be known
   * before the session row - and therefore this hold - can exist).
   * `checkoutSessionId @unique` on the hold table means a checkout may
   * apply AT MOST one gift card - M30 explicitly does not invent
   * multi-gift-card stacking.
   */
  async reserveRedemptionForCheckout(
    tx: Prisma.TransactionClient,
    code: string,
    checkoutSessionId: string,
    requestedAmount: number,
    grandTotal: number,
  ): Promise<{ amount: number; giftCardId: string }> {
    if (requestedAmount <= 0) throw new ValidationError('Gift card amount to apply must be positive');
    const found = await tx.giftCard.findFirst({ where: { codeHash: hashGiftCardCode(code) }, select: { id: true } });
    if (!found) throw new ValidationError(GENERIC_REDEMPTION_ERROR);

    const giftCard = await this.lockById(tx, found.id);
    this.assertRedeemable(giftCard);
    const available = await this.availableBalance(tx, giftCard);
    if (available <= 0 || requestedAmount > available) throw new ValidationError(GENERIC_REDEMPTION_ERROR);

    const amount = Math.round(Math.min(requestedAmount, available, grandTotal) * 100) / 100;
    const env = loadEnv();
    const expiresAt = new Date(Date.now() + env.INVENTORY_RESERVATION_TTL_SECONDS * 1000);
    await tx.giftCardRedemptionHold.create({ data: { giftCardId: giftCard.id, checkoutSessionId, amount, expiresAt } });
    return { amount, giftCardId: giftCard.id };
  }

  /** Releases an ACTIVE hold without spending anything - same shape as the other two domains. */
  async releaseHoldForCheckoutSession(tx: Prisma.TransactionClient, checkoutSessionId: string): Promise<void> {
    await tx.giftCardRedemptionHold.updateMany({ where: { checkoutSessionId, status: 'ACTIVE' }, data: { status: 'RELEASED' } });
  }

  /**
   * Converts an ACTIVE hold into a real REDEEM ledger entry at order
   * confirmation - called from inside
   * OrderService.createOrderFromCheckoutSession's own transaction.
   * Idempotent via a deterministic idempotencyKey, mirroring
   * StoreCreditService.convertRedemptionHold exactly.
   */
  async convertRedemptionHold(tx: Prisma.TransactionClient, order: Order): Promise<void> {
    const hold = await tx.giftCardRedemptionHold.findUnique({ where: { checkoutSessionId: order.checkoutSessionId } });
    if (!hold || hold.status !== 'ACTIVE') return;

    const idempotencyKey = `giftcard-redeem:${order.checkoutSessionId}`;
    const existing = await tx.giftCardLedgerEntry.findUnique({ where: { idempotencyKey } });
    if (!existing) {
      const rows = await tx.$queryRaw<GiftCard[]>`SELECT * FROM "gift_cards" WHERE "id" = ${hold.giftCardId} FOR UPDATE`;
      const giftCard = rows[0]!;
      const newBalance = Number(giftCard.balance) - Number(hold.amount);

      await tx.giftCardLedgerEntry.create({
        data: {
          giftCardId: hold.giftCardId,
          type: 'REDEEM',
          amount: Number(hold.amount),
          balanceAfter: newBalance,
          reason: `Redeemed at order ${order.orderNumber}`,
          referenceType: 'ORDER',
          referenceId: order.id,
          idempotencyKey,
        },
      });
      await tx.giftCard.update({
        where: { id: hold.giftCardId },
        data: { balance: newBalance, status: newBalance === 0 ? 'DEPLETED' : undefined },
      });
      await recordAudit(tx, {
        actorType: order.customerId ? 'CUSTOMER' : 'SYSTEM',
        action: 'gift_card.redeem',
        entityType: 'GiftCard',
        entityId: hold.giftCardId,
        newValue: { amount: Number(hold.amount) },
        reference: order.id,
      });
    }

    await tx.giftCardRedemptionHold.update({ where: { id: hold.id }, data: { status: 'CONVERTED' } });
    await tx.order.update({ where: { id: order.id }, data: { giftCardApplied: hold.amount } });
  }

  /** Releases every hold whose checkout session never converted before the hold's own TTL elapsed. */
  async releaseStaleRedemptionHolds(): Promise<number> {
    const stale = await this.prisma.giftCardRedemptionHold.findMany({ where: { status: 'ACTIVE', expiresAt: { lt: new Date() } } });
    let released = 0;
    for (const hold of stale) {
      const didRelease = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "gift_card_redemption_holds" WHERE "id" = ${hold.id} FOR UPDATE`;
        const fresh = rows[0];
        if (!fresh || fresh.status !== 'ACTIVE') return false;
        await tx.giftCardRedemptionHold.update({ where: { id: hold.id }, data: { status: 'RELEASED' } });
        return true;
      });
      if (didRelease) released += 1;
    }
    return released;
  }

  // --- M30 purchase flow ---

  /**
   * Starts a gift-card purchase. Deliberately NOT a CheckoutSession/Order
   * (no physical SKU, no shipping, no inventory reservation) - see the
   * schema's own GiftCardPurchase docblock for the full reasoning. Always
   * RAZORPAY (never COD - nothing to physically deliver). Idempotent on
   * `idempotencyKey`, the same discipline as CheckoutService.startCheckout.
   */
  async initiatePurchase(
    identity: CartOwnerIdentity,
    amount: number,
    recipientEmail: string | undefined,
    idempotencyKey: string,
  ): Promise<{ id: string; status: string; providerReferenceId?: string; publicKeyId?: string; amount: number; message?: string }> {
    if (amount <= 0) throw new ValidationError('Gift card purchase amount must be positive');
    if (!idempotencyKey?.trim()) throw new ValidationError('An idempotency key is required');

    const existing = await this.prisma.giftCardPurchase.findUnique({ where: { idempotencyKey } });
    if (existing) return { id: existing.id, status: existing.status, providerReferenceId: existing.providerReferenceId ?? undefined, amount: Number(existing.amount) };

    const provider = resolvePaymentProvider('RAZORPAY');
    const paymentResult = await provider.initiate({
      checkoutSessionId: `giftcard-purchase:${idempotencyKey}`,
      amount,
      idempotencyKey: `${idempotencyKey}:payment`,
    });

    if (paymentResult.status === 'UNAVAILABLE') {
      throw new ValidationError(paymentResult.message ?? 'Online payment is unavailable right now - please try again shortly.');
    }

    try {
      const purchase = await this.prisma.giftCardPurchase.create({
        data: {
          customerId: identity.customerId,
          guestSessionId: identity.guestSessionId,
          amount,
          recipientEmail,
          status: 'INITIATED',
          provider: 'RAZORPAY',
          providerReferenceId: paymentResult.providerReferenceId,
          idempotencyKey,
        },
      });
      return { id: purchase.id, status: purchase.status, providerReferenceId: purchase.providerReferenceId ?? undefined, publicKeyId: paymentResult.publicKeyId, amount };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.giftCardPurchase.findUnique({ where: { idempotencyKey } });
        if (winner) return { id: winner.id, status: winner.status, providerReferenceId: winner.providerReferenceId ?? undefined, amount: Number(winner.amount) };
      }
      throw err;
    }
  }

  /**
   * Called from PaymentService.handleRazorpayWebhook once a
   * GiftCardPurchase-correlated PaymentEvent has been durably recorded
   * (recordOrResumeEvent) - the exact additive-dispatch pattern M21
   * established for Exchange price-difference payments, never touching
   * applyOutcome/applyCaptureOutcome. Idempotent: a GiftCardPurchase
   * already CAPTURED is a safe no-op (the webhook-level PaymentEvent
   * dedup is the primary guard; this is defense in depth).
   */
  async applyPurchaseCaptureOutcome(purchaseId: string, outcome: 'CAPTURED' | 'FAILED', providerPaymentEntityId?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; status: string; amount: unknown; recipientEmail: string | null; customerId: string | null; guestSessionId: string | null }[]
      >`SELECT * FROM "gift_card_purchases" WHERE "id" = ${purchaseId} FOR UPDATE`;
      const purchase = rows[0];
      if (!purchase) return;
      if (purchase.status !== 'INITIATED') return; // already terminal - safe no-op

      if (outcome === 'FAILED') {
        await tx.giftCardPurchase.update({ where: { id: purchaseId }, data: { status: 'FAILED', providerReferenceId: providerPaymentEntityId } });
        return;
      }

      const code = generateGiftCardCode();
      const codeHash = hashGiftCardCode(code);
      const codeLast4 = code.slice(-4);
      const amount = Number(purchase.amount);

      const giftCard = await tx.giftCard.create({
        data: {
          codeHash,
          codeLast4,
          initialValue: amount,
          balance: amount,
          purchasedByCustomerId: purchase.customerId,
          purchasedByGuestSessionId: purchase.guestSessionId,
          recipientEmail: purchase.recipientEmail,
          issuedAt: new Date(),
        },
      });
      await tx.giftCardLedgerEntry.create({
        data: {
          giftCardId: giftCard.id,
          type: 'ISSUE',
          amount,
          balanceAfter: amount,
          referenceType: 'GIFT_CARD_PURCHASE',
          referenceId: purchase.id,
          reason: 'Purchased',
          idempotencyKey: `giftcard-purchase-issue:${purchase.id}`,
        },
      });
      await tx.giftCardPurchase.update({
        where: { id: purchaseId },
        data: { status: 'CAPTURED', giftCardId: giftCard.id, providerReferenceId: providerPaymentEntityId },
      });
      await recordAudit(tx, {
        actorType: purchase.customerId ? 'CUSTOMER' : 'SYSTEM',
        action: 'gift_card.purchase.captured',
        entityType: 'GiftCardPurchase',
        entityId: purchase.id,
        // Never the code/codeHash - only non-sensitive metadata.
        newValue: { amount, codeLast4 },
        reference: giftCard.id,
      });
    });
  }
}
