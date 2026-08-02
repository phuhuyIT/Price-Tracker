import { describe, expect, it, vi } from 'vitest';

import { createServiceWorkerQueue } from '../../../apps/extension/lib/serviceWorkerQueue.js';
import { STORAGE_KEYS } from '../../../apps/extension/lib/serviceWorkerStore.js';

function createMemoryStore(overrides = {}) {
  const state = {
    auth: { expiresAt: null, mode: 'disabled', token: null, user: null },
    backend: { checkedAt: null, error: null, status: 'unknown' },
    captures: {},
    lastSubmission: { at: null, error: null, productId: null, state: 'idle' },
    queue: [],
    settings: {
      automaticCapture: false,
      backendBaseUrl: 'http://127.0.0.1:3000',
      debugMode: false,
      pricingContextKey: 'extension:test-installation',
    },
    ...overrides,
  };
  const keyToProperty = {
    [STORAGE_KEYS.AUTH]: 'auth',
    [STORAGE_KEYS.BACKEND]: 'backend',
    [STORAGE_KEYS.LAST_SUBMISSION]: 'lastSubmission',
    [STORAGE_KEYS.LATEST_CAPTURES]: 'captures',
    [STORAGE_KEYS.QUEUE]: 'queue',
    [STORAGE_KEYS.SETTINGS]: 'settings',
  };

  return {
    async load() {
      return state;
    },
    async set(records) {
      for (const [key, value] of Object.entries(records)) {
        state[keyToProperty[key]] = value;
      }
    },
    state,
  };
}

function createQueueHarness({ backendResult, state } = {}) {
  const store = createMemoryStore(state);
  const backendClient = {
    submitSnapshot: vi.fn(
      async () =>
        backendResult ?? {
          body: { data: { product: { id: 17 } }, success: true },
          kind: 'success',
        },
    ),
  };
  const alarms = { clear: vi.fn(async () => true), create: vi.fn(async () => undefined) };
  const queue = createServiceWorkerQueue({ alarms, backendClient, store });
  return { alarms, backendClient, queue, store };
}

const snapshot = {
  capturedAt: '2026-08-01T00:00:00.000Z',
  itemId: '26882883164',
  shopId: '1259293184',
};

describe('service-worker queue persistence', () => {
  it('persists before sending and removes a successful record', async () => {
    const harness = createQueueHarness();
    const result = await harness.queue.enqueue(snapshot, 'semantic-hash');

    expect(result).toMatchObject({ added: true, queue: { total: 0 } });
    expect(harness.backendClient.submitSnapshot).toHaveBeenCalledWith(
      harness.store.state.settings,
      harness.store.state.auth,
      snapshot,
    );
    expect(harness.store.state.lastSubmission).toMatchObject({
      productId: 17,
      state: 'success',
    });
  });

  it('retains a temporary failure and schedules an alarm', async () => {
    const harness = createQueueHarness({
      backendResult: {
        error: 'Backend unavailable',
        errorCode: null,
        kind: 'temporary',
        status: null,
      },
    });
    await harness.queue.enqueue(snapshot, 'semantic-hash');

    expect(harness.store.state.queue).toEqual([
      expect.objectContaining({ attemptCount: 1, state: 'retry_wait' }),
    ]);
    expect(harness.alarms.create).toHaveBeenCalledOnce();
  });

  it('keeps auth failures blocked and removes the invalid local credential', async () => {
    const harness = createQueueHarness({
      backendResult: {
        error: 'Session revoked',
        errorCode: 'SESSION_REVOKED',
        kind: 'auth',
        status: 401,
      },
      state: {
        auth: {
          expiresAt: '2026-09-01T00:00:00.000Z',
          mode: 'enabled',
          token: 'secret-application-token',
          user: { email: 'owner@example.com', id: 2 },
        },
      },
    });
    await harness.queue.enqueue(snapshot, 'semantic-hash');

    expect(harness.store.state.queue[0].state).toBe('blocked_auth');
    expect(harness.store.state.auth).toMatchObject({ mode: 'enabled', token: null, user: null });
  });

  it('retains permanent failures without scheduling another attempt', async () => {
    const harness = createQueueHarness({
      backendResult: {
        error: 'Snapshot invalid',
        errorCode: 'INVALID_SHOPEE_PAYLOAD',
        kind: 'permanent',
        status: 422,
      },
    });
    await harness.queue.enqueue(snapshot, 'semantic-hash');

    expect(harness.store.state.queue[0]).toMatchObject({
      nextAttemptAt: null,
      state: 'failed_permanent',
    });
    expect(harness.alarms.create).not.toHaveBeenCalled();
  });

  it('stops at the retry bound and allows explicit dead-letter removal', async () => {
    const record = {
      attemptCount: 4,
      createdAt: '2026-08-01T00:00:00.000Z',
      id: 'queued-record',
      lastError: null,
      nextAttemptAt: 0,
      semanticHash: 'semantic-hash',
      snapshot,
      state: 'retry_wait',
    };
    const harness = createQueueHarness({
      backendResult: {
        error: 'Backend unavailable',
        errorCode: null,
        kind: 'temporary',
        status: null,
      },
      state: { queue: [record] },
    });
    await harness.queue.process();

    expect(harness.store.state.queue[0]).toMatchObject({
      attemptCount: 5,
      state: 'retry_exhausted',
    });
    expect(await harness.queue.clearFailed()).toMatchObject({ failed: 0, total: 0 });
  });
});
