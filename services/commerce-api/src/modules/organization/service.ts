import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { withUniqueConstraintCheck } from '../../lib/prisma-error-mapping.js';

export interface UpdateBrandInput {
  name?: string;
  isActive?: boolean;
}

export interface UpdateLocationInput {
  name?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  isActive?: boolean;
}

export interface CreateBrandInput {
  code: string;
  name: string;
}

export interface CreateLocationInput {
  code: string;
  name: string;
  type?: 'WAREHOUSE' | 'STORE';
  city?: string;
  state?: string;
  pinCode?: string;
}

/**
 * Organization & Locations (M00, specs/31-organization-locations.md).
 * ORG-001: single legal entity, multiple owned brands (first-class
 * entity, never free text). ORG-002/INV-004: location-aware from day
 * one; warehouse-only at launch, STORE type reserved for
 * FUTURE_CONSIDERATION.
 */
export class OrganizationService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma() {
    return this.fastify.prisma;
  }

  async createBrand(input: CreateBrandInput, actorStaffId: string) {
    const brand = await withUniqueConstraintCheck(() => this.prisma.brand.create({ data: input }), 'Brand');
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'brand.create',
      entityType: 'Brand',
      entityId: brand.id,
      newValue: input,
    });
    return brand;
  }

  async listBrands() {
    return this.prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  async getBrand(id: string) {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand) throw new NotFoundError('Brand', id);
    return brand;
  }

  async updateBrand(id: string, input: UpdateBrandInput, actorStaffId: string) {
    const existing = await this.getBrand(id);
    const updated = await this.prisma.brand.update({ where: { id }, data: input });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'brand.update',
      entityType: 'Brand',
      entityId: id,
      oldValue: { name: existing.name, isActive: existing.isActive },
      newValue: input,
    });
    return updated;
  }

  async createLocation(input: CreateLocationInput, actorStaffId: string) {
    const location = await withUniqueConstraintCheck(
      () => this.prisma.location.create({ data: { ...input, type: input.type ?? 'WAREHOUSE' } }),
      'Location',
    );
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'location.create',
      entityType: 'Location',
      entityId: location.id,
      newValue: input,
    });
    return location;
  }

  async listLocations() {
    return this.prisma.location.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  async getLocation(id: string) {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) throw new NotFoundError('Location', id);
    return location;
  }

  async updateLocation(id: string, input: UpdateLocationInput, actorStaffId: string) {
    const existing = await this.getLocation(id);
    const updated = await this.prisma.location.update({ where: { id }, data: input });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'location.update',
      entityType: 'Location',
      entityId: id,
      oldValue: { name: existing.name, isActive: existing.isActive },
      newValue: input,
    });
    return updated;
  }
}
