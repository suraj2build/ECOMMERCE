import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { InsufficientStockError, NotFoundError, ValidationError } from '@fcp/shared';
import { CartService } from '../cart/service.js';
import type { CartOwnerIdentity } from '../cart/identity.js';
import { ServiceabilityService } from '../pdp/serviceability-service.js';
import { InventoryService } from '../inventory/service.js';
import { TaxConfigService } from '../tax/service.js';
import { determinePlaceOfSupply, splitTax } from '../tax/tax-engine.js';
import { ShippingService } from './shipping-service.js';
import { resolvePaymentProvider } from './payment-provider.js';
import { recordAudit } from '../audit/service.js';
import { OrderService } from '../order/service.js';
import { LoyaltyService } from '../loyalty/service.js';
import { PromotionService } from '../promotions/service.js';
import { StoreCreditService } from '../refunds/store-credit-service.js';
import { GiftCardService } from '../gift-cards/service.js';

export interface AddressInput {
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  stateCode: string; // same convention as GstRegistration.stateCode (e.g. 'DL')
  pincode: string;
}

/** LR-003: the browser's consent choices and the tracking identifiers it
 * holds for each consented purpose. */
export interface TrackingInput {
  analytics: boolean;
  marketing: boolean;
  analyticsClientId?: string;
  metaBrowserId?: string;
  metaClickId?: string;
}

export interface StartCheckoutInput {
  tracking?: TrackingInput;
  contactName: string;
  contactMobile: string;
  contactEmail?: string;
  billingAddress: AddressInput;
  shippingAddress: AddressInput;
  paymentMethod: 'PREPAID' | 'COD';
  idempotencyKey: string;
  // M23 (specs/22-loyalty.md §8): the customer's own choice, validated
  // and RESERVED (never spent yet - see LoyaltyService.
  // reserveRedemptionForCheckout's own docblock) inside this same
  // synchronous checkout call. Ignored for a guest identity - loyalty
  // requires a persistent customer identity.
  loyaltyPointsToRedeem?: number;
  // M24 (specs/23-promotions.md §checkout integration): validated and
  // RESERVED the same two-stage preview/reserve way as loyalty points -
  // see PromotionService.reserveForCheckout's own docblock. An invalid/
  // expired/incompatible coupon code throws immediately (surfaced as a
  // clear inline error), it is never silently ignored.
  couponCode?: string;
  // Store credit applied at checkout (M24 - store credit previously
  // only existed as a refund/exchange settlement destination, M20).
  storeCreditToApply?: number;
  // M30 (specs/33-store-credit-gift-cards.md): the plaintext gift-card
  // code and the amount to apply from it - the FOURTH and final
  // reduction, applied after promotion/loyalty/store credit. At most
  // one gift card per checkout (M30 explicitly does not invent
  // multi-gift-card stacking).
  giftCardCode?: string;
  giftCardAmountToApply?: number;
}

interface PricedLine {
  skuId: string;
  quantity: number;
  unitPriceInclusive: number;
  discountAmount: number;
  taxableValue: number;
  gstRatePercent: number;
  taxAmount: number;
  lineTotalInclusive: number;
}

/**
 * Checkout (M13, specs/12-checkout.md). Produces the "order creation
 * trigger" artifact (CheckoutSession) - NOT the formal Order model
 * itself; OrderService.createOrderFromCheckoutSession (M15) is called
 * in-process the moment a COD session is genuinely CONFIRMED below,
 * mirroring how PaymentService calls the same method from a Razorpay
 * capture webhook. Depends only on the
 * PaymentProvider interface (ADR-0011), never a specific provider
 * directly, and reuses the exact same re-validation building blocks
 * every other milestone already built: CartService (price/availability),
 * ServiceabilityService (PIN re-check, IND-002), InventoryService
 * (reservation, INV-002/003), and the M08 tax engine (HSN-rate-based,
 * CHK-002).
 */
export class CheckoutService {
  private readonly cart: CartService;
  private readonly serviceability: ServiceabilityService;
  private readonly inventory: InventoryService;
  private readonly taxConfig: TaxConfigService;
  private readonly shipping: ShippingService;
  private readonly order: OrderService;
  private readonly loyalty: LoyaltyService;
  private readonly promotions: PromotionService;
  private readonly storeCredit: StoreCreditService;
  private readonly giftCard: GiftCardService;

  constructor(private readonly fastify: FastifyInstance) {
    this.cart = new CartService(fastify);
    this.serviceability = new ServiceabilityService(fastify);
    this.inventory = new InventoryService(fastify);
    this.taxConfig = new TaxConfigService(fastify);
    this.shipping = new ShippingService(fastify);
    this.order = new OrderService(fastify);
    this.loyalty = new LoyaltyService(fastify);
    this.promotions = new PromotionService(fastify);
    this.storeCredit = new StoreCreditService(fastify);
    this.giftCard = new GiftCardService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  /**
   * Resolves the supplier GST registration to price against. Single/
   * few-location operation at launch (ORG-002) - picks the first
   * active, GST-configured location. Multi-location tax-jurisdiction
   * routing is out of this milestone's scope.
   */
  private async resolveSupplierRegistration() {
    const location = await this.prisma.location.findFirst({
      where: { isActive: true, gstRegistrationId: { not: null } },
    });
    if (!location) {
      throw new ValidationError('No active, GST-configured location is available to fulfil orders from');
    }
    return this.taxConfig.resolveSupplierRegistration(location.id);
  }

  /**
   * Prices every cart line against the shipping address's state
   * (tax-inclusive, matching CAT-001's display convention) - the same
   * computation used for both the review preview and the real
   * checkout submission, so the two can never silently disagree.
   *
   * M24 (specs/23-promotions.md, TAX-006): if a promotion discount
   * applies, it is allocated pro-rata across lines by their
   * (undiscounted) inclusive share, applied PRE-TAX by reducing each
   * line's own taxableValue BEFORE `splitTax` runs - `splitTax` itself
   * is never modified, only fed a smaller input, per TAX-006's
   * "without rewriting tax logic" requirement. Any leftover paisa from
   * pro-rata rounding across lines is assigned to the LAST line, the
   * same "remainder goes to the last one" discipline this codebase
   * already uses elsewhere (e.g. FIFO batch draw-down).
   *
   * A coupon code that fails validation (invalid/expired/incompatible)
   * throws immediately - callers (previewCheckout AND startCheckout)
   * both want that surfaced as a clear inline error, never silently
   * ignored (acceptance/m24-promotions.md).
   */
  private async priceLines(
    items: Awaited<ReturnType<CartService['getCartView']>>['items'],
    shippingStateCode: string,
    couponCode?: string,
  ): Promise<{ lines: PricedLine[]; subtotal: number; taxAmount: number; baseSubtotal: number; promotionDiscountTotal: number; appliedPromotions: import('../promotions/service.js').AppliedPromotion[] }> {
    const registration = await this.resolveSupplierRegistration();
    const { isIntraState } = determinePlaceOfSupply({
      supplierStateCode: registration.stateCode,
      shippingStateCode,
    });

    interface BaseLine {
      skuId: string;
      quantity: number;
      unitPriceInclusive: number;
      lineInclusive: number;
      gstRatePercent: number;
      cessPercent: number | null;
    }
    const baseLines: BaseLine[] = [];
    let baseSubtotal = 0;

    for (const item of items) {
      if (!item.isPurchasable) {
        throw new ValidationError(`'${item.styleName}' is no longer available - remove it from your bag to continue`);
      }
      if (!item.inStock) {
        throw new ValidationError(`Only ${item.availableQuantity} of '${item.styleName}' is available - update the quantity in your bag`);
      }

      const sku = await this.prisma.sku.findUnique({ where: { id: item.skuId }, include: { style: true } });
      if (!sku) throw new NotFoundError('Sku', item.skuId);
      const hsnCode = sku.hsnCode ?? sku.style.hsnCode;
      if (!hsnCode) {
        throw new ValidationError(`'${item.styleName}' has no HSN code configured - cannot compute tax for checkout`);
      }
      const rate = await this.taxConfig.resolveTaxRate(hsnCode);

      const sellingPriceInclusive = item.currentPrice ?? item.priceAtAdd;
      const lineInclusive = sellingPriceInclusive * item.quantity;
      baseLines.push({
        skuId: item.skuId,
        quantity: item.quantity,
        unitPriceInclusive: sellingPriceInclusive,
        lineInclusive,
        gstRatePercent: Number(rate.gstRatePercent),
        cessPercent: rate.cessPercent ? Number(rate.cessPercent) : null,
      });
      baseSubtotal += lineInclusive;
    }
    baseSubtotal = Math.round(baseSubtotal * 100) / 100;

    const env = loadEnv();
    const evaluation = await this.promotions.previewApplication(baseSubtotal, couponCode);
    if (couponCode?.trim() && evaluation.couponRejectedReason) {
      throw new ValidationError(evaluation.couponRejectedReason);
    }
    const promotionDiscountTotal = env.PROMOTIONS_DISCOUNT_PRETAX ? evaluation.totalDiscount : 0;

    const lines: PricedLine[] = [];
    let subtotal = 0;
    let taxAmount = 0;
    let discountAllocated = 0;

    baseLines.forEach((base, index) => {
      const isLast = index === baseLines.length - 1;
      const share = baseSubtotal > 0 ? base.lineInclusive / baseSubtotal : 0;
      const discountAmount = isLast
        ? Math.round((promotionDiscountTotal - discountAllocated) * 100) / 100
        : Math.round(promotionDiscountTotal * share * 100) / 100;
      discountAllocated = Math.round((discountAllocated + discountAmount) * 100) / 100;

      const discountedInclusive = Math.round((base.lineInclusive - discountAmount) * 100) / 100;
      // Storefront prices are tax-inclusive (CAT-001); reverse the split
      // to get the tax-exclusive taxable value the tax engine expects,
      // computed from the DISCOUNTED inclusive amount (pre-tax discount).
      const taxableValue = Math.round((discountedInclusive / (1 + base.gstRatePercent / 100)) * 100) / 100;
      const split = splitTax({
        taxableValue,
        gstRatePercent: base.gstRatePercent,
        cessPercent: base.cessPercent,
        isIntraState,
      });

      lines.push({
        skuId: base.skuId,
        quantity: base.quantity,
        unitPriceInclusive: base.unitPriceInclusive,
        discountAmount,
        taxableValue,
        gstRatePercent: base.gstRatePercent,
        taxAmount: split.totalTax,
        lineTotalInclusive: taxableValue + split.totalTax,
      });
      subtotal += taxableValue + split.totalTax;
      taxAmount += split.totalTax;
    });

    return {
      lines,
      subtotal: Math.round(subtotal * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      baseSubtotal,
      promotionDiscountTotal,
      appliedPromotions: evaluation.applied,
    };
  }

  async previewCheckout(identity: CartOwnerIdentity, shippingAddress: AddressInput, couponCode?: string) {
    const cartView = await this.cart.getCartView(identity);
    if (cartView.items.length === 0) throw new ValidationError('Your bag is empty');
    if (cartView.hasBlockingChanges) {
      throw new ValidationError('Your bag has changes that need your attention before checkout - review it first');
    }

    const serviceability = await this.serviceability.checkServiceability(shippingAddress.pincode);
    const { lines, subtotal, taxAmount, promotionDiscountTotal, appliedPromotions } = await this.priceLines(
      cartView.items,
      shippingAddress.stateCode,
      couponCode,
    );
    const shippingCost = await this.shipping.calculateShippingCost(subtotal);

    return {
      isServiceable: serviceability.isServiceable,
      codAvailable: serviceability.codAvailable,
      knownPincode: serviceability.known,
      lines,
      subtotal,
      taxAmount,
      promotionDiscountTotal,
      appliedPromotions,
      shippingCost,
      grandTotal: Math.round((subtotal + shippingCost) * 100) / 100,
    };
  }

  async startCheckout(identity: CartOwnerIdentity, input: StartCheckoutInput) {
    const existing = await this.prisma.checkoutSession.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return this.getCheckoutSession(existing.id, identity);

    if (input.paymentMethod === 'COD') {
      const env = loadEnv();
      const cartView = await this.cart.getCartView(identity);
      if (cartView.subtotal > env.COD_MAX_ORDER_VALUE_INR) {
        throw new ValidationError(
          `Cash on Delivery is not available for orders above ₹${env.COD_MAX_ORDER_VALUE_INR} - please choose online payment`,
        );
      }
    }

    const serviceability = await this.serviceability.checkServiceability(input.shippingAddress.pincode);
    if (!serviceability.isServiceable) {
      throw new ValidationError(`Delivery is not currently available to PIN code ${input.shippingAddress.pincode}`);
    }
    if (input.paymentMethod === 'COD' && !serviceability.codAvailable) {
      throw new ValidationError('Cash on Delivery is not available for this PIN code - please choose online payment');
    }

    const cartView = await this.cart.getCartView(identity);
    if (cartView.items.length === 0) throw new ValidationError('Your bag is empty');
    if (cartView.hasBlockingChanges) {
      throw new ValidationError('Your bag has changes that need your attention before checkout - review it first');
    }

    const { lines, subtotal, taxAmount, baseSubtotal, promotionDiscountTotal, appliedPromotions } = await this.priceLines(
      cartView.items,
      input.shippingAddress.stateCode,
      input.couponCode,
    );

    // M24/M25 independent-review certification-repair (Blocker 2,
    // PROMO-002/LOY-005): a promotion's cross-domain compatibility with
    // loyalty redemption / store credit is enforced HERE, before any
    // reservation is made, so an incompatible combination fails fast
    // with a clear reason rather than requiring a rollback. Only fires
    // when the customer is actually ATTEMPTING to combine (redemption
    // amount > 0) - a promotion marked incompatible with loyalty still
    // applies normally on an order that redeems no points at all.
    if (input.loyaltyPointsToRedeem && input.loyaltyPointsToRedeem > 0) {
      const incompatible = appliedPromotions.find((p) => !p.loyaltyCompatible);
      if (incompatible) {
        throw new ValidationError(`The promotion "${incompatible.name}" cannot be combined with loyalty point redemption`);
      }
    }
    if (input.storeCreditToApply && input.storeCreditToApply > 0) {
      const incompatible = appliedPromotions.find((p) => !p.storeCreditCompatible);
      if (incompatible) {
        throw new ValidationError(`The promotion "${incompatible.name}" cannot be combined with store credit`);
      }
    }
    if (input.giftCardAmountToApply && input.giftCardAmountToApply > 0) {
      const incompatible = appliedPromotions.find((p) => !p.giftCardCompatible);
      if (incompatible) {
        throw new ValidationError(`The promotion "${incompatible.name}" cannot be combined with a gift card`);
      }
    }

    const shippingCost = await this.shipping.calculateShippingCost(subtotal);
    const grandTotal = Math.round((subtotal + shippingCost) * 100) / 100;

    // Reserve every line before creating anything (INV-002) - all-or-
    // nothing: any failure releases every reservation already made in
    // this attempt rather than leaving a partially-reserved cart.
    const reservedLineData: Array<PricedLine & { locationId: string; reservationId: string }> = [];
    try {
      for (const line of lines) {
        const balances = await this.prisma.inventoryBalance.findMany({
          where: { skuId: line.skuId },
          orderBy: { onHand: 'desc' },
        });
        const candidate = balances.find((b) => b.onHand - b.reserved >= line.quantity);
        if (!candidate) {
          const bestAvailable = Math.max(0, ...balances.map((b) => b.onHand - b.reserved), 0);
          throw new InsufficientStockError(line.skuId, line.quantity, bestAvailable);
        }

        const reservation = await this.inventory.reserve({
          skuId: line.skuId,
          locationId: candidate.locationId,
          quantity: line.quantity,
          referenceType: 'CHECKOUT_SESSION',
          idempotencyKey: `${input.idempotencyKey}:${line.skuId}`,
        });
        reservedLineData.push({ ...line, locationId: candidate.locationId, reservationId: reservation.id });
      }
    } catch (err) {
      for (const reserved of reservedLineData) {
        await this.inventory.releaseReservation(reserved.reservationId, 'checkout attempt failed');
      }
      throw err;
    }

    // M23 (specs/22-loyalty.md §8): a non-authoritative preview, purely
    // to compute the reduced amount to hand the payment provider below
    // (a Razorpay "order" created for a slightly-wrong amount is
    // harmless - no money moves until a later capture - see
    // LoyaltyService.previewRedemptionValue's own docblock for why the
    // REAL enforcement happens later, inside the transaction below).
    let loyaltyRedemptionValue = 0;
    if (input.loyaltyPointsToRedeem && input.loyaltyPointsToRedeem > 0) {
      if (!identity.customerId) throw new ValidationError('Loyalty points can only be redeemed by a signed-in customer');
      try {
        loyaltyRedemptionValue = await this.loyalty.previewRedemptionValue(identity.customerId, input.loyaltyPointsToRedeem, grandTotal);
      } catch (err) {
        for (const reserved of reservedLineData) {
          await this.inventory.releaseReservation(reserved.reservationId, 'checkout attempt failed');
        }
        throw err;
      }
    }

    // M24 (specs/23-promotions.md, LOY-005 stacking): same non-
    // authoritative-preview-then-authoritative-reserve split as
    // loyalty, checked against whatever remains AFTER the loyalty
    // reduction above (store credit is the last reduction applied).
    let storeCreditApplied = 0;
    if (input.storeCreditToApply && input.storeCreditToApply > 0) {
      try {
        storeCreditApplied = await this.storeCredit.previewRedemptionValue(identity, input.storeCreditToApply, grandTotal - loyaltyRedemptionValue);
      } catch (err) {
        for (const reserved of reservedLineData) {
          await this.inventory.releaseReservation(reserved.reservationId, 'checkout attempt failed');
        }
        throw err;
      }
    }

    // M30 (specs/33-store-credit-gift-cards.md): the FOURTH and final
    // reduction, same non-authoritative-preview-then-authoritative-
    // reserve split, checked against whatever remains after loyalty AND
    // store credit.
    let giftCardApplied = 0;
    if (input.giftCardCode && input.giftCardAmountToApply && input.giftCardAmountToApply > 0) {
      try {
        giftCardApplied = await this.giftCard.previewRedemptionValue(
          input.giftCardCode,
          input.giftCardAmountToApply,
          grandTotal - loyaltyRedemptionValue - storeCreditApplied,
        );
      } catch (err) {
        for (const reserved of reservedLineData) {
          await this.inventory.releaseReservation(reserved.reservationId, 'checkout attempt failed');
        }
        throw err;
      }
    }
    const amountPayable = Math.round((grandTotal - loyaltyRedemptionValue - storeCreditApplied - giftCardApplied) * 100) / 100;

    // Generated up front (rather than left to Prisma's own default) so
    // it can be handed to the payment provider as the order `receipt`
    // before the CheckoutSession row exists - Razorpay order creation
    // necessarily happens before the row it will be linked to.
    const sessionIdCandidate = randomUUID();

    // M30's own explicit requirement that a gift card may cover the
    // FULL payable amount: a genuine gap this requirement exposed in
    // the pre-existing reduction chain (loyalty/store credit already
    // could in principle reduce amountPayable to zero, but nothing
    // handled that case - see CLAUDE.md's own "document the dependency,
    // make the smallest safe repair" instruction for touching certified
    // code). Zero (or negative, defensively) payable means nothing is
    // owed to any payment provider - treated exactly like COD's own
    // `{status: 'CONFIRMED'}` shape, regardless of which paymentMethod
    // was chosen, so order confirmation proceeds in this same request
    // without ever calling out to Razorpay for a ₹0 order (which
    // Razorpay itself would reject).
    const paymentProvider = resolvePaymentProvider(input.paymentMethod === 'COD' ? 'COD' : 'RAZORPAY');
    const paymentResult =
      amountPayable <= 0
        ? ({ status: 'CONFIRMED' as const })
        : await paymentProvider.initiate({
            checkoutSessionId: sessionIdCandidate,
            amount: amountPayable,
            idempotencyKey: `${input.idempotencyKey}:payment`,
          });

    // A concurrent double-submission with the same idempotencyKey can
    // pass the existence check above on both requests before either has
    // inserted - the DB's own unique constraint on idempotencyKey is the
    // real guarantee. Reservations made above are already idempotent per
    // SKU (InventoryService.reserve() dedupes on its own idempotencyKey),
    // so the loser here doesn't need to release anything - it just
    // returns the winner's session instead of a spurious conflict error,
    // giving both requests the same successful response (negative
    // scenario #3, acceptance/m13-checkout.md).
    let sessionId: string;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const session = await tx.checkoutSession.create({
          data: {
            id: sessionIdCandidate,
            customerId: identity.customerId,
            guestSessionId: identity.guestSessionId,
            contactName: input.contactName,
            contactMobile: input.contactMobile,
            contactEmail: input.contactEmail,
            billingAddress: input.billingAddress as object,
            shippingAddress: input.shippingAddress as object,
            shippingStateCode: input.shippingAddress.stateCode,
            shippingCost,
            subtotal,
            taxAmount,
            grandTotal,
            loyaltyPointsRedeemed: input.loyaltyPointsToRedeem && loyaltyRedemptionValue > 0 ? input.loyaltyPointsToRedeem : 0,
            loyaltyRedemptionValue,
            storeCreditApplied,
            promotionDiscountTotal,
            giftCardApplied,
            paymentMethod: input.paymentMethod,
            // LR-003: identifiers are kept only for a purpose the customer
            // consented to; without consent nothing is stored or sent.
            analyticsConsent: input.tracking?.analytics === true,
            marketingConsent: input.tracking?.marketing === true,
            analyticsClientId: input.tracking?.analytics ? (input.tracking.analyticsClientId ?? null) : null,
            metaBrowserId: input.tracking?.marketing ? (input.tracking.metaBrowserId ?? null) : null,
            metaClickId: input.tracking?.marketing ? (input.tracking.metaClickId ?? null) : null,
            status: paymentResult.status === 'CONFIRMED' ? 'CONFIRMED' : 'RESERVED',
            idempotencyKey: input.idempotencyKey,
            confirmedAt: paymentResult.status === 'CONFIRMED' ? new Date() : null,
            lines: {
              create: reservedLineData.map((l) => ({
                skuId: l.skuId,
                locationId: l.locationId,
                quantity: l.quantity,
                unitPriceInclusive: l.unitPriceInclusive,
                discountAmountSnapshot: l.discountAmount,
                taxableValueSnapshot: l.taxableValue,
                gstRatePercent: l.gstRatePercent,
                taxAmountSnapshot: l.taxAmount,
                lineTotalInclusive: l.lineTotalInclusive,
                reservationId: l.reservationId,
              })),
            },
            payments: {
              create: {
                provider: input.paymentMethod === 'COD' ? 'COD' : 'RAZORPAY',
                status: paymentResult.status === 'CONFIRMED' ? 'CONFIRMED' : 'INITIATED',
                amount: amountPayable,
                providerReferenceId: paymentResult.providerReferenceId,
                idempotencyKey: `${input.idempotencyKey}:payment`,
              },
            },
          },
        });

        // M23 (specs/22-loyalty.md §8): the AUTHORITATIVE, row-locked
        // validation+hold-creation - see reserveRedemptionForCheckout's
        // own docblock for why this can only happen here, inside this
        // transaction, after the CheckoutSession row it attaches to
        // already exists. On the rare race this rejects (see
        // previewRedemptionValue's docblock), the whole transaction
        // rolls back and the catch block below releases every
        // reservation made in this attempt, exactly like an
        // insufficient-stock failure.
        if (input.loyaltyPointsToRedeem && loyaltyRedemptionValue > 0 && identity.customerId) {
          await this.loyalty.reserveRedemptionForCheckout(tx, identity.customerId, session.id, input.loyaltyPointsToRedeem, grandTotal);
        }

        // M24: same authoritative, row-locked re-validation pattern -
        // a coupon that lost the usage-cap race throws here (aborting
        // the whole transaction, reservations released by the catch
        // block below); an automatic promotion that lost it is safely
        // dropped (see PromotionService.reserveForCheckout's own
        // docblock for the documented narrow limitation this implies
        // for a CAPPED automatic promotion specifically).
        if (promotionDiscountTotal > 0 || input.couponCode) {
          await this.promotions.reserveForCheckout(tx, baseSubtotal, input.couponCode, identity, session.id);
        }

        if (storeCreditApplied > 0) {
          await this.storeCredit.reserveRedemptionForCheckout(tx, identity, session.id, input.storeCreditToApply!, grandTotal - loyaltyRedemptionValue);
        }

        // M30: same authoritative, row-locked re-validation pattern -
        // applied LAST, against whatever remains after loyalty AND
        // store credit.
        if (giftCardApplied > 0) {
          await this.giftCard.reserveRedemptionForCheckout(
            tx,
            input.giftCardCode!,
            session.id,
            input.giftCardAmountToApply!,
            grandTotal - loyaltyRedemptionValue - storeCreditApplied,
          );
        }

        await recordAudit(tx, {
          actorType: identity.customerId ? 'CUSTOMER' : 'SYSTEM',
          action: 'checkout.session.create',
          entityType: 'CheckoutSession',
          entityId: session.id,
          newValue: { status: session.status, grandTotal, paymentMethod: input.paymentMethod },
        });

        return session;
      });
      sessionId = created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.checkoutSession.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (winner) {
          await this.loadOwnedSession(winner.id, identity);
          sessionId = winner.id;
        } else {
          throw err;
        }
      } else {
        // M23: the session transaction rolled back (most likely the
        // rare loyalty-hold race described above) - release every
        // reservation made in this attempt, same as the insufficient-
        // stock catch block earlier, rather than leaving them orphaned
        // against a session that was never actually created.
        for (const reserved of reservedLineData) {
          await this.inventory.releaseReservation(reserved.reservationId, 'checkout attempt failed');
        }
        throw err;
      }
    }

    // COD accepts and confirms in the same request - "successful COD
    // order acceptance" is exactly the M15 order-creation trigger
    // (specs/13-payment.md). PREPAID's own trigger is the Razorpay
    // capture webhook (PaymentService), not here. Idempotent on
    // checkoutSessionId, so the idempotency-race "winner" path above
    // safely calls this too without risking a duplicate order.
    if (paymentResult.status === 'CONFIRMED') {
      await this.order.createOrderFromCheckoutSession(sessionId);
    }

    return this.toView(sessionId, paymentResult.message);
  }

  async getCheckoutSession(id: string, identity: CartOwnerIdentity) {
    await this.loadOwnedSession(id, identity);
    return this.toView(id);
  }

  /**
   * Starts a NEW Payment attempt against an already-reserved session
   * (PAY-005 - "reservation preserved through the retry window"). Only
   * valid while the session's reservations are still intact
   * (status PAYMENT_FAILED) - once the session has expired the
   * reservations are already released and the customer must start a
   * fresh checkout, never silently re-reserve stock here.
   */
  async retryPayment(id: string, identity: CartOwnerIdentity, idempotencyKey: string) {
    const session = await this.loadOwnedSession(id, identity);

    const paymentIdempotencyKey = `${idempotencyKey}:payment`;
    const existingPayment = await this.prisma.payment.findUnique({ where: { idempotencyKey: paymentIdempotencyKey } });
    if (existingPayment) return this.toView(session.id);

    if (session.status !== 'PAYMENT_FAILED') {
      throw new ValidationError('This checkout can no longer be retried - please start a new checkout');
    }

    const lines = await this.prisma.checkoutSessionLine.findMany({ where: { checkoutSessionId: session.id } });
    for (const line of lines) {
      const reservation = line.reservationId
        ? await this.prisma.inventoryReservation.findUnique({ where: { id: line.reservationId } })
        : null;
      if (!reservation || reservation.status !== 'ACTIVE') {
        throw new ValidationError('Your reservation has expired - please start a new checkout');
      }
    }

    // M23/M30: reuse the SAME redemption/credit already committed on
    // this session at startCheckout (never re-validated or re-applied
    // here - the hold from the original attempt is still ACTIVE and
    // unaffected by a payment-only retry).
    const amountPayable =
      Number(session.grandTotal) - Number(session.loyaltyRedemptionValue) - Number(session.storeCreditApplied) - Number(session.giftCardApplied);

    const paymentProvider = resolvePaymentProvider(session.paymentMethod === 'COD' ? 'COD' : 'RAZORPAY');
    const paymentResult =
      amountPayable <= 0
        ? ({ status: 'CONFIRMED' as const })
        : await paymentProvider.initiate({
            checkoutSessionId: session.id,
            amount: amountPayable,
            idempotencyKey: paymentIdempotencyKey,
          });

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            checkoutSessionId: session.id,
            provider: session.paymentMethod === 'COD' ? 'COD' : 'RAZORPAY',
            status: paymentResult.status === 'CONFIRMED' ? 'CONFIRMED' : 'INITIATED',
            amount: amountPayable,
            providerReferenceId: paymentResult.providerReferenceId,
            idempotencyKey: paymentIdempotencyKey,
          },
        });
        await tx.checkoutSession.update({
          where: { id: session.id },
          data: {
            status: paymentResult.status === 'CONFIRMED' ? 'CONFIRMED' : 'RESERVED',
            confirmedAt: paymentResult.status === 'CONFIRMED' ? new Date() : null,
          },
        });
        await recordAudit(tx, {
          actorType: identity.customerId ? 'CUSTOMER' : 'SYSTEM',
          action: 'checkout.payment.retry',
          entityType: 'CheckoutSession',
          entityId: session.id,
          newValue: { status: paymentResult.status },
        });
      });
    } catch (err) {
      // Same concurrent-double-submission handling as startCheckout - the
      // DB's unique constraint on Payment.idempotencyKey is the real
      // guarantee against a duplicate retry attempt racing itself.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
        throw err;
      }
    }

    if (paymentResult.status === 'CONFIRMED') {
      await this.order.createOrderFromCheckoutSession(session.id);
    }

    return this.toView(session.id, paymentResult.message);
  }

  private async loadOwnedSession(id: string, identity: CartOwnerIdentity) {
    const session = await this.prisma.checkoutSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundError('CheckoutSession', id);

    const owns =
      (identity.customerId && session.customerId === identity.customerId) ||
      (identity.guestSessionId && session.guestSessionId === identity.guestSessionId);
    if (!owns) throw new NotFoundError('CheckoutSession', id);

    return session;
  }

  private async toView(id: string, paymentMessage?: string) {
    const session = await this.prisma.checkoutSession.findUniqueOrThrow({
      where: { id },
      include: {
        lines: { include: { sku: { include: { style: true, colour: true, size: true } } } },
        // "The current attempt" is always the most recent row for this
        // session (retries create new rows rather than mutating an old
        // one - PAY-005) - take(1) ordered by createdAt desc resolves it
        // without pulling the whole retry history into every view.
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        order: { select: { orderNumber: true } },
      },
    });
    const currentPayment = session.payments[0];
    // Razorpay's hosted Checkout.js needs the order id + the account's
    // PUBLIC key id to open (never the secret) - only meaningful while
    // a real Razorpay attempt is still in flight (INITIATED). Key id is
    // not sensitive (it's embedded in every Razorpay integration's
    // client-side JS by design); pulled from env directly rather than
    // persisted, since it isn't Payment-row state.
    const isOpenRazorpayAttempt = currentPayment?.provider === 'RAZORPAY' && currentPayment.status === 'INITIATED';

    return {
      id: session.id,
      status: session.status,
      paymentMethod: session.paymentMethod,
      payment: currentPayment
        ? {
            status: currentPayment.status,
            message: paymentMessage,
            providerOrderId: isOpenRazorpayAttempt ? currentPayment.providerReferenceId ?? undefined : undefined,
            providerPublicKeyId: isOpenRazorpayAttempt ? loadEnv().RAZORPAY_KEY_ID || undefined : undefined,
          }
        : null,
      contactName: session.contactName,
      contactMobile: session.contactMobile,
      shippingAddress: session.shippingAddress,
      billingAddress: session.billingAddress,
      shippingCost: Number(session.shippingCost),
      subtotal: Number(session.subtotal),
      taxAmount: Number(session.taxAmount),
      grandTotal: Number(session.grandTotal),
      loyaltyPointsRedeemed: session.loyaltyPointsRedeemed,
      loyaltyRedemptionValue: Number(session.loyaltyRedemptionValue),
      storeCreditApplied: Number(session.storeCreditApplied),
      promotionDiscountTotal: Number(session.promotionDiscountTotal),
      giftCardApplied: Number(session.giftCardApplied),
      amountPayable:
        Math.round(
          (Number(session.grandTotal) - Number(session.loyaltyRedemptionValue) - Number(session.storeCreditApplied) - Number(session.giftCardApplied)) *
            100,
        ) / 100,
      currency: session.currency,
      // Set once the order exists (COD placed / prepaid captured) - the
      // transaction ID the browser's purchase tag shares with the server (LR-003).
      orderNumber: session.order?.orderNumber ?? null,
      lines: session.lines.map((l) => ({
        skuId: l.skuId,
        skuCode: l.sku.skuCode,
        styleCode: l.sku.style.styleCode,
        styleName: l.sku.style.name,
        colourName: l.sku.colour.name,
        sizeLabel: l.sku.size.label,
        quantity: l.quantity,
        unitPriceInclusive: Number(l.unitPriceInclusive),
        lineTotalInclusive: Number(l.lineTotalInclusive),
      })),
      createdAt: session.createdAt,
      confirmedAt: session.confirmedAt,
    };
  }
}
