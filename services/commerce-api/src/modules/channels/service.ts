import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Channel, ChannelListing } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { withUniqueConstraintCheck } from '../../lib/prisma-error-mapping.js';
import { CatalogService } from '../catalog/service.js';
import { InventoryService } from '../inventory/service.js';
import { getChannelProvider, type ChannelFeedItem } from './provider.js';

export interface CreateChannelInput {
  key: string;
  name: string;
  providerName: string;
  config?: Record<string, unknown>;
}

/**
 * Channel-specific field mapping (CHAN-001: "expressed as configuration,
 * not core schema"). A template string may reference `{style.name}`,
 * `{colour.name}`, `{size.label}`, `{sku.skuCode}` - resolved against the
 * real catalog data, never a hard-coded per-channel branch in code. This
 * is deliberately a flat template substitution, not a generalized rules/
 * workflow engine (this phase's own explicit boundary).
 */
export interface ChannelFieldMapConfig {
  titleTemplate?: string;
  descriptionTemplate?: string;
}

const DEFAULT_TITLE_TEMPLATE = '{style.name} - {colour.name} - {size.label}';
const DEFAULT_DESCRIPTION_TEMPLATE = '{style.name} in {colour.name}, size {size.label}';

function resolveTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([\w.]+)\}/g, (match, token: string) => values[token] ?? match);
}

/**
 * Social / Channel Publishing (M26, specs/25-social-channel-publishing.md,
 * CHAN-001 - adapter/contract architecture only). Publishing depends only
 * on the `ChannelProvider` interface (provider.ts), never a marketplace
 * SDK directly - the same boundary discipline `MarketingProvider`/
 * `ShippingProvider`/`PaymentProvider` already established. The core
 * Product Master (Style/Sku/Price) is read-only from this service's
 * point of view: publishing NEVER writes back to catalog/price/
 * inventory - internal commerce remains the source of truth, a channel
 * is purely a downstream projection.
 */
export class ChannelService {
  private readonly catalog: CatalogService;
  private readonly inventory: InventoryService;

  constructor(private readonly fastify: FastifyInstance) {
    this.catalog = new CatalogService(fastify);
    this.inventory = new InventoryService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  async createChannel(input: CreateChannelInput, actorStaffId: string): Promise<Channel> {
    const channel = await withUniqueConstraintCheck(
      () =>
        this.prisma.channel.create({
          data: {
            key: input.key,
            name: input.name,
            providerName: input.providerName,
            config: (input.config ?? {}) as object,
          },
        }),
      'Channel',
    );
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'channel.create',
      entityType: 'Channel',
      entityId: channel.id,
      newValue: { key: channel.key, providerName: channel.providerName },
    });
    return channel;
  }

  async listChannels(): Promise<Channel[]> {
    return this.prisma.channel.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getChannel(id: string): Promise<Channel> {
    const channel = await this.prisma.channel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundError('Channel not found');
    return channel;
  }

  /**
   * Builds the channel-mapped feed item for one SKU from core catalog
   * data alone - no marketplace-specific field is ever read from Style/
   * Sku/Price themselves, only from `Channel.config` (configuration).
   * Used both by `publishSku` (the real publish path) and by
   * `previewFeedItem` (a read-only preview requiring no channel/DB
   * writes, used by the acceptance test's "feed generation" proof).
   */
  async buildFeedItem(skuId: string, config: ChannelFieldMapConfig): Promise<ChannelFeedItem> {
    const sku = await this.prisma.sku.findUnique({
      where: { id: skuId },
      include: { style: { include: { brand: true } }, colour: true, size: true },
    });
    if (!sku) throw new NotFoundError('Sku not found');

    const activePrice = await this.catalog.getActivePrice(sku.styleId, sku.colourId);
    const image = await this.prisma.productMedia.findFirst({
      where: { styleId: sku.styleId, OR: [{ colourId: sku.colourId }, { colourId: null }], type: 'IMAGE' },
      orderBy: { sortOrder: 'asc' },
    });

    const templateValues: Record<string, string> = {
      'style.name': sku.style.name,
      'colour.name': sku.colour.name,
      'size.label': sku.size.label,
      'sku.skuCode': sku.skuCode,
    };

    const isPublishableCatalogEntry = sku.style.lifecycleState === 'PUBLISHED' && activePrice !== null && sku.isActive;
    if (!isPublishableCatalogEntry) {
      throw new ValidationError(
        'SKU is not channel-publishable: the style must be PUBLISHED, have an active price, and the SKU must be active',
      );
    }

    // M26 independent-review certification repair (2026-09-28): channel
    // availability is derived from the SAME canonical cross-location
    // sellable-inventory formula the certified public PDP (M11) uses -
    // InventoryService.getAvailableToSellBySku, never a fabricated
    // constant and never a second, independently-invented formula.
    // Publishability (checked above) and current stock level are
    // deliberately kept separate: a catalog-publishable SKU with zero
    // available-to-sell inventory is still a valid feed item, correctly
    // marked out_of_stock - this build does not invent an auto-unpublish-
    // at-zero-stock policy, since no such requirement exists in the
    // approved spec.
    const availableQty = (await this.inventory.getAvailableToSellBySku([sku.id])).get(sku.id) ?? 0;

    // LR-004: absolute public URLs for the product page and image.
    const site = loadEnv().STOREFRONT_PUBLIC_URL?.replace(/\/$/, '') ?? null;
    const absolute = (url: string | null | undefined) => (!url ? null : /^https?:\/\//.test(url) ? url : site ? `${site}${url.startsWith('/') ? '' : '/'}${url}` : null);

    return {
      externalId: sku.skuCode,
      title: resolveTemplate(config.titleTemplate ?? DEFAULT_TITLE_TEMPLATE, templateValues),
      description: resolveTemplate(config.descriptionTemplate ?? DEFAULT_DESCRIPTION_TEMPLATE, templateValues),
      price: Number(activePrice!.sellingPrice),
      currency: 'INR',
      availability: availableQty > 0 ? 'in_stock' : 'out_of_stock',
      imageUrl: absolute(image?.url),
      itemGroupId: sku.style.styleCode,
      link: site ? `${site}/product/${sku.styleId}` : null,
      regularPrice: Number(activePrice!.mrp),
      brand: sku.style.brand.name,
      color: sku.colour.name,
      size: sku.size.label,
      gender: sku.style.gender ?? null,
    };
  }

  /** Read-only feed preview - proves field mapping without any channel state mutation (acceptance test requirement). */
  async previewFeedItem(channelId: string, skuId: string): Promise<ChannelFeedItem> {
    const channel = await this.getChannel(channelId);
    return this.buildFeedItem(skuId, (channel.config as ChannelFieldMapConfig) ?? {});
  }

  async listListings(channelId: string): Promise<ChannelListing[]> {
    return this.prisma.channelListing.findMany({ where: { channelId }, orderBy: { updatedAt: 'desc' } });
  }

  /**
   * M26 independent-review certification repair (2026-09-28, sections
   * 8-9): the durable, DB-backed in-flight claim for one publish/
   * unpublish attempt on a given listing - the same PENDING/FAILED ->
   * PROCESSING compare-and-set idiom RefundService.claimProcessing
   * already established (REFUND_PROCESSING_STALE_SECONDS's twin here is
   * CHANNEL_PUBLISH_STALE_SECONDS), but implemented with an explicit
   * `SELECT ... FOR UPDATE` row lock (the same idiom
   * InventoryService.lockBalance/lockReservation already use) rather
   * than a bare `updateMany` CAS: unlike Refund/Marketing (where every
   * prior status is equally eligible to re-claim), `unpublishSku` has a
   * NARROWER eligibility rule that depends on the status the row had at
   * the EXACT moment of claim - a plain `updateMany` tells a caller
   * *whether* it won the claim but not *what the row was* immediately
   * before, leaving a real window for two sequential claims (one after
   * the other has already finished and moved on) to each look like a
   * fresh, valid attempt from a caller's stale pre-claim read. Locking
   * the row first and reading its status inside that same lock closes
   * that window: the returned `previousStatus` is the row's true state
   * at the instant this claim was granted, never stale.
   *
   * Claimable from ANY current status (NOT_PUBLISHED, PUBLISHED - a
   * legitimate resync, FAILED, AMBIGUOUS_RECONCILIATION_REQUIRED - an
   * operator-safe retry) except a still-fresh PROCESSING claim held by
   * another in-flight request. The UPDATE inside this transaction is
   * committed to Postgres BEFORE any external provider call is ever
   * made (the transaction itself commits before this method returns),
   * so it IS the durable evidence that an attempt began - the same
   * architectural role a `CampaignDelivery` row created PENDING before
   * dispatch plays for marketing (M25), adapted to a long-lived,
   * resyncable listing row rather than a create-once delivery row.
   *
   * M26 independent-review certification repair (2026-09-29, Blocker 1 -
   * provider idempotency identity): this same claim transaction also
   * resolves the durable operation identity (`currentOperationId`) the
   * caller will build the provider-facing idempotency key from.
   * Reclaiming a still-genuinely-open operation (AMBIGUOUS_
   * RECONCILIATION_REQUIRED, or a stale PROCESSING claim - both mean
   * "the previous attempt's outcome is unknown, this IS that same
   * attempt being retried/reconciled") REUSES the row's existing
   * `currentOperationId`, so a real provider sees the identical key and
   * can safely de-duplicate. Claiming from any SETTLED status
   * (NOT_PUBLISHED, PUBLISHED, FAILED) mints a BRAND NEW id, since that
   * is by definition a genuinely new logical operation (a first
   * publish, a resync with presumably different content, or a retry
   * after a DEFINITE - not ambiguous - rejection).
   */
  private async claimProcessing(
    listingId: string,
  ): Promise<{ claimed: boolean; listing: ChannelListing; previousStatus: ChannelListing['status']; operationId: string | null }> {
    const staleCutoff = new Date(Date.now() - loadEnv().CHANNEL_PUBLISH_STALE_SECONDS * 1000);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: ChannelListing['status']; updatedAt: Date; currentOperationId: string | null }[]>`
        SELECT "status", "updatedAt", "currentOperationId" FROM "channel_listings" WHERE "id" = ${listingId} FOR UPDATE
      `;
      const row = rows[0];
      if (!row) throw new NotFoundError('Channel listing not found');
      const previousStatus = row.status;
      const isStaleProcessingReclaim = previousStatus === 'PROCESSING' && row.updatedAt < staleCutoff;
      const eligible = previousStatus !== 'PROCESSING' || isStaleProcessingReclaim;
      if (!eligible) {
        const listing = await tx.channelListing.findUniqueOrThrow({ where: { id: listingId } });
        return { claimed: false, listing, previousStatus, operationId: null };
      }
      const reconcilingOpenOperation = previousStatus === 'AMBIGUOUS_RECONCILIATION_REQUIRED' || isStaleProcessingReclaim;
      const operationId = reconcilingOpenOperation && row.currentOperationId ? row.currentOperationId : randomUUID();
      const listing = await tx.channelListing.update({
        where: { id: listingId },
        data: { status: 'PROCESSING', currentOperationId: operationId },
      });
      return { claimed: true, listing, previousStatus, operationId };
    });
  }

  /** Releases a held PROCESSING claim back to `status` without recording an attempt - used when a claimed request turns out to be ineligible (nothing changed, so nothing was attempted). */
  private async releaseClaim(listingId: string, status: ChannelListing['status']): Promise<void> {
    await this.prisma.channelListing.update({ where: { id: listingId }, data: { status } });
  }

  async publishSku(channelId: string, skuId: string, actorStaffId: string): Promise<ChannelListing> {
    const channel = await this.getChannel(channelId);
    // Postgres's own ON CONFLICT (the upsert's implementation) makes
    // first-ever-listing creation safe under real concurrency without
    // needing claimProcessing's own CAS - two concurrent FIRST publish
    // calls for the same (channelId, skuId) converge to the SAME row
    // here; claimProcessing below is what then serializes the actual
    // provider dispatch.
    const existing = await this.prisma.channelListing.upsert({
      where: { channelId_skuId: { channelId, skuId } },
      update: {},
      create: { channelId, skuId, status: 'NOT_PUBLISHED' },
    });

    const { claimed, listing, operationId } = await this.claimProcessing(existing.id);
    if (!claimed) {
      // Another request currently holds a live (non-stale) claim on this
      // exact listing - converge to whatever it is doing rather than
      // racing a second provider dispatch for the same SKU+channel
      // (independent-review repair, concurrency requirement). No
      // attempt is recorded here: nothing happened on this call.
      return listing;
    }
    // Blocker 1 (2026-09-29): the provider-facing idempotency key.
    // `operationId` is never null here - claimProcessing always resolves
    // one (reused or freshly minted) whenever `claimed` is true.
    const idempotencyKey = `${channelId}:${skuId}:PUBLISH:${operationId}`;

    let item: ChannelFeedItem;
    try {
      item = await this.buildFeedItem(skuId, (channel.config as ChannelFieldMapConfig) ?? {});
    } catch (err) {
      // A validation failure (not channel-publishable) never calls the
      // external provider at all - a DEFINITE, known failure, recorded
      // exactly like one, so the attempt history is complete either way.
      const errorMessage = err instanceof Error ? err.message : 'Unknown validation error';
      return this.recordOutcome(listing, 'PUBLISH', 'FAILED', errorMessage, actorStaffId, operationId);
    }

    let provider: ReturnType<typeof getChannelProvider>;
    try {
      provider = getChannelProvider(channel.providerName);
    } catch (err) {
      // Resolving the provider itself failed (unknown provider name, or
      // the production mock-provider guard) - no external call was ever
      // attempted, so this is a DEFINITE, known failure, never ambiguous.
      // Recorded the same way a validation failure is, and critically
      // NEVER left the claimed listing stuck at PROCESSING with no
      // outcome recorded at all.
      const errorMessage = err instanceof Error ? err.message : 'Unknown provider configuration error';
      return this.recordOutcome(listing, 'PUBLISH', 'FAILED', errorMessage, actorStaffId, operationId, item);
    }
    try {
      const result = await provider.publish({
        channelKey: channel.key,
        config: (channel.config as Record<string, unknown>) ?? {},
        item,
        idempotencyKey,
      });

      if (result.status === 'SUCCESS') {
        const updated = await this.prisma.channelListing.update({
          where: { id: listing.id },
          data: {
            status: 'PUBLISHED',
            externalId: result.externalId,
            lastSyncedAt: new Date(),
            lastError: null,
            payloadSnapshot: item as object,
          },
        });
        await this.prisma.channelPublicationAttempt.create({
          data: {
            channelListingId: listing.id,
            action: 'PUBLISH',
            status: 'SUCCESS',
            requestPayload: item as object,
            responsePayload: result as object,
            actorStaffId,
            operationId,
          },
        });
        await recordAudit(this.prisma, {
          actorType: 'STAFF',
          actorStaffId,
          action: 'channel.listing.publish',
          entityType: 'ChannelListing',
          entityId: listing.id,
          newValue: { channelId, skuId, externalId: result.externalId, availability: item.availability },
        });
        return updated;
      }
      // A DEFINITE provider rejection - the provider returned, it did
      // not throw, so the outcome is genuinely known.
      return this.recordOutcome(listing, 'PUBLISH', 'FAILED', result.errorMessage ?? 'Provider rejected the listing', actorStaffId, operationId, item, result as object);
    } catch (err) {
      // M26 independent-review certification repair (2026-09-28,
      // finding #2): the provider call itself threw/timed out AFTER
      // dispatch - the provider may have accepted the listing before
      // the error reached us. This is NEVER recorded as a definite
      // FAILED: that would claim a certainty this attempt does not
      // have. See ChannelListingStatus.AMBIGUOUS_RECONCILIATION_REQUIRED.
      const errorMessage = err instanceof Error ? err.message : 'Unknown provider error';
      return this.recordOutcome(listing, 'PUBLISH', 'AMBIGUOUS', errorMessage, actorStaffId, operationId, item);
    }
  }

  async unpublishSku(channelId: string, skuId: string, actorStaffId: string): Promise<ChannelListing> {
    const channel = await this.getChannel(channelId);
    const existing = await this.prisma.channelListing.findUnique({ where: { channelId_skuId: { channelId, skuId } } });
    if (!existing) throw new NotFoundError('Channel listing not found');

    const { claimed, listing, previousStatus, operationId } = await this.claimProcessing(existing.id);
    if (!claimed) {
      return listing; // converge to the in-flight claim, never a second dispatch
    }

    // Eligibility is re-checked against `previousStatus` - the row's
    // TRUE state at the exact instant this claim was granted (inside
    // claimProcessing's own row lock), never a stale pre-claim read.
    // Unpublish is attemptable from PUBLISHED (the normal case), a
    // reclaimed stale PROCESSING (an earlier attempt crashed mid-flight
    // - functionally identical to AMBIGUOUS), or
    // AMBIGUOUS_RECONCILIATION_REQUIRED itself (M26 repair, section
    // 12/11 - the operator-safe retry/reconcile path for a prior publish
    // resync or unpublish that ended ambiguous), provided a real
    // externalId exists to attempt against. NOT_PUBLISHED and FAILED
    // have genuinely nothing live known to unpublish. A rejected
    // request releases its claim immediately - nothing was attempted,
    // so nothing is recorded as an attempt.
    const eligiblePrevious = previousStatus === 'PUBLISHED' || previousStatus === 'AMBIGUOUS_RECONCILIATION_REQUIRED' || previousStatus === 'PROCESSING';
    if (!eligiblePrevious || !listing.externalId) {
      await this.releaseClaim(listing.id, previousStatus === 'PROCESSING' ? 'AMBIGUOUS_RECONCILIATION_REQUIRED' : previousStatus);
      throw new ValidationError('Listing is not currently published (or ambiguously published) on this channel');
    }
    // Blocker 1 (2026-09-29): `UNPUBLISH` in the key means a genuine
    // provider outage that leaves ONE listing's PUBLISH ambiguous and a
    // separate UNPUBLISH ambiguous (or vice versa) can never be
    // conflated as "the same already-processed operation" by a real
    // provider, even though both target the same channel+SKU.
    const idempotencyKey = `${channelId}:${skuId}:UNPUBLISH:${operationId}`;

    let provider: ReturnType<typeof getChannelProvider>;
    try {
      provider = getChannelProvider(channel.providerName);
    } catch (err) {
      // Same reasoning as publishSku's own identical guard: no external
      // call was ever attempted, so this is a DEFINITE failure, never
      // ambiguous, and never leaves the listing stuck at PROCESSING.
      const errorMessage = err instanceof Error ? err.message : 'Unknown provider configuration error';
      return this.recordOutcome(listing, 'UNPUBLISH', 'FAILED', errorMessage, actorStaffId, operationId);
    }
    try {
      const result = await provider.unpublish({
        channelKey: channel.key,
        config: (channel.config as Record<string, unknown>) ?? {},
        externalId: listing.externalId!,
        idempotencyKey,
      });
      if (result.status === 'SUCCESS') {
        const updated = await this.prisma.channelListing.update({
          where: { id: listing.id },
          data: { status: 'NOT_PUBLISHED', lastSyncedAt: new Date(), lastError: null },
        });
        await this.prisma.channelPublicationAttempt.create({
          data: {
            channelListingId: listing.id,
            action: 'UNPUBLISH',
            status: 'SUCCESS',
            responsePayload: result as object,
            actorStaffId,
            operationId,
          },
        });
        await recordAudit(this.prisma, {
          actorType: 'STAFF',
          actorStaffId,
          action: 'channel.listing.unpublish',
          entityType: 'ChannelListing',
          entityId: listing.id,
        });
        return updated;
      }
      return this.recordOutcome(listing, 'UNPUBLISH', 'FAILED', result.errorMessage ?? 'Provider rejected the unpublish', actorStaffId, operationId);
    } catch (err) {
      // Same reasoning as publish's own catch block: a thrown/timed-out
      // unpublish may have genuinely removed the listing before the
      // error reached us - never recorded as a definite FAILED.
      const errorMessage = err instanceof Error ? err.message : 'Unknown provider error';
      return this.recordOutcome(listing, 'UNPUBLISH', 'AMBIGUOUS', errorMessage, actorStaffId, operationId);
    }
  }

  /**
   * Records a non-success publish/unpublish outcome honestly - both on
   * the listing (FAILED or AMBIGUOUS_RECONCILIATION_REQUIRED, lastError,
   * incremented retryCount) and as its own immutable
   * `ChannelPublicationAttempt` row (full history, never overwritten).
   * `FAILED` is reserved for a DEFINITE, known rejection (local
   * validation, or the provider explicitly returning failure);
   * `AMBIGUOUS` is reserved for a genuinely unknown outcome (the
   * provider call threw, or a stale claim was reclaimed) - the two are
   * never conflated (M26 independent-review certification repair,
   * finding #2).
   */
  private async recordOutcome(
    listing: ChannelListing,
    action: 'PUBLISH' | 'UNPUBLISH',
    outcome: 'FAILED' | 'AMBIGUOUS',
    errorMessage: string,
    actorStaffId: string,
    operationId: string | null,
    requestPayload?: unknown,
    responsePayload?: unknown,
  ): Promise<ChannelListing> {
    const listingStatus = outcome === 'FAILED' ? 'FAILED' : 'AMBIGUOUS_RECONCILIATION_REQUIRED';
    const attemptStatus = outcome === 'FAILED' ? 'FAILURE' : 'AMBIGUOUS_RECONCILIATION_REQUIRED';
    const updated = await this.prisma.channelListing.update({
      where: { id: listing.id },
      data: { status: listingStatus, lastError: errorMessage, retryCount: { increment: 1 } },
    });
    await this.prisma.channelPublicationAttempt.create({
      data: {
        channelListingId: listing.id,
        action,
        status: attemptStatus,
        requestPayload: requestPayload ? (requestPayload as object) : undefined,
        responsePayload: responsePayload ? (responsePayload as object) : undefined,
        errorMessage,
        actorStaffId,
        operationId,
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: `channel.listing.${action.toLowerCase()}_${outcome.toLowerCase()}`,
      entityType: 'ChannelListing',
      entityId: listing.id,
      newValue: { errorMessage, outcome },
    });
    return updated;
  }

  /**
   * Staff-gated, idempotent, callable sweep (mirrors the existing
   * `POST /loyalty/sweep/vest`, `POST /marketing/sweep/send-due` shape) -
   * reclaims any ChannelListing whose PROCESSING claim has gone stale
   * (the process that took it crashed somewhere between the provider
   * call and recording an outcome) into
   * AMBIGUOUS_RECONCILIATION_REQUIRED. Never guesses a definite
   * SUCCESS/FAILED for a reclaimed row - the same honest-uncertainty
   * discipline as every other AMBIGUOUS_RECONCILIATION_REQUIRED path in
   * this build. A future cron can call this same route a staff operator
   * can call manually today - no general scheduling platform was built.
   */
  async reclaimStaleProcessing(actorStaffId: string): Promise<{ reclaimed: number }> {
    const staleCutoff = new Date(Date.now() - loadEnv().CHANNEL_PUBLISH_STALE_SECONDS * 1000);
    const stale = await this.prisma.channelListing.findMany({
      where: { status: 'PROCESSING', updatedAt: { lt: staleCutoff } },
      select: { id: true },
    });
    let reclaimed = 0;
    for (const { id } of stale) {
      const result = await this.prisma.channelListing.updateMany({
        where: { id, status: 'PROCESSING', updatedAt: { lt: staleCutoff } },
        data: { status: 'AMBIGUOUS_RECONCILIATION_REQUIRED', lastError: 'Reclaimed stale PROCESSING claim - provider outcome unknown', retryCount: { increment: 1 } },
      });
      if (result.count > 0) {
        reclaimed += 1;
        await recordAudit(this.prisma, {
          actorType: 'STAFF',
          actorStaffId,
          action: 'channel.listing.reclaimed_stale',
          entityType: 'ChannelListing',
          entityId: id,
        });
      }
    }
    return { reclaimed };
  }

  /**
   * Staff-gated, idempotent, callable sweep for the other half of M26's
   * repair (sections 4-5): a PUBLISHED listing's `payloadSnapshot`
   * records the availability we last actually told the channel: if
   * canonical inventory has since changed such that the LIVE
   * availability no longer matches that snapshot, the channel's own
   * copy is stale and needs resyncing. Detection is a pure read-time
   * recomputation (no persisted "stale" flag, no new event bus, no
   * background job required to merely detect it) - this sweep is the
   * explicit, callable CORRECTION action, reusing `publishSku` itself
   * (the exact same durable claim + provider call + idempotency key)
   * rather than duplicating any of that machinery. Internal inventory
   * transactions never call this or any channel code synchronously -
   * this sweep is the only thing that couples the two, and only when
   * explicitly invoked.
   */
  async resyncStaleListings(actorStaffId: string): Promise<{ resynced: number; listingIds: string[]; unpublished: number; published: number }> {
    const published = await this.prisma.channelListing.findMany({ where: { status: 'PUBLISHED' }, include: { channel: true } });
    const resyncedIds: string[] = [];
    let unpublished = 0;
    for (const listing of published) {
      let current: ChannelFeedItem;
      try {
        current = await this.buildFeedItem(listing.skuId, (listing.channel.config as ChannelFieldMapConfig) ?? {});
      } catch {
        // LR-004: the style was unpublished/archived, lost its price or the
        // SKU was deactivated - take it off the channel.
        await this.unpublishSku(listing.channelId, listing.skuId, actorStaffId);
        unpublished += 1;
        continue;
      }
      // LR-004: any change the channel shows (stock, price, sale price,
      // title, image, link) makes the channel's copy stale.
      const snapshot = (listing.payloadSnapshot ?? {}) as Partial<ChannelFeedItem>;
      const fields = ['availability', 'price', 'regularPrice', 'title', 'description', 'imageUrl', 'link'] as const;
      if (fields.some((field) => snapshot[field] !== current[field])) {
        await this.publishSku(listing.channelId, listing.skuId, actorStaffId);
        resyncedIds.push(listing.id);
      }
    }
    const newlyPublished = await this.publishNewSkus(actorStaffId);
    return { resynced: resyncedIds.length, listingIds: resyncedIds, unpublished, published: newlyPublished };
  }

  /** LR-004: channels configured with `publishAll: true` carry every
   * storefront-visible SKU; newly published ones are added here. */
  private async publishNewSkus(actorStaffId: string, limitPerChannel = 200): Promise<number> {
    const channels = await this.prisma.channel.findMany();
    let count = 0;
    for (const channel of channels) {
      if ((channel.config as { publishAll?: unknown } | null)?.publishAll !== true) continue;
      const skus = await this.prisma.sku.findMany({
        where: {
          isActive: true,
          style: { lifecycleState: 'PUBLISHED' },
          channelListings: { none: { channelId: channel.id, status: { not: 'NOT_PUBLISHED' } } },
        },
        select: { id: true, styleId: true, colourId: true },
        orderBy: { id: 'asc' },
        take: limitPerChannel,
      });
      for (const sku of skus) {
        if (!(await this.catalog.getActivePrice(sku.styleId, sku.colourId))) continue;
        await this.publishSku(channel.id, sku.id, actorStaffId);
        count += 1;
      }
    }
    return count;
  }

  async listAttempts(channelListingId: string) {
    return this.prisma.channelPublicationAttempt.findMany({
      where: { channelListingId },
      orderBy: { attemptedAt: 'desc' },
    });
  }
}
