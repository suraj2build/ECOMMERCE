import { writeFile } from 'node:fs/promises';
import { measureReadLoad } from './lib/read-load.mjs';

// Explicit test environment only; production capacity still requires the
// selected topology, real network/CDN and a sustained mixed workload.
const base = process.env.LOAD_TEST_API_URL;
if (!base || process.env.LOAD_TEST_ALLOWED !== 'test-environment') {
  throw new Error('Set LOAD_TEST_API_URL and LOAD_TEST_ALLOWED=test-environment explicitly.');
}
const response = await fetch(`${base}/api/v1/storefront/styles?take=1`);
if (!response.ok) throw new Error(`Catalog setup failed: ${response.status}`);
const styles = await response.json();
if (!styles[0]?.id) throw new Error('A real published, priced test product is required.');
const product = `${base}/api/v1/storefront/products/${styles[0].id}`;
const storefront = process.env.LOAD_TEST_STOREFRONT_URL;
if (!storefront) throw new Error('LOAD_TEST_STOREFRONT_URL is required to test the rendered product route.');
const reports = [];
let shopper = 0;
for (const connections of [100, 200]) {
  for (const [name, url] of [
    ['same-product', product],
    ['product-page', `${storefront}/product/${styles[0].id}`],
    ['catalog', `${base}/api/v1/storefront/styles?take=24`],
    ['search', `${base}/api/v1/storefront/search?pageSize=24`],
  ]) {
    const result = await measureReadLoad({
      url, connections, duration: connections === 100 ? 30 : 15,
      headerFactory() {
        const id = shopper++;
        return { 'x-forwarded-for': `198.18.${Math.floor(id / 250) % 250}.${id % 250 + 1}` };
      },
      verifyBody(body) {
        if (name === 'product-page') return body.includes('<html') && body.includes(styles[0].id) && body.includes('"@type":"Product"');
        const value = JSON.parse(body);
        return value.unavailable !== true && !value.error;
      },
    });
    const report = { name, connections, ...result };
    reports.push(report);
    console.log(JSON.stringify(report));
  }
}
await writeFile(process.env.LOAD_TEST_REPORT ?? 'read-load-results.json', JSON.stringify({
  environment: 'supplied test target; production capacity not certified',
  method: 'connection admission and warmed steady-state read load; both phases fail on errors',
  reports,
}, null, 2));
if (reports.some((r) => r.errors || r.timeouts || r.non2xx || r.mismatches)) {
  throw new Error('Read-load gate failed: errors, timeouts, non-2xx or invalid responses (including admission).');
}
