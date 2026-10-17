import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { ForbiddenError, NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { preparePublicImage } from '../../lib/image-validation.js';
import { newReviewPhotoKey, resolveReviewPhotoStore, type ReviewPhotoStore } from './review-photo-storage.js';

export interface SubmitReviewInput {
  styleId: string;
  rating: number;
  title?: string;
  body: string;
}

export interface SetFeaturedInput {
  featuredOnHome: boolean;
  featuredSortOrder?: number | null;
}

/**
 * Ratings & reviews (M11, PDP-001). Auto-published on submission - see
 * the Review model's docblock in schema.prisma for why. One review per
 * customer per style is DB-enforced, so a rating/count can never be
 * inflated by repeat submissions.
 */
export class ReviewService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  async submitReview(customerId: string, input: SubmitReviewInput) {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new ValidationError('rating must be an integer between 1 and 5');
    }
    if (!input.body?.trim()) {
      throw new ValidationError('body is required');
    }
    const style = await this.prisma.style.findUnique({ where: { id: input.styleId } });
    if (!style) throw new NotFoundError('Style', input.styleId);

    const existing = await this.prisma.review.findUnique({
      where: { styleId_customerId: { styleId: input.styleId, customerId } },
    });
    if (existing) throw new ValidationError('You have already reviewed this product');

    return this.prisma.review.create({
      data: { styleId: input.styleId, customerId, rating: input.rating, title: input.title, body: input.body },
    });
  }

  /** Public: published reviews for a style, most recent first. */
  async listPublishedReviews(styleId: string, params: { take?: number; skip?: number } = {}) {
    const take = Math.min(params.take ?? 10, 50);
    const skip = params.skip ?? 0;
    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where: { styleId, status: 'PUBLISHED' },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: { customer: { select: { fullName: true } } },
      }),
      this.prisma.review.count({ where: { styleId, status: 'PUBLISHED' } }),
    ]);
    return { reviews, total };
  }

  /** Always computed live from PUBLISHED rows - never a cached/fabricated count. */
  async getRatingSummary(styleId: string) {
    const agg = await this.prisma.review.aggregate({
      where: { styleId, status: 'PUBLISHED' },
      _avg: { rating: true },
      _count: { _all: true },
    });
    return { averageRating: agg._avg.rating, reviewCount: agg._count._all };
  }

  async hideReview(reviewId: string, actorStaffId: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundError('Review', reviewId);
    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'HIDDEN', moderatedByStaffId: actorStaffId, moderatedAt: new Date() },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'review.hide',
      entityType: 'Review',
      entityId: reviewId,
      oldValue: { status: review.status },
      newValue: { status: 'HIDDEN' },
    });
    return updated;
  }

  async unhideReview(reviewId: string, actorStaffId: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundError('Review', reviewId);
    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'PUBLISHED', moderatedByStaffId: actorStaffId, moderatedAt: new Date() },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'review.unhide',
      entityType: 'Review',
      entityId: reviewId,
      oldValue: { status: review.status },
      newValue: { status: 'PUBLISHED' },
    });
    return updated;
  }

  private storeInstance?: ReviewPhotoStore;
  private get store(): ReviewPhotoStore {
    this.storeInstance ??= resolveReviewPhotoStore();
    return this.storeInstance;
  }

  /**
   * specs/36. Auto-published with the review itself - no separate
   * moderation gate. consent must be explicitly true in THIS request;
   * a photo can never be stored without photoConsentAt being set in the
   * same call (RESOLUTION, specs/36).
   */
  async attachPhoto(reviewId: string, customerId: string, file: { buffer: Buffer; filename?: string }, consent: boolean) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundError('Review', reviewId);
    if (review.customerId !== customerId) throw new ForbiddenError('You can only add a photo to your own review');
    if (!consent) throw new ValidationError('Confirm the photo may be shown publicly before uploading it');

    const prepared = await preparePublicImage(file.buffer, 'photo');
    const key = newReviewPhotoKey(prepared.mimeType);
    try {
      await this.store.put(key, prepared.buffer, prepared.mimeType);
    } catch {
      throw new ValidationError('Could not save the photo. Try again.');
    }

    return this.prisma.review.update({
      where: { id: reviewId },
      data: { photoKey: key, photoConsentAt: new Date() },
    });
  }

  /** 404s identically whether the review has no photo or is hidden - never leaks a hidden review's existence. */
  async getPhotoForPublicServe(reviewId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review || review.status !== 'PUBLISHED' || !review.photoKey) throw new NotFoundError('Review photo', reviewId);
    return this.store.get(review.photoKey);
  }

  /**
   * specs/36. featuredOnHome can only be set true on a review that has a
   * photo and is not HIDDEN - rejected outright, never silently ignored.
   */
  async setFeatured(reviewId: string, actorStaffId: string, input: SetFeaturedInput) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundError('Review', reviewId);
    if (input.featuredOnHome) {
      if (!review.photoKey) throw new ValidationError('Only a review with a photo can be featured on the homepage');
      if (review.status === 'HIDDEN') throw new ValidationError('A hidden review cannot be featured on the homepage');
    }

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { featuredOnHome: input.featuredOnHome, featuredSortOrder: input.featuredSortOrder ?? null },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'review.feature',
      entityType: 'Review',
      entityId: reviewId,
      oldValue: { featuredOnHome: review.featuredOnHome, featuredSortOrder: review.featuredSortOrder },
      newValue: { featuredOnHome: updated.featuredOnHome, featuredSortOrder: updated.featuredSortOrder },
    });
    return updated;
  }

  /** Staff curation list: reviews with a photo, most recently photographed first. */
  async listReviewsForCuration(params: { take?: number; skip?: number } = {}) {
    const take = Math.min(params.take ?? 25, 100);
    const skip = params.skip ?? 0;
    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where: { photoKey: { not: null } },
        orderBy: [{ featuredOnHome: 'desc' }, { updatedAt: 'desc' }],
        take,
        skip,
        include: { customer: { select: { fullName: true } }, style: { select: { id: true, name: true } } },
      }),
      this.prisma.review.count({ where: { photoKey: { not: null } } }),
    ]);
    return { reviews, total };
  }

  /**
   * Public homepage data: only featured, published, photographed reviews.
   * Price is NOT included here - a review's style has no cached price on
   * the Review/Style rows, so the live price must be composed by the
   * caller (PdpService.getFeaturedReviews) via CatalogService, the same
   * single source of price truth every other public listing uses.
   */
  async listFeaturedReviews() {
    return this.prisma.review.findMany({
      where: { featuredOnHome: true, status: 'PUBLISHED', photoKey: { not: null } },
      orderBy: [{ featuredSortOrder: 'asc' }, { updatedAt: 'desc' }],
      include: {
        customer: { select: { fullName: true } },
        style: { select: { id: true, name: true, media: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } } } },
      },
    });
  }
}
