import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CustomerProfileService } from './service.js';

const addressSchema = z.object({
  label: z.string().max(60).optional(),
  recipientName: z.string().min(1).max(120),
  recipientMobile: z.string().regex(/^[0-9]{10}$/, 'recipientMobile must be a 10-digit number'),
  line1: z.string().min(1),
  line2: z.string().optional(),
  landmark: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  stateCode: z.string().min(2).max(4),
  pincode: z.string().regex(/^[0-9]{6}$/),
});
const createAddressSchema = addressSchema.extend({ isDefault: z.boolean().optional() });
const updateAddressSchema = addressSchema.partial();

const profileUpdateSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
});

const savedSizeSchema = z.object({ categoryId: z.string().uuid(), sizeId: z.string().uuid() });

const communicationChannelEnum = z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'PUSH']);
const communicationMessageTypeEnum = z.enum(['ORDER_UPDATES', 'OFFERS_AND_PROMOTIONS', 'PRODUCT_RECOMMENDATIONS', 'NEWSLETTER']);
const communicationPreferencesSchema = z.object({
  preferences: z
    .array(z.object({ channel: communicationChannelEnum, messageType: communicationMessageTypeEnum, optedIn: z.boolean() }))
    .min(1)
    .max(64),
});

/**
 * M22 Customer 360 storefront routes - every route here is authenticated-
 * customer-only (`requireCustomerAuth`, never `tryCustomerAuth`/a guest
 * fallback): a saved profile, address book, "My Sizes" set, and
 * communication-preference matrix are genuinely account-scoped concepts
 * with no guest analogue in this codebase. The customer id is ALWAYS
 * read from `request.customer!.id` (the verified JWT `sub`) - never from
 * a body/query/param - per this build's own absolute IDOR boundary.
 * Order history, wishlist, and store credit already have their own
 * storefront routes (M12/M15/M20) and are deliberately not duplicated
 * here.
 */
const customerProfileRoutes: FastifyPluginAsync = async (fastify) => {
  const profile = new CustomerProfileService(fastify);
  const auth = { preHandler: fastify.requireCustomerAuth };

  // --- Profile ---

  fastify.get('/storefront/account/profile', auth, async (request, reply) => {
    reply.status(200).send(await profile.getProfile(request.customer!.id));
  });

  fastify.patch('/storefront/account/profile', auth, async (request, reply) => {
    const body = profileUpdateSchema.parse(request.body);
    reply.status(200).send(await profile.updateProfile(request.customer!.id, body));
  });

  // --- Address book ---

  fastify.get('/storefront/account/addresses', auth, async (request, reply) => {
    reply.status(200).send(await profile.listAddresses(request.customer!.id));
  });

  fastify.post('/storefront/account/addresses', auth, async (request, reply) => {
    const body = createAddressSchema.parse(request.body);
    reply.status(201).send(await profile.createAddress(request.customer!.id, body));
  });

  fastify.patch('/storefront/account/addresses/:id', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateAddressSchema.parse(request.body);
    reply.status(200).send(await profile.updateAddress(request.customer!.id, id, body));
  });

  fastify.post('/storefront/account/addresses/:id/default', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await profile.setDefaultAddress(request.customer!.id, id));
  });

  fastify.delete('/storefront/account/addresses/:id', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await profile.deleteAddress(request.customer!.id, id);
    reply.status(204).send();
  });

  // --- Recently viewed ---

  fastify.post('/storefront/account/recently-viewed/:styleId', auth, async (request, reply) => {
    const { styleId } = z.object({ styleId: z.string().uuid() }).parse(request.params);
    await profile.recordProductView(request.customer!.id, styleId);
    reply.status(204).send();
  });

  fastify.get('/storefront/account/recently-viewed', auth, async (request, reply) => {
    const { limit } = z.object({ limit: z.coerce.number().int().positive().max(50).optional() }).parse(request.query);
    reply.status(200).send(await profile.listRecentlyViewed(request.customer!.id, limit));
  });

  // --- My Sizes: public reference-data reads for the size picker ---

  fastify.get('/storefront/categories', async (_request, reply) => {
    reply.status(200).send(await profile.listCategoriesForSizePicker());
  });

  fastify.get('/storefront/sizes', async (_request, reply) => {
    reply.status(200).send(await profile.listSizesForSizePicker());
  });

  // --- My Sizes ---

  fastify.get('/storefront/account/sizes', auth, async (request, reply) => {
    reply.status(200).send(await profile.listSavedSizes(request.customer!.id));
  });

  fastify.put('/storefront/account/sizes', auth, async (request, reply) => {
    const body = savedSizeSchema.parse(request.body);
    reply.status(200).send(await profile.saveSize(request.customer!.id, body.categoryId, body.sizeId));
  });

  fastify.delete('/storefront/account/sizes/:id', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await profile.removeSavedSize(request.customer!.id, id);
    reply.status(204).send();
  });

  // --- My reviews ---

  fastify.get('/storefront/account/reviews', auth, async (request, reply) => {
    reply.status(200).send(await profile.listMyReviews(request.customer!.id));
  });

  // --- Communication preferences ---

  fastify.get('/storefront/account/communication-preferences', auth, async (request, reply) => {
    reply.status(200).send(await profile.getCommunicationPreferences(request.customer!.id));
  });

  fastify.put('/storefront/account/communication-preferences', auth, async (request, reply) => {
    const body = communicationPreferencesSchema.parse(request.body);
    reply.status(200).send(await profile.setCommunicationPreferences(request.customer!.id, body.preferences));
  });
};

export default customerProfileRoutes;
