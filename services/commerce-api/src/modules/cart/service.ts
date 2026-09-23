import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { CatalogService } from '../catalog/service.js';
import type { CartOwnerIdentity } from './identity.js';

export interface CartItemView {
  skuId: string;
  skuCode: string;
  styleId: string;
  styleName: string;
  colourName: string;
  sizeLabel: string;
  imageUrl: string | null;
  quantity: number;
  priceAtAdd: number;
  currentPrice: number | null;
  priceChanged: boolean;
  availableQuantity: number;
  inStock: boolean;
  isPurchasable: boolean; // still published and priced - false if the product was pulled after adding
}

export interface CartView {
  id: string;
  items: CartItemView[];
  itemCount: number;
  subtotal: number;
  hasBlockingChanges: boolean; // true if anything needs the customer's attention before checkout
}

/**
 * Cart (M12, specs/11-wishlist-cart.md, CART-001/002, INV-002).
 *
 * The one rule this service must never violate: adding to cart NEVER
 * calls InventoryService.reserve() - this module has no dependency on
 * InventoryService's mutating methods at all, only read-only
 * InventoryBalance queries for informational display, exactly mirroring
 * PdpService's own live-availability read (M11). Real reservation only
 * happens at checkout/payment initiation (M13, INV-002).
 */
export class CartService {
  private readonly catalog: CatalogService;

  constructor(private readonly fastify: FastifyInstance) {
    this.catalog = new CatalogService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  private async findCartRow(tx: Prisma.TransactionClient | PrismaClient, identity: CartOwnerIdentity) {
    if (identity.customerId) {
      return tx.cart.findUnique({ where: { customerId: identity.customerId } });
    }
    return tx.cart.findUnique({ where: { guestSessionId: identity.guestSessionId } });
  }

  /**
   * Returns the cart row for this identity, creating an empty one if
   * needed. A guest cart past its configured TTL (CART-001) is treated as
   * expired: its items are cleared and its activity clock restarts,
   * rather than accumulating stale line items forever.
   */
  private async getOrCreateCartRow(identity: CartOwnerIdentity) {
    const env = loadEnv();
    const existing = await this.findCartRow(this.prisma, identity);

    if (!existing) {
      return this.prisma.cart.create({
        data: { customerId: identity.customerId, guestSessionId: identity.guestSessionId },
      });
    }

    if (identity.guestSessionId) {
      const ttlMs = env.CART_GUEST_TTL_DAYS * 24 * 60 * 60 * 1000;
      const isExpired = Date.now() - existing.lastActivityAt.getTime() > ttlMs;
      if (isExpired) {
        await this.prisma.cartItem.deleteMany({ where: { cartId: existing.id } });
        return this.prisma.cart.update({ where: { id: existing.id }, data: { lastActivityAt: new Date() } });
      }
    }

    return existing;
  }

  private async touchCart(cartId: string): Promise<void> {
    await this.prisma.cart.update({ where: { id: cartId }, data: { lastActivityAt: new Date() } });
  }

  async addItem(identity: CartOwnerIdentity, skuId: string, quantity: number): Promise<CartView> {
    if (quantity <= 0) throw new ValidationError('Quantity must be a positive integer');

    const sku = await this.prisma.sku.findUnique({ where: { id: skuId } });
    if (!sku || !sku.isActive) throw new NotFoundError('Sku', skuId);

    const activePrice = await this.catalog.getActivePrice(sku.styleId, sku.colourId);
    if (!activePrice) throw new ValidationError('This product is not currently available for purchase');

    const env = loadEnv();
    const cart = await this.getOrCreateCartRow(identity);

    const existingItem = await this.prisma.cartItem.findUnique({
      where: { cartId_skuId: { cartId: cart.id, skuId } },
    });
    const newQuantity = (existingItem?.quantity ?? 0) + quantity;
    if (newQuantity > env.CART_MAX_QUANTITY_PER_SKU) {
      throw new ValidationError(
        `Cannot add ${quantity} more of this item - the maximum per product is ${env.CART_MAX_QUANTITY_PER_SKU} and the cart already has ${existingItem?.quantity ?? 0}`,
      );
    }

    await this.prisma.cartItem.upsert({
      where: { cartId_skuId: { cartId: cart.id, skuId } },
      update: { quantity: newQuantity, priceAtAdd: activePrice.sellingPrice },
      create: { cartId: cart.id, skuId, quantity: newQuantity, priceAtAdd: activePrice.sellingPrice },
    });
    await this.touchCart(cart.id);

    return this.getCartView(identity);
  }

  async updateItemQuantity(identity: CartOwnerIdentity, skuId: string, quantity: number): Promise<CartView> {
    if (quantity <= 0) throw new ValidationError('Quantity must be a positive integer - use remove to delete an item');

    const env = loadEnv();
    if (quantity > env.CART_MAX_QUANTITY_PER_SKU) {
      throw new ValidationError(`The maximum quantity per product is ${env.CART_MAX_QUANTITY_PER_SKU}`);
    }

    const cart = await this.getOrCreateCartRow(identity);
    const item = await this.prisma.cartItem.findUnique({ where: { cartId_skuId: { cartId: cart.id, skuId } } });
    if (!item) throw new NotFoundError('CartItem', skuId);

    await this.prisma.cartItem.update({
      where: { cartId_skuId: { cartId: cart.id, skuId } },
      data: { quantity },
    });
    await this.touchCart(cart.id);

    return this.getCartView(identity);
  }

  async removeItem(identity: CartOwnerIdentity, skuId: string): Promise<CartView> {
    const cart = await this.getOrCreateCartRow(identity);
    const item = await this.prisma.cartItem.findUnique({ where: { cartId_skuId: { cartId: cart.id, skuId } } });
    if (!item) throw new NotFoundError('CartItem', skuId);

    await this.prisma.cartItem.delete({ where: { cartId_skuId: { cartId: cart.id, skuId } } });
    await this.touchCart(cart.id);

    return this.getCartView(identity);
  }

  /**
   * Re-validates every line item's price and availability against
   * current catalog/inventory state (spec requirement: "the cart MUST
   * re-validate ... and MUST clearly surface any change"). This is a
   * read-time projection, never a second source of truth.
   */
  async getCartView(identity: CartOwnerIdentity): Promise<CartView> {
    const cart = await this.getOrCreateCartRow(identity);

    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: {
        sku: {
          include: {
            style: true,
            colour: true,
            size: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const skuIds = items.map((i) => i.skuId);
    const balances = skuIds.length
      ? await this.prisma.inventoryBalance.groupBy({
          by: ['skuId'],
          where: { skuId: { in: skuIds } },
          _sum: { onHand: true, reserved: true },
        })
      : [];
    const availabilityBySkuId = new Map(
      balances.map((b) => [b.skuId, Math.max(0, (b._sum.onHand ?? 0) - (b._sum.reserved ?? 0))]),
    );

    const media = items.length
      ? await this.prisma.productMedia.findMany({
          where: { styleId: { in: items.map((i) => i.sku.styleId) } },
          orderBy: { sortOrder: 'asc' },
        })
      : [];

    let subtotal = 0;
    let hasBlockingChanges = false;

    const itemViews: CartItemView[] = [];
    for (const item of items) {
      const activePrice = await this.catalog.getActivePrice(item.sku.styleId, item.sku.colourId);
      const currentPrice = activePrice ? Number(activePrice.sellingPrice) : null;
      const priceChanged = currentPrice !== null && currentPrice !== Number(item.priceAtAdd);
      const availableQuantity = availabilityBySkuId.get(item.skuId) ?? 0;
      const inStock = availableQuantity >= item.quantity;
      const isPurchasable = item.sku.style.lifecycleState === 'PUBLISHED' && currentPrice !== null;
      const image =
        media.find((m) => m.styleId === item.sku.styleId && m.colourId === item.sku.colourId) ??
        media.find((m) => m.styleId === item.sku.styleId && m.colourId === null);

      if (!isPurchasable || !inStock || priceChanged) hasBlockingChanges = true;
      if (isPurchasable) subtotal += (currentPrice ?? Number(item.priceAtAdd)) * item.quantity;

      itemViews.push({
        skuId: item.skuId,
        skuCode: item.sku.skuCode,
        styleId: item.sku.styleId,
        styleName: item.sku.style.name,
        colourName: item.sku.colour.name,
        sizeLabel: item.sku.size.label,
        imageUrl: image?.url ?? null,
        quantity: item.quantity,
        priceAtAdd: Number(item.priceAtAdd),
        currentPrice,
        priceChanged,
        availableQuantity,
        inStock,
        isPurchasable,
      });
    }

    return {
      id: cart.id,
      items: itemViews,
      itemCount: itemViews.reduce((sum, i) => sum + i.quantity, 0),
      subtotal,
      hasBlockingChanges,
    };
  }

  /**
   * Merges a guest cart into the now-logged-in customer's cart
   * (CART-001: "merges into the account cart on login"). Idempotent - a
   * guest session with no cart, or one already merged, is a safe no-op.
   * Quantities are summed per SKU and capped at the configured maximum,
   * never silently dropped past the cap (the customer sees the capped
   * total on next read, not an error mid-login).
   */
  async mergeGuestCartIntoCustomer(customerId: string, guestSessionId: string): Promise<void> {
    const guestCart = await this.prisma.cart.findUnique({
      where: { guestSessionId },
      include: { items: true },
    });
    if (!guestCart) return;

    const env = loadEnv();
    const customerCart = await this.getOrCreateCartRow({ customerId });

    await this.prisma.$transaction(async (tx) => {
      for (const guestItem of guestCart.items) {
        const existing = await tx.cartItem.findUnique({
          where: { cartId_skuId: { cartId: customerCart.id, skuId: guestItem.skuId } },
        });
        const mergedQuantity = Math.min(
          (existing?.quantity ?? 0) + guestItem.quantity,
          env.CART_MAX_QUANTITY_PER_SKU,
        );
        await tx.cartItem.upsert({
          where: { cartId_skuId: { cartId: customerCart.id, skuId: guestItem.skuId } },
          update: { quantity: mergedQuantity, priceAtAdd: guestItem.priceAtAdd },
          create: {
            cartId: customerCart.id,
            skuId: guestItem.skuId,
            quantity: mergedQuantity,
            priceAtAdd: guestItem.priceAtAdd,
          },
        });
      }
      await tx.cart.update({ where: { id: customerCart.id }, data: { lastActivityAt: new Date() } });
      await tx.cart.delete({ where: { id: guestCart.id } });
    });
  }
}
