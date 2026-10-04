#!/usr/bin/env node
// VANYA local demo: one command starts the whole application on this
// computer with demo data, reachable from a phone on the same Wi-Fi.
//
//   npm run demo              start (first run installs, builds and seeds)
//   npm run demo -- --reset   start from an empty demo database
//   npm run demo -- --rebuild force a fresh build
//   npm run demo -- --host 192.168.1.20   use this address for phones
//
// Free and local: nothing is deployed or hosted. Payments are cash on
// delivery only (no Razorpay keys), sign-in codes are printed here instead
// of sent by SMS, and shipping uses the test carrier. Guide:
// docs/deployment/LOCAL_DEMO.md.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, '.demo');
const LOGS = path.join(STATE, 'logs');
const isWin = process.platform === 'win32';
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const PORTS = { api: 4000, storefront: 3000, admin: 3001 };
const DB_NAME = 'vanya_demo';
const PG = { user: 'fcp_app', password: 'fcp_dev_password', host: '127.0.0.1', port: 5432 };
const DATABASE_URL = `postgresql://${PG.user}:${PG.password}@${PG.host}:${PG.port}/${DB_NAME}`;

const say = (msg = '') => console.log(msg);
const step = (msg) => say(`\n▸ ${msg}`);
function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- checks

const [major] = process.versions.node.split('.').map(Number);
if (major !== 24) fail(`Node.js 24 is required (found ${process.versions.node}). Install it from https://nodejs.org and run again.`);

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
  fail(`${what} did not become ready within ${seconds} seconds. Logs: ${LOGS}`);
}

/** The address phones use: this computer's Wi-Fi/LAN IPv4 address. */
function lanAddress() {
  const override = option('host');
  if (override) return override;
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|br-|veth|vEthernet|vmnet|vboxnet|utun|tailscale|zt|wg)/i.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const score = a.address.startsWith('192.168.') ? 3 : a.address.startsWith('10.') ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 1 : 0;
      candidates.push({ name, address: a.address, score });
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  if (candidates.length > 1) {
    say(`  Network addresses found: ${candidates.map((c) => `${c.address} (${c.name})`).join(', ')}`);
    say(`  Using ${candidates[0].address}. If your phone cannot connect, run again with --host <the Wi-Fi address>.`);
  }
  return candidates[0]?.address ?? '127.0.0.1';
}

function run(cmd, cmdArgs, env, label, { cwd = ROOT } = {}) {
  const log = path.join(LOGS, `${label}.log`);
  const res = spawnSync(cmd, cmdArgs, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', shell: isWin, maxBuffer: 256 * 1024 * 1024 });
  writeFileSync(log, `${res.stdout ?? ''}${res.stderr ?? ''}`);
  if (res.status !== 0) fail(`${label} failed. See ${log}`);
}
const npm = isWin ? 'npm.cmd' : 'npm';

// ---------------------------------------------------------------- state

mkdirSync(LOGS, { recursive: true });
const settingsFile = path.join(STATE, 'settings.json');
const settings = existsSync(settingsFile)
  ? JSON.parse(readFileSync(settingsFile, 'utf8'))
  : {
      // Generated once on this computer and kept in .demo/ (git-ignored).
      jwtSecret: randomBytes(32).toString('hex'),
      guestSecret: randomBytes(32).toString('hex'),
      revalidateSecret: randomBytes(32).toString('hex'),
      mfaKey: randomBytes(32).toString('hex'),
      adminEmail: 'admin@vanya-demo.example',
      adminPassword: `Vanya-${randomBytes(6).toString('hex')}-Demo1!`,
    };
writeFileSync(settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });

const HOST = lanAddress();
const url = (port) => `http://${HOST}:${port}`;

const apiEnv = {
  NODE_ENV: 'production',
  DEPLOYMENT_STAGE: 'preview',
  PORT: String(PORTS.api),
  LOG_LEVEL: 'info',
  DATABASE_URL,
  REDIS_URL: 'redis://127.0.0.1:6379/3',
  MEILISEARCH_HOST: 'http://127.0.0.1:7700',
  JWT_ACCESS_SECRET: settings.jwtSecret,
  GUEST_SESSION_SIGNING_SECRET: settings.guestSecret,
  MFA_SECRET_ENCRYPTION_KEY: settings.mfaKey,
  STOREFRONT_REVALIDATE_SECRET: settings.revalidateSecret,
  STOREFRONT_REVALIDATE_URL: `http://127.0.0.1:${PORTS.storefront}/api/revalidate/product`,
  STOREFRONT_PUBLIC_URL: url(PORTS.storefront),
  CORS_ORIGINS: [url(PORTS.storefront), url(PORTS.admin), `http://localhost:${PORTS.storefront}`, `http://localhost:${PORTS.admin}`].join(','),
  TRUST_PROXY_HOPS: '0',
  MAINTENANCE_ALERT_LOG_ONLY: 'true',
  // The demo has no online payment, so cash on delivery must cover every
  // demo product; the real default limit (₹5,000) applies everywhere else.
  COD_MAX_ORDER_VALUE_INR: '100000',
  RETURN_EVIDENCE_STORAGE_DIR: path.join(STATE, 'return-evidence'),
  SEED_SUPER_ADMIN_EMAIL: settings.adminEmail,
  SEED_SUPER_ADMIN_PASSWORD: settings.adminPassword,
};
const storefrontEnv = {
  NODE_ENV: 'production',
  DEPLOYMENT_STAGE: 'preview',
  NEXT_PUBLIC_API_URL: url(PORTS.api),
  NEXT_PUBLIC_SITE_URL: url(PORTS.storefront),
  STOREFRONT_REVALIDATE_SECRET: settings.revalidateSecret,
};
const adminEnv = { NODE_ENV: 'production', NEXT_PUBLIC_API_URL: url(PORTS.api) };

say('VANYA local demo');
say(`  This computer: ${HOST}`);

// ---------------------------------------------------------------- services

step('Database, cache and search');
const services = { postgres: PG.port, redis: 6379, meilisearch: 7700 };
const missing = [];
for (const [name, port] of Object.entries(services)) if (!(await portOpen(port))) missing.push(name);
if (missing.length) {
  const docker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8', shell: isWin });
  if (docker.status !== 0) fail(`Not running: ${missing.join(', ')}. Install and start Docker Desktop (https://www.docker.com/products/docker-desktop/), then run again.`);
  say(`  Starting with Docker: ${missing.join(', ')}`);
  run('docker', ['compose', '-f', 'infra/docker-compose.yml', 'up', '-d', ...missing], {}, 'docker');
  for (const name of missing) await waitFor(() => portOpen(services[name]), name);
} else {
  say('  Already running.');
}

for (const [name, port] of Object.entries(PORTS)) {
  if (await portOpen(port)) fail(`Port ${port} (${name}) is already in use. Stop whatever is using it (or an earlier demo) and run again.`);
}

// ---------------------------------------------------------------- install + database

if (!existsSync(path.join(ROOT, 'node_modules', '.package-lock.json'))) {
  step('Installing dependencies (first run, a few minutes)');
  run(npm, ['ci'], {}, 'install');
}

async function adminDb(sql, { query = false } = {}) {
  const { PrismaClient } = await import('@fcp/db');
  const client = new PrismaClient({ datasources: { db: { url: `postgresql://${PG.user}:${PG.password}@${PG.host}:${PG.port}/postgres` } } });
  try {
    return query ? await client.$queryRawUnsafe(sql) : await client.$executeRawUnsafe(sql);
  } finally {
    await client.$disconnect();
  }
}

step('Demo database');
if (flag('reset')) {
  say('  --reset: removing the demo database and its search index');
  await adminDb(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await fetch('http://127.0.0.1:7700/indexes/styles', { method: 'DELETE' }).catch(() => undefined);
}
const exists = await adminDb(`SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'`, { query: true });
if (!exists.length) await adminDb(`CREATE DATABASE ${DB_NAME}`);
run(npm, ['run', 'db:migrate:deploy'], { DATABASE_URL }, 'migrate');
run(npm, ['run', 'db:seed'], { DATABASE_URL, SEED_SUPER_ADMIN_EMAIL: settings.adminEmail, SEED_SUPER_ADMIN_PASSWORD: settings.adminPassword }, 'seed');
say('  Ready.');

// ---------------------------------------------------------------- build

const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', shell: isWin }).stdout?.trim() || 'unknown';
const stampFile = path.join(STATE, 'build.json');
const stamp = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, 'utf8')) : null;
const built = existsSync(path.join(ROOT, 'apps/storefront/.next/BUILD_ID')) && existsSync(path.join(ROOT, 'apps/admin/.next/BUILD_ID')) && existsSync(path.join(ROOT, 'services/commerce-api/dist/index.js'));
if (flag('rebuild') || !built || stamp?.host !== HOST || stamp?.head !== head) {
  step(`Building the API, storefront and admin for ${HOST} (a few minutes)`);
  run(npm, ['run', 'build', '--workspace=services/commerce-api'], {}, 'build-api');
  run(npm, ['run', 'build', '--workspace=apps/storefront'], storefrontEnv, 'build-storefront');
  run(npm, ['run', 'build', '--workspace=apps/admin'], adminEnv, 'build-admin');
  writeFileSync(stampFile, JSON.stringify({ host: HOST, head, at: new Date().toISOString() }, null, 2));
} else {
  say(`\n▸ Build is current for ${HOST} (use --rebuild to force).`);
}

// ---------------------------------------------------------------- start

step('Starting');
const children = [];
let stopping = false;
function start(label, cmdArgs, env, cwd) {
  const out = createWriteStream(path.join(LOGS, `${label}.log`), { flags: 'w' });
  const child = spawn(process.execPath, cmdArgs, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.on('exit', (code) => {
    if (!stopping) console.error(`\n✗ ${label} stopped (exit ${code}). See ${path.join(LOGS, `${label}.log`)}`);
  });
  children.push(child);
  return child;
}
const nextBin = (app) => createRequire(path.join(ROOT, 'apps', app, 'package.json')).resolve('next/dist/bin/next');

const api = start('api', ['dist/index.js'], apiEnv, path.join(ROOT, 'services/commerce-api'));
// Sign-in codes: no SMS vendor yet, so the API prints them; show them here.
let buffered = '';
api.stdout.on('data', (chunk) => {
  buffered += chunk.toString();
  const lines = buffered.split('\n');
  buffered = lines.pop() ?? '';
  for (const line of lines) {
    const m = line.match(/OTP for (\S+): (\d{4,8})/);
    if (m) say(`  Sign-in code for ${m[1]}: ${m[2]}`);
  }
});
start('storefront', [nextBin('storefront'), 'start', '-H', '0.0.0.0', '-p', String(PORTS.storefront)], storefrontEnv, path.join(ROOT, 'apps/storefront'));
start('admin', [nextBin('admin'), 'start', '-H', '0.0.0.0', '-p', String(PORTS.admin)], adminEnv, path.join(ROOT, 'apps/admin'));

function stop() {
  if (stopping) return;
  stopping = true;
  say('\nStopping the demo…');
  for (const child of children) child.kill();
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const ok = (u) => fetch(u).then((r) => r.ok).catch(() => false);
await waitFor(() => ok(`http://127.0.0.1:${PORTS.api}/health`), 'The API');
await waitFor(() => ok(`http://127.0.0.1:${PORTS.storefront}/`), 'The storefront');
await waitFor(() => ok(`http://127.0.0.1:${PORTS.admin}/login`), 'The admin');

step('Demo catalogue');
const seed = spawnSync(process.execPath, ['scripts/seed-demo.mjs'], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, ...apiEnv, DEMO_SEED_ALLOWED: 'preview', DEMO_API_URL: `http://127.0.0.1:${PORTS.api}`, DEMO_ASSET_BASE: url(PORTS.storefront) },
});
writeFileSync(path.join(LOGS, 'demo-seed.log'), `${seed.stdout}${seed.stderr}`);
if (seed.status !== 0) {
  stop();
  fail(`Loading the demo catalogue failed. See ${path.join(LOGS, 'demo-seed.log')}`);
}
// The search engine may hold products from another database (development,
// tests, an earlier demo): the reindex rebuilds it from the demo database
// alone and refreshes the storefront's cached pages (DEPLOYMENT.md runbook).
const login = await fetch(`http://127.0.0.1:${PORTS.api}/api/v1/auth/staff/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: settings.adminEmail, password: settings.adminPassword }),
}).then((r) => r.json()).catch(() => ({}));
const reindex = login.token
  ? await fetch(`http://127.0.0.1:${PORTS.api}/api/v1/search/reindex`, { method: 'POST', headers: { authorization: `Bearer ${login.token}` } }).catch(() => null)
  : null;
if (!reindex?.ok) {
  stop();
  fail(`Rebuilding the search index failed. See ${path.join(LOGS, 'api.log')}`);
}
say('  12 products, 3 collections and Watch & Shop are loaded; search index rebuilt.');

say(`
────────────────────────────────────────────────────────────
  VANYA demo is running.

  On this computer   Storefront  http://localhost:${PORTS.storefront}
                     Admin       http://localhost:${PORTS.admin}/login

  On your phone      Storefront  ${url(PORTS.storefront)}
  (same Wi-Fi)       Admin       ${url(PORTS.admin)}/login

  Admin sign-in      ${settings.adminEmail}
                     ${settings.adminPassword}

  Customer sign-in   any 10-digit mobile number; the code appears here.
  Payment            cash on delivery, allowed up to ₹1,00,000 in the demo
                     (online payment is not set up here).

  Phone can't connect? Allow Node.js through this computer's firewall on
  private networks, and check the phone is on the same Wi-Fi (not mobile
  data or a guest network). Guide: docs/deployment/LOCAL_DEMO.md

  Press Ctrl+C to stop. Logs: ${LOGS}
────────────────────────────────────────────────────────────`);
