import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { ContentService } from '../../src/modules/content/service.js';

/**
 * M09 Watch & Shop certification (specs/35-watch-and-shop.md): lifecycle
 * state machine, staff-attribution/audit on every transition, the public
 * feed never leaking unpublished content, scheduled-publish effective
 * dating, multi-product tagging, and RBAC.
 */
describe('Watch & Shop (M09, specs/35)', () => {
  let app: FastifyInstance;
  let actorStaffId: string;
  let styleId: string;
  let colourId: string;
  let sizeId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    await grantPermissions('MARKETING', ['content:manage', 'content:moderate', 'content:read']);
    const auth = await createAuthenticatedStaff(app, ['MARKETING']);
    actorStaffId = auth.staffUserId;

    const { brand, category, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: 'WS-001', name: 'Watch & Shop Tee', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    styleId = style.id;
    colourId = colour.id;
    sizeId = size.id;
  });

  describe('Lifecycle state machine', () => {
    it('creates a media item in DRAFT and transitions through the moderation path to PUBLISHED', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia(
        { title: 'Autumn Drop', mediaUrl: 'https://cdn.example.com/v1.mp4' },
        actorStaffId,
      );
      expect(media.state).toBe('DRAFT');

      const pending = await content.transition(media.id, 'PENDING_MODERATION', actorStaffId);
      expect(pending.state).toBe('PENDING_MODERATION');

      const published = await content.transition(media.id, 'PUBLISHED', actorStaffId);
      expect(published.state).toBe('PUBLISHED');
      expect(published.publishedAt).not.toBeNull();
      expect(published.moderatedByStaffId).toBe(actorStaffId);
    });

    it('allows DRAFT to go straight to PUBLISHED when no moderation step is used', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia(
        { title: 'Direct Publish', mediaUrl: 'https://cdn.example.com/v2.mp4' },
        actorStaffId,
      );
      const published = await content.transition(media.id, 'PUBLISHED', actorStaffId);
      expect(published.state).toBe('PUBLISHED');
    });

    it('rejects an illegal transition (e.g. DRAFT directly to UNPUBLISHED)', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia(
        { title: 'Illegal Transition', mediaUrl: 'https://cdn.example.com/v3.mp4' },
        actorStaffId,
      );
      await expect(content.transition(media.id, 'UNPUBLISHED', actorStaffId)).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('records staff attribution and audit evidence on every transition', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia(
        { title: 'Audited Item', mediaUrl: 'https://cdn.example.com/v4.mp4' },
        actorStaffId,
      );
      await content.transition(media.id, 'PENDING_MODERATION', actorStaffId);
      await content.transition(media.id, 'REJECTED', actorStaffId, { moderationNote: 'Low video quality' });

      const auditRows = await testPrisma.auditLog.findMany({
        where: { entityType: 'ShoppableMedia', entityId: media.id },
        orderBy: { createdAt: 'asc' },
      });
      const actions = auditRows.map((r) => r.action);
      expect(actions).toContain('shoppable_media.create');
      expect(actions).toContain('shoppable_media.transition_to_pending_moderation');
      expect(actions).toContain('shoppable_media.transition_to_rejected');
      expect(auditRows.every((r) => r.actorStaffId === actorStaffId)).toBe(true);
    });

    it('allows a REJECTED item to be resubmitted to PENDING_MODERATION', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia(
        { title: 'Resubmit', mediaUrl: 'https://cdn.example.com/v5.mp4' },
        actorStaffId,
      );
      await content.transition(media.id, 'PENDING_MODERATION', actorStaffId);
      await content.transition(media.id, 'REJECTED', actorStaffId);
      const resubmitted = await content.transition(media.id, 'PENDING_MODERATION', actorStaffId);
      expect(resubmitted.state).toBe('PENDING_MODERATION');
    });
  });

  describe('Scheduling', () => {
    it('requires a future scheduledPublishAt when transitioning to SCHEDULED', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia(
        { title: 'Scheduled Item', mediaUrl: 'https://cdn.example.com/v6.mp4' },
        actorStaffId,
      );
      await expect(content.transition(media.id, 'SCHEDULED', actorStaffId)).rejects.toMatchObject({
        statusCode: 400,
      });
      await expect(
        content.transition(media.id, 'SCHEDULED', actorStaffId, { scheduledPublishAt: new Date(Date.now() - 1000) }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('a SCHEDULED item with a future date is NOT visible in the public feed', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia(
        { title: 'Future Drop', mediaUrl: 'https://cdn.example.com/v7.mp4' },
        actorStaffId,
      );
      await content.transition(media.id, 'SCHEDULED', actorStaffId, {
        scheduledPublishAt: new Date(Date.now() + 3_600_000),
      });

      const feed = await content.getPublicFeed();
      expect(feed.map((m) => m.id)).not.toContain(media.id);
    });

    it('a SCHEDULED item whose time has passed IS visible in the public feed without a manual state change', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia(
        { title: 'Due Drop', mediaUrl: 'https://cdn.example.com/v8.mp4' },
        actorStaffId,
      );
      await content.transition(media.id, 'SCHEDULED', actorStaffId, {
        scheduledPublishAt: new Date(Date.now() + 500),
      });
      await new Promise((resolve) => setTimeout(resolve, 700));

      const feed = await content.getPublicFeed();
      expect(feed.map((m) => m.id)).toContain(media.id);

      // Still SCHEDULED in the DB until explicitly promoted - the feed
      // query is fail-safe on its own, not dependent on promotion having run.
      const stillScheduled = await testPrisma.shoppableMedia.findUniqueOrThrow({ where: { id: media.id } });
      expect(stillScheduled.state).toBe('SCHEDULED');

      const promoted = await content.promoteDueScheduledMedia();
      expect(promoted).toBeGreaterThanOrEqual(1);
      const nowPublished = await testPrisma.shoppableMedia.findUniqueOrThrow({ where: { id: media.id } });
      expect(nowPublished.state).toBe('PUBLISHED');
    });

    it('a REJECTED item is never visible in the public feed regardless of merchandisingPosition', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia(
        { title: 'Rejected Item', mediaUrl: 'https://cdn.example.com/v9.mp4', merchandisingPosition: 0 },
        actorStaffId,
      );
      await content.transition(media.id, 'PENDING_MODERATION', actorStaffId);
      await content.transition(media.id, 'REJECTED', actorStaffId);

      const feed = await content.getPublicFeed();
      expect(feed.map((m) => m.id)).not.toContain(media.id);
    });

    it('a DRAFT/PENDING_MODERATION/UNPUBLISHED item is never visible in the public feed', async () => {
      const content = new ContentService(app);
      const draft = await content.createShoppableMedia({ title: 'Draft', mediaUrl: 'https://cdn.example.com/d.mp4' }, actorStaffId);
      const pending = await content.createShoppableMedia({ title: 'Pending', mediaUrl: 'https://cdn.example.com/p.mp4' }, actorStaffId);
      await content.transition(pending.id, 'PENDING_MODERATION', actorStaffId);
      const unpublished = await content.createShoppableMedia({ title: 'Unpublished', mediaUrl: 'https://cdn.example.com/u.mp4' }, actorStaffId);
      await content.transition(unpublished.id, 'PUBLISHED', actorStaffId);
      await content.transition(unpublished.id, 'UNPUBLISHED', actorStaffId);

      const feed = await content.getPublicFeed();
      const ids = feed.map((m) => m.id);
      expect(ids).not.toContain(draft.id);
      expect(ids).not.toContain(pending.id);
      expect(ids).not.toContain(unpublished.id);
    });
  });

  describe('Product tagging', () => {
    it('supports multiple tagged products per media item with explicit ordering', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia(
        { title: 'Multi-tag', mediaUrl: 'https://cdn.example.com/multi.mp4' },
        actorStaffId,
      );
      const brand2 = await testPrisma.brand.create({ data: { code: 'WSB2', name: 'Second Brand' } });
      const category = await testPrisma.category.findFirstOrThrow();
      const style2 = await testPrisma.style.create({
        data: { styleCode: 'WS-002', name: 'Second Style', brandId: brand2.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
      });

      await content.addTag(media.id, { styleId, colourId, sizeId, sortOrder: 1 }, actorStaffId);
      await content.addTag(media.id, { styleId: style2.id, sortOrder: 0 }, actorStaffId);

      const reread = await content.getById(media.id);
      expect(reread.tags).toHaveLength(2);
      expect(reread.tags[0]!.styleId).toBe(style2.id); // sortOrder 0 first
      expect(reread.tags[1]!.styleId).toBe(styleId);
    });

    it('rejects a colour that does not belong to the tagged style', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia(
        { title: 'Cross-style colour', mediaUrl: 'https://cdn.example.com/cross.mp4' },
        actorStaffId,
      );
      const brand2 = await testPrisma.brand.create({ data: { code: 'WSB3', name: 'Third Brand' } });
      const category = await testPrisma.category.findFirstOrThrow();
      const style2 = await testPrisma.style.create({
        data: { styleCode: 'WS-003', name: 'Third Style', brandId: brand2.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
      });
      const foreignColour = await testPrisma.colour.create({ data: { styleId: style2.id, name: 'Blue', colourCode: 'BLU' } });

      await expect(
        content.addTag(media.id, { styleId, colourId: foreignColour.id }, actorStaffId),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('removes a tag', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia({ title: 'Untag me', mediaUrl: 'https://cdn.example.com/untag.mp4' }, actorStaffId);
      const tag = await content.addTag(media.id, { styleId }, actorStaffId);
      await content.removeTag(tag.id, actorStaffId);
      const reread = await content.getById(media.id);
      expect(reread.tags).toHaveLength(0);
    });
  });

  describe('Analytics event capture', () => {
    it('records a VIEW/TAG_TAP/ADD_TO_BAG event only against PUBLISHED media', async () => {
      const content = new ContentService(app);
      const media = await content.createShoppableMedia({ title: 'Events', mediaUrl: 'https://cdn.example.com/ev.mp4' }, actorStaffId);

      await expect(content.recordEvent(media.id, 'VIEW', { sessionRef: 'sess-1' })).rejects.toMatchObject({
        statusCode: 400,
      });

      await content.transition(media.id, 'PUBLISHED', actorStaffId);
      const event = await content.recordEvent(media.id, 'VIEW', { sessionRef: 'sess-1' });
      expect(event.eventType).toBe('VIEW');

      const events = await testPrisma.shoppableMediaEvent.findMany({ where: { shoppableMediaId: media.id } });
      expect(events).toHaveLength(1);
    });
  });

  describe('HTTP-layer authorization', () => {
    it('rejects content writes without content:manage permission', async () => {
      const { token } = await createAuthenticatedStaff(app, []);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/content/shoppable-media',
        headers: { authorization: `Bearer ${token}` },
        payload: { title: 'Should not be created', mediaUrl: 'https://cdn.example.com/no.mp4' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('exposes the public feed with no auth required', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/content/watch-and-shop/feed' });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    it('allows a MARKETING-role staff member to manage content end to end via HTTP', async () => {
      const { token } = await createAuthenticatedStaff(app, ['MARKETING']);
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/content/shoppable-media',
        headers: { authorization: `Bearer ${token}` },
        payload: { title: 'HTTP Item', mediaUrl: 'https://cdn.example.com/http.mp4' },
      });
      expect(createRes.statusCode).toBe(201);

      const transitionRes = await app.inject({
        method: 'POST',
        url: `/api/v1/content/shoppable-media/${createRes.json().id}/transition`,
        headers: { authorization: `Bearer ${token}` },
        payload: { toState: 'PUBLISHED' },
      });
      expect(transitionRes.statusCode).toBe(200);

      const feedRes = await app.inject({ method: 'GET', url: '/api/v1/content/watch-and-shop/feed' });
      expect(feedRes.json().map((m: { id: string }) => m.id)).toContain(createRes.json().id);
    });
  });
});
