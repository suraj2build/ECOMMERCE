import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ConversionService } from './service.js';

const withdrawalSchema = z.object({
  // The browser's random consent-subject ID (sent with its checkouts).
  subjectId: z.string().uuid().optional(),
  // The shopper's choices after the change; a purpose that is now false is withdrawn.
  analytics: z.boolean(),
  marketing: z.boolean(),
});

/**
 * LR-003 consent withdrawal, called by the storefront when the shopper
 * turns a tracking purpose off. Open to guests (the subject ID is a
 * random value only that browser holds); a signed-in customer's own
 * orders are covered as well. It can only remove consent, and the answer
 * is always 204 so it reveals nothing about which orders exist.
 */
const conversionRoutes: FastifyPluginAsync = async (fastify) => {
  const conversions = new ConversionService(fastify);

  fastify.post('/storefront/consent/withdrawal', { preHandler: fastify.tryCustomerAuth }, async (request, reply) => {
    const body = withdrawalSchema.parse(request.body);
    await conversions.withdrawConsent({ subjectId: body.subjectId, customerId: request.customer?.id }, body);
    reply.status(204).send();
  });
};

export default conversionRoutes;
