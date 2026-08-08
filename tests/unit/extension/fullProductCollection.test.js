import { describe, expect, it, vi } from 'vitest';

import { createFullProductCollectionCoordinator } from '../../../apps/extension/lib/fullProductCollection.js';

function createHarness() {
  const state = {
    auth: { mode: 'disabled', token: null },
    settings: { backendBaseUrl: 'http://127.0.0.1:3000' },
  };
  const backendClient = {
    refreshProduct: vi.fn(),
    trackProduct: vi.fn(),
  };
  const backgroundCollection = {
    pollNow: vi.fn(async (jobId) => ({ jobId, state: 'collecting' })),
  };
  const store = { load: vi.fn(async () => state) };
  const coordinator = createFullProductCollectionCoordinator({
    backendClient,
    backgroundCollection,
    store,
  });

  return { backendClient, backgroundCollection, coordinator, state };
}

describe('full product collection coordinator', () => {
  it('starts the exact job returned for a new product', async () => {
    const harness = createHarness();
    const job = { id: 31, status: 'pending' };
    harness.backendClient.trackProduct.mockResolvedValue({
      body: { data: { job, product: null, queued: true }, success: true },
      kind: 'success',
    });

    const result = await harness.coordinator.start(
      'https://shopee.vn/product-i.1259293184.26882883164',
    );

    expect(harness.backendClient.refreshProduct).not.toHaveBeenCalled();
    expect(harness.backgroundCollection.pollNow).toHaveBeenCalledWith(31);
    expect(result).toMatchObject({ collection: { state: 'collecting' }, job });
  });

  it('queues a refresh before collecting an existing product', async () => {
    const harness = createHarness();
    const product = { id: 9 };
    const job = { id: 32, status: 'pending' };
    harness.backendClient.trackProduct.mockResolvedValue({
      body: { data: { job: null, product, queued: false }, success: true },
      kind: 'success',
    });
    harness.backendClient.refreshProduct.mockResolvedValue({
      body: { data: { job, product, queued: true }, success: true },
      kind: 'success',
    });

    await harness.coordinator.start('https://shopee.vn/product-i.1259293184.26882883164');

    expect(harness.backendClient.refreshProduct).toHaveBeenCalledWith(
      harness.state.settings,
      harness.state.auth,
      9,
    );
    expect(harness.backgroundCollection.pollNow).toHaveBeenCalledWith(32);
  });

  it('surfaces a backend queue failure without starting collection', async () => {
    const harness = createHarness();
    harness.backendClient.trackProduct.mockResolvedValue({
      error: 'Price tracker sign-in is required',
      errorCode: 'AUTHENTICATION_REQUIRED',
      kind: 'auth',
    });

    await expect(
      harness.coordinator.start('https://shopee.vn/product-i.1259293184.26882883164'),
    ).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Price tracker sign-in is required',
    });
    expect(harness.backgroundCollection.pollNow).not.toHaveBeenCalled();
  });
});
