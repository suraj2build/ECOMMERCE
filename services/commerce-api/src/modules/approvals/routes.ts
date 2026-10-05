import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ForbiddenError } from '@fcp/shared';
import { ApprovalPolicyService } from './service.js';

/**
 * Approval policy (AO-D4, docs/admin/APPROVALS.md). Any signed-in staff
 * member can read the policy (the admin uses it to explain who may
 * approve); only org:manage may change it, with a password re-confirmation.
 * The approval log is for org:manage or audit:read.
 */
const approvalRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ApprovalPolicyService(fastify.prisma);
  const staffOnly = [fastify.requireStaffAuth];
  const manage = [fastify.requireStaffAuth, fastify.requirePermission('org:manage')];

  fastify.get('/approvals/policy', { preHandler: staffOnly }, async (request) => service.getPolicy(request.staffUser!.id));

  fastify.put('/approvals/policy', { preHandler: manage }, async (request) => {
    const body = z
      .object({
        ownerApprovalEnabled: z.boolean(),
        ownerStaffIds: z.array(z.string().uuid()).max(20),
        confirmation: z.object({ password: z.string().min(1).max(200), mfaCode: z.string().max(12).optional() }),
      })
      .strict()
      .parse(request.body);
    return service.updatePolicy(body, request.staffUser!.id);
  });

  // Active staff, identity only, for choosing owners.
  fastify.get('/approvals/staff', { preHandler: manage }, async () =>
    fastify.prisma.staffUser.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' }, take: 200 }),
  );

  fastify.get('/approvals/records', { preHandler: [fastify.requireStaffAuth] }, async (request) => {
    const perms = request.staffUser!.permissions;
    if (!perms.has('org:manage') && !perms.has('audit:read')) throw new ForbiddenError('Viewing the approval log needs org:manage or audit:read');
    const q = z
      .object({ selfApproved: z.enum(['true', 'false']).optional(), take: z.coerce.number().int().positive().max(200).optional(), skip: z.coerce.number().int().nonnegative().optional() })
      .parse(request.query);
    return service.listRecords({ selfApproved: q.selfApproved === undefined ? undefined : q.selfApproved === 'true', take: q.take, skip: q.skip });
  });
};

export default approvalRoutes;
