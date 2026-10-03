import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertText, createMaintenanceRunner, memoryMaintenanceStore, type AlertSink, type MaintenanceAlert } from '../../src/maintenance.js';

describe('Scheduled maintenance', () => {
  afterEach(() => vi.useRealTimers());
  const log = () => ({ info: vi.fn(), error: vi.fn() });

  it('starts immediately, isolates failed jobs and retries on the next sweep', async () => {
    vi.useFakeTimers();
    const failed = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(1);
    const next = vi.fn().mockResolvedValue({ succeeded: 1 });
    const logger = log();
    const runner = createMaintenanceRunner([{ name: 'payments', run: failed }, { name: 'invoices', run: next }], logger, 1000);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(failed).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledTimes(2);
    await runner.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('never overlaps a long job and drains it before stopping', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const first = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const next = vi.fn().mockResolvedValue(0);
    const runner = createMaintenanceRunner([{ name: 'slow', run: first }, { name: 'next', run: next }], log(), 1000);
    runner.start();
    runner.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(first).toHaveBeenCalledTimes(1);
    let drained = false;
    const shutdown = runner.stop().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await shutdown;
    expect(next).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(first).toHaveBeenCalledTimes(1);
  });
});

describe('Scheduled maintenance: intervals and alerting (LR-006)', () => {
  afterEach(() => vi.useRealTimers());

  it('runs a job no more often than its own interval while others run every sweep', async () => {
    vi.useFakeTimers();
    const frequent = vi.fn().mockResolvedValue(0);
    const hourly = vi.fn().mockResolvedValue(0);
    const runner = createMaintenanceRunner([{ name: 'frequent', run: frequent }, { name: 'hourly', run: hourly, everyMs: 3_600_000 }], { info: vi.fn(), error: vi.fn() }, 60_000);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(frequent).toHaveBeenCalledTimes(11);
    expect(hourly).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(55 * 60_000);
    expect(hourly).toHaveBeenCalledTimes(2);
    await runner.stop();
  });

  it('records every run and raises an alert after three consecutive failures, clearing on success', async () => {
    const store = memoryMaintenanceStore();
    const job = vi.fn().mockRejectedValueOnce(new Error('a')).mockRejectedValueOnce(new Error('b')).mockRejectedValueOnce(new Error('c')).mockResolvedValue({ released: 2 });
    const logger = { info: vi.fn(), error: vi.fn() };
    const runner = createMaintenanceRunner([{ name: 'flaky-provider', run: job }], logger, 1000, { store });
    for (let i = 0; i < 4; i++) await runner.runAll();
    expect(store.runs.map((r) => r.outcome)).toEqual(['FAILURE', 'FAILURE', 'FAILURE', 'SUCCESS']);
    const alerts = logger.error.mock.calls.filter(([fields]) => (fields as { alert?: boolean }).alert === true);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]![0]).toMatchObject({ job: 'flaky-provider', consecutiveFailures: 3, alertDestination: 'log-only' });
    expect(logger.info).toHaveBeenLastCalledWith({ job: 'flaky-provider', result: { released: 2 } }, 'Maintenance completed');
  });
});

describe('Scheduled maintenance: alert delivery (LR-006)', () => {
  const sink = (fail: () => boolean = () => false) => {
    const sent: MaintenanceAlert[] = [];
    const alerts: AlertSink = { destination: 'webhook', send: async (alert) => { if (fail()) throw new Error('HTTP 503'); sent.push(alert); } };
    return { sent, alerts };
  };

  it('notifies once per failure streak and once on recovery, then again for a new streak', async () => {
    const { sent, alerts } = sink();
    let failing = true;
    const runner = createMaintenanceRunner([{ name: 'expire-payments', run: async () => { if (failing) throw new Error('gateway timeout'); return 1; } }], { info: vi.fn(), error: vi.fn() }, 1000, { store: memoryMaintenanceStore(), alerts });
    for (let i = 0; i < 6; i++) await runner.runAll();
    expect(sent).toEqual([{ kind: 'FAILING', job: 'expire-payments', consecutiveFailures: 3, error: 'gateway timeout' }]);
    failing = false;
    await runner.runAll();
    await runner.runAll();
    expect(sent.slice(1)).toEqual([{ kind: 'RECOVERED', job: 'expire-payments', consecutiveFailures: 6 }]);
    failing = true;
    for (let i = 0; i < 3; i++) await runner.runAll();
    expect(sent.map((a) => a.kind)).toEqual(['FAILING', 'RECOVERED', 'FAILING']);
  });

  it('retries an undelivered alert on the next failure instead of losing it', async () => {
    let down = true;
    const { sent, alerts } = sink(() => down);
    const logger = { info: vi.fn(), error: vi.fn() };
    const runner = createMaintenanceRunner([{ name: 'recover-invoices', run: async () => { throw new Error('db'); } }], logger, 1000, { store: memoryMaintenanceStore(), alerts });
    for (let i = 0; i < 3; i++) await runner.runAll();
    expect(sent).toEqual([]);
    expect(logger.error.mock.calls.some(([, msg]) => msg === 'Could not deliver the maintenance alert; will retry on the next run')).toBe(true);
    down = false;
    await runner.runAll();
    await runner.runAll();
    expect(sent).toEqual([{ kind: 'FAILING', job: 'recover-invoices', consecutiveFailures: 4, error: 'db' }]);
  });

  it('formats a readable, secret-free message', () => {
    expect(alertText({ kind: 'FAILING', job: 'expire-payments', consecutiveFailures: 3, error: 'timeout' }, 'production'))
      .toBe('[commerce-api production] Scheduled job "expire-payments" has failed 3 times in a row. Last error: timeout. Status: GET /api/v1/maintenance/jobs');
  });
});
