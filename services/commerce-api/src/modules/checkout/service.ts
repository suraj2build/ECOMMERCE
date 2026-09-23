import type { FastifyInstance } from 'fastify';
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

export interface AddressInput {
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  stateCode: string; // same convention as GstRegistration.stateCode (e.g. 'DL')
  pincode: string;
}

export interface StartCheckoutInput {
  contactName: string;
  contactMobile: string;
  contactEmail?: string;
  billingAddress: AddressInput;
  shippingAddress: AddressInput;
  paymentMethod: 'PREPAID' | 'COD';
  idempotencyKey: string;
}

interface PricedLine {
  skuId: string;
  quantity: number;
  unitPriceInclusive: number;
  taxableValue: number;
  gstRatePercent: number;
  taxAmount: number;
  lineTotalInclusive: number;
}

/**
 * Checkout (M13, specs/12-checkout.md). Produces the "order creation
 * trigger" artifact (CheckoutSession) - NOT the formal Order model,
 * which is M15's own milestone to create (see the schema comment on
 * CheckoutSession and InvoiceService's docblock). Depends only on the
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

  constructor(private readonly fastify: FastifyInstance) {
    this.cart = new CartService(fastify);
    this.serviceability = new ServiceabilityService(fastify);
    this.inventory = new InventoryService(fastify);
    this.taxConfig = new TaxConfigService(fastify);
    this.shipping = new ShippingService(fastify);
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
   */
  private async priceLines(
    items: Awaited<ReturnType<CartService['getCartView']>>['items'],
    shippingStateCode: string,
  ): Promise<{ lines: PricedLine[]; subtotal: number; taxAmount: number }> {
    const registration = await this.resolveSupplierRegistration();
    const { isIntraState } = determinePlaceOfSupply({
      supplierStateCode: registration.stateCode,
      shippingStateCode,
    });

    const lines: PricedLine[] = [];
    let subtotal = 0;
    let taxAmount = 0;

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
      const gstRatePercent = Number(rate.gstRatePercent);
      // Storefront prices are tax-inclusive (CAT-001); reverse the split
      // to get the tax-exclusive taxable value the tax engine expects.
      const taxableValue = Math.round((lineInclusive / (1 + gstRatePercent / 100)) * 100) / 100;
      const split = splitTax({
        taxableValue,
        gstRatePercent,
        cessPercent: rate.cessPercent ? Number(rate.cessPercent) : null,
        isIntraState,
      });

      lines.push({
        skuId: item.skuId,
        quantity: item.quantity,
        unitPriceInclusive: sellingPriceInclusive,
        taxableValue,
        gstRatePercent,
        taxAmount: split.totalTax,
        lineTotalInclusive: taxableValue + split.totalTax,
      });
      subtotal += taxableValue + split.totalTax;
      taxAmount += split.totalTax;
    }

    return { lines, subtotal: Math.round(subtotal * 100) / 100, taxAmount: Math.round(taxAmount * 100) / 100 };
  }

  async previewCheckout(identity: CartOwnerIdentity, shippingAddress: AddressInput) {
    const cartView = await this.cart.getCartView(identity);
    if (cartView.items.length === 0) throw new ValidationError('Your bag is empty');
    if (cartView.hasBlockingChanges) {
      throw new ValidationError('Your bag has changes that need your attention before checkout - review it first');
    }

    const serviceability = await this.serviceability.checkServiceability(shippingAddress.pincode);
    const { lines, subtotal, taxAmount } = await this.priceLines(cartView.items, shippingAddress.stateCode);
    const shippingCost = await this.shipping.calculateShippingCost(subtotal);

    return {
      isServiceable: serviceability.isServiceable,
      codAvailable: serviceability.codAvailable,
      knownPincode: serviceability.known,
      lines,
      subtotal,
      taxAmount,
      shippingCost,
      grandTotal: Math.round((subtotal + shippingCost) * 100) / 100,
    };
  }

  async startCheckout(identity: CartOwnerIdentity, input: StartCheckoutInput) {
    const existing = await this.prisma.checkoutSession.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return this.toView(existing.id);

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

    const { lines, subtotal, taxAmount } = await this.priceLines(cartView.items, input.shippingAddress.stateCode);
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

    const paymentProvider = resolvePaymentProvider(input.paymentMethod === 'COD' ? 'COD' : 'RAZORPAY');
    const paymentResult = await paymentProvider.initiate({
      amount: grandTotal,
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
            paymentMethod: input.paymentMethod,
            status: paymentResult.status === 'CONFIRMED' ? 'CONFIRMED' : 'RESERVED',
            idempotencyKey: input.idempotencyKey,
            confirmedAt: paymentResult.status === 'CONFIRMED' ? new Date() : null,
            lines: {
              create: reservedLineData.map((l) => ({
                skuId: l.skuId,
                locationId: l.locationId,
                quantity: l.quantity,
                unitPriceInclusive: l.unitPriceInclusive,
                taxableValueSnapshot: l.taxableValue,
                gstRatePercent: l.gstRatePercent,
                taxAmountSnapshot: l.taxAmount,
                lineTotalInclusive: l.lineTotalInclusive,
                reservationId: l.reservationId,
              })),
            },
            payment: {
              create: {
                provider: input.paymentMethod === 'COD' ? 'COD' : 'RAZORPAY',
                status: paymentResult.status === 'CONFIRMED' ? 'CONFIRMED' : 'INITIATED',
                amount: grandTotal,
                providerReferenceId: paymentResult.providerReferenceId,
                idempotencyKey: `${input.idempotencyKey}:payment`,
              },
            },
          },
        });

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
          sessionId = winner.id;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    return this.toView(sessionId, paymentResult.message);
  }

  async getCheckoutSession(id: string, identity: CartOwnerIdentity) {
    const session = await this.prisma.checkoutSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundError('CheckoutSession', id);

    const owns =
      (identity.customerId && session.customerId === identity.customerId) ||
      (identity.guestSessionId && session.guestSessionId === identity.guestSessionId);
    if (!owns) throw new NotFoundError('CheckoutSession', id);

    return this.toView(id);
  }

  private async toView(id: string, paymentMessage?: string) {
    const session = await this.prisma.checkoutSession.findUniqueOrThrow({
      where: { id },
      include: {
        lines: { include: { sku: { include: { style: true, colour: true, size: true } } } },
        payment: true,
      },
    });

    return {
      id: session.id,
      status: session.status,
      paymentMethod: session.paymentMethod,
      payment: session.payment
        ? { status: session.payment.status, message: paymentMessage }
        : null,
      contactName: session.contactName,
      contactMobile: session.contactMobile,
      shippingAddress: session.shippingAddress,
      billingAddress: session.billingAddress,
      shippingCost: Number(session.shippingCost),
      subtotal: Number(session.subtotal),
      taxAmount: Number(session.taxAmount),
      grandTotal: Number(session.grandTotal),
      currency: session.currency,
      lines: session.lines.map((l) => ({
        skuId: l.skuId,
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
