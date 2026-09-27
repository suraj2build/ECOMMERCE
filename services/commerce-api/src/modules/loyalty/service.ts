import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type LoyaltyAccount, type LoyaltyLedgerEntry, type Order, type OrderLine } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';

/**
 * Loyalty (M23, specs/22-loyalty.md, LOY-001-005). Structurally SEPARATE
 * from StoreCreditAccount/Entry (REF-002) and from Promotion/Coupon (M24)
 * - four distinct concepts, never collapsed into one shared table (LOY-001).
 * See the schema docblock above the M23 model group for the full design
 * rationale: why EARN triggers at order confirmation rather than
 * delivery, the FIFO batch/allocation mechanism, and the checkout-time
 * redemption HOLD (mirroring InventoryReservation's own ACTIVE/CONVERTED/
 * EXPIRED lifecycle) that makes two concurrent checkouts unable to
 * double-spend the same points.
 *
 * Every rate/threshold this service reads (loadEnv()) is an intentionally
 * CONFIGURABLE engineering default (LOY-002/003/004) - never a Product
 * Owner-approved commercial policy.
 */
export class LoyaltyService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  // --- Account access ---

  /**
   * Row-locks (creating if absent) the LoyaltyAccount for a customer.
   * MUST run inside a transaction. Uses `upsert` (rather than
   * StoreCreditService.lockOrCreateAccount's check-then-create-with-
   * retry idiom) because loyalty's identity key is always exactly
   * customerId (never a guest/customer XOR) - a single-unique-key upsert
   * compiles to an atomic INSERT ... ON CONFLICT DO NOTHING-equivalent at
   * the database level, so two genuinely concurrent first-ever-account
   * calls for the SAME customer never race at all (no P2002, no retry
   * needed) - important here specifically because this method is called
   * from INSIDE OrderService's own larger transaction (order
   * confirmation), where an uncaught P2002 would abort the entire order
   * creation, not just this call.
   */
  private async lockOrCreateAccountByCustomerId(tx: Prisma.TransactionClient, customerId: string): Promise<LoyaltyAccount> {
    await tx.loyaltyAccount.upsert({ where: { customerId }, update: {}, create: { customerId } });
    const rows = await tx.$queryRaw<LoyaltyAccount[]>`SELECT * FROM "loyalty_accounts" WHERE "customerId" = ${customerId} FOR UPDATE`;
    return rows[0]!;
  }

  private async lockAccountById(tx: Prisma.TransactionClient, accountId: string): Promise<LoyaltyAccount> {
    const rows = await tx.$queryRaw<LoyaltyAccount[]>`SELECT * FROM "loyalty_accounts" WHERE "id" = ${accountId} FOR UPDATE`;
    if (!rows[0]) throw new NotFoundError('LoyaltyAccount', accountId);
    return rows[0];
  }

  private async recomputeTier(tx: Prisma.TransactionClient, accountId: string): Promise<void> {
    const account = await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: accountId } });
    const tier = await tx.loyaltyTier.findFirst({
      where: { minLifetimePoints: { lte: account.lifetimeEarnedPoints } },
      orderBy: { minLifetimePoints: 'desc' },
    });
    if (tier && tier.id !== account.currentTierId) {
      await tx.loyaltyAccount.update({ where: { id: accountId }, data: { currentTierId: tier.id } });
    }
  }

  async getBalanceForCustomer(customerId: string): Promise<{ balance: number; lifetimeEarnedPoints: number; tier: { id: string; name: string } | null }> {
    const account = await this.prisma.loyaltyAccount.findUnique({ where: { customerId }, include: { currentTier: true } });
    if (!account) return { balance: 0, lifetimeEarnedPoints: 0, tier: null };
    return {
      balance: account.balance,
      lifetimeEarnedPoints: account.lifetimeEarnedPoints,
      tier: account.currentTier ? { id: account.currentTier.id, name: account.currentTier.name } : null,
    };
  }

  async listLedgerForCustomer(customerId: string) {
    const account = await this.prisma.loyaltyAccount.findUnique({ where: { customerId } });
    if (!account) return [];
    const entries = await this.prisma.loyaltyLedgerEntry.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return entries.map((e) => ({
      id: e.id,
      type: e.type,
      pointsDelta: e.pointsDelta,
      reason: e.reason,
      expiresAt: e.expiresAt,
      createdAt: e.createdAt,
    }));
  }

  /** Available-to-spend balance = ledger balance minus every currently-ACTIVE hold (mirrors inventory's onHand-vs-reserved-vs-available split). */
  private async availableBalance(
    tx: Prisma.TransactionClient | PrismaClient,
    account: { id: string; balance: number },
  ): Promise<number> {
    const held = await tx.loyaltyRedemptionHold.aggregate({
      where: { accountId: account.id, status: 'ACTIVE' },
      _sum: { points: true },
    });
    return account.balance - (held._sum.points ?? 0);
  }

  /**
   * Non-authoritative preview of a redemption's INR value, used ONLY to
   * compute the amount CheckoutService hands to the payment provider
   * BEFORE the checkout's own transaction exists (chicken-and-egg: the
   * authoritative lock+hold in `reserveRedemptionForCheckout` needs a
   * CheckoutSession row to attach to, which doesn't exist yet at this
   * point). Throws the same validation errors early for a fast, honest
   * rejection; the REAL enforcement is the row-locked re-check inside
   * `reserveRedemptionForCheckout` moments later - if a genuine
   * concurrent race changes the answer in between (vanishingly rare: the
   * SAME customer completing two checkouts within milliseconds of each
   * other), that re-check fails safely and CheckoutService aborts the
   * whole attempt (see that call site's own docblock), never silently
   * charging for a redemption that didn't actually hold.
   */
  async previewRedemptionValue(customerId: string, points: number, grandTotal: number): Promise<number> {
    const env = loadEnv();
    if (points < env.LOYALTY_MIN_REDEMPTION_POINTS) {
      throw new ValidationError(`Minimum redemption is ${env.LOYALTY_MIN_REDEMPTION_POINTS} points`);
    }
    if (points > env.LOYALTY_MAX_REDEMPTION_POINTS_PER_ORDER) {
      throw new ValidationError(`Maximum redemption per order is ${env.LOYALTY_MAX_REDEMPTION_POINTS_PER_ORDER} points`);
    }
    const account = await this.prisma.loyaltyAccount.findUnique({ where: { customerId } });
    const available = account ? await this.availableBalance(this.prisma, account) : 0;
    if (points > available) throw new ValidationError(`Only ${available} points are available to redeem`);

    const value = (points * env.LOYALTY_REDEMPTION_PAISE_PER_POINT) / 100;
    if (value > grandTotal) throw new ValidationError('Redemption value cannot exceed the order total');
    return value;
  }

  // --- EARN (order confirmation) ---

  /**
   * Posts the ONE EARN ledger entry for a newly-confirmed order. Called
   * from inside OrderService.createOrderFromCheckoutSession's own
   * transaction (never a separate, forgettable step). No-op for a guest
   * order (no customerId - loyalty requires a persistent identity to
   * earn/redeem against on a FUTURE purchase, which a guest session does
   * not have) and for a zero-point result (e.g. a very small order under
   * the configured earn rate's rounding floor).
   *
   * Idempotent via `qualifyingOrderId`'s unique constraint - a retried
   * call for an order that already has an EARN entry is a safe no-op
   * (OrderService's own top-level idempotency on checkoutSessionId
   * already prevents this from being reached twice in practice; this is
   * defense in depth, matching every other mutation in this codebase).
   */
  async earnForOrder(tx: Prisma.TransactionClient, order: Order): Promise<void> {
    if (!order.customerId) return;

    const existing = await tx.loyaltyLedgerEntry.findUnique({ where: { qualifyingOrderId: order.id } });
    if (existing) return;

    const env = loadEnv();
    const qualifyingValue = order.subtotal; // tax-inclusive merchandise value, excluding shipping - see model-group docblock
    const points = Math.floor((Number(qualifyingValue) * env.LOYALTY_EARN_POINTS_PER_100_INR) / 100);
    if (points <= 0) return;

    const account = await this.lockOrCreateAccountByCustomerId(tx, order.customerId);
    const expiresAt = new Date(Date.now() + env.LOYALTY_POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    try {
      await tx.loyaltyLedgerEntry.create({
        data: {
          accountId: account.id,
          type: 'EARN',
          pointsDelta: points,
          remainingPoints: points,
          expiresAt,
          qualifyingOrderId: order.id,
          reason: `Order ${order.orderNumber} confirmed`,
          idempotencyKey: `loyalty-earn:${order.id}`,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return; // genuinely already earned
      throw err;
    }

    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { balance: { increment: points }, lifetimeEarnedPoints: { increment: points } },
    });
    await this.recomputeTier(tx, account.id);
    await tx.order.update({ where: { id: order.id }, data: { loyaltyPointsEarned: points } });

    await recordAudit(tx, {
      actorType: 'SYSTEM',
      action: 'loyalty.earn',
      entityType: 'LoyaltyAccount',
      entityId: account.id,
      newValue: { points },
      reference: order.id,
    });
  }

  // --- REVERSE (cancellation / return) ---

  /**
   * Reverses the proportional share of loyalty points a single cancelled
   * OrderLine contributed to its order's EARN batch. See the model-group
   * schema docblock for why earning-at-confirmation (not delivery) is
   * what makes this reachable at all without weakening M18's certified
   * "cannot cancel a shipped/delivered line" boundary. A line's share is
   * capped at whatever remains unconsumed in that specific EARN batch
   * (points already redeemed/expired elsewhere cannot be clawed back) -
   * this is not a bug, it is the correct behavior: you cannot reverse
   * points that were already genuinely spent.
   *
   * Idempotent via `reversalOrderLineId`'s unique constraint - a retried
   * cancellation (M18's own idempotency key convention) never
   * double-reverses.
   */
  async reverseForOrderLine(tx: Prisma.TransactionClient, order: Order, orderLine: OrderLine, reason: string): Promise<void> {
    await this.reverse(tx, order, Number(orderLine.lineTotalInclusive), { reversalOrderLineId: orderLine.id }, reason);
  }

  /**
   * Same mechanism as reverseForOrderLine, keyed on the ReturnLine instead
   * - see that method's docblock. Takes just `{ id }` rather than a full
   * ReturnLine since that's the only field this needs, and the caller
   * (ReturnService.recordQcAndDisposition) only has the narrow row shape
   * returned by its own `lockReturnLine` row-lock helper, not a full
   * Prisma ReturnLine.
   */
  async reverseForReturnLine(tx: Prisma.TransactionClient, order: Order, orderLine: OrderLine, returnLine: { id: string }, reason: string): Promise<void> {
    await this.reverse(tx, order, Number(orderLine.lineTotalInclusive), { reversalReturnLineId: returnLine.id }, reason);
  }

  private async reverse(
    tx: Prisma.TransactionClient,
    order: Order,
    lineValue: number,
    anchor: { reversalOrderLineId: string } | { reversalReturnLineId: string },
    reason: string,
  ): Promise<void> {
    const earnEntry = await tx.loyaltyLedgerEntry.findUnique({ where: { qualifyingOrderId: order.id } });
    if (!earnEntry || Number(order.subtotal) <= 0) return; // guest order, or nothing was ever earned

    const idempotencyKey =
      'reversalOrderLineId' in anchor ? `loyalty-reverse:orderline:${anchor.reversalOrderLineId}` : `loyalty-reverse:returnline:${anchor.reversalReturnLineId}`;
    const prior = await tx.loyaltyLedgerEntry.findFirst({ where: anchor });
    if (prior) return; // already reversed for this exact trigger - idempotent no-op

    const lineShare = Math.floor((earnEntry.pointsDelta * lineValue) / Number(order.subtotal));
    if (lineShare <= 0) return;

    const account = await this.lockAccountById(tx, earnEntry.accountId);
    const freshEarn = await tx.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: earnEntry.id } });
    const actualReverse = Math.min(lineShare, freshEarn.remainingPoints ?? 0);
    if (actualReverse <= 0) return;

    let reverseEntry: LoyaltyLedgerEntry;
    try {
      reverseEntry = await tx.loyaltyLedgerEntry.create({
        data: {
          accountId: account.id,
          type: 'REVERSE',
          pointsDelta: -actualReverse,
          reason,
          idempotencyKey,
          ...anchor,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return; // lost a genuine race to another reversal of the SAME trigger
      throw err;
    }

    await tx.loyaltyPointAllocation.create({
      data: { spendingEntryId: reverseEntry.id, earnEntryId: freshEarn.id, pointsConsumed: actualReverse },
    });
    await tx.loyaltyLedgerEntry.update({ where: { id: freshEarn.id }, data: { remainingPoints: { decrement: actualReverse } } });
    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { balance: { decrement: actualReverse }, lifetimeEarnedPoints: { decrement: actualReverse } },
    });
    await this.recomputeTier(tx, account.id);

    await recordAudit(tx, {
      actorType: 'SYSTEM',
      action: 'loyalty.reverse',
      entityType: 'LoyaltyAccount',
      entityId: account.id,
      newValue: { points: actualReverse },
      reference: order.id,
    });
  }

  // --- FIFO draw-down (shared by REDEEM conversion and EXPIRE sweep) ---

  private async drawDownFifo(
    tx: Prisma.TransactionClient,
    account: LoyaltyAccount,
    points: number,
    type: 'REDEEM' | 'EXPIRE',
    reason: string,
    idempotencyKeyPrefix: string,
  ): Promise<void> {
    const batches = await tx.loyaltyLedgerEntry.findMany({
      where: { accountId: account.id, type: 'EARN', remainingPoints: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
    });

    let remaining = points;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, batch.remainingPoints ?? 0);
      if (take <= 0) continue;

      const entry = await tx.loyaltyLedgerEntry.create({
        data: { accountId: account.id, type, pointsDelta: -take, reason, idempotencyKey: `${idempotencyKeyPrefix}:${batch.id}` },
      });
      await tx.loyaltyPointAllocation.create({ data: { spendingEntryId: entry.id, earnEntryId: batch.id, pointsConsumed: take } });
      await tx.loyaltyLedgerEntry.update({ where: { id: batch.id }, data: { remainingPoints: { decrement: take } } });
      remaining -= take;
    }

    const actuallyDrawn = points - Math.max(remaining, 0);
    await tx.loyaltyAccount.update({ where: { id: account.id }, data: { balance: { decrement: actuallyDrawn } } });
  }

  // --- Checkout-time redemption hold ---

  /**
   * Validates a requested redemption and creates its HOLD row, called
   * from INSIDE CheckoutService.startCheckout's own transaction, right
   * after the CheckoutSession row itself is inserted (the hold's FK
   * requires that row to already exist - same "create the row this
   * depends on first, in the same transaction" discipline every other
   * checkout-time side effect in this codebase already follows). Does
   * NOT touch the ledger or the account balance - see
   * LoyaltyRedemptionHold's own schema docblock for why: this is a
   * RESERVATION, not a spend; the actual REDEEM ledger entries only post
   * at order confirmation (convertRedemptionHold).
   *
   * Checkout in this codebase is a single, synchronous, one-shot call
   * (address + payment method in, a fully-priced/reserved/payment-
   * initiated session out - there is no separate "edit an in-progress
   * session" step for anything else either, e.g. cart items are locked
   * in at this same call), so redemption is requested as part of THIS
   * call's own input, never as a later mutation of an existing session.
   */
  async reserveRedemptionForCheckout(
    tx: Prisma.TransactionClient,
    customerId: string,
    checkoutSessionId: string,
    points: number,
    grandTotal: number,
  ): Promise<{ points: number; value: number }> {
    const env = loadEnv();
    if (points < env.LOYALTY_MIN_REDEMPTION_POINTS) {
      throw new ValidationError(`Minimum redemption is ${env.LOYALTY_MIN_REDEMPTION_POINTS} points`);
    }
    if (points > env.LOYALTY_MAX_REDEMPTION_POINTS_PER_ORDER) {
      throw new ValidationError(`Maximum redemption per order is ${env.LOYALTY_MAX_REDEMPTION_POINTS_PER_ORDER} points`);
    }

    const account = await this.lockOrCreateAccountByCustomerId(tx, customerId);
    const available = await this.availableBalance(tx, account);
    if (points > available) throw new ValidationError(`Only ${available} points are available to redeem`);

    const value = (points * env.LOYALTY_REDEMPTION_PAISE_PER_POINT) / 100;
    if (value > grandTotal) throw new ValidationError('Redemption value cannot exceed the order total');

    // Mirrors InventoryReservation's own checkout-lifetime TTL - a hold
    // outlives the checkout only as long as the session itself is
    // meaningfully still in progress.
    const expiresAt = new Date(Date.now() + env.INVENTORY_RESERVATION_TTL_SECONDS * 1000);
    await tx.loyaltyRedemptionHold.create({
      data: { accountId: account.id, checkoutSessionId, points, value, expiresAt },
    });

    return { points, value };
  }

  /** Releases an ACTIVE hold without spending anything - called wherever inventory reservations for the same session are released (payment expiry/failure-to-terminal sweeps). Safe no-op if no hold exists or it already resolved. */
  async releaseHoldForCheckoutSession(tx: Prisma.TransactionClient, checkoutSessionId: string): Promise<void> {
    await tx.loyaltyRedemptionHold.updateMany({
      where: { checkoutSessionId, status: 'ACTIVE' },
      data: { status: 'RELEASED' },
    });
  }

  /**
   * Converts an ACTIVE hold into the real REDEEM ledger entries at order
   * confirmation - called from inside
   * OrderService.createOrderFromCheckoutSession's own transaction, right
   * after the Order row itself is created. A safe no-op if no hold
   * exists (nothing redeemed) or the hold is already CONVERTED (this
   * exact idempotency scenario is normally unreachable in practice,
   * since OrderService's own top-level checkoutSessionId uniqueness
   * already short-circuits a retried order-creation before this is ever
   * reached twice - this check is defense in depth).
   *
   * Defensive cap (documented, extremely narrow limitation): if some of
   * the hold's underlying points expired in the (checkout-session-TTL-
   * bounded, typically ~15-minute) window between hold-creation and this
   * conversion, fewer points may genuinely be available than the hold
   * recorded - this redeems whatever is ACTUALLY available rather than
   * throwing (an order must never be blocked by a stale points-expiry
   * corner case once payment has already been accepted), and records
   * the ACTUAL redeemed value on the Order, which may be (rarely, by at
   * most a few points) smaller than what was displayed to the customer
   * during checkout.
   */
  async convertRedemptionHold(tx: Prisma.TransactionClient, order: Order): Promise<void> {
    const hold = await tx.loyaltyRedemptionHold.findUnique({ where: { checkoutSessionId: order.checkoutSessionId } });
    if (!hold || hold.status !== 'ACTIVE') return;

    const account = await this.lockAccountById(tx, hold.accountId);
    const actualPoints = Math.min(hold.points, account.balance);
    if (actualPoints > 0) {
      await this.drawDownFifo(tx, account, actualPoints, 'REDEEM', `Redeemed at order ${order.orderNumber}`, `loyalty-redeem:${order.id}`);
    }
    const env = loadEnv();
    const actualValue = (actualPoints * env.LOYALTY_REDEMPTION_PAISE_PER_POINT) / 100;

    await tx.loyaltyRedemptionHold.update({ where: { id: hold.id }, data: { status: 'CONVERTED' } });
    await tx.order.update({
      where: { id: order.id },
      data: { loyaltyPointsRedeemed: actualPoints, loyaltyRedemptionValue: actualValue },
    });

    await recordAudit(tx, {
      actorType: 'CUSTOMER',
      action: 'loyalty.redeem',
      entityType: 'LoyaltyAccount',
      entityId: account.id,
      newValue: { points: actualPoints },
      reference: order.id,
    });
  }

  /** Releases every hold whose checkout session never converted to an order before the hold's own TTL elapsed - callable directly or by a future scheduler, same shape as InventoryService.expireStaleReservations. */
  async releaseStaleRedemptionHolds(): Promise<number> {
    const stale = await this.prisma.loyaltyRedemptionHold.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
    });
    let released = 0;
    for (const hold of stale) {
      const didRelease = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "loyalty_redemption_holds" WHERE "id" = ${hold.id} FOR UPDATE`;
        const fresh = rows[0];
        if (!fresh || fresh.status !== 'ACTIVE') return false;
        await tx.loyaltyRedemptionHold.update({ where: { id: hold.id }, data: { status: 'RELEASED' } });
        return true;
      });
      if (didRelease) released += 1;
    }
    return released;
  }

  // --- EXPIRE (sweep) ---

  /** Expires every EARN batch past its configured retention window - callable directly or by a future scheduler. Idempotent per batch (idempotencyKey `expire:<batchId>`), safe to run repeatedly or concurrently. */
  async expirePoints(): Promise<number> {
    const now = new Date();
    const stale = await this.prisma.loyaltyLedgerEntry.findMany({
      where: { type: 'EARN', remainingPoints: { gt: 0 }, expiresAt: { lt: now } },
    });

    let count = 0;
    for (const batch of stale) {
      const applied = await this.prisma
        .$transaction(async (tx) => {
          const account = await this.lockAccountById(tx, batch.accountId);
          const fresh = await tx.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: batch.id } });
          if (!fresh.remainingPoints || fresh.remainingPoints <= 0 || !fresh.expiresAt || fresh.expiresAt >= now) return false;

          const take = fresh.remainingPoints;
          const entry = await tx.loyaltyLedgerEntry.create({
            data: { accountId: account.id, type: 'EXPIRE', pointsDelta: -take, reason: 'Points expired', idempotencyKey: `expire:${batch.id}` },
          });
          await tx.loyaltyPointAllocation.create({ data: { spendingEntryId: entry.id, earnEntryId: batch.id, pointsConsumed: take } });
          await tx.loyaltyLedgerEntry.update({ where: { id: batch.id }, data: { remainingPoints: 0 } });
          await tx.loyaltyAccount.update({ where: { id: account.id }, data: { balance: { decrement: take } } });

          await recordAudit(tx, {
            actorType: 'SYSTEM',
            action: 'loyalty.expire',
            entityType: 'LoyaltyAccount',
            entityId: account.id,
            newValue: { points: take },
            reference: batch.id,
          });
          return true;
        })
        .catch((err) => {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false; // already expired by a concurrent sweep run
          throw err;
        });
      if (applied) count += 1;
    }
    return count;
  }

  // --- Manual staff adjustment ---

  async manualAdjust(customerId: string, pointsDelta: number, reason: string, actorStaffId: string, idempotencyKey: string): Promise<LoyaltyLedgerEntry> {
    if (pointsDelta === 0) throw new ValidationError('An adjustment must be non-zero');
    if (!reason?.trim()) throw new ValidationError('A reason is required for a manual loyalty adjustment');
    if (!idempotencyKey?.trim()) throw new ValidationError('An idempotency key is required');

    const prior = await this.prisma.loyaltyLedgerEntry.findUnique({ where: { idempotencyKey } });
    if (prior) return prior;

    return this.prisma.$transaction(async (tx) => {
      const account = await this.lockOrCreateAccountByCustomerId(tx, customerId);

      let entry: LoyaltyLedgerEntry;
      try {
        entry = await tx.loyaltyLedgerEntry.create({
          data: { accountId: account.id, type: 'ADJUST', pointsDelta, reason: reason.trim(), actorStaffId, idempotencyKey },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const winner = await tx.loyaltyLedgerEntry.findUnique({ where: { idempotencyKey } });
          if (winner) return winner;
        }
        throw err;
      }

      const balanceDelta = pointsDelta;
      const lifetimeDelta = pointsDelta > 0 ? pointsDelta : 0; // negative adjustments correct/claw back a balance, never demote lifetime tier standing
      await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: { balance: { increment: balanceDelta }, lifetimeEarnedPoints: { increment: lifetimeDelta } },
      });
      if (lifetimeDelta > 0) await this.recomputeTier(tx, account.id);

      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'loyalty.adjust',
        entityType: 'LoyaltyAccount',
        entityId: account.id,
        newValue: { pointsDelta, reason: reason.trim() },
      });

      return entry;
    });
  }
}
