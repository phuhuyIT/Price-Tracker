import { ERROR_CODES } from '../../../packages/shared/errors/errorCodes.js';
import { STORAGE_KEYS } from './serviceWorkerStore.js';

export const COLLECTION_POLL_ALARM_NAME = 'collection-job-poll';
export const COLLECTION_RETRY_ALARM_NAME = 'collection-job-retry';
export const COLLECTION_TIMEOUT_ALARM_PREFIX = 'collection-job-timeout:';
export const DEFAULT_COLLECTION_TIMEOUT_MS = 90_000;

function status(state, { error = null, jobId = null } = {}) {
  return { at: new Date().toISOString(), error, jobId, state };
}

/** Run opt-in collection jobs inside inactive tabs in the current Chrome profile. */
export function createBackgroundCollectionAgent({
  action,
  alarms,
  backendClient,
  notifications,
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
        message: 'Sign in to Shopee in this Chrome profile, then retry the price collection job.',
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
      await clearActive(active, status('success', { jobId: active.job.id }));
      return { completed: true };
    }

    if (result.kind === 'temporary') {
      await setStatus(status('retry_wait', { error: result.error, jobId: active.job.id }));
      await closeTab(active.tabId);
      await store.set({
        [STORAGE_KEYS.ACTIVE_COLLECTION]: { ...active, tabId: null },
      });
      await alarms.create(COLLECTION_RETRY_ALARM_NAME, { when: Date.now() + 5_000 });
      return { completed: false };
    }

    await clearActive(
      active,
      status('failed', {
        error: result.error ?? 'The backend rejected the completed collection',
        jobId: active.job.id,
      }),
    );
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

    if (errorCode === ERROR_CODES.AUTHENTICATION_REQUIRED) {
      await showAuthenticationRequired();
    }

    await clearActive(
      active,
      status('failed', {
        error: result.kind === 'success' ? errorMessage : (result.error ?? errorMessage),
        jobId: active.job.id,
      }),
    );
    return { failed: true };
  }

  async function configureAlarm() {
    const state = await store.load();
    await alarms.clear(COLLECTION_POLL_ALARM_NAME);

    if (state.settings.backgroundCollectionEnabled) {
      await alarms.create(COLLECTION_POLL_ALARM_NAME, {
        periodInMinutes: state.settings.collectionPollIntervalMinutes,
      });
    }
  }

  async function poll({ allowWhenDisabled = false } = {}) {
    if (polling) {
      return { state: 'busy' };
    }

    polling = true;

    try {
      const state = await store.load();

      if (!allowWhenDisabled && !state.settings.backgroundCollectionEnabled) {
        return setStatus(status('disabled'));
      }

      if (state.activeCollection?.pendingSnapshot) {
        return completeActive(state.activeCollection);
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
      );

      if (result.kind !== 'success') {
        return setStatus(status('backend_error', { error: result.error }));
      }

      if (!result.claim) {
        await clearAttention();
        return setStatus(status('idle'));
      }

      let tab;

      try {
        tab = await tabs.create({
          active: false,
          url: result.claim.job.canonicalUrl,
          windowId: normalWindow.id,
        });
      } catch {
        const active = { ...result.claim, job: result.claim.job, tabId: null };
        return failActive(
          active,
          ERROR_CODES.EXTENSION_UNAVAILABLE,
          'Chrome could not open the inactive collection tab',
        );
      }

      const active = {
        job: result.claim.job,
        leaseToken: result.claim.leaseToken,
        pendingSnapshot: null,
        startedAt: new Date().toISOString(),
        tabId: tab.id,
      };
      await store.set({
        [STORAGE_KEYS.ACTIVE_COLLECTION]: active,
        [STORAGE_KEYS.COLLECTION_STATUS]: status('collecting', {
          jobId: active.job.id,
        }),
      });
      await alarms.create(`${COLLECTION_TIMEOUT_ALARM_PREFIX}${active.job.id}`, {
        when: Date.now() + timeoutMs,
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

    async handleAlarm(name) {
      if (name === COLLECTION_POLL_ALARM_NAME || name === COLLECTION_RETRY_ALARM_NAME) {
        return poll();
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

    async initialise() {
      await configureAlarm();
      return poll();
    },

    poll,

    pollNow() {
      return poll({ allowWhenDisabled: true });
    },
  });
}
