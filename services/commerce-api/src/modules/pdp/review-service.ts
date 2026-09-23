import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';

export interface SubmitReviewInput {
  styleId: string;
  rating: number;
  title?: string;
  body: string;
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
}
