/**
 * M32 Performance/Scale (acceptance/m32-performance-load.md) - generates
 * a representative-scale catalog/order dataset directly against the DB
 * for EXPLAIN ANALYZE and load-test measurement. NEVER invoked outside
 * local/CI/sandbox environments (no wiring into any deploy pipeline,
 * same isolation discipline as seed.ts).
 *
 * Scale: 2,000 styles x 2 colours x 4 sizes = 16,000 SKUs - within the
 * approved 10,000-50,000 SKU operating envelope
 * (blueprint/NON_FUNCTIONAL_REQUIREMENTS.md), scaled to the LOWER half
 * of that range rather than its upper bound, since this sandbox has a
 * fixed, shared disk/CPU allowance, not dedicated load-test hardware -
 * generating and then repeatedly querying 50k SKUs' worth of related
 * rows (colours/sizes/prices/inventory/media) here would risk exhausting
 * this environment's own resource ceiling before ever reaching the
 * actual query-plan/latency measurement this script exists to produce.
 * The chosen scale is still large enough to force Postgres off any
 * small-table sequential-scan-is-fine plan and reveal a genuinely
 * missing index, which is what EXPLAIN ANALYZE against this data is
 * actually checking for.
 *
 * Uses direct bulk createMany() calls, NOT the service layer - this is
 * synthetic load-test fixture data, not a correctness proof (M06/M13/M14
 * etc.'s own adversarial test suites already prove business-rule
 * correctness under real concurrency); generating it through
 * ProductService/InventoryService one row at a time would take
 * hours at this scale for no additional signal.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/client/index.js';

const prisma = new PrismaClient();

const STYLE_COUNT = 2_000;
const COLOURS_PER_STYLE = 2;
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const SIZES_PER_STYLE = 4; // a random 4-of-6 per style, closer to real catalog variance than a fixed set

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  console.log(`[perf-seed] starting - target ${STYLE_COUNT} styles x ${COLOURS_PER_STYLE} colours x ${SIZES_PER_STYLE} sizes`);
  const startedAt = Date.now();

  const brand = await prisma.brand.upsert({
    where: { code: 'PERF-BRAND' },
    update: {},
    create: { code: 'PERF-BRAND', name: 'Perf Test Brand' },
  });
  const category = await prisma.category.upsert({
    where: { slug: 'perf-category' },
    update: {},
    create: { name: 'Perf Category', slug: 'perf-category' },
  });
  const location = await prisma.location.upsert({
    where: { code: 'PERF-WH' },
    update: {},
    create: { code: 'PERF-WH', name: 'Perf Warehouse', type: 'WAREHOUSE' },
  });

  const sizeRecords = await Promise.all(
    SIZES.map((label, i) =>
      prisma.size.upsert({ where: { label }, update: {}, create: { label, sortOrder: i } }),
    ),
  );

  // --- Styles ---
  const styleIds: string[] = [];
  const styleRows = Array.from({ length: STYLE_COUNT }, (_, i) => {
    const id = randomUUID();
    styleIds.push(id);
    return {
      id,
      styleCode: `PERF-STY-${i.toString().padStart(6, '0')}`,
      name: `Perf Style ${i}`,
      brandId: brand.id,
      categoryId: category.id,
      season: 'SS26',
      collection: 'Core',
      lifecycleState: 'PUBLISHED' as const,
      publishedAt: new Date(),
    };
  });
  for (const batch of chunk(styleRows, 2000)) {
    await prisma.style.createMany({ data: batch });
  }
  console.log(`[perf-seed] ${styleIds.length} styles created`);

  // --- Colours ---
  type ColourRow = { id: string; styleId: string; name: string; colourCode: string };
  const colourRows: ColourRow[] = [];
  for (const styleId of styleIds) {
    for (let c = 0; c < COLOURS_PER_STYLE; c++) {
      colourRows.push({ id: randomUUID(), styleId, name: `Colour ${c}`, colourCode: `C${c}` });
    }
  }
  for (const batch of chunk(colourRows, 5000)) {
    await prisma.colour.createMany({ data: batch });
  }
  console.log(`[perf-seed] ${colourRows.length} colours created`);

  // --- Prices (one per style, applies to all colours) ---
  const priceRows = styleIds.map((styleId) => ({
    id: randomUUID(),
    styleId,
    mrp: '1999.00',
    sellingPrice: '1499.00',
    currency: 'INR',
  }));
  for (const batch of chunk(priceRows, 5000)) {
    await prisma.price.createMany({ data: batch });
  }
  console.log(`[perf-seed] ${priceRows.length} prices created`);

  // --- SKUs + InventoryBalance ---
  type SkuRow = { id: string; skuCode: string; styleId: string; colourId: string; sizeId: string };
  const skuRows: SkuRow[] = [];
  let skuSeq = 0;
  for (const colour of colourRows) {
    const shuffledSizeIdx = [...sizeRecords.keys()].sort(() => Math.random() - 0.5).slice(0, SIZES_PER_STYLE);
    for (const idx of shuffledSizeIdx) {
      skuRows.push({
        id: randomUUID(),
        skuCode: `PERF-SKU-${(skuSeq++).toString().padStart(7, '0')}`,
        styleId: colour.styleId,
        colourId: colour.id,
        sizeId: sizeRecords[idx]!.id,
      });
    }
  }
  for (const batch of chunk(skuRows, 5000)) {
    await prisma.sku.createMany({ data: batch });
  }
  console.log(`[perf-seed] ${skuRows.length} SKUs created`);

  const balanceRows = skuRows.map((s) => ({
    skuId: s.id,
    locationId: location.id,
    onHand: 20 + Math.floor(Math.random() * 80),
    reserved: 0,
  }));
  for (const batch of chunk(balanceRows, 5000)) {
    await prisma.inventoryBalance.createMany({ data: batch });
  }
  console.log(`[perf-seed] ${balanceRows.length} inventory balances created`);

  console.log(`[perf-seed] catalog scale complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`[perf-seed] totals: styles=${styleIds.length} colours=${colourRows.length} skus=${skuRows.length}`);
  console.log(`[perf-seed] reference style id for PDP benchmarking: ${styleIds[0]}`);
  console.log(`[perf-seed] reference style code for search benchmarking: ${styleRows[0]!.styleCode}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
