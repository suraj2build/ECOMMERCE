#!/usr/bin/env node
// Runs the full Playwright suite locally against a DEDICATED, disposable
// stack - never against the local demo. This closes the gap CI doesn't
// have: CI gets a fresh ephemeral Postgres/Meilisearch per run, so e2e's
// own fixture-writing specs (search-deep-pages, record-completeness -
// see playwright.config.ts) can never touch anything real. Locally, the
// same host commonly also runs `npm run demo`, which is NOT disposable -
// so this script uses the existing `fcp_test` database (the same one
// `npm run test:integration` uses) and NODE_ENV=test (which makes
// services/commerce-api/src/modules/search/index-service.ts use the
// `styles_test` Meilisearch index, never the demo's own `styles` index).
//
//   npm run test:e2e:local
//   PG_HOST_PORT=5434 npm run test:e2e:local   (same override demo-local.mjs supports)
//
// This REBUILDS apps/storefront and apps/admin with E2E-specific
// NEXT_PUBLIC_API_URL values, overwriting whatever .next build is
// currently there (including a local demo's). Rebuild+restart the demo
// afterward if you need it back (npm run demo -- --rebuild).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LOGS = path.join(ROOT, '.e2e-local', 'logs');
mkdirSync(LOGS, { recursive: true });
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

const PG_HOST_PORT = Number(process.env.PG_HOST_PORT) || 5432;
const PG = { user: 'fcp_app', password: 'fcp_dev_password', host: '127.0.0.1', port: PG_HOST_PORT };
const DATABASE_URL = `postgresql://${PG.user}:${PG.password}@${PG.host}:${PG.port}/fcp_test`;
const MEILISEARCH_HOST = `http://127.0.0.1:${process.env.MEILISEARCH_PORT ?? 7700}`;
const REDIS_URL = `redis://127.0.0.1:${process.env.REDIS_PORT ?? 6379}/1`;

// Deliberately NOT the demo's ports (4000/3000/3001), so both can exist
// at once without a port clash (the build-overwrite caveat above still
// applies either way).
const PORTS = { api: 4010, storefront: 3010, admin: 3011 };

const say = (msg = '') => console.log(msg);
const step = (msg) => say(`\n▸ ${msg}`);
const children = [];
function fail(msg) {
  console.error(`\n✗ ${msg}`);
  for (const child of children) child.kill();
  process.exit(1);
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}
async function waitFor(check, what, seconds = 90) {
  for (let i = 0; i < seconds; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`${what} did not become ready within ${seconds} seconds.`);
}
function runSync(cmd, args, env, label, { cwd = ROOT } = {}) {
  const log = path.join(LOGS, `${label}.log`);
  const res = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', shell: isWin, maxBuffer: 256 * 1024 * 1024 });
  writeFileSync(log, `${res.stdout ?? ''}${res.stderr ?? ''}`);
  if (res.status !== 0) fail(`${label} failed (exit ${res.status}). See ${log}`);
}
function runBackground(cmd, args, env, label, { cwd = ROOT } = {}) {
  const log = path.join(LOGS, `${label}.log`);
  const out = openSync(log, 'w');
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', out, out], shell: isWin });
  children.push(child);
  return child;
}

async function main() {
  for (const [name, port] of [['postgres', PG.port], ['redis', Number(process.env.REDIS_PORT) || 6379], ['meilisearch', Number(process.env.MEILISEARCH_PORT) || 7700]]) {
    if (!(await portOpen(port))) fail(`${name} is not reachable on port ${port}. Start infra/docker-compose.yml first (same stack npm run demo / test:integration use).`);
  }
  for (const [name, port] of Object.entries(PORTS)) {
    if (await portOpen(port)) fail(`Port ${port} (${name}) is already in use - stop whatever is running there and try again.`);
  }

  step('Resetting fcp_test to a clean, demo-free schema (RBAC/admin baseline only)');
  runSync(npm, ['run', 'db:migrate:deploy', '--workspace=packages/db'], { DATABASE_URL }, 'migrate');
  // Full reset (not just migrate) so a prior integration-test run's rows
  // never leak into e2e as a false "it already exists" positive.
  runSync('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-seed'], { DATABASE_URL }, 'reset', { cwd: path.join(ROOT, 'packages/db') });
  runSync(npm, ['run', 'db:seed', '--workspace=packages/db'], {
    DATABASE_URL,
    SEED_SUPER_ADMIN_EMAIL: process.env.SEED_SUPER_ADMIN_EMAIL ?? 'e2e-admin@example.com',
    SEED_SUPER_ADMIN_PASSWORD: process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'E2eOnlyPassword123!',
  }, 'seed');

  step('Clearing the styles_test Meilisearch index (NODE_ENV=test routes here, never the demo\'s "styles")');
  spawnSync('curl', ['-sf', '-X', 'DELETE', `${MEILISEARCH_HOST}/indexes/styles_test`], { encoding: 'utf8' });

  step('Building commerce-api');
  runSync(npm, ['run', 'build', '--workspace=services/commerce-api'], {}, 'build-api');

  step(`Building storefront and admin (NEXT_PUBLIC_API_URL=http://localhost:${PORTS.api} - this overwrites any current .next build, including a local demo's)`);
  runSync(npm, ['run', 'build', '--workspace=apps/storefront'], {
    NODE_ENV: 'production',
    NEXT_PUBLIC_API_URL: `http://localhost:${PORTS.api}`,
    NEXT_PUBLIC_SITE_URL: `http://localhost:${PORTS.storefront}`,
    NEXT_PUBLIC_GA4_MEASUREMENT_ID: 'G-E2ETEST01',
    NEXT_PUBLIC_META_PIXEL_ID: '1234567890',
  }, 'build-storefront');
  runSync(npm, ['run', 'build', '--workspace=apps/admin'], { NODE_ENV: 'production', NEXT_PUBLIC_API_URL: `http://localhost:${PORTS.api}` }, 'build-admin');

  step('Starting the dedicated e2e API/storefront/admin trio');
  const apiEnv = {
    NODE_ENV: 'test', // routes search to styles_test, see index-service.ts
    PORT: String(PORTS.api),
    LOG_LEVEL: 'info',
    DATABASE_URL,
    REDIS_URL,
    MEILISEARCH_HOST,
    JWT_ACCESS_SECRET: 'e2e-only-secret-e2e-only-secret',
    GUEST_SESSION_SIGNING_SECRET: 'e2e-only-guest-session-secret-not-for-prod',
    MFA_SECRET_ENCRYPTION_KEY: 'b'.repeat(64),
    CORS_ORIGINS: `http://localhost:${PORTS.storefront},http://localhost:${PORTS.admin}`,
    TRUST_PROXY_HOPS: '0',
    MAINTENANCE_ALERT_LOG_ONLY: 'true',
    SITE_INDEXING: 'enabled',
  };
  runBackground('node', ['services/commerce-api/dist/index.js'], apiEnv, 'api');
  await waitFor(() => portOpen(PORTS.api), 'commerce-api');

  runBackground('npx', ['next', 'start', '-p', String(PORTS.storefront)], { NODE_ENV: 'production' }, 'storefront', { cwd: path.join(ROOT, 'apps/storefront') });
  await waitFor(() => portOpen(PORTS.storefront), 'storefront');

  runBackground('npx', ['next', 'start', '-p', String(PORTS.admin)], { NODE_ENV: 'production' }, 'admin', { cwd: path.join(ROOT, 'apps/admin') });
  await waitFor(() => portOpen(PORTS.admin), 'admin');

  step('Running the full Playwright suite (api-smoke, storefront, storefront-bulk-catalogue, admin)');
  const res = spawnSync(npm, ['run', 'test:e2e'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWin,
    env: {
      ...process.env,
      E2E_BASE_URL: `http://localhost:${PORTS.api}`,
      STOREFRONT_BASE_URL: `http://localhost:${PORTS.storefront}`,
      ADMIN_BASE_URL: `http://localhost:${PORTS.admin}`,
    },
  });

  for (const child of children) child.kill();
  say(`\n${res.status === 0 ? '✓ e2e suite passed' : `✗ e2e suite failed (exit ${res.status})`} against the dedicated fcp_test/styles_test stack - the local demo (if any) was not touched by test DATA, but its storefront/admin .next build was overwritten and needs a rebuild to come back (npm run demo -- --rebuild).`);
  process.exit(res.status ?? 1);
}

main().catch((error) => fail(error.stack ?? String(error)));
