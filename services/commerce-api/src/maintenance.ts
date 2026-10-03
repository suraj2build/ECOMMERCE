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
  /** Minimum time between runs of this job; defaults to every sweep. */
  everyMs?: number;
}

/** LR-006: a job failing this many times in a row logs at error level with alert: true. */
export const ALERT_AFTER_CONSECUTIVE_FAILURES = 3;

/** Small, loggable summary of a sweep result: counts, never row contents. */
function summarise(result: unknown): unknown {
  if (Array.isArray(result)) return { count: result.length };
  if (result && typeof result === 'object') {
    return Object.fromEntries(Object.entries(result).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v === 'object' ? undefined : v]));
  }
  return result ?? null;
}

type RunRecorder = (run: { job: string; startedAt: Date; finishedAt: Date; outcome: 'SUCCESS' | 'FAILURE'; result?: unknown; error?: string }) => Promise<number>;

/** Records the run and returns the job's current run of consecutive failures. */
export function prismaRunRecorder(prisma: PrismaClient): RunRecorder {
  return async (run) => {
    await prisma.maintenanceJobRun.create({
      data: { job: run.job, startedAt: run.startedAt, finishedAt: run.finishedAt, outcome: run.outcome, result: (run.result ?? undefined) as never, error: run.error?.slice(0, 2000) },
    });
    if (run.outcome === 'SUCCESS') return 0;
    const recent = await prisma.maintenanceJobRun.findMany({ where: { job: run.job }, orderBy: { startedAt: 'desc' }, take: 50, select: { outcome: true } });
    const firstSuccess = recent.findIndex((r) => r.outcome === 'SUCCESS');
    return firstSuccess === -1 ? recent.length : firstSuccess;
  };
}

/** Completion-based scheduling prevents overlapping sweeps in one process.
 * Domain row locks and claims make multiple replicas safe.
 * Shutdown drains the current sweep before infrastructure is disconnected.
 */
export function createMaintenanceRunner(
  jobs: MaintenanceJob[],
  log: Pick<FastifyInstance['log'], 'info' | 'error'>,
  intervalMs = 60_000,
  record?: RunRecorder,
) {
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  const lastStarted = new Map<string, number>();

  async function runJob(job: MaintenanceJob) {
    const startedAt = new Date();
    lastStarted.set(job.name, startedAt.getTime());
    try {
      const result = summarise(await job.run());
      log.info({ job: job.name, result }, 'Maintenance completed');
      await record?.({ job: job.name, startedAt, finishedAt: new Date(), outcome: 'SUCCESS', result }).catch((err) => log.error({ err, job: job.name }, 'Could not record maintenance run'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const consecutive = record
        ? await record({ job: job.name, startedAt, finishedAt: new Date(), outcome: 'FAILURE', error: message }).catch(() => 0)
        : 0;
      if (consecutive >= ALERT_AFTER_CONSECUTIVE_FAILURES) {
        log.error({ err, job: job.name, consecutiveFailures: consecutive, alert: true }, 'Maintenance job keeps failing');
      } else {
        log.error({ err, job: job.name, consecutiveFailures: consecutive }, 'Maintenance failed; will retry next sweep');
      }
    }
  }

  async function sweep() {
    for (const job of jobs) {
      if (stopped) break;
      const last = lastStarted.get(job.name);
      if (last !== undefined && job.everyMs && Date.now() - last < job.everyMs) continue;
      await runJob(job);
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
    /** One full sweep, ignoring intervals (tests and manual operation). */
    async runAll() {
      for (const job of jobs) await runJob(job);
    },
  };
}

const MINUTE = 60_000;

/** Every recovery/expiry sweep in the application (LR-006). Each one claims
 * its rows under locks, so running it on several replicas is safe. */
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
  return createMaintenanceRunner(appMaintenanceJobs(app), app.log, 60_000, prismaRunRecorder(app.prisma));
}

/** Staff view (LR-006): per job, last run, last success, last failure and
 * the current run of consecutive failures. */
export async function maintenanceJobStatus(app: FastifyInstance) {
  const names = appMaintenanceJobs(app).map((job) => job.name);
  return Promise.all(names.map(async (job) => {
    const recent = await app.prisma.maintenanceJobRun.findMany({ where: { job }, orderBy: { startedAt: 'desc' }, take: 50 });
    const lastSuccess = recent.find((r) => r.outcome === 'SUCCESS') ?? null;
    const lastFailure = recent.find((r) => r.outcome === 'FAILURE') ?? null;
    const firstSuccess = recent.findIndex((r) => r.outcome === 'SUCCESS');
    const consecutiveFailures = firstSuccess === -1 ? recent.length : firstSuccess;
    return {
      job,
      lastRunAt: recent[0]?.startedAt ?? null,
      lastSuccessAt: lastSuccess?.finishedAt ?? null,
      lastFailureAt: lastFailure?.finishedAt ?? null,
      lastError: lastFailure?.error ?? null,
      lastResult: lastSuccess?.result ?? null,
      consecutiveFailures,
      alert: consecutiveFailures >= ALERT_AFTER_CONSECUTIVE_FAILURES,
    };
  }));
}
