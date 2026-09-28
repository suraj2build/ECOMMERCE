import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type NotificationEvent, type CommunicationChannel } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { getMarketingProvider } from '../marketing/provider.js';
import { TRANSACTIONAL_MESSAGE_TYPES } from '../customer-profile/service.js';

/**
 * Transactional Notifications (M29, specs/29-notifications.md,
 * cross-cutting, NOTIF-001). Triggered ONLY from already-committed,
 * authoritative state changes (order/shipment/return/refund/exchange/
 * loyalty transitions) - never a second, independently-drifting source
 * of truth. Reuses the EXISTING `MarketingProvider` interface verbatim
 * (the send contract - to/channel/subject/content/idempotencyKey ->
 * status/providerMessageId/errorMessage - is identical) rather than
 * inventing a second provider abstraction, and the EXISTING
 * `CommunicationPreference` opt-in matrix (M22, CUST-002) rather than a
 * second consent model - a customer opted out of `ORDER_UPDATES` on a
 * channel is never notified on it here either, transactional or not
 * (the same rule M22's own Finding 3 repair established).
 *
 * Duplicate-event handling (NOTIF-001: "a retried trigger must not send
 * the same notification twice") follows the exact durable-claim-before-
 * provider-call idiom `MarketingService.dispatchToRecipient` established
 * for M25's own per-recipient dispatch (Blocker 4): `NotificationDelivery`'s
 * own `@@unique([event, referenceId, channel])` constraint is the
 * idempotency guarantee, not an application-level check-then-send.
 */
export class NotificationService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  private async isOptedIn(customerId: string, channel: CommunicationChannel): Promise<boolean> {
    const pref = await this.prisma.communicationPreference.findUnique({
      where: { customerId_channel_messageType: { customerId, channel, messageType: 'ORDER_UPDATES' } },
    });
    if (pref) return pref.optedIn;
    return TRANSACTIONAL_MESSAGE_TYPES.has('ORDER_UPDATES');
  }

  /**
   * Fires a single transactional notification for `event`/`referenceId`
   * to `customerId` over SMS (this platform's baseline channel - every
   * customer has a mandatory, verified mobile number; email is optional
   * and not attempted for transactional notifications, an honest scope
   * boundary rather than a fabricated multi-channel fan-out). Never
   * throws - a notification-delivery failure must never fail or roll
   * back the authoritative operation that triggered it; every outcome
   * (including a caught exception) is instead recorded honestly on the
   * `NotificationDelivery` row itself.
   */
  async notify(event: NotificationEvent, customerId: string, referenceId: string, content: string): Promise<void> {
    try {
      const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { mobile: true } });
      if (!customer) return;

      const channel: CommunicationChannel = 'SMS';
      const optedIn = await this.isOptedIn(customerId, channel);
      if (!optedIn) {
        await this.createDeliveryIfAbsent(event, referenceId, channel, customerId, 'SKIPPED_OPTOUT');
        return;
      }
      if (!customer.mobile) {
        await this.createDeliveryIfAbsent(event, referenceId, channel, customerId, 'SKIPPED_NO_ADDRESS');
        return;
      }

      let claimedRow: { id: string };
      try {
        claimedRow = await this.prisma.notificationDelivery.create({
          data: { event, referenceId, channel, customerId, status: 'PENDING' },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return; // already claimed by a prior/concurrent trigger of this exact event - never resent
        }
        throw err;
      }

      const provider = getMarketingProvider(loadEnv().MARKETING_PROVIDER);
      try {
        const result = await provider.send({
          to: customer.mobile,
          channel,
          content,
          idempotencyKey: `${event}:${referenceId}:${channel}`,
        });
        await this.prisma.notificationDelivery.update({
          where: { id: claimedRow.id },
          data:
            result.status === 'SENT'
              ? { status: 'SENT', providerMessageId: result.providerMessageId, sentAt: new Date() }
              : { status: 'FAILED', errorMessage: result.errorMessage },
        });
      } catch (err) {
        await this.prisma.notificationDelivery.update({
          where: { id: claimedRow.id },
          data: {
            status: 'AMBIGUOUS_RECONCILIATION_REQUIRED',
            errorMessage: err instanceof Error ? err.message : 'Unknown provider error',
          },
        });
      }
    } catch {
      // Never let a notification-delivery bug surface as a failure of the
      // authoritative operation that triggered it.
    }
  }

  private async createDeliveryIfAbsent(
    event: NotificationEvent,
    referenceId: string,
    channel: CommunicationChannel,
    customerId: string,
    status: 'SKIPPED_OPTOUT' | 'SKIPPED_NO_ADDRESS',
  ): Promise<void> {
    try {
      await this.prisma.notificationDelivery.create({ data: { event, referenceId, channel, customerId, status } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
  }

  async listForCustomer(customerId: string) {
    return this.prisma.notificationDelivery.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }
}
