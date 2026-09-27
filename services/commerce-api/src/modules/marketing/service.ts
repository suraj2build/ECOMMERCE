import type { FastifyInstance } from 'fastify';
import type {
  PrismaClient,
  CustomerSegment,
  MarketingCampaign,
  CommunicationChannel,
  CommunicationMessageType,
  CampaignStatus,
} from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { TRANSACTIONAL_MESSAGE_TYPES } from '../customer-profile/service.js';
import { getMarketingProvider } from './provider.js';

/**
 * Genuine marketing message types a campaign may target - ORDER_UPDATES
 * is reserved for transactional messaging (specs/29-notifications.md,
 * M26+, unbuilt) and is never a valid campaign messageType, even though
 * the enum itself is shared with M22's CommunicationPreference.
 */
const MARKETING_MESSAGE_TYPES: ReadonlySet<CommunicationMessageType> = new Set([
  'OFFERS_AND_PROMOTIONS',
  'PRODUCT_RECOMMENDATIONS',
  'NEWSLETTER',
]);

export interface CreateSegmentInput {
  name: string;
  description?: string;
  minLifetimeOrderCount?: number;
  minLifetimeSpend?: number;
  loyaltyTierId?: string;
}

export interface CreateCampaignInput {
  name: string;
  channel: CommunicationChannel;
  messageType: CommunicationMessageType;
  subject?: string;
  content: string;
  segmentId?: string;
  scheduledAt?: string;
}

export interface CampaignSendSummary {
  campaign: MarketingCampaign;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
}

/**
 * Marketing (M25, specs/24-marketing.md): customer segmentation,
 * campaign scheduling, and outbound messaging via the provider
 * abstraction in `provider.ts`. Deliberately reuses the EXISTING
 * `CommunicationChannel`/`CommunicationMessageType` enums and the
 * EXISTING per-customer `CommunicationPreference` opt-in matrix (M22,
 * CUST-002) rather than inventing a second consent model - a customer
 * opted out of a channel/message-type combination is never sent a
 * campaign on it, full stop.
 */
export class MarketingService {
  constructor(private readonly fastify: FastifyInstance) {}
  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  async createSegment(input: CreateSegmentInput, actorStaffId: string): Promise<CustomerSegment> {
    if (input.loyaltyTierId) {
      const tier = await this.prisma.loyaltyTier.findUnique({ where: { id: input.loyaltyTierId } });
      if (!tier) throw new NotFoundError('Loyalty tier not found');
    }
    const segment = await this.prisma.customerSegment.create({
      data: {
        name: input.name,
        description: input.description,
        minLifetimeOrderCount: input.minLifetimeOrderCount,
        minLifetimeSpend: input.minLifetimeSpend,
        loyaltyTierId: input.loyaltyTierId,
        createdByStaffId: actorStaffId,
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'marketing.segment.create',
      entityType: 'CustomerSegment',
      entityId: segment.id,
      newValue: { name: segment.name },
    });
    return segment;
  }

  async listSegments(): Promise<CustomerSegment[]> {
    return this.prisma.customerSegment.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /**
   * Live segment membership - resolved fresh on every call from
   * customer/order/loyalty data, never a stored snapshot (no
   * generalized query DSL/rule engine, per this phase's own "no
   * general workflow engine" boundary). Returns customer IDs only -
   * never full customer rows - so a caller can never receive more PII
   * than the ID needed for send/count purposes (data minimization,
   * `acceptance/m25-marketing.md`).
   */
  async resolveSegmentCustomerIds(segmentId: string): Promise<Set<string>> {
    const segment = await this.prisma.customerSegment.findUnique({ where: { id: segmentId } });
    if (!segment) throw new NotFoundError('Segment not found');

    let ids: Set<string> | null = null;

    if (segment.minLifetimeOrderCount != null || segment.minLifetimeSpend != null) {
      const grouped = await this.prisma.order.groupBy({
        by: ['customerId'],
        where: { customerId: { not: null } },
        _count: { _all: true },
        _sum: { grandTotal: true },
      });
      ids = new Set(
        grouped
          .filter(
            (g) =>
              (segment.minLifetimeOrderCount == null || g._count._all >= segment.minLifetimeOrderCount) &&
              (segment.minLifetimeSpend == null || Number(g._sum.grandTotal ?? 0) >= Number(segment.minLifetimeSpend)),
          )
          .map((g) => g.customerId as string),
      );
    }

    if (segment.loyaltyTierId) {
      const tierCustomers = await this.prisma.loyaltyAccount.findMany({
        where: { currentTierId: segment.loyaltyTierId },
        select: { customerId: true },
      });
      const tierSet = new Set(tierCustomers.map((c) => c.customerId));
      ids = ids ? new Set([...ids].filter((id) => tierSet.has(id))) : tierSet;
    }

    if (ids !== null) return ids;

    // A segment with no criteria at all matches every customer.
    const all = await this.prisma.customer.findMany({ select: { id: true } });
    return new Set(all.map((c) => c.id));
  }

  /** Recipient COUNT only - never the underlying customer list (data minimization). */
  async previewRecipientCount(segmentId?: string): Promise<number> {
    if (!segmentId) return this.prisma.customer.count();
    return (await this.resolveSegmentCustomerIds(segmentId)).size;
  }

  async createCampaign(input: CreateCampaignInput, actorStaffId: string): Promise<MarketingCampaign> {
    if (!MARKETING_MESSAGE_TYPES.has(input.messageType)) {
      throw new ValidationError(
        'Campaign messageType must be a marketing message type (OFFERS_AND_PROMOTIONS, PRODUCT_RECOMMENDATIONS, or NEWSLETTER) - ORDER_UPDATES is reserved for transactional messaging',
      );
    }
    if (input.segmentId) {
      const segment = await this.prisma.customerSegment.findUnique({ where: { id: input.segmentId } });
      if (!segment) throw new NotFoundError('Segment not found');
    }
    const campaign = await this.prisma.marketingCampaign.create({
      data: {
        name: input.name,
        channel: input.channel,
        messageType: input.messageType,
        subject: input.subject,
        content: input.content,
        segmentId: input.segmentId,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        createdByStaffId: actorStaffId,
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'marketing.campaign.create',
      entityType: 'MarketingCampaign',
      entityId: campaign.id,
      newValue: { name: campaign.name, channel: campaign.channel, messageType: campaign.messageType },
    });
    return campaign;
  }

  async listCampaigns(): Promise<MarketingCampaign[]> {
    return this.prisma.marketingCampaign.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getCampaign(id: string): Promise<MarketingCampaign> {
    const campaign = await this.prisma.marketingCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundError('Campaign not found');
    return campaign;
  }

  async cancelCampaign(id: string, actorStaffId: string): Promise<MarketingCampaign> {
    const result = await this.prisma.marketingCampaign.updateMany({
      where: { id, status: { in: ['DRAFT', 'SCHEDULED'] } },
      data: { status: 'CANCELLED' },
    });
    if (result.count === 0) {
      throw new ValidationError('Campaign cannot be cancelled from its current status');
    }
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'marketing.campaign.cancel',
      entityType: 'MarketingCampaign',
      entityId: id,
    });
    return this.getCampaign(id);
  }

  private async isOptedIn(
    customerId: string,
    channel: CommunicationChannel,
    messageType: CommunicationMessageType,
  ): Promise<boolean> {
    const pref = await this.prisma.communicationPreference.findUnique({
      where: { customerId_channel_messageType: { customerId, channel, messageType } },
    });
    if (pref) return pref.optedIn;
    // No explicit row: mirrors CustomerProfileService.getCommunicationPreferences's
    // own default exactly (transactional types default opted-in; every
    // marketing type defaults opted-OUT until explicit opt-in) - the
    // SAME single source of truth, not a second, divergent definition.
    return TRANSACTIONAL_MESSAGE_TYPES.has(messageType);
  }

  /**
   * Compare-and-swap claim of the SENDING status - the serialization
   * point that makes two genuinely concurrent `sendCampaign` calls on
   * the SAME campaign converge to exactly one sender, never a double
   * send (the same idiom `RefundService.claimProcessing` established).
   * A campaign stuck in SENDING past `MARKETING_SENDING_STALE_SECONDS`
   * (the process that claimed it crashed mid-send) is safe to reclaim.
   */
  private async claimSending(campaignId: string): Promise<{ claimed: boolean; campaign: MarketingCampaign }> {
    const staleCutoff = new Date(Date.now() - loadEnv().MARKETING_SENDING_STALE_SECONDS * 1000);
    const result = await this.prisma.marketingCampaign.updateMany({
      where: {
        id: campaignId,
        OR: [{ status: { in: ['DRAFT', 'SCHEDULED'] } }, { status: 'SENDING', updatedAt: { lt: staleCutoff } }],
      },
      data: { status: 'SENDING' },
    });
    const campaign = await this.prisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    return { claimed: result.count > 0, campaign };
  }

  /**
   * Sends a campaign to its resolved recipient set. Idempotent per
   * (campaignId, customerId) via `CampaignDelivery`'s own unique
   * constraint - a retried/reclaimed send skips any customer already
   * processed, so a crash-then-retry never double-messages anyone who
   * already received (or was correctly skipped for) this campaign.
   * Never fabricates a delivery outcome: each recipient's row records
   * the provider's ACTUAL result (SENT/FAILED) or an honest
   * SKIPPED_OPTOUT/SKIPPED_NO_ADDRESS reason.
   */
  async sendCampaign(campaignId: string, actorStaffId: string): Promise<CampaignSendSummary> {
    const { claimed, campaign: current } = await this.claimSending(campaignId);
    if (!claimed) {
      // Another sender already owns this campaign (still SENDING within
      // the staleness window), or it already reached a terminal status
      // (SENT/FAILED/CANCELLED) - a safe no-op either way, never an error.
      return { campaign: current, sentCount: 0, failedCount: 0, skippedCount: 0 };
    }

    try {
      const recipientIds = current.segmentId
        ? [...(await this.resolveSegmentCustomerIds(current.segmentId))]
        : (await this.prisma.customer.findMany({ select: { id: true } })).map((c) => c.id);

      const customers = await this.prisma.customer.findMany({
        where: { id: { in: recipientIds } },
        select: { id: true, email: true, mobile: true },
      });

      const provider = getMarketingProvider(loadEnv().MARKETING_PROVIDER);
      let sentCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      for (const customer of customers) {
        const existing = await this.prisma.campaignDelivery.findUnique({
          where: { campaignId_customerId: { campaignId, customerId: customer.id } },
        });
        if (existing) continue;

        const optedIn = await this.isOptedIn(customer.id, current.channel, current.messageType);
        if (!optedIn) {
          await this.prisma.campaignDelivery.create({
            data: { campaignId, customerId: customer.id, status: 'SKIPPED_OPTOUT' },
          });
          skippedCount++;
          continue;
        }

        // PUSH has no device-token registration flow anywhere in this
        // codebase (a documented scope boundary, the same kind M19's
        // photo-upload and M08's S3-client gaps each recorded) - it is
        // never sendable, always SKIPPED_NO_ADDRESS.
        const to = current.channel === 'EMAIL' ? customer.email : current.channel === 'PUSH' ? null : customer.mobile;
        if (!to) {
          await this.prisma.campaignDelivery.create({
            data: { campaignId, customerId: customer.id, status: 'SKIPPED_NO_ADDRESS' },
          });
          skippedCount++;
          continue;
        }

        const result = await provider.send({
          to,
          channel: current.channel,
          subject: current.subject ?? undefined,
          content: current.content,
          idempotencyKey: `${campaignId}:${customer.id}`,
        });

        if (result.status === 'SENT') {
          await this.prisma.campaignDelivery.create({
            data: {
              campaignId,
              customerId: customer.id,
              status: 'SENT',
              providerMessageId: result.providerMessageId,
              sentAt: new Date(),
            },
          });
          sentCount++;
        } else {
          await this.prisma.campaignDelivery.create({
            data: { campaignId, customerId: customer.id, status: 'FAILED', errorMessage: result.errorMessage },
          });
          failedCount++;
        }
      }

      const finalStatus: CampaignStatus = sentCount === 0 && failedCount > 0 ? 'FAILED' : 'SENT';
      const updated = await this.prisma.marketingCampaign.update({
        where: { id: campaignId },
        data: { status: finalStatus, sentAt: new Date() },
      });
      await recordAudit(this.prisma, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'marketing.campaign.send',
        entityType: 'MarketingCampaign',
        entityId: campaignId,
        newValue: { sentCount, failedCount, skippedCount, status: finalStatus },
      });
      return { campaign: updated, sentCount, failedCount, skippedCount };
    } catch (err) {
      await this.prisma.marketingCampaign.update({ where: { id: campaignId }, data: { status: 'FAILED' } });
      throw err;
    }
  }
}
