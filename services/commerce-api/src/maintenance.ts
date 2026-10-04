import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { InventoryService } from './modules/inventory/service.js';
import { PaymentService } from './modules/payment/service.js';
import { OrderService } from './modules/order/service.js';
import { LoyaltyService } from './modules/loyalty/service.js';
import { StoreCreditService } from './modules/refunds/store-credit-service.js';
import { GiftCardService } from './modules/gift-cards/service.js';
import { RefundService } from './modules/refunds/service.js';
import { MarketingService } from './modules/marketing/service.js';
import { ChannelService } from './modules/channels/service.js';
import { ConversionService } from './modules/conversions/service.js';

export interface MaintenanceJob {
  name: string;
  run(): Promise<unknown>;
  /** Minimum time between runs of this job (across instances); defaults to once per sweep. */
  everyMs?: number;
}

/** LR-006: a job failing this many times in a row raises an alert. */
export const ALERT_AFTER_CONSECUTIVE_FAILURES = 3;

/** Small, loggable summary of a sweep result: counts, never row contents. */
function summarise(result: unknown): unknown {
  if (Array.isArray(result)) return { count: result.length };
  if (result && typeof result === 'object') {
    return Object.fromEntries(Object.entries(result).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v === 'object' ? undefined : v]));
  }
  return result ?? null;
}

export interface MaintenanceRun {
  /** The id the lease issued for this run. */
  id: string;
  job: string;
  /** When the lease was taken, by the store's clock (the database clock
   * for the shared store), so runs order correctly across instances. */
  startedAt: Date;
  finishedAt: Date;
  outcome: 'SUCCESS' | 'FAILURE';
  result?: unknown;
  error?: string;
}

export interface RecordedRun {
  /** Failures in a row including this run; 0 after a success. */
  consecutiveFailures: number;
  /** Length of the most recent failure streak, reported on recovery. */
  endedStreak: number;
  /** Whether the current failure streak has already been notified. */
  alerted: boolean;
}

/** A lease taken for one run. */
export interface JobLease { runId: string; startedAt: Date }

/**
 * Scheduler state. The Postgres store is shared by every API instance, so
 * a job runs on one instance at a time and its interval holds across
 * instances; the in-memory store covers one process (unit tests).
 */
export interface MaintenanceStore {
  /** Takes the job's lease when nobody holds a live one and the job is
   * due: `everyMs` has passed since its last start, or its last run died
   * before it was recorded (then it runs again at once). Null otherwise. */
  acquire(job: string, everyMs: number): Promise<JobLease | null>;
  /** Extends a held lease; false if another instance has taken it. */
  renew(job: string): Promise<boolean>;
  release(job: string): Promise<void>;
  record(run: MaintenanceRun): Promise<RecordedRun>;
  setAlerted(job: string, alerted: boolean): Promise<void>;
}

export interface MaintenanceAlert {
  kind: 'FAILING' | 'RECOVERED';
  job: string;
  consecutiveFailures: number;
  error?: string;
}

/** Where alerts go. `send` throws when the alert was not delivered. */
export interface AlertSink {
  readonly destination: 'webhook' | 'log-only';
  send(alert: MaintenanceAlert): Promise<void>;
}

/** No external destination: the error-level `alert: true` log line is the alert. */
export const logOnlyAlerts: AlertSink = { destination: 'log-only', send: async () => {} };

export function alertText(alert: MaintenanceAlert, environment: string): string {
  const where = `[commerce-api ${environment}]`;
  return alert.kind === 'FAILING'
    ? `${where} Scheduled job "${alert.job}" has failed ${alert.consecutiveFailures} times in a row. Last error: ${alert.error ?? 'unknown'}. Status: GET /api/v1/maintenance/jobs`
    : `${where} Scheduled job "${alert.job}" is succeeding again after ${alert.consecutiveFailures} failures in a row.`;
}

/** POSTs `{ text, kind, job, consecutiveFailures, error, environment, at }`. */
export function webhookAlerts(url: string, environment: string, timeoutMs = 5000): AlertSink {
  return {
    destination: 'webhook',
    async send(alert) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: alertText(alert, environment), ...alert, error: alert.error?.slice(0, 500), environment, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // The URL is a secret, so only the status is reported.
      if (!res.ok) throw new Error(`alert webhook answered HTTP ${res.status}`);
    },
  };
}

/** One process's state; intervals use Date.now() (fake timers in tests). */
export function memoryMaintenanceStore(): MaintenanceStore & { runs: MaintenanceRun[] } {
  const lastStarted = new Map<string, number>();
  const held = new Set<string>();
  const streak = new Map<string, number>();
  const lastStreak = new Map<string, number>();
  const alerted = new Set<string>();
  const runs: MaintenanceRun[] = [];
  return {
    runs,
    async acquire(job, everyMs) {
      if (held.has(job)) return null;
      const last = lastStarted.get(job);
      if (last !== undefined && everyMs > 0 && Date.now() - last < everyMs) return null;
      held.add(job);
      lastStarted.set(job, Date.now());
      return { runId: randomUUID(), startedAt: new Date() };
    },
    async renew(job) { return held.has(job); },
    async release(job) { held.delete(job); },
    async record(run) {
      runs.push(run);
      const before = streak.get(run.job) ?? 0;
      const consecutiveFailures = run.outcome === 'FAILURE' ? before + 1 : 0;
      streak.set(run.job, consecutiveFailures);
      if (run.outcome === 'SUCCESS' && before > 0) lastStreak.set(run.job, before);
      return { consecutiveFailures, endedStreak: lastStreak.get(run.job) ?? 0, alerted: alerted.has(run.job) };
    },
    async setAlerted(name, value) { if (value) alerted.add(name); else alerted.delete(name); },
  };
}

/** The shared Postgres store (maintenance_job_states / maintenance_job_runs).
 * Leases, run start times and therefore run order use the database clock,
 * so instance clock skew does not matter. Each lease carries the id of its
 * run: a lease whose run was never recorded belongs to a crashed instance,
 * while a recorded run whose release failed is not mistaken for a crash. */
export function prismaMaintenanceStore(prisma: PrismaClient, options: { leaseMs: number; holder?: string }): MaintenanceStore {
  const holder = options.holder ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const leaseSeconds = options.leaseMs / 1000;
  return {
    async acquire(job, everyMs) {
      const runId = randomUUID();
      const rows = await prisma.$queryRaw<{ lastStartedAt: Date }[]>`
        INSERT INTO maintenance_job_states (job, holder, "leaseUntil", "lastStartedAt", "currentRunId", "updatedAt")
        VALUES (${job}, ${holder}, now() + make_interval(secs => ${leaseSeconds}::double precision), now(), ${runId}, now())
        ON CONFLICT (job) DO UPDATE
          SET holder = EXCLUDED.holder, "leaseUntil" = EXCLUDED."leaseUntil", "lastStartedAt" = EXCLUDED."lastStartedAt",
              "currentRunId" = EXCLUDED."currentRunId", "updatedAt" = now()
        WHERE (maintenance_job_states."leaseUntil" IS NULL OR maintenance_job_states."leaseUntil" < now())
          AND (
            (maintenance_job_states.holder IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM maintenance_job_runs r WHERE r.id = maintenance_job_states."currentRunId"))
            OR ${everyMs}::double precision <= 0
            OR maintenance_job_states."lastStartedAt" IS NULL
            OR maintenance_job_states."lastStartedAt" <= now() - make_interval(secs => ${everyMs / 1000}::double precision)
          )
        RETURNING "lastStartedAt"`;
      return rows.length === 1 ? { runId, startedAt: rows[0]!.lastStartedAt } : null;
    },
    async renew(job) {
      const n = await prisma.$executeRaw`
        UPDATE maintenance_job_states SET "leaseUntil" = now() + make_interval(secs => ${leaseSeconds}::double precision), "updatedAt" = now()
        WHERE job = ${job} AND holder = ${holder}`;
      return n === 1;
    },
    async release(job) {
      await prisma.$executeRaw`
        UPDATE maintenance_job_states SET holder = NULL, "leaseUntil" = NULL, "updatedAt" = now()
        WHERE job = ${job} AND holder = ${holder}`;
    },
    async record(run) {
      await prisma.maintenanceJobRun.create({
        data: { id: run.id, job: run.job, startedAt: run.startedAt, finishedAt: run.finishedAt, outcome: run.outcome, result: (run.result ?? undefined) as never, error: run.error?.slice(0, 2000) },
      });
      const [recent, state] = await Promise.all([
        prisma.maintenanceJobRun.findMany({ where: { job: run.job }, orderBy: { startedAt: 'desc' }, take: 51, select: { outcome: true } }),
        prisma.maintenanceJobState.findUnique({ where: { job: run.job }, select: { alertedAt: true } }),
      ]);
      const failuresFrom = (from: number) => {
        const next = recent.findIndex((r, i) => i >= from && r.outcome === 'SUCCESS');
        return (next === -1 ? recent.length : next) - from;
      };
      // The latest streak, even with successes after it (a recovery
      // notice retried on a later success still reports it).
      const latestFailure = recent.findIndex((r) => r.outcome === 'FAILURE');
      return {
        consecutiveFailures: run.outcome === 'FAILURE' ? Math.min(50, failuresFrom(0)) : 0,
        endedStreak: latestFailure === -1 ? 0 : Math.min(50, failuresFrom(latestFailure)),
        alerted: Boolean(state?.alertedAt),
      };
    },
    async setAlerted(job, alerted) {
      await prisma.maintenanceJobState.updateMany({ where: { job }, data: { alertedAt: alerted ? new Date() : null } });
    },
  };
}

type Log = Pick<FastifyInstance['log'], 'info' | 'error'>;

/**
 * Completion-based scheduling prevents overlapping sweeps in one process;
 * the store's lease prevents two instances running the same job, and the
 * domain row locks and claims stay as a second line of defence.
 * Shutdown drains the current sweep before infrastructure is disconnected.
 */
export function createMaintenanceRunner(
  jobs: MaintenanceJob[],
  log: Log,
  intervalMs = 60_000,
  options: { store?: MaintenanceStore; alerts?: AlertSink; heartbeatMs?: number } = {},
) {
  const store = options.store ?? memoryMaintenanceStore();
  const alerts = options.alerts ?? logOnlyAlerts;
  const heartbeatMs = options.heartbeatMs ?? 40_000;
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;

  async function deliver(alert: MaintenanceAlert): Promise<boolean> {
    if (alerts.destination === 'log-only') return false;
    try {
      await alerts.send(alert);
      return true;
    } catch (err) {
      log.error({ err, job: alert.job, alert: true }, 'Could not deliver the maintenance alert; will retry on the next run');
      return false;
    }
  }

  /** Runs the job if this instance gets its lease; returns whether it ran. */
  async function runJob(job: MaintenanceJob, everyMs: number): Promise<boolean> {
    let lease: JobLease | null;
    try {
      lease = await store.acquire(job.name, everyMs);
      if (!lease) return false;
    } catch (err) {
      log.error({ err, job: job.name }, 'Could not take the maintenance lease; will retry next sweep');
      return false;
    }
    const heartbeat = setInterval(() => {
      store.renew(job.name)
        .then((held) => { if (!held) log.error({ job: job.name, alert: true }, 'Maintenance lease lost while the job was still running'); })
        .catch((err) => log.error({ err, job: job.name }, 'Could not renew the maintenance lease'));
    }, heartbeatMs);
    heartbeat.unref?.();

    const { runId: id, startedAt } = lease;
    const began = performance.now();
    const finishedAt = () => new Date(startedAt.getTime() + Math.round(performance.now() - began));
    let run: MaintenanceRun;
    let failure: unknown;
    try {
      const result = summarise(await job.run());
      run = { id, job: job.name, startedAt, finishedAt: finishedAt(), outcome: 'SUCCESS', result };
      log.info({ job: job.name, result }, 'Maintenance completed');
    } catch (err) {
      failure = err;
      run = { id, job: job.name, startedAt, finishedAt: finishedAt(), outcome: 'FAILURE', error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearInterval(heartbeat);
    }

    try {
      const state = await store.record(run).catch((err): RecordedRun | null => {
        log.error({ err, job: job.name }, 'Could not record maintenance run');
        return null;
      });
      if (run.outcome === 'FAILURE') {
        const consecutive = state?.consecutiveFailures ?? 0;
        if (consecutive >= ALERT_AFTER_CONSECUTIVE_FAILURES) {
          log.error({ err: failure, job: job.name, consecutiveFailures: consecutive, alert: true, alertDestination: alerts.destination }, 'Maintenance job keeps failing');
          if (state && !state.alerted && (await deliver({ kind: 'FAILING', job: job.name, consecutiveFailures: consecutive, error: run.error }))) {
            await store.setAlerted(job.name, true);
          }
        } else {
          log.error({ err: failure, job: job.name, consecutiveFailures: consecutive }, 'Maintenance failed; will retry next sweep');
        }
      } else if (state?.alerted && (await deliver({ kind: 'RECOVERED', job: job.name, consecutiveFailures: state.endedStreak }))) {
        await store.setAlerted(job.name, false);
      }
    } catch (err) {
      log.error({ err, job: job.name }, 'Could not update maintenance alert state');
    } finally {
      await store.release(job.name).catch((err) => log.error({ err, job: job.name }, 'Could not release the maintenance lease'));
    }
    return true;
  }

  // A job with no interval of its own runs once per sweep across all
  // instances: the lease's interval check spaces it by most of a sweep, so
  // a second instance sweeping moments later does not run it again.
  const perSweepSpacing = Math.floor(intervalMs * 0.8);

  async function sweep() {
    for (const job of jobs) {
      if (stopped) break;
      await runJob(job, job.everyMs ?? perSweepSpacing);
    }
  }

  function tick() {
    if (stopped || active) return;
    active = sweep().finally(() => {
      active = undefined;
      if (!stopped) {
        timer = setTimeout(tick, intervalMs);
        timer.unref();
      }
    });
  }

  return {
    alertDestination: alerts.destination,
    start() {
      if (!stopped) return active;
      stopped = false;
      tick();
      return active;
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await active;
    },
    /** One full sweep ignoring intervals (tests and manual operation); a
     * job another instance is running right now is still skipped. */
    async runAll(): Promise<{ ran: string[]; skipped: string[] }> {
      const ran: string[] = [];
      const skipped: string[] = [];
      for (const job of jobs) (await runJob(job, 0) ? ran : skipped).push(job.name);
      return { ran, skipped };
    },
  };
}

const MINUTE = 60_000;

/** Every recovery/expiry sweep in the application (LR-006). The scheduler
 * lease runs each on one instance at a time; each also claims its rows
 * under locks, so an overlap (a lease lost mid-run) is still safe. */
export function appMaintenanceJobs(app: FastifyInstance): MaintenanceJob[] {
  const payments = new PaymentService(app);
  const inventory = new InventoryService(app);
  const orders = new OrderService(app);
  const loyalty = new LoyaltyService(app);
  const storeCredit = new StoreCreditService(app);
  const giftCards = new GiftCardService(app);
  const refunds = new RefundService(app);
  const marketing = new MarketingService(app);
  const channels = new ChannelService(app);
  const conversions = new ConversionService(app);
  const env = loadEnv();
  return [
    // Payment expiry releases value holds as well as inventory, first.
    { name: 'expire-payments', run: () => payments.expireStalePayments() },
    { name: 'expire-reservations', run: () => inventory.expireStaleReservations() },
    { name: 'recover-invoices', run: () => orders.reconcilePendingInvoices() },
    { name: 'release-loyalty-holds', run: () => loyalty.releaseStaleRedemptionHolds() },
    { name: 'release-store-credit-holds', run: () => storeCredit.releaseStaleRedemptionHolds() },
    { name: 'release-gift-card-holds', run: () => giftCards.releaseStaleRedemptionHolds() },
    { name: 'reconcile-refunds', run: () => refunds.reconcilePendingRefunds(), everyMs: 5 * MINUTE },
    { name: 'send-due-campaigns', run: () => marketing.processDueCampaigns(null) },
    { name: 'vest-loyalty-points', run: () => loyalty.vestEligiblePoints(), everyMs: 15 * MINUTE },
    { name: 'expire-loyalty-points', run: () => loyalty.expirePoints(), everyMs: 60 * MINUTE },
    { name: 'reclaim-channel-claims', run: () => channels.reclaimStaleProcessing(null), everyMs: 5 * MINUTE },
    { name: 'resync-channel-listings', run: () => channels.resyncStaleListings(null), everyMs: env.CHANNEL_RESYNC_INTERVAL_MINUTES * MINUTE },
    { name: 'dispatch-conversion-events', run: () => conversions.dispatchDue() },
    { name: 'prune-maintenance-runs', run: () => pruneRuns(app.prisma, env.MAINTENANCE_RUN_RETENTION_DAYS), everyMs: 60 * MINUTE },
  ];
}

async function pruneRuns(prisma: PrismaClient, days: number) {
  const { count } = await prisma.maintenanceJobRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
  return { deleted: count };
}

export function createAppMaintenance(app: FastifyInstance) {
  const env = loadEnv();
  const leaseMs = env.MAINTENANCE_LEASE_SECONDS * 1000;
  return createMaintenanceRunner(appMaintenanceJobs(app), app.log, 60_000, {
    store: prismaMaintenanceStore(app.prisma, { leaseMs }),
    alerts: env.MAINTENANCE_ALERT_WEBHOOK_URL
      ? webhookAlerts(env.MAINTENANCE_ALERT_WEBHOOK_URL, env.NODE_ENV === 'production' && env.DEPLOYMENT_STAGE === 'preview' ? 'preview' : env.NODE_ENV)
      : logOnlyAlerts,
    heartbeatMs: Math.floor(leaseMs / 3),
  });
}

/** Staff view (LR-006): per job, last run, last success, last failure, the
 * current run of consecutive failures, whether an instance is running it
 * now, and when the current failure streak was notified. */
export async function maintenanceJobStatus(app: FastifyInstance) {
  const names = appMaintenanceJobs(app).map((job) => job.name);
  const states = new Map((await app.prisma.maintenanceJobState.findMany()).map((state) => [state.job, state]));
  const now = new Date();
  return Promise.all(names.map(async (job) => {
    const recent = await app.prisma.maintenanceJobRun.findMany({ where: { job }, orderBy: { startedAt: 'desc' }, take: 50 });
    const lastSuccess = recent.find((r) => r.outcome === 'SUCCESS') ?? null;
    const lastFailure = recent.find((r) => r.outcome === 'FAILURE') ?? null;
    const firstSuccess = recent.findIndex((r) => r.outcome === 'SUCCESS');
    const consecutiveFailures = firstSuccess === -1 ? recent.length : firstSuccess;
    const state = states.get(job);
    return {
      job,
      lastRunAt: recent[0]?.startedAt ?? null,
      lastSuccessAt: lastSuccess?.finishedAt ?? null,
      lastFailureAt: lastFailure?.finishedAt ?? null,
      lastError: lastFailure?.error ?? null,
      lastResult: lastSuccess?.result ?? null,
      consecutiveFailures,
      alert: consecutiveFailures >= ALERT_AFTER_CONSECUTIVE_FAILURES,
      alertNotifiedAt: state?.alertedAt ?? null,
      running: Boolean(state?.holder && state.leaseUntil && state.leaseUntil > now),
    };
  }));
}
