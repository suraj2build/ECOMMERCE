import { PrismaClient } from '@fcp/db';

const base = process.env.LOAD_TEST_API_URL;
if (process.env.NODE_ENV !== 'test' || process.env.LOAD_TEST_ALLOWED !== 'test-environment' || !base) {
  throw new Error('Fixture provisioning requires an explicit test environment and API URL.');
}
const prisma = new PrismaClient();
let headers;
async function post(path, data) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method: 'POST', headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`Fixture ${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
}
try {
  const login = await post('/auth/staff/login', {
    email: process.env.SEED_SUPER_ADMIN_EMAIL, password: process.env.SEED_SUPER_ADMIN_PASSWORD,
  });
  if (!login.token) throw new Error('Test fixture requires an authenticated test staff session');
  headers = { authorization: `Bearer ${login.token}` };
  const category = await prisma.category.upsert({ where: { slug: 'native-load-category' }, update: {},
    create: { name: 'Native load category', slug: 'native-load-category' } });
  const size = await prisma.size.upsert({ where: { label: 'LOAD-M' }, update: {},
    create: { label: 'LOAD-M', sortOrder: 0 } });
  const suffix = Date.now() % 100000;
  const brand = await post('/organization/brands', { code: `LOAD${suffix}`, name: 'Read load fixture brand' });
  const location = await post('/organization/locations', {
    code: `LOADLOC${suffix}`, name: 'Read load fixture warehouse', type: 'WAREHOUSE',
  });
  const style = await post('/products/styles', {
    styleCode: `NATIVE-LOAD-${Date.now()}`, name: 'Read load fixture jacket',
    brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', fabric: 'Cotton',
  });
  const colour = await post(`/products/styles/${style.id}/colours`, { name: 'Black', colourCode: 'BLK' });
  const skus = await post(`/products/styles/${style.id}/skus/generate`, { sizeIds: [size.id] });
  if (!skus[0]?.skuId) throw new Error('Fixture SKU generation returned no SKU');
  await post(`/products/styles/${style.id}/media`, {
    colourId: colour.id, url: 'http://localhost:3000/e2e-fixture.png',
  });
  await post(`/products/styles/${style.id}/ready-for-enrichment`);
  await post(`/products/styles/${style.id}/qa-check`);
  await post(`/products/styles/${style.id}/publish`);
  await post('/catalog/prices', { styleId: style.id, mrp: 1999, sellingPrice: 1999 });
  await post('/inventory/adjustments', {
    skuId: skus[0].skuId, locationId: location.id, quantityDelta: 10,
    reason: 'CI native read-load fixture', idempotencyKey: `native-load-stock-${skus[0].skuId}`,
  });
  console.log(`Published real API load fixture ${style.id}`);
} finally {
  await prisma.$disconnect();
}
