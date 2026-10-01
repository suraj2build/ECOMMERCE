import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LoyaltyService } from './service.js';

// Exact mobile number only (digits, optional leading +, same 10-15 length
// as the OTP routes): no wildcard, prefix or free-text search.
const adjustmentLookupSchema = z.object({ mobile: z.string().trim().regex(/^\+?\d{10,15}$/, 'mobile must be 10-15 digits') });

const manualAdjustSchema = z.object({
  customerId: z.string().uuid(),
  pointsDelta: z.number().int(),
  reason: z.string().min(1).max(500),
  idempotencyKey: z.string().min(1),
});

/**
 * Loyalty routes (M23, specs/22-loyalty.md). Customer-facing balance/
 * ledger reads are `requireCustomerAuth`-only, customerId always from
 * `request.customer!.id` (never a body/query/param) - the same absolute
 * IDOR boundary every M22/M23 customer route follows. The one staff
 * route (manual adjustment) is gated by the dedicated `loyalty:adjust`
 * permission - deliberately separate from any read permission.
 */
const loyaltyRoutes: FastifyPluginAsync = async (fastify) => {
  const loyalty = new LoyaltyService(fastify);
  const customerAuth = { preHandler: fastify.requireCustomerAuth };
  const staffAuth = [fastify.requireStaffAuth, fastify.requirePermission('loyalty:adjust')];

  fastify.get('/storefront/account/loyalty', customerAuth, async (request, reply) => {
    reply.status(200).send(await loyalty.getBalanceForCustomer(request.customer!.id));
  });

  fastify.get('/storefront/account/loyalty/ledger', customerAuth, async (request, reply) => {
    reply.status(200).send(await loyalty.listLedgerForCustomer(request.customer!.id));
  });

  // P1 decision D-1: the restricted lookup a loyalty:adjust holder (e.g.
  // Finance) uses to find the customer an adjustment is for, without
  // Customer 360 access (customer_service:manage).
  fastify.get('/loyalty/customers/lookup', { preHandler: staffAuth }, async (request, reply) => {
    const { mobile } = adjustmentLookupSchema.parse(request.query);
    reply.status(200).send(await loyalty.lookupCustomerForAdjustment(mobile));
  });

  fastify.post('/loyalty/adjust', { preHandler: staffAuth }, async (request, reply) => {
    const body = manualAdjustSchema.parse(request.body);
    const entry = await loyalty.manualAdjust(body.customerId, body.pointsDelta, body.reason, request.staffUser!.id, body.idempotencyKey);
    reply.status(200).send(entry);
  });

  // Callable sweeps (LOY-004) - same "staff-triggerable, idempotent,
  // safe-to-run-repeatedly-or-concurrently" shape as the EXISTING
  // InventoryService.expireStaleReservations (POST /inventory/
  // reservations/expire-stale) and RefundService.reconcilePendingRefunds
  // (POST /refunds/reconcile) sweeps - a future scheduler calls the same
  // route a staff operator can call manually today.
  fastify.post('/loyalty/sweep/expire', { preHandler: staffAuth }, async (_request, reply) => {
    reply.status(200).send({ expired: await loyalty.expirePoints() });
  });

  fastify.post('/loyalty/sweep/release-stale-holds', { preHandler: staffAuth }, async (_request, reply) => {
    reply.status(200).send({ released: await loyalty.releaseStaleRedemptionHolds() });
  });

  // 2026-09-27 LOY-006: the vesting sweep - PENDING entitlements whose
  // line is delivered and whose return/exchange window has closed
  // transition to VESTED here. Same idempotent/concurrency-safe/
  // callable-directly-or-by-a-future-scheduler shape as every other
  // sweep above.
  fastify.post('/loyalty/sweep/vest', { preHandler: staffAuth }, async (_request, reply) => {
    reply.status(200).send({ vested: await loyalty.vestEligiblePoints() });
  });
};

export default loyaltyRoutes;
