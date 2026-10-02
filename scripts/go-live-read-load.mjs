import autocannon from 'autocannon';
import { writeFile } from 'node:fs/promises';

// Run only against an explicitly supplied test environment. This harness is
// read-only; checkout contention remains a separate integration/staging gate.
const base = process.env.LOAD_TEST_API_URL;
if (!base || process.env.LOAD_TEST_ALLOWED !== 'test-environment') {
  throw new Error('Set LOAD_TEST_API_URL and LOAD_TEST_ALLOWED=test-environment explicitly.');
}
const response = await fetch(`${base}/api/v1/storefront/styles?take=1`);
if (!response.ok) throw new Error(`Catalog setup failed: ${response.status}`);
const styles = await response.json();
if (!styles[0]?.id) throw new Error('A real published, priced test product is required.');
const product = `${base}/api/v1/storefront/products/${styles[0].id}`;
const reports = [];
for (const connections of [100, 200]) {
  for (const [name, url] of [
    ['same-product', product],
    ['catalog', `${base}/api/v1/storefront/styles?take=24`],
    ['search', `${base}/api/v1/storefront/search?pageSize=24`],
  ]) {
    const result = await new Promise((resolve, reject) => {
      autocannon({ url, connections, duration: connections === 100 ? 30 : 15 }, (error, metrics) => error ? reject(error) : resolve(metrics));
    });
    const report = { name, connections, requests: result.requests, latency: result.latency, errors: result.errors, timeouts: result.timeouts, non2xx: result.non2xx };
    reports.push(report);
    console.log(JSON.stringify(report));
  }
}
await writeFile(process.env.LOAD_TEST_REPORT ?? 'read-load-results.json', JSON.stringify({ environment: 'supplied test target; production capacity not certified', reports }, null, 2));
if (reports.some((r) => r.errors || r.timeouts || r.non2xx)) throw new Error('Read-load gate failed: errors, timeouts or non-2xx responses.');
