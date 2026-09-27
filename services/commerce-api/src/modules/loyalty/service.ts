import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type LoyaltyAccount, type LoyaltyLedgerEntry, type Order, type OrderLine } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { resolveReturnPolicy, isWithinWindow } from '../returns/policy.js';

/**
 * Loyalty (M23, specs/22-loyalty.md, LOY-001-006). Structurally SEPARATE
 * from StoreCreditAccount/Entry (REF-002) and from Promotion/Coupon (M24)
 * - four distinct concepts, never collapsed into one shared table (LOY-001).
 *
 * 2026-09-27 LOY-006 PRODUCT OWNER DECISION: an EARN entry's point
 * entitlement is CALCULATED at order confirmation (one entry per ORDER
 * LINE, never per order - vesting must be line-aware), but is NOT
 * spendable until it VESTS: the qualifying line must be DELIVERED *and*
 * its own return/exchange eligibility window (the SAME
 * `resolveReturnPolicy`/`isWithinWindow` source of truth returns/policy.ts
 * already established for Return/Exchange - never a second, independently
 * invented window rule) must have CLOSED, with no still-open Return or
 * Exchange on that line. `LoyaltyAccount.balance`/`lifetimeEarnedPoints`,
 * checkout redemption, and FIFO draw-down all reflect ONLY VESTED points -
 * a PENDING entitlement never counts as available/spendable, never
 * satisfies a minimum-redemption check, and is never drawn down. See the
 * schema's own M23 model-group docblock for the full design rationale and
 * `vestEligiblePoints` below for the vesting sweep itself.
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

  /**
   * Public balance read. `balance` (VESTED, available/spendable) and
   * `pendingPoints` (calculated but not yet redeemable) are reported
   * SEPARATELY, never summed - a customer-facing surface must never
   * present pending points as though they were already spendable
   * (LOY-006).
   */
  async getBalanceForCustomer(customerId: string): Promise<{ balance: number; pendingPoints: number; lifetimeEarnedPoints: number; tier: { id: string; name: string } | null }> {
    const account = await this.prisma.loyaltyAccount.findUnique({ where: { customerId }, include: { currentTier: true } });
    if (!account) return { balance: 0, pendingPoints: 0, lifetimeEarnedPoints: 0, tier: null };
    const pending = await this.prisma.loyaltyLedgerEntry.aggregate({
      where: { accountId: account.id, type: 'EARN', vestingStatus: 'PENDING' },
      _sum: { pointsDelta: true },
    });
    return {
      balance: account.balance,
      pendingPoints: pending._sum.pointsDelta ?? 0,
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
      vestingStatus: e.vestingStatus,
      vestedAt: e.vestedAt,
      reason: e.reason,
      expiresAt: e.expiresAt,
      createdAt: e.createdAt,
    }));
  }

  /** Available-to-spend balance = VESTED ledger balance minus every currently-ACTIVE hold (mirrors inventory's onHand-vs-reserved-vs-available split). PENDING points never contribute - `account.balance` itself already excludes them. */
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

  // --- EARN (order confirmation - entitlement CALCULATED, PENDING until vested) ---

  /**
   * Posts one PENDING EARN ledger entry PER ORDER LINE for a newly-
   * confirmed order (LOY-006: vesting must be line-aware, since lines can
   * deliver - and close their own return window - on different dates, so
   * a single order-level batch can no longer represent entitlement
   * correctly). Called from inside OrderService.createOrderFromCheckoutSession's
   * own transaction (never a separate, forgettable step). No-op for a
   * guest order (no customerId) and per-line for a zero-point result
   * (e.g. a very small line under the configured earn rate's rounding
   * floor).
   *
   * CRITICAL: this only CALCULATES the entitlement and records it
   * PENDING. It deliberately does NOT touch `LoyaltyAccount.balance`,
   * `lifetimeEarnedPoints`, or `expiresAt` - none of that happens until
   * `vestEligiblePoints` actually vests the entry. `remainingPoints` is
   * still set at creation (mirroring the pre-vesting build) since it is
   * simply "this entry's own total", not yet meaningfully drawn against
   * until vested.
   *
   * Idempotent via `qualifyingOrderLineId`'s unique constraint - a
   * retried call for a line that already has an EARN entry is a safe
   * no-op (OrderService's own top-level idempotency on
   * checkoutSessionId already prevents this from being reached twice in
   * practice; this is defense in depth, matching every other mutation in
   * this codebase).
   */
  async earnForOrder(tx: Prisma.TransactionClient, order: Order & { lines: OrderLine[] }): Promise<void> {
    if (!order.customerId) return;

    for (const line of order.lines) {
      await this.earnForOrderLine(tx, order.customerId, order.orderNumber, line);
    }
  }

  private async earnForOrderLine(tx: Prisma.TransactionClient, customerId: string, orderNumber: string, line: OrderLine): Promise<void> {
    const existing = await tx.loyaltyLedgerEntry.findUnique({ where: { qualifyingOrderLineId: line.id } });
    if (existing) return;

    const env = loadEnv();
    const qualifyingValue = line.lineTotalInclusive; // tax-inclusive merchandise value for THIS line
    const points = Math.floor((Number(qualifyingValue) * env.LOYALTY_EARN_POINTS_PER_100_INR) / 100);
    if (points <= 0) return;

    const account = await this.lockOrCreateAccountByCustomerId(tx, customerId);

    try {
      await tx.loyaltyLedgerEntry.create({
        data: {
          accountId: account.id,
          type: 'EARN',
          pointsDelta: points,
          remainingPoints: points,
          vestingStatus: 'PENDING',
          qualifyingOrderLineId: line.id,
          reason: `Order ${orderNumber} confirmed (line ${line.id})`,
          idempotencyKey: `loyalty-earn:${line.id}`,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return; // genuinely already earned
      throw err;
    }

    // Order.loyaltyPointsEarned is a customer-facing "how many points did
    // this order earn" summary - it reflects the CALCULATED total
    // (PENDING + VESTED), never just the vested subset, since that field
    // predates vesting and the order-detail UI already labels it
    // alongside the account's own PENDING/AVAILABLE split.
    await tx.order.update({ where: { id: line.orderId }, data: { loyaltyPointsEarned: { increment: points } } });

    await recordAudit(tx, {
      actorType: 'SYSTEM',
      action: 'loyalty.earn.pending',
      entityType: 'LoyaltyAccount',
      entityId: account.id,
      newValue: { points, orderLineId: line.id },
      reference: line.orderId,
    });
  }

  // --- VESTING (LOY-006) ---

  /**
   * Is this specific qualifying OrderLine currently eligible to vest?
   * Reuses the SAME resolveReturnPolicy/isWithinWindow source of truth
   * Return/Exchange already use - never a second, independently invented
   * window rule (explicit LOY-006 instruction).
   *
   * Delivered AND (the SKU is not returnable at all, OR its return window
   * has closed) AND no still-open Return/Exchange on this line (a
   * Return/Exchange can be INITIATED right up to the last day of the
   * calendar window and take longer than that to resolve - the calendar
   * check alone is not enough; see this method's own two additional
   * clauses). Once a Return/Exchange reaches a QC decision, either it
   * already triggered `reverse` (PASS - the entry is CANCELLED, so it
   * will never reach this check as PENDING again) or it did not (FAIL -
   * no block), so checking "unresolved" is exactly the same test as
   * "would a PASS still change anything if it happened right now".
   */
  private async isLineEligibleToVest(
    tx: Prisma.TransactionClient | PrismaClient,
    line: {
      id: string;
      skuId: string;
      status: string;
      fulfilment: { deliveredAt: Date | null } | null;
      returnLine: { disposition: string | null; return: { status: string } } | null;
      exchange: { qcResult: string | null; status: string } | null;
    },
  ): Promise<boolean> {
    if (line.status !== 'DELIVERED' || !line.fulfilment?.deliveredAt) return false;
    if (line.returnLine && line.returnLine.disposition === null && line.returnLine.return.status !== 'CANCELLED') return false;
    if (line.exchange && line.exchange.qcResult === null && line.exchange.status !== 'CANCELLED') return false;

    const policy = await resolveReturnPolicy(tx as PrismaClient, line.skuId);
    if (!policy.returnable) return true; // never returnable at all - nothing to wait for
    return !isWithinWindow(line.fulfilment.deliveredAt, policy.windowDays);
  }

  /**
   * Idempotent, concurrency-safe sweep: finds every PENDING EARN entry
   * whose line has become eligible (per isLineEligibleToVest) and
   * transitions it to VESTED exactly once. Callable directly or by a
   * future scheduler (no general scheduling platform is built here -
   * LOY-006's own explicit instruction).
   *
   * Concurrency: each candidate is processed in its OWN transaction that
   * locks the LoyaltyAccount row FIRST (the same row-lock-as-
   * serialization-point idiom `reverse` also follows, in that same
   * order, so the two can never deadlock against each other), then
   * re-reads the entry fresh under that lock. Two concurrent sweep runs
   * (or a retried/duplicated sweep call) racing the SAME entry: whichever
   * transaction acquires the account lock first vests it; the other
   * re-reads the fresh row, finds it already VESTED (or CANCELLED, if a
   * cancellation/reversal won the race instead), and safely no-ops -
   * exactly one vesting transition per entry, ever, proven under genuine
   * `Promise.all` concurrency (test/integration/loyalty.test.ts).
   */
  async vestEligiblePoints(): Promise<number> {
    const candidates = await this.prisma.loyaltyLedgerEntry.findMany({
      where: { type: 'EARN', vestingStatus: 'PENDING' },
      include: {
        qualifyingOrderLine: {
          include: {
            fulfilment: { select: { deliveredAt: true } },
            returnLine: { include: { return: { select: { status: true } } } },
            exchange: { select: { qcResult: true, status: true } },
          },
        },
      },
    });

    let vestedCount = 0;
    for (const entry of candidates) {
      const line = entry.qualifyingOrderLine;
      if (!line) continue; // defensive - every EARN entry has a qualifying line by construction
      const eligible = await this.isLineEligibleToVest(this.prisma, line);
      if (!eligible) continue;

      const didVest = await this.prisma.$transaction((tx) => this.vestOne(tx, entry.id));
      if (didVest) vestedCount += 1;
    }
    return vestedCount;
  }

  private async vestOne(tx: Prisma.TransactionClient, entryId: string): Promise<boolean> {
    const entryAccountId = await tx.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: entryId }, select: { accountId: true } });
    const account = await this.lockAccountById(tx, entryAccountId.accountId);

    // Re-read the entry AND its qualifying line's FULL current state only
    // AFTER acquiring the account lock - the serialization point every
    // mutation to this account (including a concurrent QC-PASS reversal
    // via `reverse`, which locks this SAME account row first) goes
    // through, so this read can never observe a stale in-between state.
    const fresh = await tx.loyaltyLedgerEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: {
        qualifyingOrderLine: {
          include: {
            fulfilment: { select: { deliveredAt: true } },
            returnLine: { include: { return: { select: { status: true } } } },
            exchange: { select: { qcResult: true, status: true } },
          },
        },
      },
    });
    if (fresh.vestingStatus !== 'PENDING') return false; // already vested or cancelled by a racing transaction
    if (!fresh.qualifyingOrderLine) return false; // defensive - every EARN entry has a qualifying line by construction

    const stillEligible = await this.isLineEligibleToVest(tx, fresh.qualifyingOrderLine);
    if (!stillEligible) return false;

    const env = loadEnv();
    const expiresAt = new Date(Date.now() + env.LOYALTY_POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await tx.loyaltyLedgerEntry.update({
      where: { id: entryId },
      data: { vestingStatus: 'VESTED', vestedAt: new Date(), expiresAt },
    });
    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { balance: { increment: fresh.pointsDelta }, lifetimeEarnedPoints: { increment: fresh.pointsDelta } },
    });
    await this.recomputeTier(tx, account.id);

    await recordAudit(tx, {
      actorType: 'SYSTEM',
      action: 'loyalty.vest',
      entityType: 'LoyaltyAccount',
      entityId: account.id,
      newValue: { points: fresh.pointsDelta, entryId },
      reference: fresh.qualifyingOrderLineId ?? undefined,
    });
    return true;
  }

  // --- REVERSE (cancellation / return / exchange) ---

  /**
   * Reverses/cancels the single per-line EARN entry a cancelled OrderLine
   * produced. Under LOY-006, since entitlement is now per-line (never a
   * shared order-level batch), the "proportional share" math the
   * original build used is gone entirely - the full entry either is or
   * is not this line's, so the full required reversal is simply
   * `entry.pointsDelta`.
   *
   * Idempotent via `reversalOrderLineId`'s unique constraint - a retried
   * cancellation (M18's own idempotency key convention) never
   * double-reverses.
   */
  async reverseForOrderLine(tx: Prisma.TransactionClient, order: Order, orderLine: OrderLine, reason: string): Promise<void> {
    await this.reverse(tx, order.id, orderLine.id, { reversalOrderLineId: orderLine.id }, reason);
  }

  /**
   * Same mechanism as reverseForOrderLine, keyed on the ReturnLine
   * instead - see that method's docblock. Called only when
   * `refundEligible` (QC PASS) - see ReturnService.recordQcAndDisposition's
   * own docblock for why a FAILED-QC return must not ALSO claw back
   * loyalty points.
   */
  async reverseForReturnLine(tx: Prisma.TransactionClient, order: Order, orderLine: OrderLine, returnLine: { id: string }, reason: string): Promise<void> {
    await this.reverse(tx, order.id, orderLine.id, { reversalReturnLineId: returnLine.id }, reason);
  }

  /**
   * Same mechanism, keyed on the Exchange instead - called ONLY at QC
   * PASS on the exchange's original item (ExchangeService.recordQcAndDisposition,
   * mirroring ReturnService's identical PASS-only gate exactly). This is
   * NOT a newly invented commercial policy: Exchange's own certified
   * design already reuses M19's identical QC-gated original-item
   * processing for the physical item (see the Exchange model's own
   * schema comment - "QC + disposition of the ORIGINAL item - reuses
   * InventoryService's postReturnReceipt/postReturnDisposition exactly as
   * ReturnLine does"), so applying the ALREADY-DECIDED "reverse on a
   * QC-accepted return" rule (specs/22-loyalty.md) at that identical gate
   * is a direct, principled extension, not a guess.
   */
  async reverseForExchangeLine(tx: Prisma.TransactionClient, order: Order, orderLine: OrderLine, exchange: { id: string }, reason: string): Promise<void> {
    await this.reverse(tx, order.id, orderLine.id, { reversalExchangeId: exchange.id }, reason);
  }

  private async reverse(
    tx: Prisma.TransactionClient,
    orderId: string,
    orderLineId: string,
    anchor: { reversalOrderLineId: string } | { reversalReturnLineId: string } | { reversalExchangeId: string },
    reason: string,
  ): Promise<void> {
    const earnEntry = await tx.loyaltyLedgerEntry.findUnique({ where: { qualifyingOrderLineId: orderLineId } });
    if (!earnEntry) return; // guest order, or nothing was ever earned on this line

    const idempotencyKey =
      'reversalOrderLineId' in anchor
        ? `loyalty-reverse:orderline:${anchor.reversalOrderLineId}`
        : 'reversalReturnLineId' in anchor
          ? `loyalty-reverse:returnline:${anchor.reversalReturnLineId}`
          : `loyalty-reverse:exchange:${anchor.reversalExchangeId}`;
    const prior = await tx.loyaltyLedgerEntry.findFirst({ where: anchor });
    if (prior) return; // already reversed for this exact trigger - idempotent no-op

    const account = await this.lockAccountById(tx, earnEntry.accountId);
    const freshEarn = await tx.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: earnEntry.id } });

    if (freshEarn.vestingStatus === 'CANCELLED') return; // already cancelled by a racing operation - idempotent no-op

    const requiredReverse = freshEarn.pointsDelta; // no proportional math under LOY-006 - one entry IS one line

    if (freshEarn.vestingStatus === 'PENDING') {
      // The normal, expected path under LOY-006: the points were never
      // vested, so nothing was ever in the balance to reverse. The
      // entitlement is simply CANCELLED - it can never later vest. The
      // balance-affecting amount is genuinely zero, but the REVERSE
      // ledger entry, `requiredPointsDelta`, and audit trail are ALWAYS
      // recorded regardless (2026-09-27 critical repair: never return
      // before recording a required reversal, even when the
      // balance-affecting amount is zero).
      let reverseEntry: LoyaltyLedgerEntry;
      try {
        reverseEntry = await tx.loyaltyLedgerEntry.create({
          data: {
            accountId: account.id,
            type: 'REVERSE',
            pointsDelta: 0,
            requiredPointsDelta: -requiredReverse,
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
        data: { spendingEntryId: reverseEntry.id, earnEntryId: freshEarn.id, pointsConsumed: 0 },
      });
      await tx.loyaltyLedgerEntry.update({ where: { id: freshEarn.id }, data: { vestingStatus: 'CANCELLED', remainingPoints: 0 } });

      await recordAudit(tx, {
        actorType: 'SYSTEM',
        action: 'loyalty.pending.cancelled',
        entityType: 'LoyaltyAccount',
        entityId: account.id,
        newValue: { pointsNeverVested: requiredReverse },
        reference: orderId,
      });
      return;
    }

    // EXCEPTIONAL / ADMIN-OVERRIDE PATH: the entry was already VESTED.
    // Under the certified system as it exists today this should be
    // structurally unreachable for a NORMAL customer lifecycle
    // (cancellation only applies to a not-yet-shipped line, which can
    // never be DELIVERED, and a Return/Exchange can only be INITIATED
    // while the calendar window is still open - by the time vesting has
    // happened, neither path can still be triggered through the normal
    // customer-facing flows). It remains possible only via some future
    // exceptional/admin override this build does not implement. The
    // BALANCE-AFFECTING portion is still capped at whatever remains
    // unconsumed in this specific EARN entry (this build does not invent
    // negative-balance/customer-debt semantics), but - fixing the
    // 2026-09-27 critical-repair finding - the REVERSE entry,
    // `requiredPointsDelta`, and a distinct shortfall audit event are
    // ALWAYS recorded, even when the balance-affecting amount computes to
    // zero. See specs/22-loyalty.md's own "post-vest exception returns"
    // DECISION_REQUIRED block for why this shortfall is never further
    // resolved (no debt, no clawback, no blocking) without explicit
    // Product Owner approval.
    const actualReverse = Math.min(requiredReverse, freshEarn.remainingPoints ?? 0);

    let reverseEntry: LoyaltyLedgerEntry;
    try {
      reverseEntry = await tx.loyaltyLedgerEntry.create({
        data: {
          accountId: account.id,
          type: 'REVERSE',
          pointsDelta: -actualReverse,
          requiredPointsDelta: -requiredReverse,
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
    if (actualReverse > 0) {
      await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: { balance: { decrement: actualReverse }, lifetimeEarnedPoints: { decrement: actualReverse } },
      });
      await this.recomputeTier(tx, account.id);
    }

    const shortfall = requiredReverse - actualReverse;
    await recordAudit(tx, {
      actorType: 'SYSTEM',
      // A distinct action when a shortfall occurs, so this is never
      // findable only by diffing two numbers in a JSON payload - a
      // shortfall is a genuinely different, more significant event than
      // a clean full reversal (LOY-001 repair, Blocker 1; ALWAYS
      // recorded per the 2026-09-27 critical repair, even at
      // actualReverse === 0).
      action: shortfall > 0 ? 'loyalty.reverse.postvest.shortfall' : 'loyalty.reverse.postvest',
      entityType: 'LoyaltyAccount',
      entityId: account.id,
      newValue: shortfall > 0 ? { pointsApplied: actualReverse, pointsRequired: requiredReverse, shortfall } : { points: actualReverse },
      reference: orderId,
    });
  }

  // --- FIFO draw-down (shared by REDEEM conversion and EXPIRE sweep) - VESTED entries only ---

  private async drawDownFifo(
    tx: Prisma.TransactionClient,
    account: LoyaltyAccount,
    points: number,
    type: 'REDEEM' | 'EXPIRE',
    reason: string,
    idempotencyKeyPrefix: string,
  ): Promise<void> {
    const batches = await tx.loyaltyLedgerEntry.findMany({
      where: { accountId: account.id, type: 'EARN', vestingStatus: 'VESTED', remainingPoints: { gt: 0 } },
      orderBy: { vestedAt: 'asc' },
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

  // --- Checkout-time redemption hold (VESTED/available points only) ---

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
   * at order confirmation (convertRedemptionHold). `availableBalance`
   * already excludes PENDING points entirely (LOY-006).
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

  // --- EXPIRE (sweep) - VESTED entries only, clock starts from vesting ---

  /** Expires every VESTED EARN entry past its configured retention window (which starts from vestedAt - LOY-006) - callable directly or by a future scheduler. Idempotent per entry (idempotencyKey `expire:<entryId>`), safe to run repeatedly or concurrently. A PENDING entry has no `expiresAt` set at all, so it is structurally excluded from this query already. */
  async expirePoints(): Promise<number> {
    const now = new Date();
    const stale = await this.prisma.loyaltyLedgerEntry.findMany({
      where: { type: 'EARN', vestingStatus: 'VESTED', remainingPoints: { gt: 0 }, expiresAt: { lt: now } },
    });

    let count = 0;
    for (const batch of stale) {
      const applied = await this.prisma
        .$transaction(async (tx) => {
          const account = await this.lockAccountById(tx, batch.accountId);
          const fresh = await tx.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: batch.id } });
          if (fresh.vestingStatus !== 'VESTED' || !fresh.remainingPoints || fresh.remainingPoints <= 0 || !fresh.expiresAt || fresh.expiresAt >= now) return false;

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
