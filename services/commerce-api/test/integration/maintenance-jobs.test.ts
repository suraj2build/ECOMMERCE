import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { appMaintenanceJobs, createMaintenanceRunner, prismaRunRecorder } from '../../src/maintenance.js';

/** LR-006: every sweep is scheduled, every run is recorded, and staff can see
 * last success / last failure / consecutive failures per job. */
describe('Scheduled sweeps and job monitoring (LR-006)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDatabase(); await seedRbac(); });

  const EXPECTED_JOBS = [
    'expire-payments', 'expire-reservations', 'recover-invoices', 'release-loyalty-holds', 'release-store-credit-holds',
    'release-gift-card-holds', 'reconcile-refunds', 'send-due-campaigns', 'vest-loyalty-points', 'expire-loyalty-points',
    'reclaim-channel-claims', 'resync-channel-listings', 'dispatch-conversion-events', 'prune-maintenance-runs',
  ];

  it('schedules every recovery and expiry sweep and runs each one successfully as the system', async () => {
    const jobs = appMaintenanceJobs(app);
    expect(jobs.map((j) => j.name)).toEqual(EXPECTED_JOBS);
    const runner = createMaintenanceRunner(jobs, app.log, 60_000, prismaRunRecorder(app.prisma));
    await runner.runAll();
    const runs = await testPrisma.maintenanceJobRun.findMany();
    expect(runs.map((r) => r.job).sort()).toEqual([...EXPECTED_JOBS].sort());
    expect(runs.filter((r) => r.outcome !== 'SUCCESS').map((r) => `${r.job}: ${r.error}`)).toEqual([]);
  });

  it('reports per-job status to staff with audit:read, including an alert after three failures in a row', async () => {
    const failing = createMaintenanceRunner([{ name: 'expire-payments', run: async () => { throw new Error('payment gateway timeout'); } }], app.log, 60_000, prismaRunRecorder(app.prisma));
    for (let i = 0; i < 3; i++) await failing.runAll();
    await createMaintenanceRunner([{ name: 'expire-reservations', run: async () => 4 }], app.log, 60_000, prismaRunRecorder(app.prisma)).runAll();

    await grantPermissions('BUSINESS_ADMIN', ['audit:read']);
    const { token } = await createAuthenticatedStaff(app, ['BUSINESS_ADMIN']);
    const res = await app.inject({ method: 'GET', url: '/api/v1/maintenance/jobs', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const byJob = Object.fromEntries((res.json() as { job: string }[]).map((j) => [j.job, j]));
    expect(Object.keys(byJob)).toEqual(EXPECTED_JOBS);
    expect(byJob['expire-payments']).toMatchObject({ consecutiveFailures: 3, alert: true, lastError: 'payment gateway timeout', lastSuccessAt: null });
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
