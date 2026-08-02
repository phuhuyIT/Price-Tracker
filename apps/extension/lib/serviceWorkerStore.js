import { normaliseExtensionSettings } from './extensionSettings.js';
import { SUBMISSION_STATES } from './runtimeMessages.js';

export const STORAGE_KEYS = Object.freeze({
  AUTH: 'extensionAuth',
  BACKEND: 'backendStatus',
  LAST_SUBMISSION: 'lastSubmissionStatus',
  LATEST_CAPTURES: 'latestCaptures',
  QUEUE: 'snapshotQueue',
  SETTINGS: 'extensionSettings',
});

export const DEFAULT_AUTH_STATE = Object.freeze({
  expiresAt: null,
  mode: 'unknown',
  token: null,
  user: null,
});

export const DEFAULT_BACKEND_STATUS = Object.freeze({
  checkedAt: null,
  error: null,
  status: 'unknown',
});

export const DEFAULT_SUBMISSION_STATUS = Object.freeze({
  at: null,
  error: null,
  productId: null,
  state: SUBMISSION_STATES.IDLE,
});

/** Return account state without exposing the stored bearer credential. */
export function publicAuthState(auth) {
  return {
    expiresAt: auth.expiresAt,
    mode: auth.mode,
    signedIn: Boolean(auth.mode === 'enabled' && auth.token && auth.user),
    user: auth.user,
  };
}

/** Return popup-safe queue counts. */
export function queueSummary(queue) {
  return {
    blocked: queue.filter((item) => item.state === SUBMISSION_STATES.BLOCKED_AUTH).length,
    failed: queue.filter((item) =>
      [SUBMISSION_STATES.FAILED_PERMANENT, SUBMISSION_STATES.RETRY_EXHAUSTED].includes(item.state),
    ).length,
    pending: queue.filter((item) =>
      [SUBMISSION_STATES.QUEUED, SUBMISSION_STATES.RETRY_WAIT, SUBMISSION_STATES.SENDING].includes(
        item.state,
      ),
    ).length,
    total: queue.length,
  };
}

/** Create the single extension-storage adapter used by the service worker. */
export function createServiceWorkerStore(chromeApi) {
  async function initialise() {
    try {
      await chromeApi.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    } catch {
      // Older supported Chrome versions may not expose access-level controls.
    }

    const stored = await chromeApi.storage.local.get(Object.values(STORAGE_KEYS));
    await chromeApi.storage.local.set({
      [STORAGE_KEYS.AUTH]: {
        ...DEFAULT_AUTH_STATE,
        ...(stored[STORAGE_KEYS.AUTH] ?? {}),
      },
      [STORAGE_KEYS.BACKEND]: {
        ...DEFAULT_BACKEND_STATUS,
        ...(stored[STORAGE_KEYS.BACKEND] ?? {}),
      },
      [STORAGE_KEYS.LAST_SUBMISSION]: {
        ...DEFAULT_SUBMISSION_STATUS,
        ...(stored[STORAGE_KEYS.LAST_SUBMISSION] ?? {}),
      },
      [STORAGE_KEYS.LATEST_CAPTURES]: stored[STORAGE_KEYS.LATEST_CAPTURES] ?? {},
      [STORAGE_KEYS.QUEUE]: Array.isArray(stored[STORAGE_KEYS.QUEUE])
        ? stored[STORAGE_KEYS.QUEUE]
        : [],
      [STORAGE_KEYS.SETTINGS]: normaliseExtensionSettings(stored[STORAGE_KEYS.SETTINGS]),
    });
  }

  const ready = initialise();

  return Object.freeze({
    /** Read a complete operational snapshot after initial storage repair. */
    async load() {
      await ready;
      const stored = await chromeApi.storage.local.get(Object.values(STORAGE_KEYS));
      return {
        auth: { ...DEFAULT_AUTH_STATE, ...(stored[STORAGE_KEYS.AUTH] ?? {}) },
        backend: { ...DEFAULT_BACKEND_STATUS, ...(stored[STORAGE_KEYS.BACKEND] ?? {}) },
        captures: stored[STORAGE_KEYS.LATEST_CAPTURES] ?? {},
        lastSubmission: {
          ...DEFAULT_SUBMISSION_STATUS,
          ...(stored[STORAGE_KEYS.LAST_SUBMISSION] ?? {}),
        },
        queue: Array.isArray(stored[STORAGE_KEYS.QUEUE]) ? stored[STORAGE_KEYS.QUEUE] : [],
        settings: normaliseExtensionSettings(stored[STORAGE_KEYS.SETTINGS]),
      };
    },

    ready,

    /** Update named storage records without exposing chrome.storage to business modules. */
    async set(records) {
      await ready;
      await chromeApi.storage.local.set(records);
    },
  });
}
