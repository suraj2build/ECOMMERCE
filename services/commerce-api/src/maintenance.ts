import type { FastifyInstance } from 'fastify';
import { InventoryService } from './modules/inventory/service.js';
import { PaymentService } from './modules/payment/service.js';
import { OrderService } from './modules/order/service.js';

export interface MaintenanceJob {
  name: string;
  run(): Promise<unknown>;
}

/** Completion-based scheduling prevents overlapping sweeps in one process.
 * Domain row locks and invoice uniqueness make multiple replicas safe.
 * Shutdown drains the current sweep before infrastructure is disconnected.
 */
export function createMaintenanceRunner(
  jobs: MaintenanceJob[],
  log: Pick<FastifyInstance['log'], 'info' | 'error'>,
  intervalMs = 60_000,
) {
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;

  async function sweep() {
    for (const job of jobs) {
      if (stopped) break;
      try {
        const result = await job.run();
        log.info({ job: job.name, result }, 'Maintenance completed');
      } catch (err) {
        log.error({ err, job: job.name }, 'Maintenance failed; will retry next sweep');
      }
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
  };
}

export function createAppMaintenance(app: FastifyInstance) {
  const payments = new PaymentService(app);
  const inventory = new InventoryService(app);
  const orders = new OrderService(app);
  return createMaintenanceRunner([
    // Payment expiry releases value holds as well as inventory, first.
    { name: 'expire-payments', run: () => payments.expireStalePayments() },
    { name: 'expire-reservations', run: () => inventory.expireStaleReservations() },
    { name: 'recover-invoices', run: () => orders.reconcilePendingInvoices() },
  ], app.log);
}
