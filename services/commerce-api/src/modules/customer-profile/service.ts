import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type CustomerAddress, type CommunicationChannel, type CommunicationMessageType } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { NotFoundError } from '@fcp/shared';
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
// ORDER_UPDATES is the one transactional message type in this vocabulary
// (CUST-002 requires per-channel x per-message-type granularity, not a
// single global toggle - it does not require, and this build must not
// invent, a rule that ORDER_UPDATES can never be opted out of through
// this preference center). It still defaults to opted-in, and downstream
// notification-delivery enforcement for legally-required transactional
// messages is a separate, not-yet-defined policy question - see the
// M22 certification-repair note on setCommunicationPreferences below.
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
    const updated = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id: customerId },
        data: { fullName: input.fullName, email: input.email },
        select: { id: true, mobile: true, email: true, fullName: true, mobileVerifiedAt: true, createdAt: true },
      });
      // M22 certification-repair (finding 1): never record the actual
      // email/name VALUES in the audit trail - email is PII, and the
      // audit log's job here is proving WHO changed WHAT FIELDS WHEN,
      // not holding a second copy of personal data. changedFields is
      // derived from the input the caller actually sent, not from a
      // value diff, so a field set to its current value still counts
      // as "changed" from the caller's point of view.
      const changedFields = Object.keys(input).filter((k) => input[k as keyof ProfileUpdateInput] !== undefined);
      await recordAudit(tx, {
        actorType: 'CUSTOMER',
        actorCustomerId: customerId,
        action: 'customer_profile.update',
        entityType: 'Customer',
        entityId: customerId,
        newValue: { changedFields },
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
   * Sets exactly one address as default via two sequential UPDATE
   * statements - clear whichever row is currently default, then set the
   * target - both covered by the SAME transaction's already-held
   * customer-row lock (lockCustomerForAddressMutation), so no concurrent
   * caller for this customer can observe or interleave between them.
   *
   * M22 certification-repair (finding 4, discovered by this repair's own
   * new adversarial test chaining a create-with-isDefault against a
   * set-default): the ORIGINAL single-statement form
   * (`SET "isDefault" = ("id" = target) WHERE "customerId" = ...`) is
   * NOT safe on its own, even fully serialized by a lock, because
   * PostgreSQL does not guarantee the ROW-PROCESSING ORDER within one
   * multi-row UPDATE. The partial unique index
   * (customer_addresses_one_default_per_customer) is checked per-row,
   * immediately, not deferred to statement end - if Postgres happens to
   * apply the new-default row before the old-default row within that
   * single statement, the old row's still-`true` index entry and the
   * new row's about-to-be-`true` entry transiently coexist and the
   * unique index rejects the insert (Postgres error 23505), surfacing
   * as a raw 500 - reproduced for real by
   * test/integration/customer-profile.test.ts's own concurrent
   * create-vs-set-default test. Splitting into "clear old" (only ever
   * REMOVES index entries, never conflicts) then "set new" (only ever
   * ADDS the one entry, and only after the old one is provably gone) is
   * correct regardless of PostgreSQL's internal row order.
   */
  private async atomicSetDefault(tx: Prisma.TransactionClient, customerId: string, targetAddressId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE "customer_addresses"
      SET "isDefault" = false, "updatedAt" = now()
      WHERE "customerId" = ${customerId} AND "isDefault" = true AND "id" != ${targetAddressId}`;
    await tx.$executeRaw`
      UPDATE "customer_addresses"
      SET "isDefault" = true, "updatedAt" = now()
      WHERE "id" = ${targetAddressId} AND "isDefault" = false`;
  }

  /**
   * M22 certification-repair (finding 4): every address-book mutation
   * (create/update/set-default/delete) locks this SAME row - the
   * customer's own row, which always exists, unlike an address row -
   * as its single shared serialization point, acquired as the FIRST
   * statement of the transaction. This replaces the earlier
   * "lock the customer's whole address SET via SELECT ... FOR UPDATE"
   * idiom, which had a genuine gap: a brand-new customer with ZERO
   * address rows has no row for that query to lock at all, so two
   * genuinely concurrent first-address creates could both read
   * existingCount === 0 and both attempt isDefault = true, surfacing as
   * a raw, unhandled partial-unique-index violation (500) rather than a
   * clean, deterministic result - reproduced with a genuine
   * `Promise.all` race in
   * test/integration/customer-profile.test.ts ("zero existing rows")
   * before this fix, run repeatedly against the OLD locking query.
   * Locking the customer row instead works identically whether the
   * customer has zero, one, or many addresses, and - because every one
   * of these four methods now locks EXACTLY this one row, in this one
   * order, for this one customer - it cannot reintroduce the earlier
   * lock-order-inversion deadlock (40P01) that the previous multi-row
   * `ORDER BY "id" FOR UPDATE` fix addressed: there is only ever one row
   * being locked per customer, so there is no order left to invert.
   */
  private async lockCustomerForAddressMutation(tx: Prisma.TransactionClient, customerId: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 FROM "customers" WHERE "id" = ${customerId} FOR UPDATE`;
  }

  async createAddress(customerId: string, input: AddressInput): Promise<CustomerAddress> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockCustomerForAddressMutation(tx, customerId);
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
      // M22 certification-repair (finding 1): never record address-line/
      // city/pincode/recipient VALUES (location and contact PII) in the
      // audit trail - only the fact that an address was created, by
      // whom, and whether it became the default.
      await recordAudit(tx, {
        actorType: 'CUSTOMER',
        actorCustomerId: customerId,
        action: 'customer_address.create',
        entityType: 'CustomerAddress',
        entityId: created.id,
        newValue: { isDefault: created.isDefault },
      });
      return tx.customerAddress.findUniqueOrThrow({ where: { id: created.id } });
    });
  }

  async updateAddress(customerId: string, addressId: string, input: Partial<AddressInput>): Promise<CustomerAddress> {
    await this.loadOwnedAddress(customerId, addressId);
    return this.prisma.$transaction(async (tx) => {
      await this.lockCustomerForAddressMutation(tx, customerId);
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
      const changedFields = Object.keys(input).filter((k) => input[k as keyof AddressInput] !== undefined);
      await recordAudit(tx, {
        actorType: 'CUSTOMER',
        actorCustomerId: customerId,
        action: 'customer_address.update',
        entityType: 'CustomerAddress',
        entityId: addressId,
        newValue: { changedFields },
      });
      return updated;
    });
  }

  async setDefaultAddress(customerId: string, addressId: string): Promise<CustomerAddress> {
    await this.loadOwnedAddress(customerId, addressId);
    return this.prisma.$transaction(async (tx) => {
      await this.lockCustomerForAddressMutation(tx, customerId);
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
      await this.lockCustomerForAddressMutation(tx, customerId);
      // Once the customer row lock above is held, no concurrent
      // create/update/set-default/delete for this customer can proceed
      // until this transaction commits, so a plain (non-locking) read of
      // this customer's address rows here is already race-free.
      const rows = await tx.customerAddress.findMany({ where: { customerId } });
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
        oldValue: { wasDefault: target.isDefault },
      });
    });
  }

  // --- Recently viewed ---

  /** M22 certification-repair (finding 2): shared by write and read paths so both bound by the identical cutoff instant. */
  private recentlyViewedCutoff(): Date {
    const env = loadEnv();
    return new Date(Date.now() - env.RECENTLY_VIEWED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  }

  async recordProductView(customerId: string, styleId: string): Promise<void> {
    const env = loadEnv();
    const cutoff = this.recentlyViewedCutoff();
    await this.prisma.$transaction(async (tx) => {
      await tx.recentlyViewedProduct.upsert({
        where: { customerId_styleId: { customerId, styleId } },
        create: { customerId, styleId },
        update: { viewedAt: new Date() },
      });
      // Bound the log TWO ways, independently (M22 certification-repair,
      // finding 2 - the original build only implemented the count bound
      // below; a customer viewing fewer than RECENTLY_VIEWED_MAX_ITEMS
      // products could otherwise keep an arbitrarily old view forever):
      // 1) keep only the most recent RECENTLY_VIEWED_MAX_ITEMS rows;
      // 2) delete anything older than RECENTLY_VIEWED_RETENTION_DAYS
      // outright, regardless of count. Both are product-behavior storage
      // bounding, NOT a resolution of the still-UNDER_REVIEW CUST-001/
      // AUD-002 data-retention/deletion policy - see the config comment.
      const keepIds = (
        await tx.recentlyViewedProduct.findMany({
          where: { customerId },
          orderBy: { viewedAt: 'desc' },
          take: env.RECENTLY_VIEWED_MAX_ITEMS,
          select: { id: true },
        })
      ).map((r) => r.id);
      await tx.recentlyViewedProduct.deleteMany({ where: { customerId, id: { notIn: keepIds } } });
      await tx.recentlyViewedProduct.deleteMany({ where: { customerId, viewedAt: { lt: cutoff } } });
    });
  }

  async listRecentlyViewed(customerId: string, limit = 20) {
    const env = loadEnv();
    const rows = await this.prisma.recentlyViewedProduct.findMany({
      where: { customerId, viewedAt: { gte: this.recentlyViewedCutoff() }, style: { lifecycleState: 'PUBLISHED' } },
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
    // M22 certification-repair (finding 3): the original build rejected
    // optedIn=false for ORDER_UPDATES with a 400, framing it as an
    // established rule. No approved decision (CUST-002 in
    // blueprint/DECISION_REGISTER.md only requires per-channel x
    // per-message-type granularity, not a non-opt-outable message type)
    // actually authorizes that - it was an invented product/legal
    // conclusion this build had no authority to make (CUST-001/AUD-002
    // remain UNDER_REVIEW). The preference record now represents
    // whatever value the customer actually sets, for every message type
    // including ORDER_UPDATES. Whether a downstream notification sender
    // is ever legally required to send/suppress a transactional message
    // regardless of this preference is a separate, not-yet-defined
    // policy question, outside this milestone's scope - this service
    // only records the customer's stated preference, it does not decide
    // or enforce delivery semantics.
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
