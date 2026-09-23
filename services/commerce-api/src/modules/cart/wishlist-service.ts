import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { CatalogService } from '../catalog/service.js';
import { CartService, type CartView } from './service.js';
import type { CartOwnerIdentity } from './identity.js';

export interface WishlistItemView {
  skuId: string;
  skuCode: string;
  styleId: string;
  styleName: string;
  colourName: string;
  sizeLabel: string;
  imageUrl: string | null;
  currentPrice: number | null;
  availableQuantity: number;
  inStock: boolean;
  isPurchasable: boolean;
  addedAt: Date;
}

/**
 * Wishlist (M12, specs/11-wishlist-cart.md, CART-001/003). Save-for-later
 * only - never reserves inventory, same discipline as Cart. Sharing
 * (CART-003) is explicitly FUTURE_CONSIDERATION and not built here.
 */
export class WishlistService {
  private readonly catalog: CatalogService;
  private readonly cart: CartService;

  constructor(private readonly fastify: FastifyInstance) {
    this.catalog = new CatalogService(fastify);
    this.cart = new CartService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  private async getOrCreateWishlistRow(identity: CartOwnerIdentity) {
    const existing = identity.customerId
      ? await this.prisma.wishlist.findUnique({ where: { customerId: identity.customerId } })
      : await this.prisma.wishlist.findUnique({ where: { guestSessionId: identity.guestSessionId } });

    if (existing) return existing;
    return this.prisma.wishlist.create({
      data: { customerId: identity.customerId, guestSessionId: identity.guestSessionId },
    });
  }

  async addItem(identity: CartOwnerIdentity, skuId: string): Promise<WishlistItemView[]> {
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId } });
    if (!sku || !sku.isActive) throw new NotFoundError('Sku', skuId);

    const wishlist = await this.getOrCreateWishlistRow(identity);
    await this.prisma.wishlistItem.upsert({
      where: { wishlistId_skuId: { wishlistId: wishlist.id, skuId } },
      update: {},
      create: { wishlistId: wishlist.id, skuId },
    });

    return this.listItems(identity);
  }

  async removeItem(identity: CartOwnerIdentity, skuId: string): Promise<WishlistItemView[]> {
    const wishlist = await this.getOrCreateWishlistRow(identity);
    const item = await this.prisma.wishlistItem.findUnique({
      where: { wishlistId_skuId: { wishlistId: wishlist.id, skuId } },
    });
    if (!item) throw new NotFoundError('WishlistItem', skuId);

    await this.prisma.wishlistItem.delete({ where: { wishlistId_skuId: { wishlistId: wishlist.id, skuId } } });
    return this.listItems(identity);
  }

  async listItems(identity: CartOwnerIdentity): Promise<WishlistItemView[]> {
    const wishlist = await this.getOrCreateWishlistRow(identity);

    const items = await this.prisma.wishlistItem.findMany({
      where: { wishlistId: wishlist.id },
      include: { sku: { include: { style: true, colour: true, size: true } } },
      orderBy: { createdAt: 'desc' },
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

    const views: WishlistItemView[] = [];
    for (const item of items) {
      const activePrice = await this.catalog.getActivePrice(item.sku.styleId, item.sku.colourId);
      const currentPrice = activePrice ? Number(activePrice.sellingPrice) : null;
      const availableQuantity = availabilityBySkuId.get(item.skuId) ?? 0;
      const image =
        media.find((m) => m.styleId === item.sku.styleId && m.colourId === item.sku.colourId) ??
        media.find((m) => m.styleId === item.sku.styleId && m.colourId === null);

      views.push({
        skuId: item.skuId,
        skuCode: item.sku.skuCode,
        styleId: item.sku.styleId,
        styleName: item.sku.style.name,
        colourName: item.sku.colour.name,
        sizeLabel: item.sku.size.label,
        imageUrl: image?.url ?? null,
        currentPrice,
        availableQuantity,
        inStock: availableQuantity > 0,
        isPurchasable: item.sku.style.lifecycleState === 'PUBLISHED' && currentPrice !== null,
        addedAt: item.createdAt,
      });
    }

    return views;
  }

  /** Moves a saved item into the cart, removing it from the wishlist on success. */
  async moveToCart(identity: CartOwnerIdentity, skuId: string, quantity: number): Promise<CartView> {
    if (quantity <= 0) throw new ValidationError('Quantity must be a positive integer');

    const wishlist = await this.getOrCreateWishlistRow(identity);
    const item = await this.prisma.wishlistItem.findUnique({
      where: { wishlistId_skuId: { wishlistId: wishlist.id, skuId } },
    });
    if (!item) throw new NotFoundError('WishlistItem', skuId);

    const cartView = await this.cart.addItem(identity, skuId, quantity);
    await this.prisma.wishlistItem.delete({ where: { wishlistId_skuId: { wishlistId: wishlist.id, skuId } } });

    return cartView;
  }

  /** Merges a guest wishlist into the customer's on login (CART-001), same idempotent-no-op-if-absent pattern as CartService. */
  async mergeGuestWishlistIntoCustomer(customerId: string, guestSessionId: string): Promise<void> {
    const guestWishlist = await this.prisma.wishlist.findUnique({
      where: { guestSessionId },
      include: { items: true },
    });
    if (!guestWishlist) return;

    const customerWishlist = await this.getOrCreateWishlistRow({ customerId });

    await this.prisma.$transaction(async (tx) => {
      for (const guestItem of guestWishlist.items) {
        await tx.wishlistItem.upsert({
          where: { wishlistId_skuId: { wishlistId: customerWishlist.id, skuId: guestItem.skuId } },
          update: {},
          create: { wishlistId: customerWishlist.id, skuId: guestItem.skuId },
        });
      }
      await tx.wishlist.delete({ where: { id: guestWishlist.id } });
    });
  }
}
