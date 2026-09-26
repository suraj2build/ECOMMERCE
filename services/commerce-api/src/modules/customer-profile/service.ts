import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type CustomerAddress, type CommunicationChannel, type CommunicationMessageType } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';

export interface AddressInput {
  label?: string;
  recipientName: string;
  recipientMobile: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
}

export interface ProfileUpdateInput {
  fullName?: string;
  email?: string;
}

const COMMUNICATION_CHANNELS: CommunicationChannel[] = ['SMS', 'WHATSAPP', 'EMAIL', 'PUSH'];
const COMMUNICATION_MESSAGE_TYPES: CommunicationMessageType[] = [
  'ORDER_UPDATES',
  'OFFERS_AND_PROMOTIONS',
  'PRODUCT_RECOMMENDATIONS',
  'NEWSLETTER',
];
// ORDER_UPDATES is transactional/essential (order confirmation, shipment,
// delivery) - never opt-outable through this preference center. Every
// other message type is genuine marketing consent (CUST-002).
const TRANSACTIONAL_MESSAGE_TYPES: ReadonlySet<CommunicationMessageType> = new Set(['ORDER_UPDATES']);

/**
 * M22 Customer 360 (specs/21-customer-profile.md): profile, address book,
 * recently viewed, saved sizes, reviews read surface, and communication
 * preferences - all scoped to the AUTHENTICATED customer only (never a
 * customerId taken from the request body/query/params - always
 * request.customer!.id from a verified JWT, per this build's own
 * absolute IDOR boundary). Order history, shipment tracking, wishlist,
 * and store credit are deliberately NOT reimplemented here - they reuse
 * the existing M12/M15/M17/M20 read routes directly (see routes.ts and
 * the storefront account UI).
 */
export class CustomerProfileService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  // --- Profile ---

  async getProfile(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, mobile: true, email: true, fullName: true, mobileVerifiedAt: true, createdAt: true },
    });
    if (!customer) throw new NotFoundError('Customer', customerId);
    return customer;
  }

  async updateProfile(customerId: string, input: ProfileUpdateInput) {
    const before = await this.getProfile(customerId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id: customerId },
        data: { fullName: input.fullName, email: input.email },
        select: { id: true, mobile: true, email: true, fullName: true, mobileVerifiedAt: true, createdAt: true },
      });
      await recordAudit(tx, {
        actorType: 'CUSTOMER',
        actorCustomerId: customerId,
        action: 'customer_profile.update',
        entityType: 'Customer',
        entityId: customerId,
        oldValue: { fullName: before.fullName, email: before.email },
        newValue: { fullName: customer.fullName, email: customer.email },
      });
      return customer;
    });
    return updated;
  }

  // --- Address book ---

  async listAddresses(customerId: string): Promise<CustomerAddress[]> {
    return this.prisma.customerAddress.findMany({ where: { customerId }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
  }

  private async loadOwnedAddress(customerId: string, addressId: string): Promise<CustomerAddress> {
    const address = await this.prisma.customerAddress.findUnique({ where: { id: addressId } });
    if (!address || address.customerId !== customerId) throw new NotFoundError('Address', addressId);
    return address;
  }

  /**
   * Sets exactly one address as default via a SINGLE atomic UPDATE
   * statement (`isDefault = (id = target)` for every row of this
   * customer) rather than a separate "unset old, set new" pair of
   * statements - two concurrent calls targeting different addresses of
   * the SAME customer necessarily serialize on Postgres's own per-row
   * write lock (the second statement blocks on the row(s) the first is
   * updating, then re-evaluates against the first's now-committed
   * state), so the committed result is always exactly one default,
   * never zero or two - backed by the migration's own partial unique
   * index as the final, unconditional guarantee.
   */
  private async atomicSetDefault(tx: Prisma.TransactionClient, customerId: string, targetAddressId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE "customer_addresses"
      SET "isDefault" = ("id" = ${targetAddressId}), "updatedAt" = now()
      WHERE "customerId" = ${customerId}`;
  }

  async createAddress(customerId: string, input: AddressInput): Promise<CustomerAddress> {
    return this.prisma.$transaction(async (tx) => {
      // Lock this customer's whole address set as the shared
      // serialization point against concurrent create/delete/set-default
      // calls for the same customer (same idiom as
      // StoreCreditService.lockOrCreateAccount).
      await tx.$queryRaw`SELECT 1 FROM "customer_addresses" WHERE "customerId" = ${customerId} FOR UPDATE`;
      const existingCount = await tx.customerAddress.count({ where: { customerId } });
      const created = await tx.customerAddress.create({
        data: {
          customerId,
          label: input.label,
          recipientName: input.recipientName,
          recipientMobile: input.recipientMobile,
          line1: input.line1,
          line2: input.line2,
          landmark: input.landmark,
          city: input.city,
          state: input.state,
          stateCode: input.stateCode,
          pincode: input.pincode,
          // A customer's very first address is always the default,
          // regardless of what the client requested.
          isDefault: existingCount === 0,
        },
      });
      if (existingCount > 0 && input && (input as AddressInput & { isDefault?: boolean }).isDefault) {
        await this.atomicSetDefault(tx, customerId, created.id);
      }
      await recordAudit(tx, {
        actorType: 'CUSTOMER',
        actorCustomerId: customerId,
        action: 'customer_address.create',
        entityType: 'CustomerAddress',
        entityId: created.id,
        newValue: { city: created.city, pincode: created.pincode, isDefault: created.isDefault },
      });
      return tx.customerAddress.findUniqueOrThrow({ where: { id: created.id } });
    });
  }

  async updateAddress(customerId: string, addressId: string, input: Partial<AddressInput>): Promise<CustomerAddress> {
    await this.loadOwnedAddress(customerId, addressId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "customer_addresses" WHERE "customerId" = ${customerId} FOR UPDATE`;
      const updated = await tx.customerAddress.update({
        where: { id: addressId },
        data: {
          label: input.label,
          recipientName: input.recipientName,
          recipientMobile: input.recipientMobile,
          line1: input.line1,
          line2: input.line2,
          landmark: input.landmark,
          city: input.city,
          state: input.state,
          stateCode: input.stateCode,
          pincode: input.pincode,
        },
      });
      await recordAudit(tx, {
        actorType: 'CUSTOMER',
        actorCustomerId: customerId,
        action: 'customer_address.update',
        entityType: 'CustomerAddress',
        entityId: addressId,
      });
      return updated;
    });
  }

  async setDefaultAddress(customerId: string, addressId: string): Promise<CustomerAddress> {
    await this.loadOwnedAddress(customerId, addressId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "customer_addresses" WHERE "customerId" = ${customerId} FOR UPDATE`;
      await this.atomicSetDefault(tx, customerId, addressId);
      await recordAudit(tx, {
        actorType: 'CUSTOMER',
        actorCustomerId: customerId,
        action: 'customer_address.set_default',
        entityType: 'CustomerAddress',
        entityId: addressId,
      });
      return tx.customerAddress.findUniqueOrThrow({ where: { id: addressId } });
    });
  }

  async deleteAddress(customerId: string, addressId: string): Promise<void> {
    await this.loadOwnedAddress(customerId, addressId);
    await this.prisma.$transaction(async (tx) => {
      // Lock the customer's whole address set FIRST - the shared
      // serialization point that makes a concurrent delete-vs-set-default
      // (or delete-vs-delete) on the SAME customer's addresses converge
      // to a single well-defined outcome rather than racing.
      const rows = await tx.$queryRaw<CustomerAddress[]>`
        SELECT * FROM "customer_addresses" WHERE "customerId" = ${customerId} FOR UPDATE`;
      const target = rows.find((r) => r.id === addressId);
      if (!target) throw new NotFoundError('Address', addressId);

      await tx.customerAddress.delete({ where: { id: addressId } });

      if (target.isDefault) {
        const remaining = rows.filter((r) => r.id !== addressId).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        if (remaining[0]) {
          await this.atomicSetDefault(tx, customerId, remaining[0].id);
        }
      }

      await recordAudit(tx, {
        actorType: 'CUSTOMER',
        actorCustomerId: customerId,
        action: 'customer_address.delete',
        entityType: 'CustomerAddress',
        entityId: addressId,
        oldValue: { city: target.city, pincode: target.pincode, isDefault: target.isDefault },
      });
    });
  }

  // --- Recently viewed ---

  async recordProductView(customerId: string, styleId: string): Promise<void> {
    const env = loadEnv();
    await this.prisma.$transaction(async (tx) => {
      await tx.recentlyViewedProduct.upsert({
        where: { customerId_styleId: { customerId, styleId } },
        create: { customerId, styleId },
        update: { viewedAt: new Date() },
      });
      // Bound the log: keep only the most recent RECENTLY_VIEWED_MAX_ITEMS
      // rows for this customer, deleting anything older.
      const keepIds = (
        await tx.recentlyViewedProduct.findMany({
          where: { customerId },
          orderBy: { viewedAt: 'desc' },
          take: env.RECENTLY_VIEWED_MAX_ITEMS,
          select: { id: true },
        })
      ).map((r) => r.id);
      await tx.recentlyViewedProduct.deleteMany({ where: { customerId, id: { notIn: keepIds } } });
    });
  }

  async listRecentlyViewed(customerId: string, limit = 20) {
    const env = loadEnv();
    const rows = await this.prisma.recentlyViewedProduct.findMany({
      where: { customerId, style: { lifecycleState: 'PUBLISHED' } },
      orderBy: { viewedAt: 'desc' },
      take: Math.min(limit, env.RECENTLY_VIEWED_MAX_ITEMS),
      include: { style: { select: { id: true, name: true, styleCode: true } } },
    });
    return rows.map((r) => ({ styleId: r.style.id, name: r.style.name, styleCode: r.style.styleCode, viewedAt: r.viewedAt }));
  }

  // --- My Sizes: reference data (public reads - no admin HTTP surface
  // exists yet for Category/Size elsewhere in this codebase; a customer
  // needs a real picker to save a size against, so these two minimal,
  // read-only, staff-safe-field-only endpoints are added here rather
  // than left as a "call the seed script" gap). ---

  async listCategoriesForSizePicker() {
    return this.prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async listSizesForSizePicker() {
    return this.prisma.size.findMany({ select: { id: true, label: true }, orderBy: { sortOrder: 'asc' } });
  }

  // --- My Sizes ---

  async listSavedSizes(customerId: string) {
    const rows = await this.prisma.customerSavedSize.findMany({
      where: { customerId },
      include: { category: { select: { id: true, name: true } }, size: { select: { id: true, label: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      categoryId: r.category.id,
      categoryName: r.category.name,
      sizeId: r.size.id,
      sizeLabel: r.size.label,
      updatedAt: r.updatedAt,
    }));
  }

  async saveSize(customerId: string, categoryId: string, sizeId: string) {
    const [category, size] = await Promise.all([
      this.prisma.category.findUnique({ where: { id: categoryId } }),
      this.prisma.size.findUnique({ where: { id: sizeId } }),
    ]);
    if (!category) throw new NotFoundError('Category', categoryId);
    if (!size) throw new NotFoundError('Size', sizeId);

    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.customerSavedSize.upsert({
        where: { customerId_categoryId: { customerId, categoryId } },
        create: { customerId, categoryId, sizeId },
        update: { sizeId },
      });
      await recordAudit(tx, {
        actorType: 'CUSTOMER',
        actorCustomerId: customerId,
        action: 'customer_saved_size.upsert',
        entityType: 'CustomerSavedSize',
        entityId: saved.id,
        newValue: { categoryId, sizeId },
      });
      return saved;
    });
  }

  async removeSavedSize(customerId: string, savedSizeId: string): Promise<void> {
    const existing = await this.prisma.customerSavedSize.findUnique({ where: { id: savedSizeId } });
    if (!existing || existing.customerId !== customerId) throw new NotFoundError('CustomerSavedSize', savedSizeId);
    await this.prisma.$transaction(async (tx) => {
      await tx.customerSavedSize.delete({ where: { id: savedSizeId } });
      await recordAudit(tx, {
        actorType: 'CUSTOMER',
        actorCustomerId: customerId,
        action: 'customer_saved_size.delete',
        entityType: 'CustomerSavedSize',
        entityId: savedSizeId,
      });
    });
  }

  // --- Reviews (read-only aggregation of the existing M11 model) ---

  async listMyReviews(customerId: string) {
    const rows = await this.prisma.review.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: { style: { select: { id: true, name: true, styleCode: true } } },
    });
    // Never exposes moderatedByStaffId or any staff-only moderation note.
    return rows.map((r) => ({
      id: r.id,
      styleId: r.style.id,
      styleName: r.style.name,
      rating: r.rating,
      title: r.title,
      body: r.body,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  // --- Communication preferences ---

  async getCommunicationPreferences(customerId: string) {
    const rows = await this.prisma.communicationPreference.findMany({ where: { customerId } });
    const byKey = new Map(rows.map((r) => [`${r.channel}:${r.messageType}`, r.optedIn]));
    const matrix: Array<{ channel: CommunicationChannel; messageType: CommunicationMessageType; optedIn: boolean; transactional: boolean }> = [];
    for (const channel of COMMUNICATION_CHANNELS) {
      for (const messageType of COMMUNICATION_MESSAGE_TYPES) {
        const key = `${channel}:${messageType}`;
        const transactional = TRANSACTIONAL_MESSAGE_TYPES.has(messageType);
        const defaultOptedIn = transactional; // essential messages default ON; marketing defaults OFF
        matrix.push({ channel, messageType, optedIn: byKey.get(key) ?? defaultOptedIn, transactional });
      }
    }
    return matrix;
  }

  async setCommunicationPreferences(
    customerId: string,
    updates: Array<{ channel: CommunicationChannel; messageType: CommunicationMessageType; optedIn: boolean }>,
  ) {
    for (const update of updates) {
      if (TRANSACTIONAL_MESSAGE_TYPES.has(update.messageType) && !update.optedIn) {
        throw new ValidationError(`${update.messageType} is a transactional message type and cannot be opted out of`);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      for (const update of updates) {
        await tx.communicationPreference.upsert({
          where: { customerId_channel_messageType: { customerId, channel: update.channel, messageType: update.messageType } },
          create: { customerId, channel: update.channel, messageType: update.messageType, optedIn: update.optedIn },
          update: { optedIn: update.optedIn },
        });
      }
      await recordAudit(tx, {
        actorType: 'CUSTOMER',
        actorCustomerId: customerId,
        action: 'communication_preference.update',
        entityType: 'CommunicationPreference',
        entityId: customerId,
        newValue: updates,
      });
    });
    return this.getCommunicationPreferences(customerId);
  }
}
