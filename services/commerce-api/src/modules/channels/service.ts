import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Channel, ChannelListing } from '@fcp/db';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { withUniqueConstraintCheck } from '../../lib/prisma-error-mapping.js';
import { CatalogService } from '../catalog/service.js';
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

  constructor(private readonly fastify: FastifyInstance) {
    this.catalog = new CatalogService(fastify);
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
      include: { style: true, colour: true, size: true },
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

    return {
      externalId: sku.skuCode,
      title: resolveTemplate(config.titleTemplate ?? DEFAULT_TITLE_TEMPLATE, templateValues),
      description: resolveTemplate(config.descriptionTemplate ?? DEFAULT_DESCRIPTION_TEMPLATE, templateValues),
      price: Number(activePrice!.sellingPrice),
      currency: 'INR',
      availability: 'in_stock',
      imageUrl: image?.url ?? null,
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

  async publishSku(channelId: string, skuId: string, actorStaffId: string): Promise<ChannelListing> {
    const channel = await this.getChannel(channelId);
    const listing = await this.prisma.channelListing.upsert({
      where: { channelId_skuId: { channelId, skuId } },
      update: {},
      create: { channelId, skuId, status: 'NOT_PUBLISHED' },
    });

    let item: ChannelFeedItem;
    try {
      item = await this.buildFeedItem(skuId, (channel.config as ChannelFieldMapConfig) ?? {});
    } catch (err) {
      // A validation failure (not channel-publishable) never calls the
      // external provider at all - it is recorded exactly like a
      // provider-side failure, so the attempt history is complete either way.
      const errorMessage = err instanceof Error ? err.message : 'Unknown validation error';
      return this.recordFailedAttempt(listing, 'PUBLISH', errorMessage, actorStaffId);
    }

    const provider = getChannelProvider(channel.providerName);
    try {
      const result = await provider.publish({
        channelKey: channel.key,
        config: (channel.config as Record<string, unknown>) ?? {},
        item,
        idempotencyKey: `${channelId}:${skuId}`,
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
          },
        });
        await recordAudit(this.prisma, {
          actorType: 'STAFF',
          actorStaffId,
          action: 'channel.listing.publish',
          entityType: 'ChannelListing',
          entityId: listing.id,
          newValue: { channelId, skuId, externalId: result.externalId },
        });
        return updated;
      }
      return this.recordFailedAttempt(listing, 'PUBLISH', result.errorMessage ?? 'Provider rejected the listing', actorStaffId, item);
    } catch (err) {
      // The provider call itself threw (outage/timeout) - recorded
      // honestly as a failure with a retry count, never silently swallowed.
      const errorMessage = err instanceof Error ? err.message : 'Unknown provider error';
      return this.recordFailedAttempt(listing, 'PUBLISH', errorMessage, actorStaffId, item);
    }
  }

  async unpublishSku(channelId: string, skuId: string, actorStaffId: string): Promise<ChannelListing> {
    const channel = await this.getChannel(channelId);
    const listing = await this.prisma.channelListing.findUnique({ where: { channelId_skuId: { channelId, skuId } } });
    if (!listing) throw new NotFoundError('Channel listing not found');
    if (listing.status !== 'PUBLISHED' || !listing.externalId) {
      throw new ValidationError('Listing is not currently published on this channel');
    }

    const provider = getChannelProvider(channel.providerName);
    try {
      const result = await provider.unpublish({
        channelKey: channel.key,
        config: (channel.config as Record<string, unknown>) ?? {},
        externalId: listing.externalId,
        idempotencyKey: `${channelId}:${skuId}`,
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
      return this.recordFailedAttempt(listing, 'UNPUBLISH', result.errorMessage ?? 'Provider rejected the unpublish', actorStaffId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown provider error';
      return this.recordFailedAttempt(listing, 'UNPUBLISH', errorMessage, actorStaffId);
    }
  }

  /**
   * A failed publish/unpublish attempt is always recorded honestly -
   * both on the listing (FAILED status, lastError, incremented
   * retryCount, for reconciliation) and as its own immutable
   * `ChannelPublicationAttempt` row (full history, never overwritten).
   */
  private async recordFailedAttempt(
    listing: ChannelListing,
    action: 'PUBLISH' | 'UNPUBLISH',
    errorMessage: string,
    actorStaffId: string,
    requestPayload?: unknown,
  ): Promise<ChannelListing> {
    const updated = await this.prisma.channelListing.update({
      where: { id: listing.id },
      data: { status: 'FAILED', lastError: errorMessage, retryCount: { increment: 1 } },
    });
    await this.prisma.channelPublicationAttempt.create({
      data: {
        channelListingId: listing.id,
        action,
        status: 'FAILURE',
        requestPayload: requestPayload ? (requestPayload as object) : undefined,
        errorMessage,
        actorStaffId,
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: `channel.listing.${action.toLowerCase()}_failed`,
      entityType: 'ChannelListing',
      entityId: listing.id,
      newValue: { errorMessage },
    });
    return updated;
  }

  async listAttempts(channelListingId: string) {
    return this.prisma.channelPublicationAttempt.findMany({
      where: { channelListingId },
      orderBy: { attemptedAt: 'desc' },
    });
  }
}
