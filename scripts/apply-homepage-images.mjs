// Replace only homepage CMS media. Never resets or seeds catalogue data.
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('scripts/demo-data/homepage-images.json', root), 'utf8'));
const apply = process.argv.includes('--apply');
const offline = process.argv.includes('--validate');
for (const b of manifest.banners) {
  if (!b.placement || !b.title || !Number.isInteger(b.sortOrder) || !b.asset.startsWith('/campaigns/launch-v1/')) throw new Error('Invalid banner manifest');
  readFileSync(new URL(`apps/storefront/public${b.asset}`, root));
}
if (offline) {
  console.log(`Validated ${manifest.banners.length} placements and all referenced image files.`);
  process.exit(0);
}
let settings = {};
try { settings = JSON.parse(readFileSync(new URL('.demo/settings.json', root), 'utf8')); } catch {}
const api = (process.env.DEMO_API_URL ?? 'http://localhost:4000').replace(/\/$/, '') + '/api/v1';
const origin = (process.env.DEMO_STOREFRONT_URL ?? 'http://localhost:3000').replace(/\/$/, '');
let token;
async function call(method, path, body) {
  const res = await fetch(api + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  return res.json();
}
const email = process.env.SEED_SUPER_ADMIN_EMAIL ?? settings.adminEmail;
const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? settings.adminPassword;
if (!email || !password) throw new Error('Demo staff credentials unavailable. Use the established desktop demo settings or staff credential environment variables.');
({ token } = await call('POST', '/auth/staff/login', { email, password }));
const current = await call('GET', '/cms/banners');
if (!Array.isArray(current)) throw new Error('Unexpected banner response');
const plan = manifest.banners.map(b => {
  const matches = current.filter(x => x.placement === b.placement && x.sortOrder === b.sortOrder);
  if (matches.length !== 1) throw new Error(`Expected one existing banner at ${b.placement}:${b.sortOrder}; got ${matches.length}. No writes performed.`);
  const existing = matches[0];
  if (existing.title !== b.title) throw new Error(`Banner title changed at ${b.placement}:${b.sortOrder}. Review manifest before replacing.`);
  return { existing, b, imageUrl: b.asset };
});
// Preflight every image before making any CMS writes.
for (const p of plan) {
  const res = await fetch(origin + p.b.asset, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
  if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) throw new Error(`Campaign asset not served: ${p.b.asset}. Deploy/rebuild storefront assets first.`);
}
let changed = 0;
for (const p of plan) {
  if (p.existing.imageUrl === p.imageUrl) continue;
  if (apply) await call('PATCH', `/cms/banners/${p.existing.id}`, { imageUrl: p.imageUrl });
  changed++;
}
if (apply) {
  const after = await call('GET', '/cms/banners');
  for (const p of plan) if (after.find(x => x.id === p.existing.id)?.imageUrl !== p.imageUrl) throw new Error(`Write verification failed: ${p.b.placement}`);
}
console.log(`${apply ? 'Applied and verified' : 'Dry run:'} ${changed} image replacements. Product data, orders, inventory, links and banner identities preserved.`);
