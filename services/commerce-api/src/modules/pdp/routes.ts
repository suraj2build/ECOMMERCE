import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { loadEnv } from '@fcp/config';
import { ValidationError } from '@fcp/shared';
import { PdpService } from './service.js';
import { ReviewService } from './review-service.js';
import { ServiceabilityService } from './serviceability-service.js';
import { CrossSellService } from './cross-sell-service.js';
import { CatalogService } from '../catalog/service.js';
import { PromotionService } from '../promotions/service.js';

/** One multipart file (fields before the file), size-limited by REVIEW_PHOTO_MAX_FILE_SIZE_BYTES. */
async function readPhotoUpload(request: FastifyRequest) {
  const max = loadEnv().REVIEW_PHOTO_MAX_FILE_SIZE_BYTES;
  let part;
  try {
    part = await request.file({ limits: { fileSize: max, files: 1 } });
  } catch {
    throw new ValidationError('Send the photo as a file upload (multipart/form-data)');
  }
  if (!part) throw new ValidationError('Choose a photo to upload');
  let buffer: Buffer;
  try {
    buffer = await part.toBuffer();
  } catch {
    throw new ValidationError(`The photo is larger than ${Math.round(max / 1048576)} MB`);
  }
  const field = (name: string) => {
    const f = (part.fields as Record<string, unknown>)[name] as { value?: unknown } | undefined;
    return typeof f?.value === 'string' ? f.value : undefined;
  };
  return { file: { buffer, filename: part.filename }, field };
}

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().optional(),
  body: z.string().min(1),
});

const pincodeSchema = z.object({
  pincode: z.string().regex(/^[0-9]{6}$/),
  city: z.string().min(1),
  state: z.string().min(1),
  isServiceable: z.boolean().optional(),
  codAvailable: z.boolean().optional(),
  estimatedDaysMin: z.number().int().nonnegative().optional(),
  estimatedDaysMax: z.number().int().nonnegative().optional(),
});

const crossSellSchema = z.object({
  relatedStyleId: z.string().uuid(),
  sortOrder: z.number().int().nonnegative().optional(),
});

const pdpRoutes: FastifyPluginAsync = async (fastify) => {
  const pdpService = new PdpService(fastify);
  const reviewService = new ReviewService(fastify);
  const serviceabilityService = new ServiceabilityService(fastify);
  const crossSellService = new CrossSellService(fastify);
  const catalogService = new CatalogService(fastify);
  const promotionService = new PromotionService(fastify);

  const moderateAuth = [fastify.requireStaffAuth, fastify.requirePermission('review:moderate')];
  const pincodeAuth = [fastify.requireStaffAuth, fastify.requirePermission('pincode:manage')];
  const crossSellAuth = [fastify.requireStaffAuth, fastify.requirePermission('catalog:cross_sell:manage')];

  // --- Public storefront reads (no auth) ---

  fastify.get('/storefront/products/:styleId', async (request, reply) => {
    const { styleId } = z.object({ styleId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await pdpService.getProductDetail(styleId));
  });

  // A PDP "Best Offers" teaser, honestly scoped: Promotion has no
  // product/category targeting (it's cart-subtotal-only by design), so
  // this asks the real promotion engine what would apply if this
  // product's own price were the entire cart - i.e. only AUTOMATIC
  // promotions (never a coupon code, which needs the shopper to supply
  // it) that this item alone already qualifies for. The storefront must
  // label this as an estimate, not a confirmed checkout discount.
  fastify.get('/storefront/products/:styleId/estimated-offers', async (request, reply) => {
    const { styleId } = z.object({ styleId: z.string().uuid() }).parse(request.params);
    const price = await catalogService.getActivePrice(styleId);
    if (!price) {
      reply.status(200).send({ offers: [] });
      return;
    }
    const evaluation = await promotionService.previewApplication(Number(price.sellingPrice), undefined);
    reply.status(200).send({
      offers: evaluation.applied.map((a) => ({ name: a.name, discountAmount: a.discountAmount })),
    });
  });

  // The shop-wide delivery and returns defaults the storefront may state
  // (home trust bar, footer). Shipping is flagged unconfirmed until
  // SHIPPING_RATES_CONFIRMED, so the storefront never presents an
  // unconfirmed threshold as a promise.
  fastify.get('/storefront/policies', async (_request, reply) => {
    const env = loadEnv();
    reply.status(200).send({
      shipping: {
        flatAmount: env.SHIPPING_DEFAULT_FLAT_AMOUNT,
        freeAboveAmount: env.SHIPPING_DEFAULT_FREE_ABOVE_THRESHOLD,
        currency: 'INR',
        confirmed: env.SHIPPING_RATES_CONFIRMED,
      },
      returns: { defaultWindowDays: env.RETURN_WINDOW_DEFAULT_DAYS },
    });
  });

  fastify.get('/storefront/serviceability', async (request, reply) => {
    const { pincode } = z.object({ pincode: z.string().regex(/^[0-9]{6}$/) }).parse(request.query);
    reply.status(200).send(await serviceabilityService.checkServiceability(pincode));
  });

  // specs/36: "What Our Customers Say" homepage carousel data.
  fastify.get('/storefront/reviews/featured', async (_request, reply) => {
    reply.status(200).send({ reviews: await pdpService.getFeaturedReviews() });
  });

  // specs/36: public photo bytes, served by review id so a hidden review's
  // photo 404s identically to one that never had a photo - never leaked.
  fastify.get('/storefront/reviews/:id/photo', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { buffer, mimeType } = await reviewService.getPhotoForPublicServe(id);
    reply
      .status(200)
      .header('Content-Type', mimeType)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(buffer);
  });

  // --- Customer-authenticated write ---

  fastify.post(
    '/storefront/products/:styleId/reviews',
    { preHandler: fastify.requireCustomerAuth },
    async (request, reply) => {
      const { styleId } = z.object({ styleId: z.string().uuid() }).parse(request.params);
      const body = reviewSchema.parse(request.body);
      const review = await reviewService.submitReview(request.customer!.id, { styleId, ...body });
      // Listing cards show the rating from the search index.
      await fastify.searchIndex.indexStyle(styleId);
      reply.status(201).send(review);
    },
  );

  // specs/36: attach one photo to the caller's own review. A separate
  // request from submitReview - always JSON there, always multipart here.
  fastify.post(
    '/pdp/reviews/:id/photo',
    { preHandler: fastify.requireCustomerAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { file, field } = await readPhotoUpload(request);
      const consent = field('consent') === 'true';
      const review = await reviewService.attachPhoto(id, request.customer!.id, file, consent);
      await fastify.searchIndex.indexStyle(review.styleId);
      reply.status(200).send(review);
    },
  );

  // --- Staff moderation / configuration ---

  fastify.post('/pdp/reviews/:id/hide', { preHandler: moderateAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const review = await reviewService.hideReview(id, request.staffUser!.id);
    await fastify.searchIndex.indexStyle(review.styleId);
    reply.status(200).send(review);
  });

  fastify.post('/pdp/reviews/:id/unhide', { preHandler: moderateAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const review = await reviewService.unhideReview(id, request.staffUser!.id);
    await fastify.searchIndex.indexStyle(review.styleId);
    reply.status(200).send(review);
  });

  // specs/36: staff curation list - every review that has a photo.
  fastify.get('/pdp/reviews', { preHandler: moderateAuth }, async (request, reply) => {
    const { take, skip } = z
      .object({ take: z.coerce.number().int().positive().max(200).optional(), skip: z.coerce.number().int().nonnegative().optional() })
      .parse(request.query);
    const { reviews, total } = await reviewService.listReviewsForCuration({ take, skip });
    reply.status(200).send({
      total,
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        status: r.status,
        createdAt: r.createdAt,
        customerName: r.customer.fullName ?? 'Anonymous',
        photoUrl: `/review-media/${r.id}`,
        featuredOnHome: r.featuredOnHome,
        featuredSortOrder: r.featuredSortOrder,
        style: r.style,
      })),
    });
  });

  fastify.patch('/pdp/reviews/:id/featured', { preHandler: moderateAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({ featuredOnHome: z.boolean(), featuredSortOrder: z.number().int().nullable().optional() })
      .parse(request.body);
    reply.status(200).send(await reviewService.setFeatured(id, request.staffUser!.id, body));
  });

  fastify.post('/pdp/pincodes', { preHandler: pincodeAuth }, async (request, reply) => {
    const body = pincodeSchema.parse(request.body);
    reply.status(200).send(await serviceabilityService.upsertPincode(body, request.staffUser!.id));
  });

  fastify.get('/pdp/pincodes', { preHandler: pincodeAuth }, async (request, reply) => {
    const { take, skip } = z
      .object({ take: z.coerce.number().int().positive().max(200).optional(), skip: z.coerce.number().int().nonnegative().optional() })
      .parse(request.query);
    reply.status(200).send(await serviceabilityService.listPincodes({ take, skip }));
  });

  fastify.post('/catalog/styles/:id/cross-sell', { preHandler: crossSellAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = crossSellSchema.parse(request.body);
    reply
      .status(201)
      .send(await crossSellService.addOverride(id, body.relatedStyleId, request.staffUser!.id, body.sortOrder));
  });

  fastify.delete(
    '/catalog/styles/:id/cross-sell/:relatedStyleId',
    { preHandler: crossSellAuth },
    async (request, reply) => {
      const { id, relatedStyleId } = z
        .object({ id: z.string().uuid(), relatedStyleId: z.string().uuid() })
        .parse(request.params);
      await crossSellService.removeOverride(id, relatedStyleId, request.staffUser!.id);
      reply.status(204).send();
    },
  );
};

export default pdpRoutes;
