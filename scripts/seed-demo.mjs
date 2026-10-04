// Preview catalogue for the local demo (LR-010): the approved AI Studio
// design's own catalogue (scripts/demo-data/aistudio-catalogue.json, exported
// from Stitch-Spark_Ai_Studio src/data/mockData.ts) loaded through the real
// staff API - the same paths an operator uses - so the demo shows the
// approved products, prices, colours and photographs on the real backend.
//
// Prisma is used only for reference data with no staff route (categories,
// sizes, SKU size-chart links). Not copied from the prototype: reviews,
// ratings, view counts and likes (never invented, LR-001). The photographs
// are the design's Unsplash images, loaded by the shopper's browser from
// images.unsplash.com; they are preview content, never production catalogue.
//
//   DEMO_SEED_ALLOWED=preview DEMO_API_URL=http://localhost:4000 DATABASE_URL=... \
//   SEED_SUPER_ADMIN_EMAIL=... SEED_SUPER_ADMIN_PASSWORD=... node scripts/seed-demo.mjs
//
// Re-running is safe: existing demo styles (style code prefix VNY-AIS-),
// collections, media and banners are left as they are.
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@fcp/db';

// A preview runs as NODE_ENV=production with DEPLOYMENT_STAGE=preview
// (LR-010); the real production stage is always refused.
const productionStage = process.env.NODE_ENV === 'production' && process.env.DEPLOYMENT_STAGE !== 'preview';
if (process.env.DEMO_SEED_ALLOWED !== 'preview' || productionStage) {
  throw new Error('Demo data is for preview environments only. Set DEMO_SEED_ALLOWED=preview (never in production).');
}
const API = `${process.env.DEMO_API_URL ?? 'http://localhost:4000'}/api/v1`;
const { version: CATALOGUE_VERSION, products: PRODUCTS, reels: REELS } = JSON.parse(readFileSync(new URL('./demo-data/aistudio-catalogue.json', import.meta.url), 'utf8'));
const prisma = new PrismaClient();

async function call(method, path, body, token, attempt = 0) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  // The catalogue is loaded through the real staff API, which rate-limits
  // writes; wait out the window instead of failing the demo start.
  if (res.status === 429 && attempt < 10) {
    const seconds = Number(res.headers.get('retry-after')) || Number(/retry in (\d+)/.exec(text)?.[1]) || 5;
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    return call(method, path, body, token, attempt + 1);
  }
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const slugify = (value) => value.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const unsplash = (id, width) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=80`;

// Every category the design's products and navigation use.
const CATEGORY_NAMES = [...new Set([
  'Festive & Ceremonial', 'Bandhgalas & Jackets', 'Linen & Silk Shirts', 'Kurtas', 'Pleated Trousers',
  'Festive Silk Edit', 'Modern Sarees', 'Co-ords & Sets', 'Dresses',
  ...PRODUCTS.map((p) => p.category),
])];
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '30', '32', '34', '36', '38', '38 (S)', '40 (M)', '42 (L)', '44 (XL)', 'FREE'];
// The design's size guide tables (SizeGuideModal.tsx), as size charts.
const CHARTS = {
  women: {
    name: 'Women · garment sizing and fit guide',
    entries: [['XS', 32, 26, 36, 14], ['S', 34, 28, 38, 14.5], ['M', 36, 30, 40, 15], ['L', 38, 32, 42, 15.5], ['XL', 40, 34, 44, 16], ['XXL', 42, 36, 46, 16.5]]
      .map(([sizeLabel, bustIn, waistIn, hipIn, shoulderIn]) => [sizeLabel, { bustIn, waistIn, hipIn, shoulderIn }]),
  },
  men: {
    name: 'Men · garment sizing and fit guide',
    entries: [['S', 38, '30-32', 38, 17], ['M', 40, '32-34', 40, 17.5], ['L', 42, '34-36', 42, 18], ['XL', 44, '36-38', 44, 18.5], ['XXL', 46, '38-40', 46, 19]]
      .map(([sizeLabel, chestIn, waistIn, hipIn, shoulderIn]) => [sizeLabel, { chestIn, waistIn, hipIn, shoulderIn }]),
  },
};
const BADGES = { BESTSELLER: 'BESTSELLER', NEW: 'NEW_ARRIVAL' };

// Editorial photographs from the design's gateway, home and story bubbles,
// as CMS banners (placement per department; the storefront reads them).
const BANNERS = {
  men: {
    gateway: [['Modern Indian Menswear', unsplash('1507679799987-c73779587ccf', 1800), '/']],
    'home-hero': [['The Festive Edit', unsplash('1507679799987-c73779587ccf', 2200), '/category/men']],
    'home-feature': [['Tradition Tailored for Today', unsplash('1602810318383-e386cc2a3ccf', 2000), '/category/men']],
    'home-category': [
      ['BANDHGALAS', unsplash('1507679799987-c73779587ccf', 400), '/category/bandhgalas-jackets'],
      ['LINEN SHIRTS', unsplash('1602810318383-e386cc2a3ccf', 400), '/category/linen-silk-shirts'],
      ['KURTAS', unsplash('1624378439575-d8705ad7ae80', 400), '/category/kurtas'],
      ['TROUSERS', unsplash('1490114538077-0a7f8cb49891', 400), '/category/pleated-trousers'],
      ['JACKETS', unsplash('1617137984095-74e4e5e3613f', 400), '/category/bandhgalas-jackets'],
      ['POLOS', unsplash('1581655353564-df123a1eb820', 400), '/category/shirts-overshirts'],
      ['FESTIVE EDIT', unsplash('1506794778202-cad84cf45f1d', 400), '/category/festive-ceremonial'],
      ['ACCESSORIES', unsplash('1522335789203-aabd1fc54bc9', 400), '/category/men'],
    ],
    'home-occasion': [
      ['For Work', unsplash('1602810318383-e386cc2a3ccf', 1000), '/category/linen-silk-shirts'],
      ['For Celebration', unsplash('1624378439575-d8705ad7ae80', 1000), '/category/festive-ceremonial'],
      ['For Travel', unsplash('1507679799987-c73779587ccf', 1000), '/category/pleated-trousers'],
    ],
    'home-tastemakers': [
      ['Vikram in Structured Bandhgala, New Delhi', unsplash('1507679799987-c73779587ccf', 800)],
      ['Arjun in European Flax Linen, Jaipur', unsplash('1602810318383-e386cc2a3ccf', 800)],
      ['Kabir in Silk Chanderi Kurta, Udaipur', unsplash('1624378439575-d8705ad7ae80', 800)],
      ['Dev in Ceremonial Nehru Jacket, Mumbai', unsplash('1617137984095-74e4e5e3613f', 800)],
      ['Rohan in Khadi Pleated Trousers, Bangalore', unsplash('1490114538077-0a7f8cb49891', 800)],
      ['Samar in Everyday Cotton Polo, Goa', unsplash('1500648767791-00dcc994a43e', 800)],
    ],
  },
  women: {
    gateway: [['Modern Indian Womenswear', unsplash('1610030469983-98e550d6193c', 1800), '/']],
    'home-hero': [['The Festive Edit', unsplash('1610030469983-98e550d6193c', 2200), '/category/women']],
    'home-feature': [['Tradition Tailored for Today', unsplash('1583391733956-3750e0ff4e8b', 2000), '/category/women']],
    'home-category': [
      ['MODERN SAREES', unsplash('1610030469983-98e550d6193c', 400), '/category/modern-sarees'],
      ['CO-ORDS & SETS', unsplash('1583391733956-3750e0ff4e8b', 400), '/category/co-ords-sets'],
      ['CHANDERI KURTAS', unsplash('1617627143750-d86bc21e42bb', 400), '/category/women'],
      ['DRAPED DRESSES', unsplash('1515372039744-b8f02a3ae446', 400), '/category/dresses'],
      ['CAPES & JACKETS', unsplash('1534528741775-53994a69daeb', 400), '/category/festive-silk-edit'],
      ['SILK BLOUSES', unsplash('1529139574466-a303027c1d8b', 400), '/category/women'],
      ['FESTIVE SILKS', unsplash('1509631179647-0177331693ae', 400), '/category/festive-silk-edit'],
      ['JEWELRY & BAGS', unsplash('1535632066927-ab7c9ab60908', 400), '/category/women'],
    ],
    'home-occasion': [
      ['For Work', unsplash('1602810318383-e386cc2a3ccf', 1000), '/category/co-ords-sets'],
      ['For Celebration', unsplash('1624378439575-d8705ad7ae80', 1000), '/category/festive-silk-edit'],
      ['For Travel', unsplash('1507679799987-c73779587ccf', 1000), '/category/dresses'],
    ],
    'home-tastemakers': [
      ['Ananya in Chanderi Wrap Set, New Delhi', unsplash('1610030469983-98e550d6193c', 800)],
      ['Tara in Pre-Draped Mulberry Saree, Jaipur', unsplash('1583391733956-3750e0ff4e8b', 800)],
      ['Meera in Organza Coordinate Set, Udaipur', unsplash('1617627143750-d86bc21e42bb', 800)],
      ['Rhea in Draped Cocktail Gown, Mumbai', unsplash('1534528741775-53994a69daeb', 800)],
      ['Isha in Ahimsa Silk Kurta, Bangalore', unsplash('1515886657613-9f3515b0c78f', 800)],
      ['Dia in Festive Handloom Silk, Kolkata', unsplash('1509631179647-0177331693ae', 800)],
    ],
  },
};

const { token } = await call('POST', '/auth/staff/login', { email: process.env.SEED_SUPER_ADMIN_EMAIL, password: process.env.SEED_SUPER_ADMIN_PASSWORD });
const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const summary = { catalogue: CATALOGUE_VERSION, created: 0, skipped: 0 };

// --- Reference data ---
const categories = {};
for (const name of CATEGORY_NAMES) {
  const slug = slugify(name);
  categories[name] = await prisma.category.upsert({ where: { slug }, update: { name, isActive: true }, create: { slug, name } });
}
const sizes = {};
for (const [index, label] of SIZE_ORDER.entries()) sizes[label] = await prisma.size.upsert({ where: { label }, update: { sortOrder: index + 1 }, create: { label, sortOrder: index + 1 } });

let brand = await prisma.brand.findFirst({ where: { code: 'VANYA' } });
if (!brand) brand = await call('POST', '/organization/brands', { code: 'VANYA', name: 'VANYA' }, token);
let location = await prisma.location.findFirst({ where: { code: 'VNY-DEMO-WH' } });
if (!location) {
  location = await call('POST', '/organization/locations', { code: 'VNY-DEMO-WH', name: 'VANYA Demo Warehouse', type: 'WAREHOUSE' }, token);
  // Checkout sells only from a GST-configured location (M08). DEMO values only:
  // not a verified registration or a verified rate (TAX-001..005 stay open).
  const entity = await call('POST', '/tax/legal-entities', { legalName: 'VANYA Demo (not a real entity)', registeredState: 'Delhi' }, token);
  const gst = await call('POST', '/tax/gst-registrations', { legalEntityId: entity.id, gstin: 'DLDEMO00001A1Z5', stateCode: 'DL', stateName: 'Delhi', status: 'ACTIVE', effectiveFrom: yesterday }, token);
  await call('POST', `/tax/locations/${location.id}/gst-registration`, { gstRegistrationId: gst.id }, token);
  await call('POST', '/tax/rates', { hsnCode: '6211', gstRatePercent: 12, effectiveFrom: yesterday }, token).catch(() => undefined);
}
for (const [pincode, city, state] of [['110001', 'New Delhi', 'Delhi'], ['400001', 'Mumbai', 'Maharashtra'], ['560001', 'Bengaluru', 'Karnataka'], ['600001', 'Chennai', 'Tamil Nadu'], ['700001', 'Kolkata', 'West Bengal']]) {
  await call('POST', '/pdp/pincodes', { pincode, city, state, isServiceable: true, codAvailable: true }, token).catch(() => undefined);
}

const charts = {};
for (const [gender, chart] of Object.entries(CHARTS)) {
  charts[gender] = await prisma.sizeChart.findFirst({ where: { name: chart.name } })
    ?? await call('POST', '/products/size-charts', { name: chart.name, gender, brandId: brand.id, entries: chart.entries.map(([sizeLabel, measurements]) => ({ sizeLabel, measurements })) }, token);
}
const chartLabels = Object.fromEntries(Object.entries(CHARTS).map(([gender, chart]) => [gender, new Set(chart.entries.map(([label]) => label))]));

// --- Styles ---
const styleIds = {};
for (const p of PRODUCTS) {
  const styleCode = `VNY-AIS-${p.id.toUpperCase()}`;
  const existing = await prisma.style.findFirst({ where: { styleCode } });
  if (existing) { styleIds[p.id] = existing.id; summary.skipped += 1; continue; }
  const style = await call('POST', '/products/styles', {
    styleCode, name: p.title, brandId: brand.id, categoryId: categories[p.category].id,
    season: 'Festive 2026', collection: p.collection,
    department: p.gender === 'men' ? 'Menswear' : 'Womenswear', gender: p.gender,
    fabric: p.fabric, fit: p.fit, occasion: p.occasion, washCare: p.care.join('. '),
    countryOfOrigin: 'India', hsnCode: '6211',
    customAttributes: {
      subtitle: p.subtitle, details: p.details, fitNotes: p.fitNotes, styleNotes: p.styleNotes,
      artisanCluster: p.manufacturing?.artisanCluster, sustainableNote: p.manufacturing?.sustainableNote,
    },
  }, token);
  styleIds[p.id] = style.id;
  const colourRows = [];
  for (const [index, colour] of p.colors.entries()) {
    colourRows.push(await call('POST', `/products/styles/${style.id}/colours`, { name: colour.name, colourCode: `C${index + 1}`, hexSwatch: colour.hex }, token));
  }
  const skus = await call('POST', `/products/styles/${style.id}/skus/generate`, { sizeIds: p.sizes.map((s) => sizes[s.size].id) }, token);
  if (p.sizes.every((s) => chartLabels[p.gender].has(s.size))) {
    await prisma.sku.updateMany({ where: { styleId: style.id }, data: { sizeChartId: charts[p.gender].id } });
  }
  let sortOrder = 0;
  for (const [index, colour] of p.colors.entries()) {
    for (const url of colour.images) {
      await call('POST', `/products/styles/${style.id}/media`, {
        colourId: colourRows[index].id, url, sortOrder: sortOrder++,
        altText: `${p.title} in ${colour.name}`,
      }, token);
    }
  }
  // The design's model note ("Model is 5'9\" wearing size S"); the staff
  // media route has no field for it, so it is set on the lead photograph.
  if (p.modelInfo) {
    await prisma.productMedia.updateMany({ where: { styleId: style.id, sortOrder: 0 }, data: { modelInfo: p.modelInfo } });
  }
  await call('POST', '/catalog/prices', { styleId: style.id, mrp: p.mrp, sellingPrice: p.price }, token);
  for (const sku of skus) {
    const size = p.sizes.find((s) => sizes[s.size].id === sku.sizeId);
    const quantity = size?.inStock ? (size.stockCount ?? 10) : 0;
    if (quantity > 0) await call('POST', '/inventory/adjustments', { skuId: sku.skuId, locationId: location.id, quantityDelta: quantity, reason: 'Demo opening stock', idempotencyKey: `demo-stock-${sku.skuId}` }, token);
  }
  for (const step of ['ready-for-enrichment', 'qa-check', 'publish']) await call('POST', `/products/styles/${style.id}/${step}`, undefined, token);
  for (const badge of new Set((p.badges ?? []).map((b) => BADGES[b]).filter(Boolean))) {
    await call('POST', '/catalog/badges', { styleId: style.id, badgeType: badge, source: 'MANUAL' }, token);
  }
  summary.created += 1;
}

// --- Collections (the design's collection names) ---
const collections = new Map();
for (const p of PRODUCTS) collections.set(p.collection, [...(collections.get(p.collection) ?? []), p.id]);
for (const [name, members] of collections) {
  const slug = slugify(name);
  if (await prisma.collection.findFirst({ where: { slug } })) { summary.skipped += 1; continue; }
  const collection = await call('POST', '/catalog/collections', { name, slug, description: `${name} from VANYA.` }, token);
  for (const member of members) await call('POST', `/catalog/collections/${collection.id}/styles`, { styleId: styleIds[member] }, token);
  await call('POST', `/catalog/collections/${collection.id}/publish`, undefined, token);
  summary.created += 1;
}

// --- Watch & Shop: the design's reels (internal shoppable media) ---
for (const [index, reel] of REELS.entries()) {
  if (await prisma.shoppableMedia.findFirst({ where: { title: reel.title } })) { summary.skipped += 1; continue; }
  const media = await call('POST', '/content/shoppable-media', {
    title: reel.title, mediaUrl: reel.videoUrl ?? reel.thumbnail, thumbnailUrl: reel.thumbnail,
    creatorAttribution: `${reel.creator.name} · ${reel.creator.handle}`, merchandisingPosition: index,
  }, token);
  for (const [sortOrder, productId] of reel.taggedProductIds.entries()) {
    if (styleIds[productId]) await call('POST', `/content/shoppable-media/${media.id}/tags`, { styleId: styleIds[productId], sortOrder }, token);
  }
  await call('POST', `/content/shoppable-media/${media.id}/transition`, { toState: 'PUBLISHED' }, token);
  summary.created += 1;
}

// --- Editorial imagery (CMS banners) ---
for (const [department, placements] of Object.entries(BANNERS)) {
  for (const [key, banners] of Object.entries(placements)) {
    const placement = `${key}-${department}`;
    if (await prisma.cmsBanner.findFirst({ where: { placement } })) { summary.skipped += 1; continue; }
    for (const [sortOrder, [title, imageUrl, linkUrl]] of banners.entries()) {
      await call('POST', '/cms/banners', { title, imageUrl, ...(linkUrl ? { linkUrl } : {}), placement, sortOrder }, token);
    }
    summary.created += 1;
  }
}

await prisma.$disconnect();
console.log(JSON.stringify(summary, null, 2));
