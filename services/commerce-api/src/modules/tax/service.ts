import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { NotFoundError, ValidationError, TaxConfigurationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { withUniqueConstraintCheck } from '../../lib/prisma-error-mapping.js';

export interface CreateLegalEntityInput {
  legalName: string;
  pan?: string;
  cin?: string;
  registeredAddressLine1?: string;
  registeredAddressLine2?: string;
  registeredCity?: string;
  registeredState?: string;
  registeredPinCode?: string;
}

export interface CreateGstRegistrationInput {
  legalEntityId: string;
  gstin: string;
  stateCode: string;
  stateName: string;
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  effectiveFrom: Date;
  effectiveTo?: Date;
}

export interface CreateTaxRateInput {
  hsnCode: string;
  description?: string;
  gstRatePercent: number;
  cessPercent?: number;
  effectiveFrom: Date;
  effectiveTo?: Date;
  sourceReference?: string;
  verificationStatus?: 'UNVERIFIED' | 'PENDING_REVIEW' | 'VERIFIED';
}

export interface SetComplianceProfileInput {
  legalEntityId: string;
  aatoThresholdCrores?: number;
  einvoiceApplicable?: boolean;
  einvoiceApplicableFrom?: Date;
  exemptionNotes?: string;
  effectiveFrom?: Date;
  effectiveTo?: Date;
}

/**
 * Tax configuration management + resolution (M08, specs/32).
 * Every method here is pure configuration CRUD, or deterministic
 * resolution over that configuration - no GST rate, HSN classification,
 * or registration is ever invented. Resolution mirrors
 * CatalogService.getActivePrice's effective-dated precedence pattern.
 */
export class TaxConfigService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  // --- Legal entity ---

  async createLegalEntity(input: CreateLegalEntityInput, actorStaffId: string) {
    if (!input.legalName.trim()) throw new ValidationError('legalName is required');
    const entity = await this.prisma.legalEntity.create({ data: input });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'legal_entity.create',
      entityType: 'LegalEntity',
      entityId: entity.id,
      newValue: input,
    });
    return entity;
  }

  async listLegalEntities() {
    return this.prisma.legalEntity.findMany({ where: { isActive: true }, orderBy: { legalName: 'asc' } });
  }

  // --- GST registrations ---

  async createGstRegistration(input: CreateGstRegistrationInput, actorStaffId: string) {
    if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
      throw new ValidationError('effectiveTo must be after effectiveFrom');
    }
    const legalEntity = await this.prisma.legalEntity.findUnique({ where: { id: input.legalEntityId } });
    if (!legalEntity) throw new NotFoundError('LegalEntity', input.legalEntityId);

    const registration = await withUniqueConstraintCheck(
      () =>
        this.prisma.gstRegistration.create({
          data: {
            legalEntityId: input.legalEntityId,
            gstin: input.gstin,
            stateCode: input.stateCode,
            stateName: input.stateName,
            status: input.status ?? 'PENDING',
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo,
          },
        }),
      'GstRegistration',
    );
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'gst_registration.create',
      entityType: 'GstRegistration',
      entityId: registration.id,
      newValue: input,
      reference: input.legalEntityId,
    });
    return registration;
  }

  async listGstRegistrations() {
    return this.prisma.gstRegistration.findMany({ orderBy: { stateCode: 'asc' } });
  }

  /** Assigns which GST registration supplies from a given location (TAX-001). */
  async assignLocationGstRegistration(locationId: string, gstRegistrationId: string, actorStaffId: string) {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) throw new NotFoundError('Location', locationId);
    const registration = await this.prisma.gstRegistration.findUnique({ where: { id: gstRegistrationId } });
    if (!registration) throw new NotFoundError('GstRegistration', gstRegistrationId);

    const updated = await this.prisma.location.update({
      where: { id: locationId },
      data: { gstRegistrationId },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'location.assign_gst_registration',
      entityType: 'Location',
      entityId: locationId,
      oldValue: { gstRegistrationId: location.gstRegistrationId },
      newValue: { gstRegistrationId },
    });
    return updated;
  }

  /**
   * Resolves the active, currently-effective GST registration supplying
   * from a location. Fails safe (TaxConfigurationError, not a guess) when
   * the location has no registration assigned, the registration isn't
   * ACTIVE, or atDate falls outside its effective window - this is the
   * concrete "engineering must fail safely when required compliance
   * configuration is absent" requirement.
   */
  async resolveSupplierRegistration(locationId: string, atDate: Date = new Date()) {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      include: { gstRegistration: true },
    });
    if (!location) throw new NotFoundError('Location', locationId);
    if (!location.gstRegistration) {
      throw new TaxConfigurationError(
        `Location '${locationId}' has no GST registration configured. Tax cannot be computed until a registration is assigned.`,
      );
    }
    const reg = location.gstRegistration;
    if (reg.status !== 'ACTIVE') {
      throw new TaxConfigurationError(
        `GST registration '${reg.gstin}' for location '${locationId}' is not ACTIVE (status: ${reg.status}).`,
      );
    }
    if (atDate < reg.effectiveFrom || (reg.effectiveTo && atDate > reg.effectiveTo)) {
      throw new TaxConfigurationError(
        `GST registration '${reg.gstin}' is not effective on ${atDate.toISOString()}.`,
      );
    }
    return reg;
  }

  // --- Tax rates (HSN reference data) ---

  async createTaxRate(input: CreateTaxRateInput, actorStaffId: string) {
    if (input.gstRatePercent < 0) throw new ValidationError('gstRatePercent cannot be negative');
    if (input.cessPercent !== undefined && input.cessPercent < 0) {
      throw new ValidationError('cessPercent cannot be negative');
    }
    if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
      throw new ValidationError('effectiveTo must be after effectiveFrom');
    }

    const rate = await this.prisma.taxRate.create({
      data: {
        hsnCode: input.hsnCode,
        description: input.description,
        gstRatePercent: input.gstRatePercent,
        cessPercent: input.cessPercent,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        sourceReference: input.sourceReference,
        verificationStatus: input.verificationStatus ?? 'UNVERIFIED',
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'tax_rate.create',
      entityType: 'TaxRate',
      entityId: rate.id,
      newValue: input,
      reference: input.hsnCode,
    });
    return rate;
  }

  async listTaxRates(hsnCode?: string) {
    return this.prisma.taxRate.findMany({
      where: hsnCode ? { hsnCode } : undefined,
      orderBy: [{ hsnCode: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  /**
   * Resolves the single tax rate in effect for an HSN code at a given
   * date. Fails safe when no configured rate covers that date - never
   * assumes a rate, and never silently falls back to a different HSN's
   * rate.
   */
  async resolveTaxRate(hsnCode: string, atDate: Date = new Date()) {
    const candidates = await this.prisma.taxRate.findMany({
      where: {
        hsnCode,
        effectiveFrom: { lte: atDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: atDate } }],
      },
    });
    if (candidates.length === 0) {
      throw new TaxConfigurationError(
        `No tax rate is configured for HSN '${hsnCode}' effective on ${atDate.toISOString()}.`,
      );
    }
    // Most-recently-effective row wins if more than one configured window
    // overlaps (e.g. a correction entered after the fact) - deterministic,
    // not first-match, mirroring getActivePrice's recency tiebreak.
    candidates.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    return candidates[0]!;
  }

  // --- Compliance profile (e-invoice applicability gate) ---

  async setComplianceProfile(input: SetComplianceProfileInput, actorStaffId: string) {
    const legalEntity = await this.prisma.legalEntity.findUnique({ where: { id: input.legalEntityId } });
    if (!legalEntity) throw new NotFoundError('LegalEntity', input.legalEntityId);
    if (input.effectiveTo && input.effectiveFrom && input.effectiveTo <= input.effectiveFrom) {
      throw new ValidationError('effectiveTo must be after effectiveFrom');
    }

    const profile = await this.prisma.complianceProfile.create({
      data: {
        legalEntityId: input.legalEntityId,
        aatoThresholdCrores: input.aatoThresholdCrores,
        einvoiceApplicable: input.einvoiceApplicable ?? false,
        einvoiceApplicableFrom: input.einvoiceApplicableFrom,
        exemptionNotes: input.exemptionNotes,
        effectiveFrom: input.effectiveFrom ?? new Date(),
        effectiveTo: input.effectiveTo,
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'compliance_profile.set',
      entityType: 'ComplianceProfile',
      entityId: profile.id,
      newValue: input,
      reference: input.legalEntityId,
    });
    return profile;
  }

  /** Fails safe: returns null (not applicable) when no profile is configured. */
  async getActiveComplianceProfile(legalEntityId: string, atDate: Date = new Date()) {
    const candidates = await this.prisma.complianceProfile.findMany({
      where: {
        legalEntityId,
        effectiveFrom: { lte: atDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: atDate } }],
      },
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    return candidates[0]!;
  }
}
