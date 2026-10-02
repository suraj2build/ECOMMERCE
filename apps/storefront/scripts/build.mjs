// Builds the storefront for production and refuses a build in which a
// product page can only be served for IDs known at build time.
//
// The product page caches on demand (generateStaticParams returns []).
// Next 15 admits unseen IDs at runtime only when NODE_ENV is exactly
// "production" during `next build`; any other value (CI exports "test")
// silently produces a build where every product page is a 404
// (NoFallbackError). A deployable build is always a production build, so
// NODE_ENV is forced here and the result is checked.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

const result = spawnSync(process.execPath, [nextBin, 'build'], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});
if (result.status !== 0) process.exit(result.status ?? 1);

const manifest = JSON.parse(readFileSync(join(appDir, '.next', 'prerender-manifest.json'), 'utf8'));
const pdp = manifest.dynamicRoutes?.['/product/[styleId]'];
if (!pdp || pdp.fallback !== null) {
  console.error(
    `Product pages must render unseen products on demand (prerender fallback null), got ${JSON.stringify(pdp?.fallback)}.`,
  );
  process.exit(1);
}
