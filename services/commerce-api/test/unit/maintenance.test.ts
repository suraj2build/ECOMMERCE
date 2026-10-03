import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMaintenanceRunner } from '../../src/maintenance.js';

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
    const runs: { outcome: string }[] = [];
    const record = async (run: { outcome: 'SUCCESS' | 'FAILURE' }) => {
      runs.push(run);
      if (run.outcome === 'SUCCESS') return 0;
      let n = 0;
      for (let i = runs.length - 1; i >= 0 && runs[i]!.outcome === 'FAILURE'; i--) n++;
      return n;
    };
    const job = vi.fn().mockRejectedValueOnce(new Error('a')).mockRejectedValueOnce(new Error('b')).mockRejectedValueOnce(new Error('c')).mockResolvedValue({ released: 2 });
    const logger = { info: vi.fn(), error: vi.fn() };
    const runner = createMaintenanceRunner([{ name: 'flaky-provider', run: job }], logger, 1000, record);
    for (let i = 0; i < 4; i++) await runner.runAll();
    expect(runs.map((r) => r.outcome)).toEqual(['FAILURE', 'FAILURE', 'FAILURE', 'SUCCESS']);
    const alerts = logger.error.mock.calls.filter(([fields]) => (fields as { alert?: boolean }).alert === true);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]![0]).toMatchObject({ job: 'flaky-provider', consecutiveFailures: 3 });
    expect(logger.info).toHaveBeenLastCalledWith({ job: 'flaky-provider', result: { released: 2 } }, 'Maintenance completed');
  });
});
