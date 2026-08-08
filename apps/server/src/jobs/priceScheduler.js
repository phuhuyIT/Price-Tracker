import { randomUUID } from 'node:crypto';

import { schedule as scheduleCron } from 'node-cron';

import { COLLECTION_JOB_SOURCES } from '@shopee-price-tracker/shared';

function randomDelayMs(minimum, maximum, random) {
  if (maximum <= minimum) {
    return minimum;
  }

  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function waitForDelay(delayMs, signal) {
  if (delayMs <= 0 || signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(finish, delayMs);

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }

    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Create the asynchronous cron dispatcher for profile-bound extension jobs. */
export function createPriceScheduler({
  collectionJobService,
  config,
  idFactory = randomUUID,
  logger,
  productCollectionService,
  random = Math.random,
  repositories,
  schedule = scheduleCron,
  sleep = waitForDelay,
}) {
  let activeRun = null;
  let cronTask = null;
  let stopping = false;
  let stopController = new AbortController();

  async function executeRun(trigger) {
    const jobRunId = idFactory();
    const startedAt = Date.now();
    const summary = {
      aborted: false,
      deduplicated: 0,
      failed: 0,
      jobRunId,
      queued: 0,
      recoveredFailed: 0,
      recoveredRetried: 0,
      total: 0,
      trigger,
    };

    logger.info({ jobRunId, trigger }, 'Scheduled price-check dispatch started');

    try {
      const recovered = collectionJobService.recoverExpiredClaims();
      summary.recoveredFailed = recovered.failed;
      summary.recoveredRetried = recovered.retried;
      const products = repositories.products.listActiveForScheduling();
      summary.total = products.length;

      for (const [index, product] of products.entries()) {
        if (stopping || stopController.signal.aborted) {
          summary.aborted = true;
          break;
        }

        try {
          const queued = productCollectionService.refreshProduct({
            jobSource: COLLECTION_JOB_SOURCES.SCHEDULER,
            ownerUserId: product.ownerUserId,
            productId: product.id,
          });

          if (queued.created) {
            summary.queued += 1;
          } else {
            summary.deduplicated += 1;
          }
        } catch (error) {
          summary.failed += 1;
          logger.warn(
            {
              err: error,
              errorCode: error?.code,
              jobRunId,
              productId: product.id,
            },
            'Unable to queue a scheduled product refresh',
          );
        }

        if (index < products.length - 1 && !stopping) {
          const delayMs = randomDelayMs(
            config.dispatchDelayMinMs,
            config.dispatchDelayMaxMs,
            random,
          );
          await sleep(delayMs, stopController.signal);
        }
      }
    } catch (error) {
      summary.failed += 1;
      summary.fatalErrorCode = error?.code ?? 'SCHEDULER_ERROR';
      logger.error(
        { err: error, errorCode: error?.code, jobRunId },
        'Scheduled price-check dispatch failed',
      );
    }

    const durationMs = Date.now() - startedAt;
    const completedSummary = { ...summary, durationMs };
    logger.info(completedSummary, 'Scheduled price-check dispatch finished');
    return completedSummary;
  }

  function runNow(trigger = 'manual') {
    if (stopping) {
      return Promise.resolve({ skipped: true, reason: 'stopping', trigger });
    }

    if (activeRun) {
      logger.warn({ trigger }, 'Scheduled price-check dispatch skipped because a run is active');
      return Promise.resolve({ skipped: true, reason: 'overlap', trigger });
    }

    activeRun = executeRun(trigger).finally(() => {
      activeRun = null;
    });
    return activeRun;
  }

  return Object.freeze({
    get isRunning() {
      return activeRun !== null;
    },

    runNow,

    start() {
      if (!config.enabled) {
        logger.info('Scheduled price checks are disabled');
        return null;
      }

      if (cronTask) {
        return cronTask;
      }

      cronTask = schedule(
        config.schedule,
        () => {
          void runNow('cron');
        },
        { noOverlap: true },
      );
      logger.info({ cronSchedule: config.schedule }, 'Scheduled price checks enabled');
      return cronTask;
    },

    async stop() {
      stopping = true;
      stopController.abort();

      if (cronTask) {
        cronTask.stop();
      }

      await activeRun;

      if (cronTask?.destroy) {
        await cronTask.destroy();
      }

      cronTask = null;
    },
  });
}
