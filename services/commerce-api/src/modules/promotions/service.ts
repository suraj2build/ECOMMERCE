import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type Promotion, type Order } from '@fcp/db';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import type { CartOwnerIdentity } from '../cart/identity.js';

export interface CreatePromotionInput {
  name: string;
  description?: string;
  promotionTypeKey: string;
  isCoupon: boolean;
  couponCode?: string;
  discountType: 'PERCENTAGE' | 'FLAT_AMOUNT';
  discountValue: number;
  maxDiscountAmount?: number;
  minCartValue?: number;
  stackGroup?: string;
  priority?: number;
  startsAt: string;
  endsAt?: string;
  usageLimitTotal?: number;
  usageLimitPerCustomer?: number;
  // Blocker 2 repair: default true (matches existing behavior) - only
  // set false to mark a promotion incompatible with that value system.
  loyaltyCompatible?: boolean;
  storeCreditCompatible?: boolean;
  // M30: same default-true, opt-out-only shape as the two above.
  giftCardCompatible?: boolean;
}

export interface AppliedPromotion {
  promotionId: string;
  name: string;
  isCoupon: boolean;
  discountAmount: number;
  loyaltyCompatible: boolean;
  storeCreditCompatible: boolean;
  giftCardCompatible: boolean;
}

export interface EvaluationResult {
  applied: AppliedPromotion[];
  totalDiscount: number;
  couponRejectedReason?: string;
}

/**
 * Promotions (M24, specs/23-promotions.md, PROMO-001/002; TAX-006).
 * Structurally separate from Loyalty (specs/22-loyalty.md) and Store
 * Credit (specs/33-store-credit-gift-cards.md) - PROMO-001's own
 * four-distinct-concepts requirement. The promotion TYPE (promotional/
 * campaign/onboarding/cashback/etc) is a reference table
 * (`PromotionType`), never a fixed enum - a new type is data, not a
 * code change.
 *
 * Stacking (PROMO-002, "rule-driven, not hard-coded per combination"):
 * two Promotions sharing the same non-null `stackGroup` are mutually
 * exclusive; a null stackGroup stacks with everything else it is
 * otherwise eligible for. Automatic promotions are evaluated first, in
 * `priority` order (lower first) tie-broken by `id` - deterministic,
 * never dependent on database iteration order; the first promotion
 * from each stackGroup wins, later ones in the same group are dropped.
 * A requested coupon is then checked against whatever automatic
 * promotions survived: if it shares a stackGroup with one of them, the
 * COUPON is rejected (with a clear reason) rather than silently
 * dropping the automatic promotion that was already there.
 *
 * Every discount is computed independently against the ORIGINAL
 * (pre-discount) subtotal, never compounded sequentially - a
 * documented, predictable engineering default (some real-world coupon
 * engines compound; this codebase chooses the simpler, always-
 * explainable rule). The combined total is capped at the subtotal
 * itself (a discount can never make the order go negative); any
 * capping reduction is taken from the LOWEST-priority (last-applied)
 * promotion first, the same "assign the remainder to the last one"
 * discipline this codebase already uses for per-line rounding
 * remainders.
 */
export class PromotionService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  // --- Staff CRUD (minimal - promotion:manage) ---

  async createPromotion(input: CreatePromotionInput, actorStaffId: string): Promise<Promotion> {
    if (input.isCoupon && !input.couponCode?.trim()) {
      throw new ValidationError('A coupon promotion requires a couponCode');
    }
    if (!input.isCoupon && input.couponCode) {
      throw new ValidationError('An automatic promotion must not carry a couponCode');
    }
    if (input.discountType === 'PERCENTAGE' && (input.discountValue <= 0 || input.discountValue > 100)) {
      throw new ValidationError('A percentage discount must be between 0 and 100');
    }
    if (input.discountType === 'FLAT_AMOUNT' && input.discountValue <= 0) {
      throw new ValidationError('A flat-amount discount must be positive');
    }

    const promotionType = await this.prisma.promotionType.findUnique({ where: { key: input.promotionTypeKey } });
    if (!promotionType) throw new NotFoundError('PromotionType', input.promotionTypeKey);

    const promotion = await this.prisma.promotion.create({
      data: {
        name: input.name,
        description: input.description,
        promotionTypeId: promotionType.id,
        isCoupon: input.isCoupon,
        couponCode: input.couponCode?.trim().toUpperCase(),
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxDiscountAmount: input.maxDiscountAmount,
        minCartValue: input.minCartValue,
        stackGroup: input.stackGroup,
        priority: input.priority ?? 100,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        usageLimitTotal: input.usageLimitTotal,
        usageLimitPerCustomer: input.usageLimitPerCustomer,
        loyaltyCompatible: input.loyaltyCompatible ?? true,
        storeCreditCompatible: input.storeCreditCompatible ?? true,
        giftCardCompatible: input.giftCardCompatible ?? true,
      },
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'promotion.create',
      entityType: 'Promotion',
      entityId: promotion.id,
      newValue: { name: promotion.name, isCoupon: promotion.isCoupon, discountType: promotion.discountType, discountValue: Number(promotion.discountValue) },
    });

    return promotion;
  }

  async listPromotions(): Promise<Promotion[]> {
    return this.prisma.promotion.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }] });
  }

  async getPromotion(id: string): Promise<Promotion> {
    const promotion = await this.prisma.promotion.findUnique({ where: { id } });
    if (!promotion) throw new NotFoundError('Promotion', id);
    return promotion;
  }

  async setActive(id: string, isActive: boolean, actorStaffId: string): Promise<Promotion> {
    const existing = await this.getPromotion(id);
    const promotion = await this.prisma.promotion.update({ where: { id }, data: { isActive } });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'promotion.set_active',
      entityType: 'Promotion',
      entityId: id,
      oldValue: { isActive: existing.isActive },
      newValue: { isActive },
    });
    return promotion;
  }

  // --- Discount evaluation (shared by non-authoritative preview and the authoritative reserve) ---

  private async findEligibleAutomaticPromotions(tx: Prisma.TransactionClient | PrismaClient, subtotal: number, now: Date): Promise<Promotion[]> {
    return tx.promotion.findMany({
      where: {
        isCoupon: false,
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        AND: [{ OR: [{ minCartValue: null }, { minCartValue: { lte: subtotal } }] }],
      },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
  }

  private async findCoupon(tx: Prisma.TransactionClient | PrismaClient, code: string, subtotal: number, now: Date): Promise<{ promotion: Promotion | null; reason?: string }> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return { promotion: null, reason: 'Enter a coupon code' };
    const promotion = await tx.promotion.findUnique({ where: { couponCode: normalized } });
    if (!promotion || !promotion.isCoupon) return { promotion: null, reason: 'This coupon code is not valid' };
    if (!promotion.isActive) return { promotion: null, reason: 'This coupon is no longer active' };
    if (promotion.startsAt > now) return { promotion: null, reason: 'This coupon is not active yet' };
    if (promotion.endsAt && promotion.endsAt <= now) return { promotion: null, reason: 'This coupon has expired' };
    if (promotion.minCartValue && subtotal < Number(promotion.minCartValue)) {
      return { promotion: null, reason: `This coupon requires a minimum order value of ₹${promotion.minCartValue}` };
    }
    if (promotion.usageLimitTotal !== null && promotion.usageCountTotal >= promotion.usageLimitTotal) {
      return { promotion: null, reason: 'This coupon has reached its usage limit' };
    }
    return { promotion };
  }

  private computeDiscountAmount(promotion: Promotion, subtotal: number): number {
    let amount =
      promotion.discountType === 'PERCENTAGE' ? (subtotal * Number(promotion.discountValue)) / 100 : Number(promotion.discountValue);
    if (promotion.maxDiscountAmount !== null) amount = Math.min(amount, Number(promotion.maxDiscountAmount));
    amount = Math.min(amount, subtotal);
    return Math.round(amount * 100) / 100;
  }

  /** Resolves the final applied set (stacking-resolved) and each one's discount amount, WITHOUT touching usage counters - shared logic for both the preview and authoritative paths. */
  private async resolveApplication(
    tx: Prisma.TransactionClient | PrismaClient,
    subtotal: number,
    couponCode: string | undefined,
  ): Promise<EvaluationResult> {
    const now = new Date();
    const automatics = await this.findEligibleAutomaticPromotions(tx, subtotal, now);

    const chosen: Promotion[] = [];
    const usedGroups = new Set<string>();
    for (const promo of automatics) {
      if (promo.stackGroup && usedGroups.has(promo.stackGroup)) continue;
      chosen.push(promo);
      if (promo.stackGroup) usedGroups.add(promo.stackGroup);
    }

    let couponRejectedReason: string | undefined;
    if (couponCode?.trim()) {
      const { promotion: coupon, reason } = await this.findCoupon(tx, couponCode, subtotal, now);
      if (!coupon) {
        couponRejectedReason = reason;
      } else if (coupon.stackGroup && usedGroups.has(coupon.stackGroup)) {
        const conflicting = chosen.find((p) => p.stackGroup === coupon.stackGroup);
        couponRejectedReason = `This coupon cannot be combined with "${conflicting?.name}", which is already applied to your order`;
      } else {
        chosen.push(coupon);
      }
    }

    let amounts = chosen.map((p) => ({ promotion: p, amount: this.computeDiscountAmount(p, subtotal) }));
    let total = amounts.reduce((s, a) => s + a.amount, 0);
    if (total > subtotal) {
      // Cap the combined total at the subtotal itself - reduce from the
      // LOWEST-priority (last-applied) promotion first, deterministic,
      // never a proportional silent reallocation across all of them.
      let overage = Math.round((total - subtotal) * 100) / 100;
      const sortedByPriorityDesc = [...amounts].sort((a, b) => b.promotion.priority - a.promotion.priority || a.promotion.id.localeCompare(b.promotion.id));
      for (const entry of sortedByPriorityDesc) {
        if (overage <= 0) break;
        const reduction = Math.min(entry.amount, overage);
        entry.amount = Math.round((entry.amount - reduction) * 100) / 100;
        overage = Math.round((overage - reduction) * 100) / 100;
      }
      amounts = amounts.filter((a) => a.amount > 0);
      total = Math.round(amounts.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    }

    return {
      applied: amounts.map((a) => ({
        promotionId: a.promotion.id,
        name: a.promotion.name,
        isCoupon: a.promotion.isCoupon,
        discountAmount: a.amount,
        loyaltyCompatible: a.promotion.loyaltyCompatible,
        storeCreditCompatible: a.promotion.storeCreditCompatible,
        giftCardCompatible: a.promotion.giftCardCompatible,
      })),
      totalDiscount: total,
      couponRejectedReason,
    };
  }

  /** Non-authoritative preview (cart/checkout live UI) - no lock, no usage-cap claim. Mirrors LoyaltyService.previewRedemptionValue's own docblock. */
  async previewApplication(subtotal: number, couponCode: string | undefined): Promise<EvaluationResult> {
    return this.resolveApplication(this.prisma, subtotal, couponCode);
  }

  /**
   * Authoritative reserve, called from inside CheckoutService.startCheckout's
   * own transaction, right after the CheckoutSession row exists (same
   * "create the row this depends on first, in the same transaction"
   * discipline as LoyaltyService.reserveRedemptionForCheckout). Row-locks
   * EACH chosen promotion (`SELECT ... FOR UPDATE` - the same
   * row-lock-as-serialization-point idiom this codebase already uses
   * for LoyaltyAccount/StoreCreditAccount) BEFORE counting its existing
   * HOLD+CONVERTED redemptions and deciding whether this attempt fits
   * under the cap - the lock is what makes that count-then-decide
   * safe: no other transaction can create a competing redemption for
   * the SAME promotion while this one holds the lock, so two genuinely
   * concurrent last-use attempts are strictly serialized and exactly
   * one wins, never a blind unlocked "read count, then write" race.
   *
   * Usage is counted from PromotionRedemption rows in HOLD or CONVERTED
   * status (never a separate incrementing counter mutated at hold
   * time) precisely so a RELEASED hold (abandoned/failed checkout)
   * genuinely frees its slot back up - an abandoned attempt must never
   * permanently burn a limited coupon's usage cap.
   * `Promotion.usageCountTotal` itself is a denormalized, reporting-only
   * cache of CONFIRMED usage, incremented only at `convertHolds` (order
   * confirmation) - the same "the ledger/redemption rows are the source
   * of truth, the counter is a read-optimization kept in lockstep"
   * discipline as StoreCreditAccount.balance.
   */
  async reserveForCheckout(
    tx: Prisma.TransactionClient,
    subtotal: number,
    couponCode: string | undefined,
    identity: CartOwnerIdentity,
    checkoutSessionId: string,
  ): Promise<EvaluationResult> {
    const resolved = await this.resolveApplication(tx, subtotal, couponCode);
    const finalApplied: AppliedPromotion[] = [];

    for (const candidate of resolved.applied) {
      const rows = await tx.$queryRaw<Promotion[]>`SELECT * FROM "promotions" WHERE "id" = ${candidate.promotionId} FOR UPDATE`;
      const promotion = rows[0];
      if (!promotion || !promotion.isActive) continue; // deactivated between preview and submission - safe drop

      if (promotion.usageLimitTotal !== null) {
        const totalCount = await tx.promotionRedemption.count({ where: { promotionId: promotion.id, status: { in: ['HOLD', 'CONVERTED'] } } });
        if (totalCount >= promotion.usageLimitTotal) {
          if (promotion.isCoupon) throw new ValidationError('This coupon has reached its usage limit');
          continue; // automatic promotion - safe drop, never blocks checkout
        }
      }
      if (identity.customerId && promotion.usageLimitPerCustomer !== null) {
        const customerCount = await tx.promotionRedemption.count({
          where: { promotionId: promotion.id, customerId: identity.customerId, status: { in: ['HOLD', 'CONVERTED'] } },
        });
        if (customerCount >= promotion.usageLimitPerCustomer) {
          if (promotion.isCoupon) throw new ValidationError('You have already used this coupon the maximum number of times');
          continue; // automatic promotion - safe drop, never blocks checkout
        }
      }

      await tx.promotionRedemption.create({
        data: {
          promotionId: promotion.id,
          checkoutSessionId,
          customerId: identity.customerId,
          guestSessionId: identity.guestSessionId,
          discountAmount: candidate.discountAmount,
        },
      });
      finalApplied.push(candidate);
    }

    const totalDiscount = Math.round(finalApplied.reduce((s, a) => s + a.discountAmount, 0) * 100) / 100;
    return { applied: finalApplied, totalDiscount, couponRejectedReason: resolved.couponRejectedReason };
  }

  /**
   * Converts every HOLD redemption for this order's checkout session to
   * CONVERTED - called from inside
   * OrderService.createOrderFromCheckoutSession's own transaction. Also
   * increments each converted promotion's `usageCountTotal` denormalized
   * reporting cache by exactly the number of redemptions just
   * converted (idempotent in practice: OrderService's own top-level
   * checkoutSessionId uniqueness already prevents this from running
   * twice for the same order).
   */
  async convertHolds(tx: Prisma.TransactionClient, order: Order): Promise<void> {
    const holds = await tx.promotionRedemption.findMany({ where: { checkoutSessionId: order.checkoutSessionId, status: 'HOLD' } });
    if (holds.length === 0) return;
    await tx.promotionRedemption.updateMany({
      where: { checkoutSessionId: order.checkoutSessionId, status: 'HOLD' },
      data: { status: 'CONVERTED' },
    });
    for (const hold of holds) {
      await tx.promotion.update({ where: { id: hold.promotionId }, data: { usageCountTotal: { increment: 1 } } });
    }
  }

  /**
   * Releases every HOLD redemption for a checkout session that never
   * confirmed (payment failure/expiry) - frees its usage-cap slot
   * immediately, since usage is counted live from HOLD/CONVERTED rows,
   * never a separately-incrementing counter that would need a matching
   * decrement here.
   */
  async releaseHoldsForCheckoutSession(tx: Prisma.TransactionClient, checkoutSessionId: string): Promise<void> {
    await tx.promotionRedemption.updateMany({
      where: { checkoutSessionId, status: 'HOLD' },
      data: { status: 'RELEASED' },
    });
  }
}
