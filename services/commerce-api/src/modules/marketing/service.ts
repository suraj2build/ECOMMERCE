import type { FastifyInstance } from 'fastify';
import {
  Prisma,
  type PrismaClient,
  type CustomerSegment,
  type MarketingCampaign,
  type CommunicationChannel,
  type CommunicationMessageType,
  type CampaignStatus,
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
  /** A recipient whose provider outcome is genuinely unknown (Blocker 4) - never counted as sent or failed. */
  ambiguousCount: number;
  /** Whether THIS call actually won the campaign-level send claim - false is always a safe no-op, never an error. */
  claimed: boolean;
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
    // M25 independent-review certification-repair (Blocker 3): a
    // campaign created WITH a scheduledAt is genuinely committed to
    // that schedule (SCHEDULED), not left in DRAFT where the automatic
    // due-sweep below would never find it - DRAFT means "no schedule
    // exists yet; only an explicit manual send can dispatch this."
    const campaign = await this.prisma.marketingCampaign.create({
      data: {
        name: input.name,
        channel: input.channel,
        messageType: input.messageType,
        subject: input.subject,
        content: input.content,
        segmentId: input.segmentId,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        status: input.scheduledAt ? 'SCHEDULED' : 'DRAFT',
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
   * point that makes two genuinely concurrent send attempts on the SAME
   * campaign converge to exactly one sender, never a double send (the
   * same idiom `RefundService.claimProcessing` established).
   *
   * `dueOnly: true` (the automatic sweep, Blocker 3) claims ONLY a
   * campaign that is genuinely due - status = SCHEDULED AND
   * scheduledAt <= now - and nothing else: a DRAFT campaign (no
   * schedule committed yet) or a SCHEDULED campaign whose scheduledAt
   * is still in the future is never touched by this path, and a stuck
   * SENDING campaign is never silently reclaimed by the automatic
   * sweep either. `dueOnly: false` (an explicit staff-triggered manual
   * send) keeps the original, broader behavior unchanged - it may
   * dispatch a DRAFT or a not-yet-due SCHEDULED campaign immediately
   * (an intentional, separate, explicit operation - it does not
   * redefine what the automatic due-sweep itself will pick up), and it
   * also reclaims a campaign stuck in SENDING past
   * `MARKETING_SENDING_STALE_SECONDS` (the process that claimed it,
   * manually or via the sweep, crashed mid-send) - stale-SENDING
   * recovery is deliberately a manual-only path, never something the
   * automatic sweep does on its own.
   */
  private async claimForSend(
    campaignId: string,
    options: { dueOnly: boolean },
  ): Promise<{ claimed: boolean; campaign: MarketingCampaign }> {
    const now = new Date();
    const where: Prisma.MarketingCampaignWhereInput = options.dueOnly
      ? { id: campaignId, status: 'SCHEDULED', scheduledAt: { lte: now } }
      : {
          id: campaignId,
          OR: [
            { status: { in: ['DRAFT', 'SCHEDULED'] } },
            {
              status: 'SENDING',
              updatedAt: { lt: new Date(now.getTime() - loadEnv().MARKETING_SENDING_STALE_SECONDS * 1000) },
            },
          ],
        };
    const result = await this.prisma.marketingCampaign.updateMany({ where, data: { status: 'SENDING' } });
    const campaign = await this.prisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    return { claimed: result.count > 0, campaign };
  }

  /**
   * Dispatches a single recipient (M25 independent-review certification-
   * repair, Blocker 4). A durable PENDING claim is written BEFORE the
   * external provider call - the `CampaignDelivery`
   * `@@unique([campaignId, customerId])` constraint is what makes this
   * claim atomic: a concurrent worker's own create() for the SAME
   * recipient fails with a unique-constraint violation (P2002) and
   * safely no-ops rather than racing a second provider call. A PENDING
   * row found stale (its owning process crashed somewhere between the
   * provider call and recording SENT/FAILED) is reclaimed directly into
   * AMBIGUOUS_RECONCILIATION_REQUIRED, never silently redispatched -
   * this codebase's provider abstraction does not guarantee the
   * idempotent-retry safety a blind resend would need. A provider call
   * that itself throws/times out is recorded the same honest way: the
   * outcome is genuinely unknown, never assumed FAILED (which would
   * claim a certainty we don't have) and never auto-retried.
   */
  private async dispatchToRecipient(
    current: MarketingCampaign,
    customer: { id: string; email: string | null; mobile: string },
  ): Promise<'SENT' | 'FAILED' | 'SKIPPED' | 'AMBIGUOUS' | 'NOOP'> {
    const staleCutoff = new Date(Date.now() - loadEnv().MARKETING_DELIVERY_STALE_SECONDS * 1000);
    const existing = await this.prisma.campaignDelivery.findUnique({
      where: { campaignId_customerId: { campaignId: current.id, customerId: customer.id } },
    });

    if (existing && existing.status !== 'PENDING') {
      return 'NOOP'; // a terminal outcome is already recorded for this recipient - never reprocessed
    }

    if (existing && existing.status === 'PENDING') {
      if (existing.updatedAt >= staleCutoff) {
        return 'NOOP'; // another worker is actively holding this claim right now
      }
      // Stale PENDING: reclaim it directly as ambiguous - a CAS so a
      // concurrent reclaimer racing the SAME stale row never both win.
      const reclaimed = await this.prisma.campaignDelivery.updateMany({
        where: { id: existing.id, status: 'PENDING', updatedAt: { lt: staleCutoff } },
        data: { status: 'AMBIGUOUS_RECONCILIATION_REQUIRED', errorMessage: 'Reclaimed stale PENDING claim - provider outcome unknown' },
      });
      return reclaimed.count > 0 ? 'AMBIGUOUS' : 'NOOP';
    }

    // No row at all yet - the eligibility checks below have no external
    // side effect, so it is always safe to redo them on any retry.
    const optedIn = await this.isOptedIn(customer.id, current.channel, current.messageType);
    if (!optedIn) {
      await this.createDeliveryIfAbsent(current.id, customer.id, 'SKIPPED_OPTOUT');
      return 'SKIPPED';
    }
    // PUSH has no device-token registration flow anywhere in this
    // codebase (a documented scope boundary, the same kind M19's
    // photo-upload and M08's S3-client gaps each recorded) - it is
    // never sendable, always SKIPPED_NO_ADDRESS.
    const to = current.channel === 'EMAIL' ? customer.email : current.channel === 'PUSH' ? null : customer.mobile;
    if (!to) {
      await this.createDeliveryIfAbsent(current.id, customer.id, 'SKIPPED_NO_ADDRESS');
      return 'SKIPPED';
    }

    // --- The durable claim, BEFORE any external call ---
    let claimedRow: { id: string };
    try {
      claimedRow = await this.prisma.campaignDelivery.create({
        data: { campaignId: current.id, customerId: customer.id, status: 'PENDING' },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return 'NOOP'; // a concurrent worker won the claim race for this exact recipient
      }
      throw err;
    }

    const provider = getMarketingProvider(loadEnv().MARKETING_PROVIDER);
    try {
      const result = await provider.send({
        to,
        channel: current.channel,
        subject: current.subject ?? undefined,
        content: current.content,
        idempotencyKey: `${current.id}:${customer.id}`,
      });
      if (result.status === 'SENT') {
        await this.prisma.campaignDelivery.update({
          where: { id: claimedRow.id },
          data: { status: 'SENT', providerMessageId: result.providerMessageId, sentAt: new Date() },
        });
        return 'SENT';
      }
      await this.prisma.campaignDelivery.update({
        where: { id: claimedRow.id },
        data: { status: 'FAILED', errorMessage: result.errorMessage },
      });
      return 'FAILED';
    } catch (err) {
      // The call itself threw/timed out - genuinely unknown whether the
      // provider accepted the message before the error. Never FAILED
      // (that would claim a certainty we don't have) and never retried
      // automatically here.
      await this.prisma.campaignDelivery.update({
        where: { id: claimedRow.id },
        data: {
          status: 'AMBIGUOUS_RECONCILIATION_REQUIRED',
          errorMessage: err instanceof Error ? err.message : 'Unknown provider error',
        },
      });
      return 'AMBIGUOUS';
    }
  }

  private async createDeliveryIfAbsent(
    campaignId: string,
    customerId: string,
    status: 'SKIPPED_OPTOUT' | 'SKIPPED_NO_ADDRESS',
  ): Promise<void> {
    try {
      await this.prisma.campaignDelivery.create({ data: { campaignId, customerId, status } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      // A concurrent worker already recorded some outcome for this
      // recipient first - never overwrite it.
    }
  }

  /**
   * Sends a campaign to its resolved recipient set once the campaign-
   * level SENDING claim has already been won by the caller. Idempotent
   * per (campaignId, customerId) via `CampaignDelivery`'s own unique
   * constraint and its PENDING durable claim (see `dispatchToRecipient`)
   * - a retried/reclaimed send never double-messages anyone already
   * processed or currently being processed. Never fabricates a delivery
   * outcome.
   */
  private async dispatchCampaign(current: MarketingCampaign, actorStaffId: string): Promise<CampaignSendSummary> {
    try {
      const recipientIds = current.segmentId
        ? [...(await this.resolveSegmentCustomerIds(current.segmentId))]
        : (await this.prisma.customer.findMany({ select: { id: true } })).map((c) => c.id);

      const customers = await this.prisma.customer.findMany({
        where: { id: { in: recipientIds } },
        select: { id: true, email: true, mobile: true },
      });

      let sentCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      let ambiguousCount = 0;

      for (const customer of customers) {
        const outcome = await this.dispatchToRecipient(current, customer);
        if (outcome === 'SENT') sentCount++;
        else if (outcome === 'FAILED') failedCount++;
        else if (outcome === 'SKIPPED') skippedCount++;
        else if (outcome === 'AMBIGUOUS') ambiguousCount++;
        // 'NOOP' - another worker already owns or has resolved this
        // recipient; no counter changes, never an error.
      }

      const finalStatus: CampaignStatus = sentCount === 0 && (failedCount > 0 || ambiguousCount > 0) ? 'FAILED' : 'SENT';
      const updated = await this.prisma.marketingCampaign.update({
        where: { id: current.id },
        data: { status: finalStatus, sentAt: new Date() },
      });
      await recordAudit(this.prisma, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'marketing.campaign.send',
        entityType: 'MarketingCampaign',
        entityId: current.id,
        newValue: { sentCount, failedCount, skippedCount, ambiguousCount, status: finalStatus },
      });
      return { campaign: updated, sentCount, failedCount, skippedCount, ambiguousCount, claimed: true };
    } catch (err) {
      await this.prisma.marketingCampaign.update({ where: { id: current.id }, data: { status: 'FAILED' } });
      throw err;
    }
  }

  /** An explicit staff-triggered immediate send - a separate operation from the automatic due-sweep below; see `claimForSend`'s own docblock for exactly how the two differ. */
  async sendCampaign(campaignId: string, actorStaffId: string): Promise<CampaignSendSummary> {
    const { claimed, campaign: current } = await this.claimForSend(campaignId, { dueOnly: false });
    if (!claimed) {
      // Another sender already owns this campaign, or it already
      // reached a terminal status (SENT/FAILED/CANCELLED) - a safe
      // no-op either way, never an error.
      return { campaign: current, sentCount: 0, failedCount: 0, skippedCount: 0, ambiguousCount: 0, claimed: false };
    }
    return this.dispatchCampaign(current, actorStaffId);
  }

  /**
   * The automatic due-campaign sweep (M25 independent-review
   * certification-repair, Blocker 3) - a plain callable function
   * compatible with a future external scheduler/cron trigger, never a
   * generalized job platform. Claims and sends ONLY campaigns that are
   * genuinely due right now (status = SCHEDULED AND scheduledAt <=
   * now); see `claimForSend`'s own docblock for the exact claim
   * condition and why a DRAFT or not-yet-due SCHEDULED campaign is
   * never touched here. Two genuinely concurrent sweep invocations
   * racing the SAME due campaign converge to exactly one sender - the
   * per-campaign compare-and-swap claim is identical to
   * `sendCampaign`'s own, just scoped to the due condition.
   */
  async processDueCampaigns(actorStaffId: string): Promise<{ processedCount: number; results: CampaignSendSummary[] }> {
    const due = await this.prisma.marketingCampaign.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
      select: { id: true },
    });

    const results: CampaignSendSummary[] = [];
    for (const { id } of due) {
      const { claimed, campaign: current } = await this.claimForSend(id, { dueOnly: true });
      if (!claimed) {
        // Lost the claim race to a concurrent sweep invocation, or the
        // campaign moved on (e.g. cancelled) between the query above
        // and this claim attempt - a safe no-op, never an error.
        results.push({ campaign: current, sentCount: 0, failedCount: 0, skippedCount: 0, ambiguousCount: 0, claimed: false });
        continue;
      }
      results.push(await this.dispatchCampaign(current, actorStaffId));
    }
    return { processedCount: results.filter((r) => r.claimed).length, results };
  }
}
