import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { appMaintenanceJobs, createMaintenanceRunner, prismaMaintenanceStore, webhookAlerts } from '../../src/maintenance.js';

/** LR-006: every sweep is scheduled, every run is recorded, and staff can see
 * last success / last failure / consecutive failures per job. */
describe('Scheduled sweeps and job monitoring (LR-006)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDatabase(); await seedRbac(); });
  const store = () => prismaMaintenanceStore(app.prisma, { leaseMs: 60_000 });

  const EXPECTED_JOBS = [
    'expire-payments', 'expire-reservations', 'recover-invoices', 'release-loyalty-holds', 'release-store-credit-holds',
    'release-gift-card-holds', 'reconcile-refunds', 'send-due-campaigns', 'vest-loyalty-points', 'expire-loyalty-points',
    'reclaim-channel-claims', 'resync-channel-listings', 'dispatch-conversion-events', 'prune-maintenance-runs',
  ];

  it('schedules every recovery and expiry sweep and runs each one successfully as the system', async () => {
    const jobs = appMaintenanceJobs(app);
    expect(jobs.map((j) => j.name)).toEqual(EXPECTED_JOBS);
    const runner = createMaintenanceRunner(jobs, app.log, 60_000, { store: store() });
    await runner.runAll();
    const runs = await testPrisma.maintenanceJobRun.findMany();
    expect(runs.map((r) => r.job).sort()).toEqual([...EXPECTED_JOBS].sort());
    expect(runs.filter((r) => r.outcome !== 'SUCCESS').map((r) => `${r.job}: ${r.error}`)).toEqual([]);
  });

  it('reports per-job status to staff with audit:read, including an alert after three failures in a row', async () => {
    const failing = createMaintenanceRunner([{ name: 'expire-payments', run: async () => { throw new Error('payment gateway timeout'); } }], app.log, 60_000, { store: store() });
    for (let i = 0; i < 3; i++) await failing.runAll();
    await createMaintenanceRunner([{ name: 'expire-reservations', run: async () => 4 }], app.log, 60_000, { store: store() }).runAll();

    await grantPermissions('BUSINESS_ADMIN', ['audit:read']);
    const { token } = await createAuthenticatedStaff(app, ['BUSINESS_ADMIN']);
    const res = await app.inject({ method: 'GET', url: '/api/v1/maintenance/jobs', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const byJob = Object.fromEntries((res.json() as { job: string }[]).map((j) => [j.job, j]));
    expect(Object.keys(byJob)).toEqual(EXPECTED_JOBS);
    expect(byJob['expire-payments']).toMatchObject({ consecutiveFailures: 3, alert: true, lastError: 'payment gateway timeout', lastSuccessAt: null, running: false, alertNotifiedAt: null });
    expect(byJob['expire-reservations']).toMatchObject({ consecutiveFailures: 0, alert: false, lastResult: 4 });
    expect(byJob['vest-loyalty-points']).toMatchObject({ lastRunAt: null, consecutiveFailures: 0 });

    const { token: noPerm } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/maintenance/jobs', headers: { authorization: `Bearer ${noPerm}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/maintenance/jobs' })).statusCode).toBe(401);
  });

  it('prunes run history older than the retention period', async () => {
    await testPrisma.maintenanceJobRun.create({ data: { job: 'expire-payments', startedAt: new Date(Date.now() - 40 * 86_400_000), finishedAt: new Date(Date.now() - 40 * 86_400_000), outcome: 'SUCCESS' } });
    const prune = appMaintenanceJobs(app).find((j) => j.name === 'prune-maintenance-runs')!;
    expect(await prune.run()).toEqual({ deleted: 1 });
  });
});

/** LR-006 review: several API instances share one schedule. Each instance
 * here is its own store (its own lease holder) on the same database. */
describe('Scheduler leases across API instances (LR-006)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDatabase(); });

  const instance = (leaseMs = 60_000) => prismaMaintenanceStore(app.prisma, { leaseMs });
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const quiet = { info: () => {}, error: () => {} };

  it('lets exactly one of many instances take a job at the same moment', async () => {
    const stores = Array.from({ length: 12 }, () => instance());
    const won = await Promise.all(stores.map((s) => s.acquire('expire-payments', 0)));
    expect(won.filter(Boolean)).toHaveLength(1);
  });

  it('runs a job once when two instances sweep simultaneously, and records one run', async () => {
    let calls = 0;
    const job = { name: 'reconcile-refunds', run: async () => { calls++; await sleep(300); return { reconciled: 1 }; } };
    const [a, b] = await Promise.all([
      createMaintenanceRunner([job], quiet, 60_000, { store: instance() }).runAll(),
      createMaintenanceRunner([job], quiet, 60_000, { store: instance() }).runAll(),
    ]);
    expect(calls).toBe(1);
    expect([...a.ran, ...b.ran]).toEqual(['reconcile-refunds']);
    expect([...a.skipped, ...b.skipped]).toEqual(['reconcile-refunds']);
    expect(await testPrisma.maintenanceJobRun.count()).toBe(1);
    expect(await testPrisma.maintenanceJobState.findUniqueOrThrow({ where: { job: 'reconcile-refunds' } })).toMatchObject({ holder: null, leaseUntil: null });
  });

  it('holds a job\'s interval across instances: another instance does not rerun it early', async () => {
    const a = instance();
    const b = instance();
    expect(await a.acquire('expire-loyalty-points', 3_600_000)).not.toBeNull();
    await a.release('expire-loyalty-points');
    expect(await b.acquire('expire-loyalty-points', 3_600_000)).toBeNull();
    expect(await a.acquire('expire-loyalty-points', 3_600_000)).toBeNull();
    // A manual "run all" ignores the interval but still takes the lease.
    expect(await b.acquire('expire-loyalty-points', 0)).not.toBeNull();
  });

  it('two running schedulers run a per-sweep job once per sweep between them, never back to back', async () => {
    const starts: number[] = [];
    const job = { name: 'expire-reservations', run: async () => { starts.push(Date.now()); return 0; } };
    // 500 ms sweeps: a job without its own interval is spaced 400 ms apart across instances.
    const a = createMaintenanceRunner([job], quiet, 500, { store: instance() });
    const b = createMaintenanceRunner([job], quiet, 500, { store: instance() });
    a.start();
    await sleep(170);
    b.start();
    await sleep(2500);
    await Promise.all([a.stop(), b.stop()]);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    expect(starts.length).toBeGreaterThanOrEqual(4);
    // Two independent schedulers would run it about twice per 500 ms.
    expect(starts.length).toBeLessThanOrEqual(7);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(350);
    expect(await testPrisma.maintenanceJobRun.count({ where: { job: 'expire-reservations' } })).toBe(starts.length);
  });

  it('recovers a job whose instance died mid-run once its lease expires, without waiting for the interval', async () => {
    const crashed = instance(400);
    expect(await crashed.acquire('vest-loyalty-points', 900_000)).not.toBeNull();
    // The instance dies here: no release, no heartbeat.
    const survivor = instance(400);
    expect(await survivor.acquire('vest-loyalty-points', 900_000)).toBeNull();
    await sleep(600);
    expect(await survivor.acquire('vest-loyalty-points', 900_000)).not.toBeNull();
    // The dead instance can neither renew nor release the survivor's lease.
    expect(await crashed.renew('vest-loyalty-points')).toBe(false);
    await crashed.release('vest-loyalty-points');
    expect(await instance().acquire('vest-loyalty-points', 0)).toBeNull();
  });

  it('a recorded run whose release failed is not mistaken for a crash: the interval still holds', async () => {
    const a = instance(300);
    const lease = (await a.acquire('resync-channel-listings', 900_000))!;
    await a.record({ id: lease.runId, job: 'resync-channel-listings', startedAt: lease.startedAt, finishedAt: new Date(), outcome: 'SUCCESS', result: 0 });
    // release() never happens (a dropped connection); the lease then expires.
    await sleep(500);
    expect(await instance().acquire('resync-channel-listings', 900_000)).toBeNull();
  });

  it('stamps runs with the database clock, so streaks order correctly whatever an instance\'s clock says', async () => {
    const lease = (await instance().acquire('recover-invoices', 0))!;
    const [{ now }] = await testPrisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
    expect(Math.abs(lease.startedAt.getTime() - now.getTime())).toBeLessThan(5_000);
    const state = await testPrisma.maintenanceJobState.findUniqueOrThrow({ where: { job: 'recover-invoices' } });
    expect(state.lastStartedAt!.getTime()).toBe(lease.startedAt.getTime());
    expect(state.currentRunId).toBe(lease.runId);
  });

  it('keeps a long-running job\'s lease alive with heartbeats so no other instance starts it', async () => {
    let calls = 0;
    const job = { name: 'resync-channel-listings', run: async () => { calls++; await sleep(1200); return 0; } };
    const first = createMaintenanceRunner([job], quiet, 60_000, { store: instance(400), heartbeatMs: 100 }).runAll();
    await sleep(700); // well past the 400 ms lease
    const second = await createMaintenanceRunner([job], quiet, 60_000, { store: instance(400), heartbeatMs: 100 }).runAll();
    expect(second.skipped).toEqual(['resync-channel-listings']);
    expect((await first).ran).toEqual(['resync-channel-listings']);
    expect(calls).toBe(1);
  });
});

/** LR-006 review: a failing job must reach a person, not only the logs. */
describe('Maintenance alert webhook (LR-006)', () => {
  let app: FastifyInstance;
  let server: Server;
  let url: string;
  let status = 200;
  const received: { text: string; kind: string; job: string; consecutiveFailures: number }[] = [];
  beforeAll(async () => {
    app = await createTestApp();
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (status === 200) received.push(JSON.parse(body));
        res.writeHead(status).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });
  afterAll(async () => { await app.close(); await new Promise((resolve) => server.close(resolve)); });
  beforeEach(async () => { await resetDatabase(); received.length = 0; status = 200; });

  it('posts one alert per failure streak across instances, retries a failed delivery, and posts the recovery', async () => {
    let failing = true;
    const job = { name: 'dispatch-conversion-events', run: async () => { if (failing) throw new Error('GA4 answered HTTP 503'); return { sent: 2 }; } };
    const alerts = webhookAlerts(url, 'test');
    const quiet = { info: () => {}, error: () => {} };
    const runners = [0, 1].map(() => createMaintenanceRunner([job], quiet, 60_000, { store: prismaMaintenanceStore(app.prisma, { leaseMs: 60_000 }), alerts }));

    await runners[0]!.runAll();
    await runners[1]!.runAll();
    status = 503; // the receiver is down when the streak reaches three
    await runners[0]!.runAll();
    expect(received).toHaveLength(0);
    expect((await testPrisma.maintenanceJobState.findUniqueOrThrow({ where: { job: job.name } })).alertedAt).toBeNull();
    status = 200;
    await runners[1]!.runAll(); // 4th failure, other instance: delivered now
    await runners[0]!.runAll(); // 5th failure: already notified
    expect(received.map((r) => [r.kind, r.consecutiveFailures])).toEqual([['FAILING', 4]]);
    expect(received[0]!.text).toContain('Scheduled job "dispatch-conversion-events" has failed 4 times in a row. Last error: GA4 answered HTTP 503');
    expect((await testPrisma.maintenanceJobState.findUniqueOrThrow({ where: { job: job.name } })).alertedAt).not.toBeNull();

    failing = false;
    status = 503; // the recovery notice is not delivered on the first success...
    await runners[1]!.runAll();
    status = 200; // ...and is retried on the next one, still reporting the real streak
    await runners[0]!.runAll();
    expect(received.map((r) => [r.kind, r.consecutiveFailures])).toEqual([['FAILING', 4], ['RECOVERED', 5]]);
    expect((await testPrisma.maintenanceJobState.findUniqueOrThrow({ where: { job: job.name } })).alertedAt).toBeNull();
  });
});
