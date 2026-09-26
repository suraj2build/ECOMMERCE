import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '@fcp/shared';
import { ReturnService } from './service.js';
import { resolveCartIdentity } from '../cart/identity.js';

const returnLineInputSchema = z.object({ orderLineId: z.string().uuid(), reason: z.string().min(1).max(2000) });
const initiateReturnSchema = z.object({
  orderId: z.string().uuid(),
  lines: z.array(returnLineInputSchema).min(1),
  method: z.enum(['PICKUP', 'DROP_OFF']),
  idempotencyKey: z.string().min(1).max(200),
});
const cancelReturnSchema = z.object({ reason: z.string().max(2000).optional() });
const idempotencyKeySchema = z.object({ idempotencyKey: z.string().min(1).max(200) });
const qcSchema = z.object({
  qcResult: z.enum(['PASS', 'FAIL']),
  disposition: z.enum(['RESTOCK_SELLABLE', 'RESTOCK_DAMAGED', 'WRITE_OFF', 'RETURN_TO_SUPPLIER']),
  notes: z.string().max(2000).optional(),
});

/**
 * Returns routes (M19, specs/18-returns.md). Staff warehouse-floor
 * actions (`return:receive`/`return:qc`) mirror `warehouse:*`'s own
 * granularity; CS-assisted initiation (`return:initiate`) is a distinct
 * permission from customer self-service, which needs no staff permission
 * at all - ownership-checked instead (`resolveCartIdentity` +
 * `ReturnService.initiateReturnForCustomer`'s own `loadOwnedOrder`
 * reuse), the same IDOR-safe pattern every storefront order/cancel route
 * already uses.
 */
const returnRoutes: FastifyPluginAsync = async (fastify) => {
  const returnService = new ReturnService(fastify);

  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('return:read')];
  const initiateAuth = [fastify.requireStaffAuth, fastify.requirePermission('return:initiate')];
  const receiveAuth = [fastify.requireStaffAuth, fastify.requirePermission('return:receive')];
  const qcAuth = [fastify.requireStaffAuth, fastify.requirePermission('return:qc')];
  const identityAuth = { preHandler: fastify.tryCustomerAuth };

  // --- Storefront (customer/guest self-service) ---

  fastify.post('/storefront/returns', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const body = initiateReturnSchema.parse(request.body);
    reply
      .status(201)
      .send(await returnService.initiateReturnForCustomer(body.orderId, body.lines, body.method, identity, body.idempotencyKey));
  });

  fastify.get('/storefront/returns', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    reply.status(200).send(await returnService.listReturnsForCustomer(identity));
  });

  fastify.get('/storefront/returns/:id', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await returnService.getReturnForCustomer(id, identity));
  });

  fastify.post('/storefront/returns/:id/cancel', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = cancelReturnSchema.parse(request.body ?? {});
    reply.status(200).send(await returnService.cancelReturn(id, null, identity, body.reason));
  });

  // --- Evidence (M19 independent-review repair, finding 2) ---

  fastify.post('/storefront/returns/:id/lines/:lineId/evidence', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { id, lineId } = z.object({ id: z.string().uuid(), lineId: z.string().uuid() }).parse(request.params);
    const part = await request.file();
    if (!part) throw new ValidationError('An evidence file is required');
    const buffer = await part.toBuffer();
    reply.status(201).send(await returnService.uploadEvidence(id, lineId, null, identity, { buffer }));
  });

  fastify.get('/storefront/returns/:id/lines/:lineId/evidence', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { id, lineId } = z.object({ id: z.string().uuid(), lineId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await returnService.listEvidence(id, lineId, identity));
  });

  fastify.get('/storefront/returns/:id/lines/:lineId/evidence/:evidenceId', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { id, lineId, evidenceId } = z.object({ id: z.string().uuid(), lineId: z.string().uuid(), evidenceId: z.string().uuid() }).parse(request.params);
    const content = await returnService.getEvidenceContent(id, lineId, evidenceId, identity);
    reply.status(200).header('content-type', content.mimeType).header('cache-control', 'private, no-store').send(content.buffer);
  });

  // --- Staff ---

  fastify.post('/returns', { preHandler: initiateAuth }, async (request, reply) => {
    const body = initiateReturnSchema.parse(request.body);
    reply
      .status(201)
      .send(await returnService.initiateReturnForStaff(body.orderId, body.lines, body.method, request.staffUser!.id, body.idempotencyKey));
  });

  fastify.get('/returns/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await returnService.getReturn(id));
  });

  fastify.get('/orders/:orderId/returns', { preHandler: readAuth }, async (request, reply) => {
    const { orderId } = z.object({ orderId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await returnService.listReturnsForOrder(orderId));
  });

  fastify.get('/returns', { preHandler: readAuth }, async (request, reply) => {
    const query = z
      .object({ status: z.enum(['REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'RECEIVED', 'DISPOSITIONED', 'CANCELLED']).optional() })
      .parse(request.query);
    reply.status(200).send(await returnService.listPendingWarehouseWork(query.status));
  });

  fastify.post('/returns/:id/cancel', { preHandler: initiateAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = cancelReturnSchema.parse(request.body ?? {});
    reply.status(200).send(await returnService.cancelReturn(id, request.staffUser!.id, null, body.reason));
  });

  fastify.post('/returns/:id/pickup', { preHandler: receiveAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = idempotencyKeySchema.parse(request.body);
    reply.status(200).send(await returnService.schedulePickup(id, request.staffUser!.id, body.idempotencyKey));
  });

  fastify.post('/returns/:id/pickup/complete', { preHandler: receiveAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await returnService.markPickedUp(id, request.staffUser!.id));
  });

  fastify.post('/returns/:id/receive', { preHandler: receiveAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await returnService.markReceived(id, request.staffUser!.id));
  });

  fastify.post('/returns/:id/lines/:lineId/qc', { preHandler: qcAuth }, async (request, reply) => {
    const { id, lineId } = z.object({ id: z.string().uuid(), lineId: z.string().uuid() }).parse(request.params);
    const body = qcSchema.parse(request.body);
    reply.status(200).send(await returnService.recordQcAndDisposition(id, lineId, request.staffUser!.id, body));
  });

  // --- Evidence (M19 independent-review repair, finding 2) - staff can inspect; CS-assisted upload uses the same return:initiate grouping as staff initiation ---

  fastify.post('/returns/:id/lines/:lineId/evidence', { preHandler: initiateAuth }, async (request, reply) => {
    const { id, lineId } = z.object({ id: z.string().uuid(), lineId: z.string().uuid() }).parse(request.params);
    const part = await request.file();
    if (!part) throw new ValidationError('An evidence file is required');
    const buffer = await part.toBuffer();
    reply.status(201).send(await returnService.uploadEvidence(id, lineId, request.staffUser!.id, null, { buffer }));
  });

  fastify.get('/returns/:id/lines/:lineId/evidence', { preHandler: readAuth }, async (request, reply) => {
    const { id, lineId } = z.object({ id: z.string().uuid(), lineId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await returnService.listEvidence(id, lineId, null));
  });

  fastify.get('/returns/:id/lines/:lineId/evidence/:evidenceId', { preHandler: readAuth }, async (request, reply) => {
    const { id, lineId, evidenceId } = z.object({ id: z.string().uuid(), lineId: z.string().uuid(), evidenceId: z.string().uuid() }).parse(request.params);
    const content = await returnService.getEvidenceContent(id, lineId, evidenceId, null);
    reply.status(200).header('content-type', content.mimeType).header('cache-control', 'private, no-store').send(content.buffer);
  });
};

export default returnRoutes;
