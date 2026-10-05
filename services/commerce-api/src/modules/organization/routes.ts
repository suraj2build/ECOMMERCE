import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { OrganizationService } from './service.js';

const createBrandSchema = z.object({ code: z.string().min(1), name: z.string().min(1) });
const updateBrandSchema = z.object({ name: z.string().min(1).optional(), isActive: z.boolean().optional() });
// AO-D3: the warehouse/pickup address is edited in admin (Business & warehouse).
const pinCode = z.string().trim().regex(/^\d{6}$/, 'PIN code must be 6 digits');
const createLocationSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['WAREHOUSE', 'STORE']).optional(),
  addressLine1: z.string().trim().min(1).max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pinCode: pinCode.optional(),
});
const updateLocationSchema = z.object({
  name: z.string().min(1).optional(),
  addressLine1: z.string().trim().max(200).nullable().optional(),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pinCode: pinCode.optional(),
  isActive: z.boolean().optional(),
});

const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new OrganizationService(fastify);

  fastify.post(
    '/organization/brands',
    { preHandler: [fastify.requireStaffAuth, fastify.requirePermission('org:manage')] },
    async (request, reply) => {
      const body = createBrandSchema.parse(request.body);
      const brand = await service.createBrand(body, request.staffUser!.id);
      reply.status(201).send(brand);
    },
  );

  fastify.get(
    '/organization/brands',
    { preHandler: fastify.requireStaffAuth },
    async (_request, reply) => {
      reply.status(200).send(await service.listBrands());
    },
  );

  fastify.patch(
    '/organization/brands/:id',
    { preHandler: [fastify.requireStaffAuth, fastify.requirePermission('org:manage')] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = updateBrandSchema.parse(request.body);
      reply.status(200).send(await service.updateBrand(id, body, request.staffUser!.id));
    },
  );

  fastify.post(
    '/organization/locations',
    { preHandler: [fastify.requireStaffAuth, fastify.requirePermission('org:manage')] },
    async (request, reply) => {
      const body = createLocationSchema.parse(request.body);
      const location = await service.createLocation(body, request.staffUser!.id);
      reply.status(201).send(location);
    },
  );

  fastify.get(
    '/organization/locations',
    { preHandler: fastify.requireStaffAuth },
    async (_request, reply) => {
      reply.status(200).send(await service.listLocations());
    },
  );

  fastify.patch(
    '/organization/locations/:id',
    { preHandler: [fastify.requireStaffAuth, fastify.requirePermission('org:manage')] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = updateLocationSchema.parse(request.body);
      reply.status(200).send(await service.updateLocation(id, body, request.staffUser!.id));
    },
  );
};

export default organizationRoutes;
