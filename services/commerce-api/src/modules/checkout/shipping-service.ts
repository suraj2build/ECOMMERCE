import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';

export interface UpsertShippingRuleInput {
  type: 'FLAT' | 'FREE_ABOVE_THRESHOLD';
  flatAmount?: number;
  freeAboveThreshold?: number;
}

/**
 * Configurable shipping-cost rule engine (M13, CHK-003). Engineering-
 * default shape: exactly one active rule, either a flat rate or "free
 * above a threshold" - the two rule types actually wired up. Weight/
 * value-based shipping is explicitly deferred: no product-weight data
 * model exists yet, and inventing one just for this would be scope
 * creep beyond checkout. Falls back to the SHIPPING_DEFAULT_* env vars
 * when no rule has been configured yet (fails safe to a sane default,
 * never to a hard error or free-for-everyone).
 */
export class ShippingService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  async getActiveRule() {
    const rule = await this.prisma.shippingRule.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    if (rule) return rule;

    const env = loadEnv();
    return {
      id: null as string | null,
      type: 'FREE_ABOVE_THRESHOLD' as const,
      flatAmount: env.SHIPPING_DEFAULT_FLAT_AMOUNT,
      freeAboveThreshold: env.SHIPPING_DEFAULT_FREE_ABOVE_THRESHOLD,
    };
  }

  async calculateShippingCost(subtotal: number): Promise<number> {
    const rule = await this.getActiveRule();
    if (rule.type === 'FREE_ABOVE_THRESHOLD' && rule.freeAboveThreshold !== null && subtotal >= Number(rule.freeAboveThreshold)) {
      return 0;
    }
    return Number(rule.flatAmount ?? 0);
  }

  async upsertRule(input: UpsertShippingRuleInput, actorStaffId: string) {
    if (input.type === 'FLAT' && input.flatAmount === undefined) {
      throw new ValidationError('flatAmount is required for a FLAT shipping rule');
    }
    if (input.type === 'FREE_ABOVE_THRESHOLD' && input.freeAboveThreshold === undefined) {
      throw new ValidationError('freeAboveThreshold is required for a FREE_ABOVE_THRESHOLD shipping rule');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.shippingRule.updateMany({ where: { isActive: true }, data: { isActive: false } });
      return tx.shippingRule.create({
        data: {
          type: input.type,
          flatAmount: input.flatAmount,
          freeAboveThreshold: input.freeAboveThreshold,
          isActive: true,
        },
      });
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'shipping.rule.update',
      entityType: 'ShippingRule',
      entityId: result.id,
      newValue: result,
    });

    return result;
  }
}
