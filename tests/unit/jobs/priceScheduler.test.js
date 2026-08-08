import { describe, expect, it, vi } from 'vitest';

import { createPriceScheduler } from '../../../apps/server/src/jobs/priceScheduler.js';

function createHarness({ enabled = true, products = [] } = {}) {
  const cronTask = { destroy: vi.fn(), stop: vi.fn() };
  const schedule = vi.fn(() => cronTask);
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const collectionJobService = {
    recoverExpiredClaims: vi.fn(() => ({ failed: 0, retried: 0 })),
  };
  const productCollectionService = {
    refreshProduct: vi.fn(() => ({ created: true })),
  };
  const repositories = {
    products: { listActiveForScheduling: vi.fn(() => products) },
  };
  const sleep = vi.fn(async () => undefined);
  const scheduler = createPriceScheduler({
    collectionJobService,
    config: {
      dispatchDelayMaxMs: 10,
      dispatchDelayMinMs: 5,
      enabled,
      schedule: '0 */12 * * *',
    },
    idFactory: () => 'run-1',
    logger,
    productCollectionService,
    random: () => 0,
    repositories,
    schedule,
    sleep,
  });

  return {
    collectionJobService,
    cronTask,
    logger,
    productCollectionService,
    repositories,
    schedule,
    scheduler,
    sleep,
  };
}

describe('scheduled price-check dispatcher', () => {
  it('does not register cron while scheduling is disabled', () => {
    const harness = createHarness({ enabled: false });
    expect(harness.scheduler.start()).toBeNull();
    expect(harness.schedule).not.toHaveBeenCalled();
  });

  it('queues active products sequentially and reports deduplicated work', async () => {
    const products = [
      { id: 1, ownerUserId: 10 },
      { id: 2, ownerUserId: 20 },
      { id: 3, ownerUserId: 30 },
    ];
    const harness = createHarness({ products });
    harness.productCollectionService.refreshProduct
      .mockReturnValueOnce({ created: true })
      .mockReturnValueOnce({ created: false })
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('database unavailable'), { code: 'DATABASE_ERROR' });
      });

    const summary = await harness.scheduler.runNow('test');

    expect(harness.productCollectionService.refreshProduct.mock.calls).toEqual([
      [{ jobSource: 'scheduler', ownerUserId: 10, productId: 1 }],
      [{ jobSource: 'scheduler', ownerUserId: 20, productId: 2 }],
      [{ jobSource: 'scheduler', ownerUserId: 30, productId: 3 }],
    ]);
    expect(harness.sleep).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({
      deduplicated: 1,
      failed: 1,
      jobRunId: 'run-1',
      queued: 1,
      total: 3,
    });
  });

  it('prevents overlapping runs', async () => {
    let release;
    const sleep = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const harness = createHarness({
      products: [
        { id: 1, ownerUserId: 10 },
        { id: 2, ownerUserId: 10 },
      ],
    });
    const scheduler = createPriceScheduler({
      collectionJobService: harness.collectionJobService,
      config: {
        dispatchDelayMaxMs: 10,
        dispatchDelayMinMs: 5,
        enabled: true,
        schedule: '0 */12 * * *',
      },
      idFactory: () => 'run-overlap',
      logger: harness.logger,
      productCollectionService: harness.productCollectionService,
      repositories: harness.repositories,
      schedule: harness.schedule,
      sleep,
    });

    const first = scheduler.runNow('first');
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledOnce());
    await expect(scheduler.runNow('second')).resolves.toEqual({
      reason: 'overlap',
      skipped: true,
      trigger: 'second',
    });
    release();
    await first;
  });

  it('returns and logs a final summary when scheduler-wide setup fails', async () => {
    const harness = createHarness();
    harness.collectionJobService.recoverExpiredClaims.mockImplementation(() => {
      throw Object.assign(new Error('database unavailable'), { code: 'DATABASE_ERROR' });
    });

    await expect(harness.scheduler.runNow('test')).resolves.toMatchObject({
      failed: 1,
      fatalErrorCode: 'DATABASE_ERROR',
      jobRunId: 'run-1',
    });
    expect(harness.logger.error).toHaveBeenCalledOnce();
    expect(harness.logger.info).toHaveBeenLastCalledWith(
      expect.objectContaining({ fatalErrorCode: 'DATABASE_ERROR' }),
      'Scheduled price-check dispatch finished',
    );
  });

  it('stops cron and aborts an active dispatch delay', async () => {
    const products = [
      { id: 1, ownerUserId: 10 },
      { id: 2, ownerUserId: 10 },
    ];
    const harness = createHarness({ products });
    harness.scheduler.start();
    const running = harness.scheduler.runNow('shutdown-test');
    await harness.scheduler.stop();
    const summary = await running;

    expect(harness.cronTask.stop).toHaveBeenCalledOnce();
    expect(harness.cronTask.destroy).toHaveBeenCalledOnce();
    expect(summary.aborted).toBe(true);
  });
});
