import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { WarehouseService } from './service.js';
import { ConflictError, NotFoundError, ValidationError } from '@fcp/shared';
import { ApprovalPolicyService, selfApprovalSchema } from '../approvals/service.js';
import { ApprovalQueueService } from '../approvals/queue.js';

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'PICKED', 'SHORT_PICKED', 'EXCEPTION', 'CANCELLED']).optional(),
  locationId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  take: z.coerce.number().int().positive().max(200).optional(),
  skip: z.coerce.number().int().nonnegative().optional(),
});

const pickOutcomeSchema = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
    outcome: z.enum(['FULL', 'SHORT', 'EXCEPTION']),
    pickedQuantity: z.number().int().positive().optional(),
    exceptionType: z.enum(['STOCK_NOT_FOUND', 'INSUFFICIENT_STOCK', 'DAMAGED', 'WRONG_SKU_FOUND', 'OTHER']).optional(),
    exceptionReason: z.string().min(1).max(2000).optional(),
    coApproverStaffId: z.string().uuid().optional(),
    selfApproval: selfApprovalSchema.optional(),
    scannedBarcode: z.string().trim().min(1).max(64).optional(),
  })
  .refine((v) => v.outcome === 'EXCEPTION' || v.pickedQuantity !== undefined, {
    message: 'pickedQuantity is required for FULL/SHORT outcomes',
  })
  .refine((v) => v.outcome !== 'EXCEPTION' || v.exceptionType !== undefined, {
    message: 'exceptionType is required for an EXCEPTION outcome',
  });

/**
 * Warehouse / Picking routes (M16). Every route requires staff auth plus
 * a dedicated warehouse:* permission (distinct from order:fulfil, which
 * already gates the M15 pack/ship/deliver routes in modules/order/routes.ts)
 * - see packages/shared/src/permissions.ts for the rationale.
 *
 * Object-level authorization (IDOR/BOLA, M16 §11): every route resolves
 * the PickTask strictly by its own id via WarehouseService.getPickTask,
 * which throws a clean NotFoundError for any id that doesn't exist -
 * there is no separate "does this staff member own this task" check
 * because pick tasks are internal operational resources (not
 * customer/tenant-scoped data), the same trust model M15's staff-only
 * order-fulfilment routes already use; a staff member without ANY
 * warehouse:* permission is rejected by requirePermission before ever
 * reaching the service layer, regardless of which id they guess.
 */
const warehouseRoutes: FastifyPluginAsync = async (fastify) => {
  const warehouseService = new WarehouseService(fastify);

  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('warehouse:read')];
  const pickAuth = [fastify.requireStaffAuth, fastify.requirePermission('warehouse:pick')];

  fastify.get('/warehouse/pick-tasks', { preHandler: readAuth }, async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    reply.status(200).send(await warehouseService.listPickTasks(query));
  });

  fastify.get('/warehouse/pick-tasks/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await warehouseService.getPickTask(id));
  });

  fastify.post('/warehouse/pick-tasks/:id/pick', { preHandler: pickAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = pickOutcomeSchema.parse(request.body);
    const me = request.staffUser!.id;
    // A shortfall at/above the threshold writes off stock and needs a
    // co-approver under the same approval policy as stock adjustments
    // (AO-D4). Someone else named: the pick outcome waits, unrecorded,
    // until that person approves it from their own login
    // (approvals/queue.ts). The picker themselves: owner approval only,
    // with a reason and password.
    if (body.coApproverStaffId && body.coApproverStaffId !== me) {
      if (body.outcome === 'FULL') throw new ValidationError('A full pick writes nothing off, so it needs no approval');
      const task = await fastify.prisma.pickTask.findUnique({
        where: { id },
        select: {
          status: true,
          allocatedQuantity: true,
          order: { select: { orderNumber: true } },
          exchange: { select: { exchangeNumber: true } },
          location: { select: { name: true } },
          sku: { select: { skuCode: true, style: { select: { name: true } }, colour: { select: { name: true } }, size: { select: { label: true } } } },
        },
      });
      if (!task) throw new NotFoundError('PickTask', id);
      if (task.status !== 'PENDING') throw new ConflictError(`This pick has already been recorded (status '${task.status}')`);
      const picked = body.outcome === 'EXCEPTION' ? 0 : (body.pickedQuantity ?? 0);
      const pendingApproval = await new ApprovalQueueService(fastify).request({
        kind: 'PICK_SHORTFALL',
        requestedByStaffId: me,
        approverStaffId: body.coApproverStaffId,
        payload: {
          pickTaskId: id,
          idempotencyKey: body.idempotencyKey,
          outcome: body.outcome,
          pickedQuantity: body.pickedQuantity,
          exceptionType: body.exceptionType,
          exceptionReason: body.exceptionReason,
          scannedBarcode: body.scannedBarcode,
        },
        summary: {
          reference: task.exchange?.exchangeNumber ?? task.order?.orderNumber ?? null,
          skuCode: task.sku.skuCode,
          item: `${task.sku.style.name} · ${task.sku.colour.name} · ${task.sku.size.label}`,
          location: task.location.name,
          outcome: body.outcome,
          allocatedQuantity: task.allocatedQuantity,
          pickedQuantity: picked,
          writeOff: task.allocatedQuantity - picked,
          reason: body.exceptionReason ?? null,
        },
        subjectKey: `pick:${id}`,
      });
      reply.status(202).send({ pendingApproval });
      return;
    }
    const approval = body.coApproverStaffId
      ? await new ApprovalPolicyService(fastify.prisma).decide({
          kind: 'PICK_SHORTFALL',
          requestedByStaffId: me,
          approverStaffId: body.coApproverStaffId,
          actingStaffId: me,
          permission: 'inventory:adjust:coapprove',
          selfApproval: body.selfApproval,
        })
      : undefined;
    reply.status(200).send(
      await warehouseService.recordPickOutcome({
        pickTaskId: id,
        staffId: me,
        idempotencyKey: body.idempotencyKey,
        outcome: body.outcome,
        pickedQuantity: body.pickedQuantity,
        exceptionType: body.exceptionType,
        exceptionReason: body.exceptionReason,
        coApproverStaffId: body.coApproverStaffId,
        approval,
        scannedBarcode: body.scannedBarcode,
      }),
    );
  });
};

export default warehouseRoutes;
