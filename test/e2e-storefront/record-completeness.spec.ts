import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@fcp/db';

const apiUrl = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const storefrontUrl = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';

test('sitemap includes products beyond 3000 and catalog paging skips unpriced styles correctly', async ({ request }) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const ids = Array.from({ length: 3005 }, () => randomUUID());
  const unpricedId = randomUUID();
  const brand = await prisma.brand.create({ data: { code: marker, name: 'Completeness test' } });
  const category = await prisma.category.create({ data: { name: 'Completeness test', slug: marker } });
  try {
    await prisma.style.createMany({ data: [...ids, unpricedId].map((id, i) => ({
      id, styleCode: `${marker}-${i}`, name: `Completeness ${i}`, brandId: brand.id, categoryId: category.id,
      season: 'SS26', collection: 'Core', lifecycleState: 'PUBLISHED', publishedAt: new Date('2090-01-01'),
    })) });
    await prisma.price.createMany({ data: ids.map((styleId) => ({ styleId, mrp: 100, sellingPrice: 100, effectiveFrom: new Date('2020-01-01') })) });
    const first = await request.get(`${apiUrl}/api/v1/storefront/styles?take=60`);
    const second = await request.get(`${apiUrl}/api/v1/storefront/styles?take=60&skip=60`);
    expect(first.ok()).toBeTruthy();
    expect(second.ok()).toBeTruthy();
    const a = await first.json() as Array<{ id: string }>;
    const b = await second.json() as Array<{ id: string }>;
    expect(a).toHaveLength(60);
    expect(b).toHaveLength(60);
    expect(new Set([...a, ...b].map((s) => s.id)).size).toBe(120);
    expect([...a, ...b].some((s) => s.id === unpricedId)).toBe(false);
    const sitemap = await request.get(`${storefrontUrl}/sitemap.xml`);
    expect(sitemap.ok()).toBeTruthy();
    const xml = await sitemap.text();
    const sitemapIds = new Set([...xml.matchAll(/\/product\/([\w-]+)/g)].map((match) => match[1]));
    expect(ids.filter((id) => sitemapIds.has(id))).toHaveLength(3005);
    expect(sitemapIds.has(unpricedId)).toBe(false);
  } finally {
    await prisma.price.deleteMany({ where: { styleId: { in: ids } } });
    await prisma.style.deleteMany({ where: { brandId: brand.id } });
    await prisma.category.delete({ where: { id: category.id } });
    await prisma.brand.delete({ where: { id: brand.id } });
    await prisma.$disconnect();
  }
});
