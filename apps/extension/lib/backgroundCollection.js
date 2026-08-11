import { ERROR_CODES } from '../../../packages/shared/errors/errorCodes.js';
import { STORAGE_KEYS } from './serviceWorkerStore.js';

export const COLLECTION_POLL_ALARM_NAME = 'collection-job-poll';
export const COLLECTION_RETRY_ALARM_NAME = 'collection-job-retry';
export const COLLECTION_TIMEOUT_ALARM_PREFIX = 'collection-job-timeout:';
export const DEFAULT_COLLECTION_TIMEOUT_MS = 270_000;
const NEXT_JOB_DELAY_MIN_MS = 5_000;
const NEXT_JOB_DELAY_MAX_MS = 10_000;
const BACKEND_RETRY_DELAY_MS = 5_000;
const LEASE_SAFETY_BUFFER_MS = 10_000;
const PAGE_COMPLETION_BUFFER_MS = 5_000;
const LOCAL_COLLECTION_SUCCESS_STATES = new Set(['no_prices', 'partial', 'success', 'unavailable']);

function status(state, { error = null, jobId = null, ...details } = {}) {
  return { at: new Date().toISOString(), error, jobId, ...details, state };
}

function randomDelay(minimum, maximum, random) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function collectionTiming(claim, timeoutMs) {
  const now = Date.now();
  const configuredDeadline = now + timeoutMs;
  const leaseExpiry = Date.parse(claim?.job?.leaseExpiresAt);
  const timeoutAt = Number.isFinite(leaseExpiry)
    ? Math.max(now + 2_000, Math.min(configuredDeadline, leaseExpiry - LEASE_SAFETY_BUFFER_MS))
    : configuredDeadline;

  return {
    deadlineAt: Math.max(now + 1_000, timeoutAt - PAGE_COMPLETION_BUFFER_MS),
    timeoutAt,
  };
}

function collectionResult(snapshot, jobId, productId, processedVariantCount) {
  const observed = snapshot.variants
    .filter(
      (variant) =>
        variant.priceObservation.status === 'observed' &&
        !['sold_out', 'unavailable'].includes(variant.availability),
    )
    .toSorted(
      (left, right) => left.priceObservation.priceAmount - right.priceObservation.priceAmount,
    );
  const explicitlyUnavailable = snapshot.variants.filter((variant) =>
    ['sold_out', 'unavailable'].includes(variant.availability),
  ).length;
  const stockVariant =
    observed[0] ??
    snapshot.variants.find(
      (variant) => Number.isSafeInteger(variant.stockQuantity) && variant.stockQuantity >= 0,
    );
  const expectedVariantCount = snapshot.expectedVariantCount ?? snapshot.variants.length;
  const pricedVariantCount = observed.length;
  const resolvedVariantCount = pricedVariantCount + explicitlyUnavailable;
  const state =
    expectedVariantCount > 0 && explicitlyUnavailable >= expectedVariantCount
      ? 'unavailable'
      : pricedVariantCount === 0
        ? 'no_prices'
        : resolvedVariantCount >= expectedVariantCount
          ? 'success'
          : 'partial';
  const availability =
    state === 'unavailable'
      ? snapshot.variants.every((variant) => variant.availability === 'sold_out')
        ? 'sold_out'
        : 'unavailable'
      : snapshot.variants.some((variant) => variant.availability === 'available')
        ? 'available'
        : 'unknown';

  return status(state, {
    availability,
    displayedStockQuantity: stockVariant?.stockQuantity ?? null,
    expectedVariantCount,
    itemId: snapshot.itemId,
    jobId,
    lowestPriceAmount: observed[0]?.priceObservation.priceAmount ?? null,
    lowestPriceVariant: observed[0]?.name ?? null,
    pricedVariantCount,
    processedVariantCount: Number.isSafeInteger(processedVariantCount)
      ? processedVariantCount
      : expectedVariantCount,
    productId,
    resolvedVariantCount,
    shopId: snapshot.shopId,
  });
}

/** Run opt-in collection jobs inside inactive tabs in the current Chrome profile. */
export function createBackgroundCollectionAgent({
  action,
  alarms,
  backendClient,
  notifications,
  random = Math.random,
  store,
  tabs,
  timeoutMs = DEFAULT_COLLECTION_TIMEOUT_MS,
  windows,
}) {
  let polling = false;

  async function setStatus(value) {
    await store.set({ [STORAGE_KEYS.COLLECTION_STATUS]: value });
    return value;
  }

  async function clearAttention() {
    await action.setBadgeText({ text: '' }).catch(() => undefined);
  }

  async function showAuthenticationRequired() {
    await action.setBadgeBackgroundColor({ color: '#b42318' }).catch(() => undefined);
    await action.setBadgeText({ text: '!' }).catch(() => undefined);
    await notifications
      .create('shopee-authentication-required', {
        iconUrl: 'icons/icon128.png',
        message: 'Sign in to Shopee in this Chrome profile, then click Check now.',
        title: 'Shopee sign-in required',
        type: 'basic',
      })
      .catch(() => undefined);
  }

  async function closeTab(tabId) {
    if (Number.isInteger(tabId)) {
      await tabs.remove(tabId).catch(() => undefined);
    }
  }

  async function scheduleRetry(when) {
    await alarms.clear(COLLECTION_RETRY_ALARM_NAME);
    await alarms.create(COLLECTION_RETRY_ALARM_NAME, {
      when: Math.max(Date.now() + 100, when),
    });
  }

  async function removeManualJob(jobId, collectionStatus) {
    const state = await store.load();
    const manualCollectionQueue = state.manualCollectionQueue.filter((id) => id !== jobId);
    await store.set({
      [STORAGE_KEYS.COLLECTION_STATUS]: collectionStatus,
      [STORAGE_KEYS.MANUAL_COLLECTION_QUEUE]: manualCollectionQueue,
    });

    if (manualCollectionQueue.length > 0) {
      await scheduleRetry(Date.now() + 100);
    }

    return collectionStatus;
  }

  async function reconcileRequestedJob(jobId) {
    const state = await store.load();
    const result = await backendClient.getCollectionJob(state.settings, state.auth, jobId);

    if (result.kind !== 'success' || !result.job) {
      const error = result.error ?? 'The requested collection job no longer exists';

      if (result.kind === 'temporary') {
        const queued = status('queued', { error, jobId });
        await setStatus(queued);
        await scheduleRetry(Date.now() + BACKEND_RETRY_DELAY_MS);
        return queued;
      }

      return removeManualJob(jobId, status('failed', { error, jobId }));
    }

    const job = result.job;
    const details = {
      itemId: job.itemId,
      jobId: job.id,
      shopId: job.shopId,
    };

    if (job.status === 'completed') {
      const completedLocally =
        state.collectionStatus.jobId === jobId &&
        LOCAL_COLLECTION_SUCCESS_STATES.has(state.collectionStatus.state);
      return removeManualJob(jobId, completedLocally ? state.collectionStatus : status('idle'));
    }

    if (job.status === 'failed') {
      return removeManualJob(
        jobId,
        status('failed', {
          ...details,
          error: job.errorMessage ?? 'The requested price collection failed.',
        }),
      );
    }

    if (
      job.targetContextKey !== null &&
      job.targetContextKey !== state.settings.pricingContextKey
    ) {
      const rebound = await backendClient.rebindCollectionJob(
        state.settings,
        state.auth,
        jobId,
        state.settings.pricingContextKey,
      );

      if (rebound.kind === 'success' && rebound.job) {
        const queued = status('queued', {
          ...details,
          error: 'The manual collection moved to this Chrome profile.',
        });
        await setStatus(queued);
        const retryAt =
          rebound.job.status === 'retry_wait'
            ? Date.parse(rebound.job.nextAttemptAt)
            : Date.now() + 100;
        await scheduleRetry(Number.isFinite(retryAt) ? retryAt : Date.now() + 100);
        return queued;
      }

      const error = rebound.error ?? 'The collection could not move to this Chrome profile';

      if (rebound.kind === 'temporary') {
        const queued = status('queued', {
          ...details,
          error,
        });
        await setStatus(queued);
        await scheduleRetry(Date.now() + BACKEND_RETRY_DELAY_MS);
        return queued;
      }

      return removeManualJob(jobId, status('failed', { ...details, error }));
    }

    const queued = status('queued', {
      ...details,
      error:
        job.status === 'retry_wait'
          ? 'The requested price collection is waiting for its scheduled retry.'
          : 'The requested price collection is already being processed.',
    });
    await setStatus(queued);

    const retryAt =
      job.status === 'retry_wait'
        ? Date.parse(job.nextAttemptAt)
        : Math.min(Date.parse(job.leaseExpiresAt), Date.now() + BACKEND_RETRY_DELAY_MS);
    await scheduleRetry(Number.isFinite(retryAt) ? retryAt : Date.now() + BACKEND_RETRY_DELAY_MS);
    return queued;
  }

  async function scheduleNextJob() {
    const state = await store.load();

    if (state.manualCollectionQueue.length > 0) {
      await scheduleRetry(Date.now() + 100);
      return true;
    }

    if (!state.settings.backgroundCollectionEnabled) {
      return false;
    }

    const delayMs = randomDelay(NEXT_JOB_DELAY_MIN_MS, NEXT_JOB_DELAY_MAX_MS, random);
    await scheduleRetry(Date.now() + delayMs);
    return true;
  }

  async function clearActive(active, collectionStatus) {
    await store.set({
      [STORAGE_KEYS.ACTIVE_COLLECTION]: null,
      [STORAGE_KEYS.COLLECTION_STATUS]: collectionStatus,
    });
    await alarms.clear(`${COLLECTION_TIMEOUT_ALARM_PREFIX}${active.job.id}`);
    await alarms.clear(COLLECTION_RETRY_ALARM_NAME);
    await closeTab(active.tabId);
  }

  async function completeActive(active) {
    const state = await store.load();
    const result = await backendClient.completeCollectionJob(
      state.settings,
      state.auth,
      active.job.id,
      active.leaseToken,
      active.pendingSnapshot,
    );

    if (result.kind === 'success') {
      await clearAttention();
      await clearActive(
        active,
        collectionResult(
          active.pendingSnapshot,
          active.job.id,
          result.body?.data?.product?.id ?? null,
          state.collectionStatus.jobId === active.job.id
            ? state.collectionStatus.processedVariantCount
            : null,
        ),
      );

      await scheduleNextJob();

      return { completed: true };
    }

    if (result.kind === 'temporary') {
      await setStatus(status('retry_wait', { error: result.error, jobId: active.job.id }));
      await store.set({
        [STORAGE_KEYS.ACTIVE_COLLECTION]: { ...active, tabId: null },
      });
      await closeTab(active.tabId);
      await scheduleRetry(Date.now() + BACKEND_RETRY_DELAY_MS);
      return { completed: false };
    }

    await clearActive(
      active,
      status('failed', {
        error: result.error ?? 'The backend rejected the completed collection',
        jobId: active.job.id,
      }),
    );

    await scheduleNextJob();

    return { completed: false };
  }

  async function failActive(active, errorCode, errorMessage) {
    const state = await store.load();
    const result = await backendClient.failCollectionJob(
      state.settings,
      state.auth,
      active.job.id,
      active.leaseToken,
      errorCode,
      errorMessage,
    );

    if (result.kind === 'temporary') {
      await alarms.clear(`${COLLECTION_TIMEOUT_ALARM_PREFIX}${active.job.id}`);
      await store.set({
        [STORAGE_KEYS.ACTIVE_COLLECTION]: {
          ...active,
          pendingFailure: { errorCode, errorMessage },
          tabId: null,
        },
        [STORAGE_KEYS.COLLECTION_STATUS]: status('retry_wait', {
          error: result.error ?? errorMessage,
          jobId: active.job.id,
        }),
      });
      await closeTab(active.tabId);
      await scheduleRetry(Date.now() + BACKEND_RETRY_DELAY_MS);
      return { failed: false };
    }

    const transitionedJob = result.body?.data?.job ?? null;
    const nextState = transitionedJob?.status ?? 'failed';

    if (nextState === 'waiting_auth') {
      await showAuthenticationRequired();
      await clearActive(
        active,
        status('waiting_auth', { error: errorMessage, jobId: active.job.id }),
      );
      return { failed: false, waitingForAuthentication: true };
    }

    if (nextState === 'retry_wait') {
      await clearActive(
        active,
        status('retry_wait', { error: errorMessage, jobId: active.job.id }),
      );
      await scheduleRetry(Date.parse(transitionedJob.nextAttemptAt));
      return { failed: false, retrying: true };
    }

    await clearActive(
      active,
      status('failed', {
        error: result.kind === 'success' ? errorMessage : (result.error ?? errorMessage),
        jobId: active.job.id,
      }),
    );

    await scheduleNextJob();

    return { failed: true };
  }

  async function configureAlarm() {
    const state = await store.load();
    await alarms.clear(COLLECTION_POLL_ALARM_NAME);

    if (state.settings.backgroundCollectionEnabled) {
      await alarms.create(COLLECTION_POLL_ALARM_NAME, {
        periodInMinutes: state.settings.collectionPollIntervalMinutes,
      });
    } else {
      await alarms.clear(COLLECTION_RETRY_ALARM_NAME);
    }
  }

  async function poll({ allowWhenDisabled = false, resumeWaitingAuth = false } = {}) {
    if (polling) {
      return { state: 'busy' };
    }

    polling = true;

    try {
      const state = await store.load();
      const requestedJobId = state.manualCollectionQueue[0] ?? null;

      if (
        !allowWhenDisabled &&
        requestedJobId === null &&
        !state.settings.backgroundCollectionEnabled
      ) {
        if (LOCAL_COLLECTION_SUCCESS_STATES.has(state.collectionStatus.state)) {
          return state.collectionStatus;
        }

        return setStatus(status('disabled'));
      }

      if (state.activeCollection?.pendingSnapshot) {
        return completeActive(state.activeCollection);
      }

      if (state.activeCollection?.pendingFailure) {
        return failActive(
          state.activeCollection,
          state.activeCollection.pendingFailure.errorCode,
          state.activeCollection.pendingFailure.errorMessage,
        );
      }

      if (state.activeCollection) {
        return { state: 'collecting' };
      }

      const normalWindow = await windows
        .getLastFocused({ windowTypes: ['normal'] })
        .catch(() => null);

      if (!normalWindow?.id) {
        return setStatus(
          status('waiting_browser', {
            error: 'Open a normal Chrome window to collect queued prices.',
          }),
        );
      }

      const result = await backendClient.claimCollectionJob(
        state.settings,
        state.auth,
        state.settings.pricingContextKey,
        resumeWaitingAuth,
        requestedJobId,
      );

      if (result.kind !== 'success') {
        return setStatus(status('backend_error', { error: result.error }));
      }

      if (!result.claim) {
        await clearAttention();
        return requestedJobId === null
          ? setStatus(status('idle'))
          : reconcileRequestedJob(requestedJobId);
      }

      const manualCollectionQueue = state.manualCollectionQueue.filter(
        (jobId) => jobId !== result.claim.job.id,
      );

      let tab;

      try {
        tab = await tabs.create({
          active: false,
          url: result.claim.job.canonicalUrl,
          windowId: normalWindow.id,
        });
      } catch {
        const active = {
          ...result.claim,
          job: result.claim.job,
          pendingFailure: null,
          tabId: null,
        };
        return failActive(
          active,
          ERROR_CODES.EXTENSION_UNAVAILABLE,
          'Chrome could not open the inactive collection tab',
        );
      }

      const timing = collectionTiming(result.claim, timeoutMs);
      const active = {
        deadlineAt: timing.deadlineAt,
        job: result.claim.job,
        leaseToken: result.claim.leaseToken,
        pendingFailure: null,
        pendingSnapshot: null,
        startedAt: new Date().toISOString(),
        tabId: tab.id,
        timeoutAt: timing.timeoutAt,
      };
      await store.set({
        [STORAGE_KEYS.ACTIVE_COLLECTION]: active,
        [STORAGE_KEYS.COLLECTION_STATUS]: status('collecting', {
          itemId: active.job.itemId,
          jobId: active.job.id,
          shopId: active.job.shopId,
        }),
        [STORAGE_KEYS.MANUAL_COLLECTION_QUEUE]: manualCollectionQueue,
      });
      await alarms.create(`${COLLECTION_TIMEOUT_ALARM_PREFIX}${active.job.id}`, {
        when: active.timeoutAt,
      });
      return { job: active.job, state: 'collecting', tabId: tab.id };
    } finally {
      polling = false;
    }
  }

  return Object.freeze({
    configureAlarm,

    async complete({ snapshot, tabId }) {
      const state = await store.load();
      const active = state.activeCollection;

      if (!active || active.tabId !== tabId) {
        return { ignored: true };
      }

      const withSnapshot = { ...active, pendingSnapshot: snapshot };
      await store.set({ [STORAGE_KEYS.ACTIVE_COLLECTION]: withSnapshot });
      return completeActive(withSnapshot);
    },

    async fail({ errorCode, errorMessage, tabId }) {
      const state = await store.load();
      const active = state.activeCollection;
      return !active || active.tabId !== tabId
        ? { ignored: true }
        : failActive(active, errorCode, errorMessage);
    },

    async progress({ expectedVariantCount, processedVariantCount, tabId }) {
      const state = await store.load();
      const active = state.activeCollection;

      if (!active || active.tabId !== tabId) {
        return { ignored: true };
      }

      const collectionStatus = status('collecting', {
        expectedVariantCount,
        itemId: active.job.itemId,
        jobId: active.job.id,
        processedVariantCount,
        shopId: active.job.shopId,
      });
      await store.set({ [STORAGE_KEYS.COLLECTION_STATUS]: collectionStatus });
      return collectionStatus;
    },

    async handleAlarm(name) {
      if (name === COLLECTION_POLL_ALARM_NAME) {
        return poll();
      }

      if (name === COLLECTION_RETRY_ALARM_NAME) {
        return poll({ allowWhenDisabled: true });
      }

      if (name.startsWith(COLLECTION_TIMEOUT_ALARM_PREFIX)) {
        const state = await store.load();
        const active = state.activeCollection;

        if (active?.pendingSnapshot) {
          return completeActive(active);
        }

        if (active && name === `${COLLECTION_TIMEOUT_ALARM_PREFIX}${active.job.id}`) {
          return failActive(
            active,
            ERROR_CODES.COLLECTION_TIMEOUT,
            'The inactive Shopee collection tab did not finish before the timeout',
          );
        }
      }

      return { ignored: true };
    },

    async handleTabRemoved(tabId) {
      const state = await store.load();
      const active = state.activeCollection;

      if (!active || active.tabId !== tabId) {
        return { ignored: true };
      }

      if (active.pendingSnapshot) {
        await store.set({
          [STORAGE_KEYS.ACTIVE_COLLECTION]: { ...active, tabId: null },
        });
        return { pendingCompletion: true };
      }

      return failActive(
        { ...active, tabId: null },
        ERROR_CODES.TAB_CLOSED_PREMATURELY,
        'The inactive Shopee collection tab closed before collection finished',
      );
    },

    async initialise() {
      await configureAlarm();
      return poll();
    },

    poll,

    async pollNow(jobId = null) {
      if (jobId !== null) {
        const state = await store.load();

        if (state.activeCollection?.job?.id === jobId) {
          await store.set({
            [STORAGE_KEYS.MANUAL_COLLECTION_QUEUE]: state.manualCollectionQueue.filter(
              (id) => id !== jobId,
            ),
          });
          return {
            job: state.activeCollection.job,
            state: 'collecting',
            tabId: state.activeCollection.tabId,
          };
        }

        const manualCollectionQueue = [...new Set([...state.manualCollectionQueue, jobId])];
        await store.set({ [STORAGE_KEYS.MANUAL_COLLECTION_QUEUE]: manualCollectionQueue });
      }

      const result = await poll({ allowWhenDisabled: true, resumeWaitingAuth: true });

      if (result?.state === 'busy') {
        await scheduleRetry(Date.now() + 100);
      }

      return result;
    },
  });
}
