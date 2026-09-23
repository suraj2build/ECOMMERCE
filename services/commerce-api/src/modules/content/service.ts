import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';

export type ShoppableMediaState =
  | 'DRAFT'
  | 'PENDING_MODERATION'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'UNPUBLISHED'
  | 'REJECTED';

export interface CreateShoppableMediaInput {
  title: string;
  mediaUrl: string;
  thumbnailUrl?: string;
  creatorAttribution?: string;
  campaignRef?: string;
  merchandisingPosition?: number;
}

export interface AddTagInput {
  styleId: string;
  colourId?: string;
  sizeId?: string;
  sortOrder?: number;
}

const ALLOWED_TRANSITIONS: Record<ShoppableMediaState, ShoppableMediaState[]> = {
  DRAFT: ['PENDING_MODERATION', 'PUBLISHED', 'SCHEDULED'],
  PENDING_MODERATION: ['PUBLISHED', 'SCHEDULED', 'REJECTED'],
  SCHEDULED: ['PUBLISHED', 'UNPUBLISHED'],
  PUBLISHED: ['UNPUBLISHED'],
  UNPUBLISHED: ['PUBLISHED', 'SCHEDULED'],
  REJECTED: ['PENDING_MODERATION'],
};

/**
 * Watch & Shop content management (M09, specs/35-watch-and-shop.md).
 * A discovery surface over the SAME commerce data PDP/Cart use -
 * ShoppableMediaTag only ever stores a Style(+Colour+Size) reference,
 * never a copy of price/availability. Every lifecycle transition is
 * staff-attributed and audited, exactly like `catalog:publish`.
 */
export class ContentService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  async createShoppableMedia(input: CreateShoppableMediaInput, actorStaffId: string) {
    if (!input.title.trim()) throw new ValidationError('title is required');
    if (!input.mediaUrl.trim()) throw new ValidationError('mediaUrl is required');

    const media = await this.prisma.shoppableMedia.create({
      data: {
        title: input.title,
        mediaUrl: input.mediaUrl,
        thumbnailUrl: input.thumbnailUrl,
        creatorAttribution: input.creatorAttribution,
        campaignRef: input.campaignRef,
        merchandisingPosition: input.merchandisingPosition ?? 0,
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'shoppable_media.create',
      entityType: 'ShoppableMedia',
      entityId: media.id,
      newValue: input,
    });
    return media;
  }

  async addTag(mediaId: string, input: AddTagInput, actorStaffId: string) {
    const media = await this.prisma.shoppableMedia.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundError('ShoppableMedia', mediaId);

    const style = await this.prisma.style.findUnique({ where: { id: input.styleId } });
    if (!style) throw new NotFoundError('Style', input.styleId);

    if (input.colourId) {
      const colour = await this.prisma.colour.findUnique({ where: { id: input.colourId } });
      if (!colour || colour.styleId !== input.styleId) {
        throw new ValidationError(`Colour '${input.colourId}' does not belong to style '${input.styleId}'`);
      }
    }
    if (input.sizeId) {
      const size = await this.prisma.size.findUnique({ where: { id: input.sizeId } });
      if (!size) throw new NotFoundError('Size', input.sizeId);
    }

    const tag = await this.prisma.shoppableMediaTag.create({
      data: {
        shoppableMediaId: mediaId,
        styleId: input.styleId,
        colourId: input.colourId,
        sizeId: input.sizeId,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'shoppable_media.tag_add',
      entityType: 'ShoppableMedia',
      entityId: mediaId,
      newValue: input,
    });
    return tag;
  }

  async removeTag(tagId: string, actorStaffId: string) {
    const tag = await this.prisma.shoppableMediaTag.findUnique({ where: { id: tagId } });
    if (!tag) throw new NotFoundError('ShoppableMediaTag', tagId);
    await this.prisma.shoppableMediaTag.delete({ where: { id: tagId } });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'shoppable_media.tag_remove',
      entityType: 'ShoppableMedia',
      entityId: tag.shoppableMediaId,
      oldValue: tag,
    });
  }

  async transition(
    mediaId: string,
    toState: ShoppableMediaState,
    actorStaffId: string,
    opts: { scheduledPublishAt?: Date; moderationNote?: string } = {},
  ) {
    const media = await this.prisma.shoppableMedia.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundError('ShoppableMedia', mediaId);

    const allowed = ALLOWED_TRANSITIONS[media.state];
    if (!allowed.includes(toState)) {
      throw new ValidationError(`Cannot transition ShoppableMedia from '${media.state}' to '${toState}'`);
    }
    if (toState === 'SCHEDULED' && !opts.scheduledPublishAt) {
      throw new ValidationError('scheduledPublishAt is required when transitioning to SCHEDULED');
    }
    if (toState === 'SCHEDULED' && opts.scheduledPublishAt && opts.scheduledPublishAt <= new Date()) {
      throw new ValidationError('scheduledPublishAt must be in the future');
    }

    const updated = await this.prisma.shoppableMedia.update({
      where: { id: mediaId },
      data: {
        state: toState,
        scheduledPublishAt: toState === 'SCHEDULED' ? opts.scheduledPublishAt : media.scheduledPublishAt,
        publishedAt: toState === 'PUBLISHED' ? new Date() : media.publishedAt,
        moderatedByStaffId:
          toState === 'PUBLISHED' || toState === 'REJECTED' ? actorStaffId : media.moderatedByStaffId,
        moderationNote: opts.moderationNote ?? media.moderationNote,
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: `shoppable_media.transition_to_${toState.toLowerCase()}`,
      entityType: 'ShoppableMedia',
      entityId: mediaId,
      oldValue: { state: media.state },
      newValue: { state: toState, ...opts },
    });
    return updated;
  }

  /** Flips SCHEDULED rows past their scheduledPublishAt to PUBLISHED - callable directly or by a future scheduler. */
  async promoteDueScheduledMedia(): Promise<number> {
    const due = await this.prisma.shoppableMedia.findMany({
      where: { state: 'SCHEDULED', scheduledPublishAt: { lte: new Date() } },
    });
    for (const item of due) {
      await this.prisma.shoppableMedia.update({
        where: { id: item.id },
        data: { state: 'PUBLISHED', publishedAt: new Date() },
      });
      await recordAudit(this.prisma, {
        actorType: 'SYSTEM',
        action: 'shoppable_media.transition_to_published',
        entityType: 'ShoppableMedia',
        entityId: item.id,
        oldValue: { state: 'SCHEDULED' },
        newValue: { state: 'PUBLISHED', reason: 'scheduled_publish_due' },
      });
    }
    return due.length;
  }

  /**
   * Public storefront feed: PUBLISHED items, plus SCHEDULED items whose
   * time has passed (fail-safe even if promoteDueScheduledMedia() hasn't
   * run yet) - never a DRAFT/PENDING_MODERATION/UNPUBLISHED/REJECTED item,
   * regardless of merchandisingPosition.
   */
  async getPublicFeed(atDate: Date = new Date()) {
    const items = await this.prisma.shoppableMedia.findMany({
      where: {
        OR: [{ state: 'PUBLISHED' }, { state: 'SCHEDULED', scheduledPublishAt: { lte: atDate } }],
      },
      include: {
        tags: { orderBy: { sortOrder: 'asc' }, include: { style: true, colour: true, size: true } },
      },
      orderBy: [{ merchandisingPosition: 'asc' }, { publishedAt: 'desc' }],
    });
    return items;
  }

  async listAllForStaff(state?: ShoppableMediaState) {
    return this.prisma.shoppableMedia.findMany({
      where: state ? { state } : undefined,
      include: { tags: { orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ merchandisingPosition: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getById(id: string) {
    const media = await this.prisma.shoppableMedia.findUnique({
      where: { id },
      include: { tags: { orderBy: { sortOrder: 'asc' }, include: { style: true, colour: true, size: true } } },
    });
    if (!media) throw new NotFoundError('ShoppableMedia', id);
    return media;
  }

  /** Event capture only (spec 35) - no dashboards/reporting built here. Refuses events against non-public media to avoid using this as an enumeration probe. */
  async recordEvent(
    mediaId: string,
    eventType: 'VIEW' | 'TAG_TAP' | 'ADD_TO_BAG',
    actor: { customerId?: string; sessionRef?: string },
  ) {
    const media = await this.prisma.shoppableMedia.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundError('ShoppableMedia', mediaId);
    if (media.state !== 'PUBLISHED') {
      throw new ValidationError('Cannot record an event against media that is not currently published');
    }
    return this.prisma.shoppableMediaEvent.create({
      data: {
        shoppableMediaId: mediaId,
        eventType,
        actorType: 'CUSTOMER',
        customerId: actor.customerId,
        sessionRef: actor.sessionRef,
      },
    });
  }
}
