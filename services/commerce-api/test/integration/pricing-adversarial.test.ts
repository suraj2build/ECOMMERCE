import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { CatalogService } from '../../src/modules/catalog/service.js';

/**
 * Certification-pass pricing round (CAT-001): overlapping schedules,
 * multiple simultaneous markdowns, colour-specific vs style-wide
 * precedence, exact boundary instants, expired/future markdown handling,
 * zero/negative price rejection, and the audit trail. getActivePrice()'s
 * tie-break order (specificity, then markdown-over-base, then most-recent
 * effectiveFrom) must resolve every overlap deterministically - never
 * ambiguously.
 */
describe('Pricing certification (CAT-001)', () => {
  let app: FastifyInstance;
  let styleId: string;
  let colourId: string;
  let actorStaffId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    const { brand, category } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: 'PA-001', name: 'Pricing Adversarial', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    styleId = style.id;
    colourId = colour.id;
    actorStaffId = (await testPrisma.staffUser.create({ data: { email: 'pa-staff@example.com', passwordHash: 'x', fullName: 'PA Staff' } })).id;
  });

  it('rejects a zero or negative MRP/selling price', async () => {
    const catalog = new CatalogService(app);
    await expect(catalog.setBasePrice({ styleId, mrp: 0, sellingPrice: 0 }, actorStaffId)).rejects.toThrow(/positive/i);
    await expect(catalog.setBasePrice({ styleId, mrp: 1000, sellingPrice: -100 }, actorStaffId)).rejects.toThrow(/positive/i);
    await expect(catalog.setBasePrice({ styleId, mrp: -100, sellingPrice: 50 }, actorStaffId)).rejects.toThrow(/positive/i);
  });

  it('resolves two overlapping markdowns for the same scope deterministically (most recent effectiveFrom wins)', async () => {
    const catalog = new CatalogService(app);
    const now = Date.now();
    await catalog.setBasePrice({ styleId, mrp: 1000, sellingPrice: 1000 }, actorStaffId);

    // Two markdowns overlapping at `now`: an older one (60% off) and a
    // newer one (50% off) both active right now.
    await catalog.setMarkdownPrice(
      { styleId, mrp: 1000, sellingPrice: 400, effectiveFrom: new Date(now - 120_000), effectiveTo: new Date(now + 3_600_000) },
      actorStaffId,
    );
    await catalog.setMarkdownPrice(
      { styleId, mrp: 1000, sellingPrice: 500, effectiveFrom: new Date(now - 60_000), effectiveTo: new Date(now + 3_600_000) },
      actorStaffId,
    );

    const active = await catalog.getActivePrice(styleId, undefined, new Date(now));
    expect(Number(active!.sellingPrice)).toBe(500); // the later-starting markdown wins, deterministically
  });

  it('resolves three simultaneously-active markdowns deterministically', async () => {
    const catalog = new CatalogService(app);
    const now = Date.now();
    await catalog.setBasePrice({ styleId, mrp: 1000, sellingPrice: 1000 }, actorStaffId);

    for (const [offsetMinutesAgo, price] of [[10, 700], [5, 600], [1, 550]] as const) {
      await catalog.setMarkdownPrice(
        {
          styleId,
          mrp: 1000,
          sellingPrice: price,
          effectiveFrom: new Date(now - offsetMinutesAgo * 60_000),
          effectiveTo: new Date(now + 3_600_000),
        },
        actorStaffId,
      );
    }

    const active = await catalog.getActivePrice(styleId, undefined, new Date(now));
    expect(Number(active!.sellingPrice)).toBe(550); // most recently started of the three
  });

  it('a colour-specific price outranks a style-wide price even if the style-wide one started more recently', async () => {
    const catalog = new CatalogService(app);
    const now = Date.now();
    await catalog.setBasePrice({ styleId, mrp: 1000, sellingPrice: 999, effectiveFrom: new Date(now - 1000) }, actorStaffId);
    await catalog.setBasePrice({ styleId, colourId, mrp: 1000, sellingPrice: 850, effectiveFrom: new Date(now - 60_000) }, actorStaffId);

    const active = await catalog.getActivePrice(styleId, colourId, new Date(now));
    expect(Number(active!.sellingPrice)).toBe(850); // colour-specific wins on specificity, not recency
  });

  it('a price is active at the exact instant of its effectiveTo boundary, and inactive one second later', async () => {
    const catalog = new CatalogService(app);
    const now = Date.now();
    const boundary = new Date(now + 10_000);
    await catalog.setMarkdownPrice(
      { styleId, mrp: 1000, sellingPrice: 500, effectiveFrom: new Date(now - 60_000), effectiveTo: boundary },
      actorStaffId,
    );

    const atBoundary = await catalog.getActivePrice(styleId, undefined, boundary);
    expect(Number(atBoundary!.sellingPrice)).toBe(500);

    const afterBoundary = await catalog.getActivePrice(styleId, undefined, new Date(boundary.getTime() + 1000));
    expect(afterBoundary).toBeNull(); // no base price exists in this test, so it correctly falls through to nothing
  });

  it('an expired markdown falls back to the base price', async () => {
    const catalog = new CatalogService(app);
    const now = Date.now();
    await catalog.setBasePrice({ styleId, mrp: 1000, sellingPrice: 1000, effectiveFrom: new Date(now - 7 * 86_400_000) }, actorStaffId);
    await catalog.setMarkdownPrice(
      { styleId, mrp: 1000, sellingPrice: 500, effectiveFrom: new Date(now - 48 * 3_600_000), effectiveTo: new Date(now - 24 * 3_600_000) },
      actorStaffId,
    );

    const active = await catalog.getActivePrice(styleId, undefined, new Date(now));
    expect(Number(active!.sellingPrice)).toBe(1000);
    expect(active!.isMarkdown).toBe(false);
  });

  it('a future-scheduled markdown does not activate early - base price applies until then', async () => {
    const catalog = new CatalogService(app);
    const now = Date.now();
    await catalog.setBasePrice({ styleId, mrp: 1000, sellingPrice: 1000, effectiveFrom: new Date(now - 1000) }, actorStaffId);
    await catalog.setMarkdownPrice(
      { styleId, mrp: 1000, sellingPrice: 400, effectiveFrom: new Date(now + 24 * 3_600_000), effectiveTo: new Date(now + 48 * 3_600_000) },
      actorStaffId,
    );

    const active = await catalog.getActivePrice(styleId, undefined, new Date(now));
    expect(Number(active!.sellingPrice)).toBe(1000);
    expect(active!.isMarkdown).toBe(false);

    // But it does activate once its window starts.
    const duringFutureWindow = await catalog.getActivePrice(styleId, undefined, new Date(now + 30 * 3_600_000));
    expect(Number(duringFutureWindow!.sellingPrice)).toBe(400);
  });

  it('records an audit entry with old/new values for a price change', async () => {
    const catalog = new CatalogService(app);
    await catalog.setBasePrice({ styleId, mrp: 1000, sellingPrice: 999 }, actorStaffId);

    const entries = await testPrisma.auditLog.findMany({ where: { action: 'price.set_base', actorStaffId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reference).toBe(styleId);
    const newValue = entries[0]!.newValue as Record<string, unknown>;
    expect(newValue.sellingPrice).toBe(999);
  });

  it('records a distinct audit action for a markdown price change', async () => {
    const catalog = new CatalogService(app);
    const now = Date.now();
    await catalog.setMarkdownPrice(
      { styleId, mrp: 1000, sellingPrice: 700, effectiveFrom: new Date(now), effectiveTo: new Date(now + 3_600_000) },
      actorStaffId,
    );

    const entries = await testPrisma.auditLog.findMany({ where: { action: 'price.set_markdown', actorStaffId } });
    expect(entries).toHaveLength(1);
  });

  it('markdown pricing rejects a request missing effectiveFrom/effectiveTo', async () => {
    const catalog = new CatalogService(app);
    await expect(
      catalog.setMarkdownPrice({ styleId, mrp: 1000, sellingPrice: 500 }, actorStaffId),
    ).rejects.toThrow(/requires both effectiveFrom and effectiveTo/i);
  });

  it('rejects setting a price for a colour that does not belong to the given style', async () => {
    const catalog = new CatalogService(app);
    const brand = await testPrisma.brand.findFirstOrThrow();
    const category = await testPrisma.category.findFirstOrThrow();
    const otherStyle = await testPrisma.style.create({
      data: { styleCode: 'PA-002', name: 'Other Style', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const otherColour = await testPrisma.colour.create({ data: { styleId: otherStyle.id, name: 'White', colourCode: 'WHT' } });

    await expect(
      catalog.setBasePrice({ styleId, colourId: otherColour.id, mrp: 1000, sellingPrice: 999 }, actorStaffId),
    ).rejects.toThrow(/does not belong to style/i);
  });
});
