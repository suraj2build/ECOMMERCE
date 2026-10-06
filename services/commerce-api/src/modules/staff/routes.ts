import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { StaffService } from './service.js';

/** Staff management (AO-D7, docs/admin/STAFF.md). Everything needs rbac:manage. */
const staffRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new StaffService(fastify);
  const auth = { preHandler: [fastify.requireStaffAuth, fastify.requirePermission('rbac:manage')] };
  const idParam = z.object({ id: z.string().uuid() });
  const roleKeys = z.array(z.string().min(1).max(64)).min(1).max(20);

  fastify.get('/staff', auth, async () => service.list());
  fastify.get('/staff/roles', auth, async () => service.roles());

  // The temporary password is in this response only; it is not stored or logged.
  fastify.post('/staff', auth, async (request, reply) => {
    const body = z.object({ email: z.string().trim().email().max(254), fullName: z.string().trim().min(1).max(120), roleKeys }).strict().parse(request.body);
    reply.status(201).send(await service.create(body, request.staffUser!.id));
  });

  fastify.put('/staff/:id/roles', auth, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ roleKeys }).strict().parse(request.body);
    return service.setRoles(id, body.roleKeys, request.staffUser!.id);
  });

  fastify.post('/staff/:id/deactivate', auth, async (request) => service.setActive(idParam.parse(request.params).id, false, request.staffUser!.id));
  fastify.post('/staff/:id/reactivate', auth, async (request) => service.setActive(idParam.parse(request.params).id, true, request.staffUser!.id));
  fastify.post('/staff/:id/reset-password', auth, async (request) => service.resetPassword(idParam.parse(request.params).id, request.staffUser!.id));
};

export default staffRoutes;
