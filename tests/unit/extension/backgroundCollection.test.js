import { describe, expect, it, vi } from 'vitest';

import { ERROR_CODES } from '../../../packages/shared/errors/errorCodes.js';
import {
  COLLECTION_TIMEOUT_ALARM_PREFIX,
  createBackgroundCollectionAgent,
} from '../../../apps/extension/lib/backgroundCollection.js';
import { STORAGE_KEYS } from '../../../apps/extension/lib/serviceWorkerStore.js';

function createMemoryStore(settings = {}) {
  const state = {
    activeCollection: null,
    auth: { expiresAt: null, mode: 'disabled', token: null, user: null },
    collectionStatus: { at: null, error: null, jobId: null, state: 'idle' },
    settings: {
      backendBaseUrl: 'http://127.0.0.1:3000',
      backgroundCollectionEnabled: false,
      collectionPollIntervalMinutes: 30,
      pricingContextKey: 'extension:test-profile',
      ...settings,
    },
  };
  const keyMap = {
    [STORAGE_KEYS.ACTIVE_COLLECTION]: 'activeCollection',
    [STORAGE_KEYS.COLLECTION_STATUS]: 'collectionStatus',
  };

  return {
    async load() {
      return state;
    },
    async set(records) {
      for (const [key, value] of Object.entries(records)) {
        state[keyMap[key]] = value;
      }
    },
    state,
  };
}

function createHarness({ settings } = {}) {
  const store = createMemoryStore(settings);
  const action = {
    setBadgeBackgroundColor: vi.fn(async () => undefined),
    setBadgeText: vi.fn(async () => undefined),
  };
  const alarms = {
    clear: vi.fn(async () => true),
    create: vi.fn(async () => undefined),
  };
  const backendClient = {
    claimCollectionJob: vi.fn(async () => ({ claim: null, kind: 'success' })),
    completeCollectionJob: vi.fn(async () => ({ body: {}, kind: 'success' })),
    failCollectionJob: vi.fn(async () => ({ body: {}, kind: 'success' })),
  };
  const notifications = { create: vi.fn(async () => 'notification') };
  const tabs = {
    create: vi.fn(async () => ({ id: 17 })),
    remove: vi.fn(async () => undefined),
  };
  const windows = { getLastFocused: vi.fn(async () => ({ id: 4 })) };
  const agent = createBackgroundCollectionAgent({
    action,
    alarms,
    backendClient,
    notifications,
    store,
    tabs,
    windows,
  });

  return { action, agent, alarms, backendClient, notifications, store, tabs, windows };
}

function claim() {
  return {
    job: {
      canonicalUrl: 'https://shopee.vn/product-i.1259293184.26882883164',
      id: 11,
    },
    leaseToken: 'a'.repeat(64),
  };
}

describe('background Chrome collection agent', () => {
  it('does not poll or create a tab while background collection is disabled', async () => {
    const harness = createHarness();
    await harness.agent.initialise();

    expect(harness.backendClient.claimCollectionJob).not.toHaveBeenCalled();
    expect(harness.tabs.create).not.toHaveBeenCalled();
    expect(harness.store.state.collectionStatus.state).toBe('disabled');
  });

  it('allows one explicit check while periodic background collection is disabled', async () => {
    const harness = createHarness();
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    await harness.agent.pollNow();

    expect(harness.backendClient.claimCollectionJob).toHaveBeenCalledOnce();
    expect(harness.tabs.create).toHaveBeenCalledWith({
      active: false,
      url: 'https://shopee.vn/product-i.1259293184.26882883164',
      windowId: 4,
    });
  });

  it('claims work with the profile key and opens an inactive tab in an existing window', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    await harness.agent.poll();

    expect(harness.backendClient.claimCollectionJob).toHaveBeenCalledWith(
      harness.store.state.settings,
      harness.store.state.auth,
      'extension:test-profile',
    );
    expect(harness.tabs.create).toHaveBeenCalledWith({
      active: false,
      url: 'https://shopee.vn/product-i.1259293184.26882883164',
      windowId: 4,
    });
    expect(harness.store.state.activeCollection).toMatchObject({
      job: { id: 11 },
      tabId: 17,
    });
  });

  it('completes the lease and closes the temporary tab', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    await harness.agent.poll();
    const snapshot = { itemId: '26882883164', pricingContextKey: 'extension:test-profile' };
    await harness.agent.complete({ snapshot, tabId: 17 });

    expect(harness.backendClient.completeCollectionJob).toHaveBeenCalledWith(
      harness.store.state.settings,
      harness.store.state.auth,
      11,
      'a'.repeat(64),
      snapshot,
    );
    expect(harness.tabs.remove).toHaveBeenCalledWith(17);
    expect(harness.store.state.activeCollection).toBeNull();
    expect(harness.store.state.collectionStatus.state).toBe('success');
  });

  it('notifies the user when the exact Chrome profile needs Shopee sign-in', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    await harness.agent.poll();
    await harness.agent.fail({
      errorCode: ERROR_CODES.AUTHENTICATION_REQUIRED,
      errorMessage: 'Shopee sign-in is required',
      tabId: 17,
    });

    expect(harness.notifications.create).toHaveBeenCalledOnce();
    expect(harness.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
    expect(harness.tabs.remove).toHaveBeenCalledWith(17);
    expect(harness.store.state.collectionStatus).toMatchObject({
      error: 'Shopee sign-in is required',
      state: 'failed',
    });
  });

  it('records a timeout and closes the temporary tab', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    await harness.agent.poll();
    await harness.agent.handleAlarm(`${COLLECTION_TIMEOUT_ALARM_PREFIX}11`);

    expect(harness.backendClient.failCollectionJob).toHaveBeenCalledWith(
      harness.store.state.settings,
      harness.store.state.auth,
      11,
      'a'.repeat(64),
      ERROR_CODES.COLLECTION_TIMEOUT,
      expect.any(String),
    );
    expect(harness.tabs.remove).toHaveBeenCalledWith(17);
  });
});
