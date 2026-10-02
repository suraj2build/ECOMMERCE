// 100 concurrent shoppers on ONE product with limited stock, over real HTTP
// against running builds: each opens the rendered product page, refreshes
// live stock, adds the item to a bag and checks out (COD) at the same moment.
// Passes only if exactly STOCK orders are accepted, every other shopper gets
// a clean stock refusal (never a 5xx), retries do not duplicate orders, and
// the inventory ledger still reconciles. Test environments only.
//
//   LOAD_TEST_ALLOWED=test-environment LOAD_TEST_API_URL=http://localhost:4000 \
//   LOAD_TEST_STOREFRONT_URL=http://localhost:3000 DATABASE_URL=... \
//   SEED_SUPER_ADMIN_EMAIL=... SEED_SUPER_ADMIN_PASSWORD=... \
//   node scripts/load-checkout-contention.mjs
import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@fcp/db';

const api = process.env.LOAD_TEST_API_URL;
const storefront = process.env.LOAD_TEST_STOREFRONT_URL;
if (!api || !storefront || process.env.LOAD_TEST_ALLOWED !== 'test-environment') {
  throw new Error('Set LOAD_TEST_API_URL, LOAD_TEST_STOREFRONT_URL and LOAD_TEST_ALLOWED=test-environment explicitly.');
}
const SHOPPERS = Number(process.env.LOAD_TEST_SHOPPERS ?? 100);
const STOCK = Number(process.env.LOAD_TEST_STOCK ?? 25);
const run = Date.now();
const prisma = new PrismaClient();
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

async function call(method, path, { body, headers = {}, base = api } = {}) {
  const started = performance.now();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text, ms: performance.now() - started };
}
async function ok(method, path, opts, label) {
  const r = await call(method, path, opts);
  if (r.status >= 300) throw new Error(`${label} failed: ${r.status} ${r.text.slice(0, 300)}`);
  return r.json;
}
const stats = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const at = (q) => Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]);
  return { n: s.length, p50: at(0.5), p95: at(0.95), max: Math.round(s[s.length - 1]) };
};

// --- Provision one published product with STOCK units ---
const { token } = await ok('POST', '/api/v1/auth/staff/login', {
  body: { email: process.env.SEED_SUPER_ADMIN_EMAIL, password: process.env.SEED_SUPER_ADMIN_PASSWORD },
}, 'staff login');
const staff = { authorization: `Bearer ${token}` };
const category = await prisma.category.upsert({ where: { slug: 'load-contention' }, update: {}, create: { name: 'Load Contention', slug: 'load-contention' } });
const size = await prisma.size.upsert({ where: { label: 'LOAD-M' }, update: {}, create: { label: 'LOAD-M', sortOrder: 0 } });
const brand = await ok('POST', '/api/v1/organization/brands', { headers: staff, body: { code: `LD${run % 100000}`, name: 'Load Brand' } }, 'brand');
const location = await ok('POST', '/api/v1/organization/locations', { headers: staff, body: { code: `LDL${run % 100000}`, name: 'Load Warehouse', type: 'WAREHOUSE' } }, 'location');
// Checkout sells only from a location with an active GST registration and
// an HSN rate (M08), as in test/e2e-storefront/checkout.spec.ts.
const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const legalEntity = await ok('POST', '/api/v1/tax/legal-entities', { headers: staff, body: { legalName: 'Load Test Pvt Ltd', registeredState: 'Delhi' } }, 'legal entity');
const gst = await ok('POST', '/api/v1/tax/gst-registrations', { headers: staff, body: {
  legalEntityId: legalEntity.id, gstin: `DLLOAD${String(run % 100000).padStart(5, '0')}A1Z5`, stateCode: 'DL', stateName: 'Delhi', status: 'ACTIVE', effectiveFrom: yesterday,
} }, 'gst registration');
await ok('POST', `/api/v1/tax/locations/${location.id}/gst-registration`, { headers: staff, body: { gstRegistrationId: gst.id } }, 'assign gst');
await ok('POST', '/api/v1/tax/rates', { headers: staff, body: { hsnCode: '6109', gstRatePercent: 12, effectiveFrom: yesterday } }, 'tax rate');
const style = await ok('POST', '/api/v1/products/styles', { headers: staff, body: {
  styleCode: `LOAD-${run}`, name: 'Contention Tee', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', fabric: 'Cotton', hsnCode: '6109',
} }, 'style');
const colour = await ok('POST', `/api/v1/products/styles/${style.id}/colours`, { headers: staff, body: { name: 'White', colourCode: 'WHT' } }, 'colour');
const [sku] = await ok('POST', `/api/v1/products/styles/${style.id}/skus/generate`, { headers: staff, body: { sizeIds: [size.id] } }, 'sku');
await ok('POST', `/api/v1/products/styles/${style.id}/media`, { headers: staff, body: { colourId: colour.id, url: `${storefront}/e2e-fixture.png` } }, 'media');
await ok('POST', '/api/v1/catalog/prices', { headers: staff, body: { styleId: style.id, mrp: 999, sellingPrice: 799 } }, 'price');
await ok('POST', '/api/v1/inventory/adjustments', { headers: staff, body: {
  skuId: sku.skuId, locationId: location.id, quantityDelta: STOCK, reason: 'Load contention stock', idempotencyKey: `load-${sku.skuId}`,
} }, 'stock');
for (const step of ['ready-for-enrichment', 'qa-check', 'publish']) {
  await ok('POST', `/api/v1/products/styles/${style.id}/${step}`, { headers: staff }, step);
}

// --- 100 shoppers browse the same product and fill a bag, all at once ---
const shoppers = Array.from({ length: SHOPPERS }, (_, i) => ({
  i, ip: { 'x-forwarded-for': `198.51.${Math.floor(i / 250)}.${(i % 250) + 1}` },
}));
const timings = { page: [], live: [], bag: [], checkout: [] };
const PINCODE = '110099';
await ok('POST', '/api/v1/pdp/pincodes', { headers: staff, body: { pincode: PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true } }, 'serviceable pincode');
const address = { line1: '1 Test Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: PINCODE };
await Promise.all(shoppers.map(async (s) => {
  const session = await ok('POST', '/api/v1/storefront/guest-session', { headers: s.ip }, `guest session ${s.i}`);
  s.headers = { ...s.ip, 'x-guest-session-id': session.guestSessionId };
  const page = await call('GET', `/product/${style.id}`, { base: storefront, headers: s.ip });
  timings.page.push(page.ms);
  check(page.status === 200 && page.text.includes(style.id), `shopper ${s.i}: product page answered ${page.status}`);
  const live = await call('GET', `/api/v1/storefront/products/${style.id}`, { headers: s.ip });
  timings.live.push(live.ms);
  check(live.status === 200, `shopper ${s.i}: live product read answered ${live.status}`);
  const bag = await call('POST', '/api/v1/storefront/cart/items', { headers: s.headers, body: { skuId: sku.skuId, quantity: 1 } });
  timings.bag.push(bag.ms);
  check(bag.status === 201, `shopper ${s.i}: add to bag answered ${bag.status}`);
}));

// --- Everyone checks out at the same moment ---
const checkoutBody = (s) => ({
  contactName: `Load Shopper ${s.i}`, contactMobile: '9876543210', billingAddress: address, shippingAddress: address,
  paymentMethod: 'COD', idempotencyKey: `load-${run}-${s.i}`,
});
const results = await Promise.all(shoppers.map(async (s) => {
  const r = await call('POST', '/api/v1/storefront/checkout', { headers: s.headers, body: checkoutBody(s) });
  timings.checkout.push(r.ms);
  return { s, r };
}));
const accepted = results.filter(({ r }) => r.status === 201);
const refused = results.filter(({ r }) => r.status !== 201);
const refusalCodes = {};
for (const { r } of refused) {
  const key = `${r.status} ${r.json?.error?.code ?? 'no-code'}`;
  refusalCodes[key] = (refusalCodes[key] ?? 0) + 1;
}
check(accepted.length === STOCK, `${accepted.length} orders accepted for ${STOCK} units`);
check(refused.every(({ r }) => r.status === 409 && r.json?.error?.code === 'INSUFFICIENT_STOCK'),
  `refusals were not all clean 409 INSUFFICIENT_STOCK: ${JSON.stringify(refusalCodes)}`);

// --- Retrying an accepted checkout returns the same order ---
const retries = await Promise.all(accepted.map(async ({ s, r }) => {
  const again = await call('POST', '/api/v1/storefront/checkout', { headers: s.headers, body: checkoutBody(s) });
  return again.status === 201 && again.json?.id === r.json?.id;
}));
check(retries.every(Boolean), `${retries.filter((x) => !x).length} accepted checkouts did not replay to the same order`);

// --- Stock integrity ---
const balance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId: sku.skuId, locationId: location.id } } });
const orders = await prisma.orderLine.count({ where: { skuId: sku.skuId } });
const converted = await prisma.inventoryReservation.count({ where: { skuId: sku.skuId, status: 'CONVERTED' } });
const active = await prisma.inventoryReservation.count({ where: { skuId: sku.skuId, status: 'ACTIVE' } });
const reconcile = await ok('GET', `/api/v1/inventory/reconcile?skuId=${sku.skuId}&locationId=${location.id}`, { headers: staff }, 'reconcile');
const liveAfter = await ok('GET', `/api/v1/storefront/products/${style.id}`, {}, 'live product after');
const availableAfter = liveAfter.variants.reduce((sum, v) => sum + v.availableQuantity, 0);
check(balance.onHand === STOCK && balance.reserved === STOCK, `balance onHand=${balance.onHand} reserved=${balance.reserved}, expected ${STOCK}/${STOCK}`);
check(orders === STOCK, `${orders} order lines for ${STOCK} units`);
check(converted === STOCK && active === 0, `reservations converted=${converted} active=${active}`);
check(reconcile.status === 'MATCH', `ledger reconciliation ${reconcile.status}`);
check(availableAfter === 0, `storefront still offers ${availableAfter} units`);

const report = {
  environment: 'supplied test target; not a production capacity certification',
  shoppers: SHOPPERS, stock: STOCK, accepted: accepted.length, refusals: refusalCodes,
  balance: { onHand: balance.onHand, reserved: balance.reserved }, orderLines: orders,
  reservations: { converted, active }, reconciliation: reconcile.status, availableAfter,
  latencyMs: { productPage: stats(timings.page), liveProduct: stats(timings.live), addToBag: stats(timings.bag), checkout: stats(timings.checkout) },
  failures,
};
console.log(JSON.stringify(report, null, 2));
await writeFile(process.env.LOAD_TEST_REPORT ?? 'checkout-contention-results.json', JSON.stringify(report, null, 2));
await prisma.$disconnect();
if (failures.length) throw new Error(`Checkout contention gate failed: ${failures.length} check(s)`);
