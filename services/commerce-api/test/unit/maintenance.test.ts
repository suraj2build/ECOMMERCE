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
