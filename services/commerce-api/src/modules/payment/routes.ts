import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CheckoutService } from '../checkout/service.js';
import { resolveCartIdentity } from '../cart/identity.js';
import { PaymentService } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The exact bytes Razorpay signed - stashed by app.ts's global JSON content-type parser. */
    rawBody?: string;
  }
}

const retrySchema = z.object({ idempotencyKey: z.string().min(1) });

/**
 * Payment routes (M14): the Razorpay webhook (no app auth - protected by
 * HMAC signature verification instead, PAY-002/003) and the storefront
 * retry-payment endpoint (same guest-or-customer identity as the rest of
 * checkout).
 */
const paymentRoutes: FastifyPluginAsync = async (fastify) => {
  const paymentService = new PaymentService(fastify);
  const checkoutService = new CheckoutService(fastify);

  fastify.post('/webhooks/razorpay', async (request, reply) => {
    const signature = request.headers['x-razorpay-signature'];
    const result = await paymentService.handleRazorpayWebhook(
      request.rawBody ?? '',
      typeof signature === 'string' ? signature : undefined,
    );
    if (!result.ok) {
      reply.status(400).send({ error: result.reason });
      return;
    }
    reply.status(200).send({ received: true, duplicate: result.duplicate ?? false });
  });

  fastify.post(
    '/storefront/checkout/:id/retry-payment',
    { preHandler: fastify.tryCustomerAuth },
    async (request, reply) => {
      const identity = resolveCartIdentity(request);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = retrySchema.parse(request.body);
      reply.status(200).send(await checkoutService.retryPayment(id, identity, body.idempotencyKey));
    },
  );
};

export default paymentRoutes;
