// Replace a product colour's placeholder image gallery with reviewed
// photography through the real staff API - never a database reset or
// direct write. The product-media route is append-only by design
// (docs/deployment/PRODUCT_PHOTOGRAPHY.md), so this uses the narrowly
// scoped replace endpoint (POST .../colours/:colourId/media/replace)
// added specifically for this: one atomic swap per colour, so a
// placeholder gallery is never left interspersed with real photos and a
// rerun never accumulates duplicate rows.
//
// Source of truth: scripts/demo-data/product-photography.json. Only a
// COMPLETE reviewed gallery (all four views: front/back/side/detail) for
// a colour is ever applied - a partially-reviewed colour is left alone,
// same discipline scripts/seed-demo.mjs already applies for a fresh seed.
//
//   node scripts/apply-product-images.mjs --validate   # offline: check files only, no API calls
//   node scripts/apply-product-images.mjs              # dry run against the live API (no writes)
//   node scripts/apply-product-images.mjs --apply      # perform the writes
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const { views: VIEWS, jobs } = JSON.parse(readFileSync(new URL('scripts/demo-data/product-photography.json', root), 'utf8'));
const apply = process.argv.includes('--apply');
const offline = process.argv.includes('--validate');

// --- Group jobs into (styleCode, colourCode) galleries ---
const galleries = new Map();
for (const job of jobs) {
  const key = `${job.styleCode}::${job.colourCode}`;
  if (!galleries.has(key)) galleries.set(key, { styleCode: job.styleCode, colourCode: job.colourCode, colour: job.colour, title: job.title, byView: {} });
  galleries.get(key).byView[job.view] = job;
}

const complete = [];
const incomplete = [];
for (const gallery of galleries.values()) {
  const views = VIEWS.map((v) => gallery.byView[v]);
  if (views.every((j) => j?.status === 'reviewed')) {
    complete.push({ ...gallery, views });
  } else {
    incomplete.push(gallery);
  }
}

// Every file a complete gallery references must actually exist on disk -
// catch a missing/renamed asset before any API call, not mid-run.
for (const gallery of complete) {
  for (const job of gallery.views) {
    readFileSync(new URL(`apps/storefront/public${job.asset}`, root));
  }
}

console.log(`${complete.length} colour galleries fully reviewed (ready to apply); ${incomplete.length} still incomplete/pending (left untouched).`);

if (offline) {
  console.log(`Validated ${complete.length} galleries and all ${complete.length * VIEWS.length} referenced image files. No API calls made.`);
  process.exit(0);
}

// --- Live API ---
let settings = {};
try {
  settings = JSON.parse(readFileSync(new URL('.demo/settings.json', root), 'utf8'));
} catch {}
const api = (process.env.DEMO_API_URL ?? 'http://localhost:4000').replace(/\/$/, '') + '/api/v1';
const origin = (process.env.DEMO_STOREFRONT_URL ?? 'http://localhost:3000').replace(/\/$/, '');
let token;

async function call(method, path, body) {
  const res = await fetch(api + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const email = process.env.SEED_SUPER_ADMIN_EMAIL ?? settings.adminEmail;
const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? settings.adminPassword;
if (!email || !password) throw new Error('Demo staff credentials unavailable. Use the established desktop demo settings or staff credential environment variables.');
({ token } = await call('POST', '/auth/staff/login', { email, password }));

// Every style we might need, fetched once as a cheap list, then only the
// styles a complete gallery actually references get their own detail call.
const neededStyleCodes = new Set(complete.map((g) => g.styleCode));
const styleIdByCode = new Map();
for (let skip = 0; ; skip += 200) {
  const page = await call('GET', `/products/styles?take=200&skip=${skip}`);
  for (const s of page) if (neededStyleCodes.has(s.styleCode)) styleIdByCode.set(s.styleCode, s.id);
  if (page.length < 200) break;
}

let appliedCount = 0;
let upToDateCount = 0;
let failedCount = 0;

for (const gallery of complete) {
  const label = `${gallery.styleCode} / ${gallery.colourCode} (${gallery.title}, ${gallery.colour})`;
  try {
    const styleId = styleIdByCode.get(gallery.styleCode);
    if (!styleId) throw new Error(`No style found in the catalogue for styleCode '${gallery.styleCode}'`);
    const style = await call('GET', `/products/styles/${styleId}`);
    const colour = style.colours.find((c) => c.colourCode === gallery.colourCode);
    if (!colour) throw new Error(`Style has no colour '${gallery.colourCode}'`);

    const items = gallery.views.map((job) => ({
      url: new URL(job.asset, origin).href,
      altText: `${gallery.title} in ${gallery.colour} (AI-generated UAT product image)`,
    }));

    // Preflight every image is actually served before writing anything.
    for (const item of items) {
      const res = await fetch(item.url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
      if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) {
        throw new Error(`Image not served: ${item.url}. Deploy/rebuild storefront assets first.`);
      }
    }

    const existing = (style.media ?? [])
      .filter((m) => m.colourId === colour.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => m.url);
    const desired = items.map((i) => i.url);
    if (JSON.stringify(existing) === JSON.stringify(desired)) {
      upToDateCount += 1;
      continue;
    }

    if (apply) {
      await call('POST', `/products/styles/${styleId}/colours/${colour.id}/media/replace`, { items });
      const after = await call('GET', `/products/styles/${styleId}`);
      const afterUrls = (after.media ?? [])
        .filter((m) => m.colourId === colour.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((m) => m.url);
      if (JSON.stringify(afterUrls) !== JSON.stringify(desired)) {
        throw new Error(`Write verification failed for ${label}`);
      }
    }
    appliedCount += 1;
  } catch (err) {
    failedCount += 1;
    console.error(`FAILED ${label}: ${err.message}`);
  }
}

console.log(
  `${apply ? 'Applied and verified' : 'Dry run:'} ${appliedCount} colour gallery replacement(s); ${upToDateCount} already up to date; ${failedCount} failed.` +
    (incomplete.length ? ` ${incomplete.length} colour(s) still incomplete and left untouched.` : ''),
);
if (failedCount > 0) process.exitCode = 1;
