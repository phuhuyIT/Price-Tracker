import { describe, expect, it, vi } from 'vitest';

import { ERROR_CODES } from '../../../packages/shared/errors/errorCodes.js';
import {
  COLLECTION_RETRY_ALARM_NAME,
  COLLECTION_TIMEOUT_ALARM_PREFIX,
  createBackgroundCollectionAgent,
} from '../../../apps/extension/lib/backgroundCollection.js';
import { STORAGE_KEYS } from '../../../apps/extension/lib/serviceWorkerStore.js';

function createMemoryStore(settings = {}) {
  const state = {
    activeCollection: null,
    auth: { expiresAt: null, mode: 'disabled', token: null, user: null },
    collectionStatus: { at: null, error: null, jobId: null, state: 'idle' },
    manualCollectionQueue: [],
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
    [STORAGE_KEYS.MANUAL_COLLECTION_QUEUE]: 'manualCollectionQueue',
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
    failCollectionJob: vi.fn(async () => ({
      body: { data: { job: { status: 'failed' } } },
      kind: 'success',
    })),
    getCollectionJob: vi.fn(async () => ({ job: null, kind: 'success' })),
    rebindCollectionJob: vi.fn(async () => ({ job: null, kind: 'success' })),
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
      itemId: '26882883164',
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      shopId: '1259293184',
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
    await harness.agent.pollNow(11);

    expect(harness.backendClient.claimCollectionJob).toHaveBeenCalledOnce();
    expect(harness.backendClient.claimCollectionJob).toHaveBeenCalledWith(
      harness.store.state.settings,
      harness.store.state.auth,
      'extension:test-profile',
      true,
      11,
    );
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
      false,
      null,
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
    const snapshot = {
      expectedVariantCount: 1,
      itemId: '26882883164',
      pricedVariantCount: 1,
      pricingContextKey: 'extension:test-profile',
      shopId: '1259293184',
      variants: [
        {
          availability: 'available',
          name: 'Default',
          priceObservation: { priceAmount: 199_000, status: 'observed' },
          stockQuantity: 12,
        },
      ],
    };
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
    expect(harness.store.state.collectionStatus).toMatchObject({
      expectedVariantCount: 1,
      lowestPriceAmount: 199_000,
      pricedVariantCount: 1,
    });
  });

  it('does not drain another job after background collection is turned off', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    await harness.agent.poll();
    harness.store.state.settings.backgroundCollectionEnabled = false;
    const snapshot = {
      expectedVariantCount: 1,
      itemId: '26882883164',
      pricedVariantCount: 1,
      pricingContextKey: 'extension:test-profile',
      shopId: '1259293184',
      variants: [
        {
          availability: 'available',
          name: 'Default',
          priceObservation: { priceAmount: 199_000, status: 'observed' },
        },
      ],
    };
    await harness.agent.complete({ snapshot, tabId: 17 });

    expect(harness.alarms.create).not.toHaveBeenCalledWith(
      COLLECTION_RETRY_ALARM_NAME,
      expect.anything(),
    );
  });

  it('reports a completed catalogue honestly when no exact price was observed', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    await harness.agent.poll();
    await harness.agent.complete({
      snapshot: {
        expectedVariantCount: 1,
        itemId: '26882883164',
        pricedVariantCount: 0,
        pricingContextKey: 'extension:test-profile',
        shopId: '1259293184',
        variants: [
          {
            availability: 'unknown',
            name: 'Default',
            priceObservation: { reason: 'variation_response_missing', status: 'not_observed' },
          },
        ],
      },
      tabId: 17,
    });

    expect(harness.store.state.collectionStatus).toMatchObject({
      expectedVariantCount: 1,
      lowestPriceAmount: null,
      pricedVariantCount: 0,
      state: 'no_prices',
    });
  });

  it('reports a displayed sold-out price as unavailable instead of current', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    await harness.agent.poll();
    await harness.agent.complete({
      snapshot: {
        expectedVariantCount: 1,
        itemId: '26882883164',
        pricedVariantCount: 1,
        pricingContextKey: 'extension:test-profile',
        shopId: '1259293184',
        variants: [
          {
            availability: 'sold_out',
            name: 'Default',
            priceObservation: { priceAmount: 199_000, status: 'observed' },
            stockQuantity: 0,
          },
        ],
      },
      tabId: 17,
    });

    expect(harness.store.state.collectionStatus).toMatchObject({
      availability: 'sold_out',
      displayedStockQuantity: 0,
      expectedVariantCount: 1,
      lowestPriceAmount: null,
      pricedVariantCount: 0,
      resolvedVariantCount: 1,
      state: 'unavailable',
    });
  });

  it('keeps a manual target queued while another collection is active', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    await harness.agent.poll();

    expect(await harness.agent.pollNow(22)).toEqual({ state: 'collecting' });
    expect(harness.store.state.manualCollectionQueue).toEqual([22]);
  });

  it('does not leave an already active manual target in the local queue', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    await harness.agent.poll();

    expect(await harness.agent.pollNow(11)).toMatchObject({ state: 'collecting' });
    expect(harness.store.state.manualCollectionQueue).toEqual([]);
  });

  it('schedules a follow-up when a manual target arrives during an existing poll', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    let releaseClaim;
    harness.backendClient.claimCollectionJob.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseClaim = resolve;
        }),
    );
    const existingPoll = harness.agent.poll();
    await vi.waitFor(() => expect(harness.backendClient.claimCollectionJob).toHaveBeenCalledOnce());

    const manualPoll = await harness.agent.pollNow(22);
    releaseClaim({ claim: null, kind: 'success' });
    await existingPoll;

    expect(manualPoll).toEqual({ state: 'busy' });
    expect(harness.store.state.manualCollectionQueue).toEqual([22]);
    expect(harness.alarms.create).toHaveBeenCalledWith(COLLECTION_RETRY_ALARM_NAME, {
      when: expect.any(Number),
    });
  });

  it('removes a completed requested job instead of leaving the popup queued', async () => {
    const harness = createHarness();
    harness.store.state.manualCollectionQueue = [11];
    harness.store.state.collectionStatus = {
      at: new Date().toISOString(),
      error: 'The requested price collection is waiting to become claimable.',
      itemId: '26882883164',
      jobId: 11,
      shopId: '1259293184',
      state: 'queued',
    };
    harness.backendClient.getCollectionJob.mockResolvedValue({
      job: {
        id: 11,
        itemId: '26882883164',
        shopId: '1259293184',
        status: 'completed',
        targetContextKey: 'extension:test-profile',
      },
      kind: 'success',
    });

    await harness.agent.pollNow();

    expect(harness.backendClient.getCollectionJob).toHaveBeenCalledWith(
      harness.store.state.settings,
      harness.store.state.auth,
      11,
    );
    expect(harness.store.state.manualCollectionQueue).toEqual([]);
    expect(harness.store.state.collectionStatus.state).toBe('idle');
  });

  it('retains a requested retry job and schedules its next claim time', async () => {
    const harness = createHarness();
    const nextAttemptAt = new Date(Date.now() + 30_000).toISOString();
    harness.store.state.manualCollectionQueue = [11];
    harness.backendClient.getCollectionJob.mockResolvedValue({
      job: {
        id: 11,
        itemId: '26882883164',
        nextAttemptAt,
        shopId: '1259293184',
        status: 'retry_wait',
        targetContextKey: 'extension:test-profile',
      },
      kind: 'success',
    });

    await harness.agent.pollNow();

    expect(harness.store.state.manualCollectionQueue).toEqual([11]);
    expect(harness.store.state.collectionStatus).toMatchObject({ jobId: 11, state: 'queued' });
    expect(harness.alarms.create).toHaveBeenCalledWith(COLLECTION_RETRY_ALARM_NAME, {
      when: Date.parse(nextAttemptAt),
    });
  });

  it('moves an explicitly requested unclaimed job to the current Chrome profile', async () => {
    const harness = createHarness();
    const nextAttemptAt = new Date(Date.now() - 1_000).toISOString();
    harness.store.state.manualCollectionQueue = [11];
    harness.backendClient.getCollectionJob.mockResolvedValue({
      job: {
        id: 11,
        itemId: '26882883164',
        nextAttemptAt,
        shopId: '1259293184',
        status: 'retry_wait',
        targetContextKey: 'extension:old-profile',
      },
      kind: 'success',
    });
    harness.backendClient.rebindCollectionJob.mockResolvedValue({
      job: {
        id: 11,
        nextAttemptAt,
        status: 'retry_wait',
        targetContextKey: 'extension:test-profile',
      },
      kind: 'success',
    });

    await harness.agent.pollNow();

    expect(harness.backendClient.rebindCollectionJob).toHaveBeenCalledWith(
      harness.store.state.settings,
      harness.store.state.auth,
      11,
      'extension:test-profile',
    );
    expect(harness.store.state.manualCollectionQueue).toEqual([11]);
    expect(harness.store.state.collectionStatus).toMatchObject({
      error: 'The manual collection moved to this Chrome profile.',
      jobId: 11,
      state: 'queued',
    });
    expect(harness.alarms.create).toHaveBeenCalledWith(COLLECTION_RETRY_ALARM_NAME, {
      when: expect.any(Number),
    });
  });

  it('persists checked-variant progress for the active collection tab', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    await harness.agent.poll();

    await harness.agent.progress({
      expectedVariantCount: 4,
      processedVariantCount: 2,
      tabId: 17,
    });

    expect(harness.store.state.collectionStatus).toMatchObject({
      expectedVariantCount: 4,
      itemId: '26882883164',
      processedVariantCount: 2,
      state: 'collecting',
    });
    expect(
      await harness.agent.progress({
        expectedVariantCount: 4,
        processedVariantCount: 3,
        tabId: 99,
      }),
    ).toEqual({ ignored: true });
  });

  it('notifies the user when the exact Chrome profile needs Shopee sign-in', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    harness.backendClient.failCollectionJob.mockResolvedValue({
      body: { data: { job: { status: 'waiting_auth' } } },
      kind: 'success',
    });
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
      state: 'waiting_auth',
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

  it('preserves a captured snapshot and the backend result when its tab closes during save', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    let resolveCompletion;
    harness.backendClient.completeCollectionJob.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCompletion = resolve;
        }),
    );
    await harness.agent.poll();
    const snapshot = {
      expectedVariantCount: 1,
      itemId: '26882883164',
      pricedVariantCount: 1,
      pricingContextKey: 'extension:test-profile',
      shopId: '1259293184',
      variants: [
        {
          availability: 'available',
          name: 'Default',
          priceObservation: { priceAmount: 199_000, status: 'observed' },
          stockQuantity: 12,
        },
      ],
    };
    const completion = harness.agent.complete({ snapshot, tabId: 17 });
    await vi.waitFor(() =>
      expect(harness.backendClient.completeCollectionJob).toHaveBeenCalledOnce(),
    );

    await expect(harness.agent.handleTabRemoved(17)).resolves.toEqual({
      pendingCompletion: true,
    });
    expect(harness.backendClient.failCollectionJob).not.toHaveBeenCalled();
    expect(harness.store.state.activeCollection).toMatchObject({
      pendingSnapshot: snapshot,
      tabId: null,
    });

    resolveCompletion({
      error: 'The backend rejected the captured snapshot',
      kind: 'permanent',
    });
    await completion;

    expect(harness.backendClient.failCollectionJob).not.toHaveBeenCalled();
    expect(harness.store.state.activeCollection).toBeNull();
    expect(harness.store.state.collectionStatus).toMatchObject({
      error: 'The backend rejected the captured snapshot',
      state: 'failed',
    });
  });

  it('reports a temporary tab that the user closes before collection finishes', async () => {
    const harness = createHarness({ settings: { backgroundCollectionEnabled: true } });
    harness.backendClient.claimCollectionJob.mockResolvedValue({ claim: claim(), kind: 'success' });
    await harness.agent.poll();
    await harness.agent.handleTabRemoved(17);

    expect(harness.backendClient.failCollectionJob).toHaveBeenCalledWith(
      harness.store.state.settings,
      harness.store.state.auth,
      11,
      'a'.repeat(64),
      ERROR_CODES.TAB_CLOSED_PREMATURELY,
      expect.any(String),
    );
    expect(harness.tabs.remove).not.toHaveBeenCalled();
    expect(harness.store.state.activeCollection).toBeNull();
  });
});
