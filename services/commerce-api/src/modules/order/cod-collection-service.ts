import type { FastifyInstance } from 'fastify';
import type { CodCollection, PrismaClient } from '@fcp/db';
import { ConflictError, NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { ConversionService } from '../conversions/service.js';

export interface CodCollectionInput {
  amount: number;
  reference: string;
  collectedAt?: Date;
}

/**
 * LR-009 (Product Owner decision 2026-10-04): a COD order becomes a
 * purchase only when it has been delivered and its cash collection is
 * confirmed. Finance records the collection (from the courier's remittance)
 * once every line is delivered or cancelled; a courier remittance adapter
 * can call the same method once a carrier is chosen (LR-008).
 *
 * Recording is once per order and idempotent: the same reference and
 * amount again returns the existing record; anything different is a
 * conflict, never an overwrite.
 */
export class CodCollectionService {
  private readonly conversions: ConversionService;

  constructor(private readonly fastify: FastifyInstance) {
    this.conversions = new ConversionService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  async record(orderId: string, input: CodCollectionInput, actorStaffId: string | null): Promise<CodCollection> {
    const collectedAt = input.collectedAt ?? new Date();
    if (collectedAt.getTime() > Date.now() + 60_000) throw new ValidationError('collectedAt cannot be in the future');

    return this.prisma.$transaction(async (tx) => {
      // The order row lock serialises concurrent recordings for one order.
      const [order] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
      if (!order) throw new NotFoundError('Order not found');
      const full = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: { select: { status: true } }, codCollection: true } });
      if (full.paymentMethod !== 'COD') throw new ValidationError('Only a cash-on-delivery order has a COD collection');

      const existing = full.codCollection;
      if (existing) {
        if (existing.reference === input.reference && Number(existing.amount) === input.amount) return existing;
        throw new ConflictError('COD collection is already recorded for this order');
      }

      if (full.lines.some((line) => line.status !== 'DELIVERED' && line.status !== 'CANCELLED')) {
        throw new ConflictError('COD collection can be recorded only once every line is delivered or cancelled');
      }
      if (!full.lines.some((line) => line.status === 'DELIVERED')) {
        throw new ConflictError('Nothing on this order was delivered, so no cash was collected');
      }
      if (collectedAt < full.createdAt) throw new ValidationError('collectedAt is before the order was placed');

      const payable = Number(full.grandTotal) - Number(full.loyaltyRedemptionValue) - Number(full.storeCreditApplied) - Number(full.giftCardApplied);
      if (input.amount > Math.round(payable * 100) / 100) {
        throw new ValidationError(`The collected amount exceeds the amount payable on delivery (${payable.toFixed(2)})`);
      }

      const created = await tx.codCollection.create({
        data: { orderId, amount: input.amount, reference: input.reference, collectedAt, recordedByStaffId: actorStaffId },
      });
      await recordAudit(tx, {
        actorType: actorStaffId ? 'STAFF' : 'SYSTEM',
        actorStaffId: actorStaffId ?? undefined,
        action: 'order.cod.collected',
        entityType: 'CodCollection',
        entityId: created.id,
        newValue: { amount: input.amount, reference: input.reference, collectedAt: collectedAt.toISOString() },
        reference: orderId,
      });
      // The order now counts as a purchase.
      await this.conversions.enqueueCodPurchase(tx, orderId, collectedAt);
      return created;
    });
  }
}
