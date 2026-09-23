import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';

export interface UpsertPincodeInput {
  pincode: string;
  city: string;
  state: string;
  isServiceable?: boolean;
  codAvailable?: boolean;
  estimatedDaysMin?: number;
  estimatedDaysMax?: number;
}

/**
 * PIN-code serviceability (IND-002). This is the static-list fallback
 * only - a real carrier-API check (SHIP-002) is M16's own scope, out of
 * this Phase 2 authorization. Checked at PDP (specs/10-pdp.md) and
 * re-validated at checkout (M13) against this same table, so the two
 * checks can never silently disagree with each other.
 */
export class ServiceabilityService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  private validatePincode(pincode: string) {
    if (!/^[0-9]{6}$/.test(pincode)) throw new ValidationError('pincode must be exactly 6 digits');
  }

  async upsertPincode(input: UpsertPincodeInput, actorStaffId: string) {
    this.validatePincode(input.pincode);
    const existing = await this.prisma.serviceablePincode.findUnique({ where: { pincode: input.pincode } });
    const updated = await this.prisma.serviceablePincode.upsert({
      where: { pincode: input.pincode },
      create: {
        pincode: input.pincode,
        city: input.city,
        state: input.state,
        isServiceable: input.isServiceable ?? true,
        codAvailable: input.codAvailable ?? true,
        estimatedDaysMin: input.estimatedDaysMin,
        estimatedDaysMax: input.estimatedDaysMax,
      },
      update: {
        city: input.city,
        state: input.state,
        isServiceable: input.isServiceable ?? true,
        codAvailable: input.codAvailable ?? true,
        estimatedDaysMin: input.estimatedDaysMin,
        estimatedDaysMax: input.estimatedDaysMax,
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: existing ? 'pincode.update' : 'pincode.create',
      entityType: 'ServiceablePincode',
      entityId: input.pincode,
      oldValue: existing ?? undefined,
      newValue: updated,
    });
    return updated;
  }

  async listPincodes(params: { take?: number; skip?: number } = {}) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    return this.prisma.serviceablePincode.findMany({ take, skip, orderBy: { pincode: 'asc' } });
  }

  /**
   * Public: never throws NotFound for an unlisted pincode - "not yet in
   * our data" is a distinct, legitimate answer from "explicitly not
   * serviceable" (negative scenario #2, acceptance/m11-pdp.md - clear
   * messaging, never blocks the rest of the page).
   */
  async checkServiceability(pincode: string) {
    this.validatePincode(pincode);
    const record = await this.prisma.serviceablePincode.findUnique({ where: { pincode } });
    if (!record) {
      return {
        pincode,
        known: false,
        isServiceable: false,
        codAvailable: false,
        city: null,
        state: null,
        estimatedDaysMin: null,
        estimatedDaysMax: null,
      };
    }
    return { ...record, known: true };
  }
}
