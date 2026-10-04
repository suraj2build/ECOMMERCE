// Representative demo catalogue for previews: categories matching the
// approved VANYA navigation, sizes, versioned size charts, 12 styles with
// colour/size variants and stock (including sold-out sizes and one sold-out
// style), two markdowns, three collections and three Watch & Shop posts.
//
// Uses the real staff API (the same paths an operator uses), plus Prisma
// only for reference data that has no staff route (categories, sizes,
// SKU size-chart links). Images are the generated, visibly marked demo
// images in apps/storefront/public/demo. No reviews or ratings are created.
//
//   DEMO_SEED_ALLOWED=preview DEMO_API_URL=http://localhost:4000 \
//   DEMO_ASSET_BASE=http://localhost:3000 DATABASE_URL=... \
//   SEED_SUPER_ADMIN_EMAIL=... SEED_SUPER_ADMIN_PASSWORD=... node scripts/seed-demo.mjs
//
// Re-running is safe: existing demo styles (style code prefix VNY-DEMO-) and
// collections are left as they are.
import { PrismaClient } from '@fcp/db';

// A hosted preview runs as NODE_ENV=production with DEPLOYMENT_STAGE=preview
// (LR-010); the real production stage is always refused.
const productionStage = process.env.NODE_ENV === 'production' && process.env.DEPLOYMENT_STAGE !== 'preview';
if (process.env.DEMO_SEED_ALLOWED !== 'preview' || productionStage) {
  throw new Error('Demo data is for preview environments only. Set DEMO_SEED_ALLOWED=preview (never in production).');
}
const API = `${process.env.DEMO_API_URL ?? 'http://localhost:4000'}/api/v1`;
const ASSETS = `${process.env.DEMO_ASSET_BASE ?? 'http://localhost:3000'}/demo`;
const prisma = new PrismaClient();

async function call(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const CATEGORIES = [
  ['festive-ceremonial', 'Festive & Ceremonial'], ['bandhgalas-jackets', 'Bandhgalas & Jackets'],
  ['linen-silk-shirts', 'Linen & Silk Shirts'], ['kurtas', 'Kurtas'], ['trousers', 'Trousers'],
  ['festive-silk-edit', 'Festive Silk Edit'], ['modern-sarees', 'Modern Sarees'],
  ['co-ords-sets', 'Co-ords & Sets'], ['dresses', 'Dresses'],
];
const SIZES = [['XS', 1], ['S', 2], ['M', 3], ['L', 4], ['XL', 5], ['FREE', 9]];
const COLOUR = {
  ivory: ['Ivory', '#ECE2D0'], maroon: ['Maroon', '#6E1C28'], navy: ['Navy', '#1E2A4A'], olive: ['Olive', '#5C6238'],
  sand: ['Sand', '#C6AA80'], rust: ['Rust', '#A44C2C'], teal: ['Teal', '#205C60'], rose: ['Rose', '#C47A84'],
  black: ['Black', '#201E1E'], mustard: ['Mustard', '#C4962C'], sage: ['Sage', '#94A484'], indigo: ['Indigo', '#34366E'],
};
// [image slug, name, category, gender, colours, sizes, chart, mrp, selling, markdown, stock per size (null = sold out)]
const STYLES = [
  ['festive-silk-kurta', 'Festive Silk Kurta', 'festive-ceremonial', 'men', ['ivory', 'maroon'], ['S', 'M', 'L', 'XL'], 'men-top', 6990, 6990, false, [4, 8, 6, 0]],
  ['heritage-bandhgala', 'Heritage Bandhgala', 'bandhgalas-jackets', 'men', ['navy', 'black'], ['S', 'M', 'L', 'XL'], 'men-top', 14990, 14990, false, [2, 5, 5, 2]],
  ['linen-camp-shirt', 'Linen Camp Shirt', 'linen-silk-shirts', 'men', ['sand', 'olive'], ['S', 'M', 'L', 'XL'], 'men-top', 3490, 2790, true, [10, 12, 9, 4]],
  ['silk-blend-shirt', 'Silk Blend Shirt', 'linen-silk-shirts', 'men', ['teal', 'ivory'], ['M', 'L', 'XL'], 'men-top', 4290, 4290, false, [6, 6, 3]],
  ['pleated-trousers', 'Pleated Trousers', 'trousers', 'men', ['sand', 'black'], ['S', 'M', 'L', 'XL'], 'men-bottom', 3990, 3990, false, [5, 7, 7, 3]],
  ['everyday-cotton-kurta', 'Everyday Cotton Kurta', 'kurtas', 'men', ['sage', 'indigo'], ['S', 'M', 'L', 'XL'], 'men-top', 2490, 2490, false, null],
  ['chanderi-saree', 'Chanderi Saree', 'modern-sarees', 'women', ['rose', 'mustard'], ['FREE'], 'saree', 8990, 8990, false, [6]],
  ['banarasi-silk-saree', 'Banarasi Silk Saree', 'festive-silk-edit', 'women', ['maroon', 'teal'], ['FREE'], 'saree', 18990, 18990, false, [3]],
  ['linen-coord-set', 'Linen Co-ord Set', 'co-ords-sets', 'women', ['rust', 'ivory'], ['XS', 'S', 'M', 'L'], 'women-top', 5990, 4790, true, [3, 6, 6, 2]],
  ['festive-anarkali-dress', 'Festive Anarkali Dress', 'festive-silk-edit', 'women', ['indigo', 'rose'], ['XS', 'S', 'M', 'L'], 'women-top', 9490, 9490, false, [2, 4, 4, 0]],
  ['midi-wrap-dress', 'Midi Wrap Dress', 'dresses', 'women', ['olive', 'black'], ['XS', 'S', 'M', 'L'], 'women-top', 4490, 4490, false, [5, 8, 8, 4]],
  ['embroidered-kurta-set', 'Embroidered Kurta Set', 'co-ords-sets', 'women', ['mustard', 'sage'], ['XS', 'S', 'M', 'L'], 'women-top', 7490, 7490, false, [3, 5, 5, 3]],
];
const CHARTS = {
  'men-top': { name: 'Men kurtas, shirts and bandhgalas', gender: 'men', entries: [['S', { chestIn: 38, lengthIn: 41 }], ['M', { chestIn: 40, lengthIn: 42 }], ['L', { chestIn: 42, lengthIn: 43 }], ['XL', { chestIn: 44, lengthIn: 44 }]] },
  'men-bottom': { name: 'Men trousers', gender: 'men', entries: [['S', { waistIn: 30, inseamIn: 31 }], ['M', { waistIn: 32, inseamIn: 31 }], ['L', { waistIn: 34, inseamIn: 32 }], ['XL', { waistIn: 36, inseamIn: 32 }]] },
  'women-top': { name: 'Women dresses, kurtas and co-ords', gender: 'women', entries: [['XS', { bustIn: 32, waistIn: 26 }], ['S', { bustIn: 34, waistIn: 28 }], ['M', { bustIn: 36, waistIn: 30 }], ['L', { bustIn: 38, waistIn: 32 }]] },
  saree: { name: 'Sarees', gender: 'women', entries: [['FREE', { sareeLengthM: 5.5, blousePieceM: 0.8 }]] },
};
const COLLECTIONS = [
  ['The Festive Edit', 'festive-edit', 'Silks and celebration wear for the season.', ['festive-silk-kurta', 'heritage-bandhgala', 'banarasi-silk-saree', 'festive-anarkali-dress']],
  ['Linen Season', 'linen-season', 'Breathable linens for warm days.', ['linen-camp-shirt', 'linen-coord-set', 'pleated-trousers']],
  ['Wedding Guest', 'wedding-guest', 'Considered looks for every function.', ['heritage-bandhgala', 'chanderi-saree', 'embroidered-kurta-set', 'silk-blend-shirt']],
];
const LOOKBOOKS = [
  ['The Festive Edit — styled', 'lookbook-festive.jpg', ['festive-silk-kurta', 'banarasi-silk-saree', 'festive-anarkali-dress']],
  ['Linen Season — on the move', 'lookbook-linen.jpg', ['linen-camp-shirt', 'linen-coord-set']],
  ['Wedding Guest — three ways', 'lookbook-wedding.jpg', ['heritage-bandhgala', 'chanderi-saree', 'embroidered-kurta-set']],
];

const { token } = await call('POST', '/auth/staff/login', { email: process.env.SEED_SUPER_ADMIN_EMAIL, password: process.env.SEED_SUPER_ADMIN_PASSWORD });
const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const summary = { created: [], skipped: [] };

// --- Reference data ---
const categories = {};
for (const [slug, name] of CATEGORIES) categories[slug] = await prisma.category.upsert({ where: { slug }, update: { name, isActive: true }, create: { slug, name } });
const sizes = {};
for (const [label, sortOrder] of SIZES) sizes[label] = await prisma.size.upsert({ where: { label }, update: {}, create: { label, sortOrder } });

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
for (const [key, chart] of Object.entries(CHARTS)) {
  charts[key] = await prisma.sizeChart.findFirst({ where: { name: chart.name } })
    ?? await call('POST', '/products/size-charts', { name: chart.name, gender: chart.gender, brandId: brand.id, entries: chart.entries.map(([sizeLabel, measurements]) => ({ sizeLabel, measurements })) }, token);
}

// --- Styles ---
const styleIds = {};
for (const [slug, name, category, gender, colours, sizeLabels, chart, mrp, selling, markdown, stock] of STYLES) {
  const styleCode = `VNY-DEMO-${slug.toUpperCase()}`;
  const existing = await prisma.style.findFirst({ where: { styleCode } });
  if (existing) { styleIds[slug] = existing.id; summary.skipped.push(styleCode); continue; }
  const style = await call('POST', '/products/styles', {
    styleCode, name, brandId: brand.id, categoryId: categories[category].id, season: 'AW26', collection: 'Demo',
    department: gender === 'men' ? 'Menswear' : 'Womenswear', gender, fabric: name.includes('Linen') ? 'Linen' : name.includes('Silk') || name.includes('Banarasi') || name.includes('Chanderi') ? 'Silk blend' : 'Cotton',
    washCare: 'Dry clean recommended', countryOfOrigin: 'India', hsnCode: '6211',
  }, token);
  styleIds[slug] = style.id;
  const colourRows = [];
  for (const key of colours) {
    const [colourName, hex] = COLOUR[key];
    colourRows.push(await call('POST', `/products/styles/${style.id}/colours`, { name: colourName, colourCode: key.slice(0, 3).toUpperCase(), hexSwatch: hex }, token));
  }
  const skus = await call('POST', `/products/styles/${style.id}/skus/generate`, { sizeIds: sizeLabels.map((label) => sizes[label].id) }, token);
  await prisma.sku.updateMany({ where: { styleId: style.id }, data: { sizeChartId: charts[chart].id } });
  for (const [index, key] of colours.entries()) {
    await call('POST', `/products/styles/${style.id}/media`, { colourId: colourRows[index].id, url: `${ASSETS}/${slug}-${key}.jpg`, sortOrder: index, altText: `${name} in ${COLOUR[key][0]} (demo image)` }, token);
  }
  await call('POST', '/catalog/prices', { styleId: style.id, mrp, sellingPrice: mrp }, token);
  if (markdown) {
    await call('POST', '/catalog/prices/markdown', { styleId: style.id, mrp, sellingPrice: selling, effectiveFrom: yesterday, effectiveTo: new Date(Date.now() + 90 * 86_400_000).toISOString() }, token);
  }
  if (stock) {
    for (const sku of skus) {
      const quantity = stock[sizeLabels.indexOf(sizeLabels.find((label) => sizes[label].id === sku.sizeId))];
      if (quantity > 0) await call('POST', '/inventory/adjustments', { skuId: sku.skuId, locationId: location.id, quantityDelta: quantity, reason: 'Demo opening stock', idempotencyKey: `demo-stock-${sku.skuId}` }, token);
    }
  }
  for (const step of ['ready-for-enrichment', 'qa-check', 'publish']) await call('POST', `/products/styles/${style.id}/${step}`, undefined, token);
  summary.created.push(styleCode);
}

// --- Collections ---
for (const [name, slug, description, members] of COLLECTIONS) {
  if (await prisma.collection.findFirst({ where: { slug } })) { summary.skipped.push(`collection:${slug}`); continue; }
  const collection = await call('POST', '/catalog/collections', { name, slug, description }, token);
  for (const member of members) await call('POST', `/catalog/collections/${collection.id}/styles`, { styleId: styleIds[member] }, token);
  await call('POST', `/catalog/collections/${collection.id}/publish`, undefined, token);
  summary.created.push(`collection:${slug}`);
}

// --- Watch & Shop (internal shoppable media; not an Instagram connection) ---
for (const [index, [title, image, members]] of LOOKBOOKS.entries()) {
  if (await prisma.shoppableMedia.findFirst({ where: { title } })) { summary.skipped.push(`media:${title}`); continue; }
  const media = await call('POST', '/content/shoppable-media', { title, mediaUrl: `${ASSETS}/${image}`, thumbnailUrl: `${ASSETS}/${image}`, creatorAttribution: 'VANYA studio (demo)', merchandisingPosition: index }, token);
  for (const [sortOrder, member] of members.entries()) await call('POST', `/content/shoppable-media/${media.id}/tags`, { styleId: styleIds[member], sortOrder }, token);
  await call('POST', `/content/shoppable-media/${media.id}/transition`, { toState: 'PUBLISHED' }, token);
  summary.created.push(`media:${title}`);
}

await prisma.$disconnect();
console.log(JSON.stringify(summary, null, 2));
