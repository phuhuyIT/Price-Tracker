import { SUBMISSION_STATES } from './runtimeMessages.js';
import {
  appendQueueRecord,
  calculateRetryDelayMs,
  MAX_RETRY_ATTEMPTS,
  resetRetryableQueue,
  stableStringify,
} from './submissionQueue.js';
import { queueSummary, STORAGE_KEYS } from './serviceWorkerStore.js';

export const RETRY_ALARM_NAME = 'snapshot-queue-retry';
const MINIMUM_ALARM_DELAY_MS = 30_000;

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Create durable, serialised submission-queue operations for the service worker. */
export function createServiceWorkerQueue({ alarms, backendClient, store }) {
  let stateLock = Promise.resolve();

  function runExclusive(task) {
    const result = stateLock.then(task, task);
    stateLock = result.catch(() => undefined);
    return result;
  }

  async function scheduleRetryAlarm(queue) {
    await alarms.clear(RETRY_ALARM_NAME);
    const nextAttemptAt = queue
      .filter((item) => item.state === SUBMISSION_STATES.RETRY_WAIT)
      .map((item) => item.nextAttemptAt)
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];

    if (nextAttemptAt !== undefined) {
      await alarms.create(RETRY_ALARM_NAME, {
        when: Math.max(nextAttemptAt, Date.now() + MINIMUM_ALARM_DELAY_MS),
      });
    }
  }

  async function processQueue() {
    return runExclusive(async () => {
      const state = await store.load();
      let queue = state.queue;

      for (;;) {
        const now = Date.now();
        const index = queue.findIndex(
          (item) =>
            [SUBMISSION_STATES.QUEUED, SUBMISSION_STATES.RETRY_WAIT].includes(item.state) &&
            (item.nextAttemptAt ?? 0) <= now,
        );

        if (index < 0) {
          break;
        }

        const record = { ...queue[index], state: SUBMISSION_STATES.SENDING };
        queue[index] = record;
        await store.set({
          [STORAGE_KEYS.LAST_SUBMISSION]: {
            at: new Date().toISOString(),
            error: null,
            productId: null,
            state: SUBMISSION_STATES.SENDING,
          },
          [STORAGE_KEYS.QUEUE]: queue,
        });
        const result = await backendClient.submitSnapshot(
          state.settings,
          state.auth,
          record.snapshot,
        );

        if (result.kind === 'success') {
          queue.splice(index, 1);
          await store.set({
            [STORAGE_KEYS.BACKEND]: {
              checkedAt: new Date().toISOString(),
              error: null,
              status: 'connected',
            },
            [STORAGE_KEYS.LAST_SUBMISSION]: {
              at: new Date().toISOString(),
              error: null,
              expectedVariantCount: record.snapshot.expectedVariantCount,
              pricedVariantCount: record.snapshot.pricedVariantCount,
              productId: result.body.data?.product?.id ?? null,
              state: SUBMISSION_STATES.SUCCESS,
            },
            [STORAGE_KEYS.QUEUE]: queue,
          });
          continue;
        }

        const attemptCount = record.attemptCount + 1;
        const lastError = {
          code: result.errorCode,
          message: result.error,
          status: result.status,
        };

        if (result.kind === 'auth') {
          queue = queue.map((item) =>
            [
              SUBMISSION_STATES.QUEUED,
              SUBMISSION_STATES.RETRY_WAIT,
              SUBMISSION_STATES.SENDING,
            ].includes(item.state)
              ? {
                  ...item,
                  lastError,
                  nextAttemptAt: null,
                  state: SUBMISSION_STATES.BLOCKED_AUTH,
                }
              : item,
          );
          await store.set({
            [STORAGE_KEYS.AUTH]: {
              ...state.auth,
              expiresAt: null,
              mode: 'enabled',
              token: null,
              user: null,
            },
            [STORAGE_KEYS.LAST_SUBMISSION]: {
              at: new Date().toISOString(),
              error: lastError,
              productId: null,
              state: SUBMISSION_STATES.BLOCKED_AUTH,
            },
            [STORAGE_KEYS.QUEUE]: queue,
          });
          break;
        }

        if (result.kind === 'temporary') {
          const exhausted = attemptCount >= MAX_RETRY_ATTEMPTS;
          const nextAttemptAt = exhausted ? null : Date.now() + calculateRetryDelayMs(attemptCount);
          queue[index] = {
            ...record,
            attemptCount,
            lastError,
            nextAttemptAt,
            state: exhausted ? SUBMISSION_STATES.RETRY_EXHAUSTED : SUBMISSION_STATES.RETRY_WAIT,
          };

          if (!exhausted) {
            queue = queue.map((item, itemIndex) =>
              itemIndex !== index && item.state === SUBMISSION_STATES.QUEUED
                ? { ...item, nextAttemptAt, state: SUBMISSION_STATES.RETRY_WAIT }
                : item,
            );
          }

          await store.set({
            [STORAGE_KEYS.BACKEND]: {
              checkedAt: new Date().toISOString(),
              error: result.error,
              status: 'unavailable',
            },
            [STORAGE_KEYS.LAST_SUBMISSION]: {
              at: new Date().toISOString(),
              error: lastError,
              productId: null,
              state: queue[index].state,
            },
            [STORAGE_KEYS.QUEUE]: queue,
          });
          break;
        }

        queue[index] = {
          ...record,
          attemptCount,
          lastError,
          nextAttemptAt: null,
          state: SUBMISSION_STATES.FAILED_PERMANENT,
        };
        await store.set({
          [STORAGE_KEYS.LAST_SUBMISSION]: {
            at: new Date().toISOString(),
            error: lastError,
            productId: null,
            state: SUBMISSION_STATES.FAILED_PERMANENT,
          },
          [STORAGE_KEYS.QUEUE]: queue,
        });
      }

      await scheduleRetryAlarm(queue);
      return queueSummary(queue);
    });
  }

  return Object.freeze({
    /** Remove explicitly acknowledged dead-letter records. */
    async clearFailed() {
      const queue = await runExclusive(async () => {
        const state = await store.load();
        const updatedQueue = state.queue.filter(
          (item) =>
            ![SUBMISSION_STATES.FAILED_PERMANENT, SUBMISSION_STATES.RETRY_EXHAUSTED].includes(
              item.state,
            ),
        );
        await store.set({ [STORAGE_KEYS.QUEUE]: updatedQueue });
        return updatedQueue;
      });
      await scheduleRetryAlarm(queue);
      return queueSummary(queue);
    },

    /** Persist an exact snapshot before attempting backend delivery. */
    async enqueue(snapshot, semanticHash) {
      const result = await runExclusive(async () => {
        const state = await store.load();
        const id = `sha256:${await sha256(stableStringify(snapshot))}`;
        const appended = appendQueueRecord(state.queue, {
          createdAt: new Date().toISOString(),
          id,
          semanticHash,
          snapshot,
        });

        if (!appended.added && appended.reason === 'queue_full') {
          await store.set({
            [STORAGE_KEYS.LAST_SUBMISSION]: {
              at: new Date().toISOString(),
              error: { code: 'QUEUE_FULL', message: 'The 50-item submission queue is full' },
              productId: null,
              state: SUBMISSION_STATES.FAILED_PERMANENT,
            },
          });
          const error = new Error('The 50-item submission queue is full');
          error.code = 'QUEUE_FULL';
          throw error;
        }

        if (appended.added) {
          await store.set({
            [STORAGE_KEYS.LAST_SUBMISSION]: {
              at: new Date().toISOString(),
              error: null,
              productId: null,
              state: SUBMISSION_STATES.QUEUED,
            },
            [STORAGE_KEYS.QUEUE]: appended.queue,
          });
        }

        return appended.added;
      });

      await processQueue();
      return { added: result, queue: queueSummary((await store.load()).queue) };
    },

    /** Recreate the next alarm after service-worker startup. */
    async initialise() {
      const state = await store.load();
      await scheduleRetryAlarm(state.queue);
      await processQueue();
    },

    process: processQueue,

    /** Reset bounded retries only after an explicit user action or sign-in. */
    async retry() {
      await runExclusive(async () => {
        const state = await store.load();
        await store.set({ [STORAGE_KEYS.QUEUE]: resetRetryableQueue(state.queue) });
      });
      await processQueue();
      return queueSummary((await store.load()).queue);
    },

    /** Release only auth and retry records after successful authentication. */
    async unblockAfterLogin() {
      await runExclusive(async () => {
        const state = await store.load();
        await store.set({ [STORAGE_KEYS.QUEUE]: resetRetryableQueue(state.queue) });
      });
      await processQueue();
    },
  });
}
