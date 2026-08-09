import { describe, expect, it, vi } from 'vitest';

import {
  createProductPinsService,
  normalisePinnedProductIds,
  normalisePinnedProductScopes,
  PINNED_PRODUCT_LIMIT,
  productPinScope,
  selectPopupProducts,
  togglePinnedProductId,
} from '../../../apps/extension/lib/productPins.js';

function product(id, overrides = {}) {
  return {
    availability: 'available',
    canonicalUrl: `https://shopee.vn/tracked-product-i.10.${id}`,
    currentLowestPrice: { priceAmount: id * 10_000 },
    id,
    lastSuccessAt: '2026-08-09T02:00:00.000Z',
    title: `Tracked product ${id}`,
    trackingStatus: 'active',
    ...overrides,
  };
}

function createHarness({ pinnedProductIds = [] } = {}) {
  const scope = 'http://127.0.0.1:3000|local';
  const state = {
    auth: { mode: 'disabled', token: null, user: null },
    pinnedProductsByScope: { [scope]: pinnedProductIds },
    settings: { backendBaseUrl: 'http://127.0.0.1:3000' },
  };
  const store = {
    load: vi.fn(async () => structuredClone(state)),
    set: vi.fn(async (records) => Object.assign(state, records)),
  };
  const backendClient = {
    getProduct: vi.fn(),
    listProducts: vi.fn(),
  };

  return {
    backendClient,
    service: createProductPinsService({ backendClient, store }),
    state,
    store,
  };
}

describe('extension popup product pins', () => {
  it('repairs persisted IDs, scopes them by backend owner, and enforces five pins', () => {
    expect(normalisePinnedProductIds([3, '3', -1, 2, 1, 4, 5, 6])).toEqual([3, 2, 1, 4, 5]);
    expect(normalisePinnedProductScopes({ scope: [2, 2, 1], unsafe: 'nope' })).toEqual({
      scope: [2, 1],
      unsafe: [],
    });
    expect(
      productPinScope({
        auth: { mode: 'enabled', user: { id: 7 } },
        settings: { backendBaseUrl: 'https://tracker.example.com' },
      }),
    ).toBe('https://tracker.example.com|user:7');

    expect(togglePinnedProductId([2, 1], 3)).toEqual([3, 2, 1]);
    expect(togglePinnedProductId([3, 2, 1], 2)).toEqual([3, 1]);
    expect(() => togglePinnedProductId([1, 2, 3, 4, 5], 6)).toThrow(
      `You can pin up to ${PINNED_PRODUCT_LIMIT} products`,
    );
  });

  it('shows pinned products first and fills the remaining positions with recent products', () => {
    const selected = selectPopupProducts(
      [product(1), product(2), product(3), product(4), product(5), product(8)],
      [8, 2],
    );

    expect(selected.map(({ id, listReason }) => [id, listReason])).toEqual([
      [8, 'pinned'],
      [2, 'pinned'],
      [1, 'recent'],
      [3, 'recent'],
      [4, 'recent'],
    ]);
  });

  it('loads older pins separately and removes pins for products deleted from the backend', async () => {
    const harness = createHarness({ pinnedProductIds: [9, 8, 2] });
    harness.backendClient.listProducts.mockResolvedValue({
      kind: 'success',
      products: [product(1), product(2), product(3), product(4), product(5)],
    });
    harness.backendClient.getProduct.mockImplementation(async (_settings, _auth, productId) => {
      if (productId === 9) {
        return { error: 'Not found', kind: 'permanent', status: 404 };
      }

      return { kind: 'success', product: product(productId) };
    });

    const result = await harness.service.loadShortlist();

    expect(result.pinnedProductIds).toEqual([8, 2]);
    expect(result.items.map(({ id }) => id)).toEqual([8, 2, 1, 3, 4]);
    expect(harness.backendClient.getProduct).toHaveBeenCalledTimes(2);
    expect(harness.state.pinnedProductsByScope).toEqual({
      'http://127.0.0.1:3000|local': [8, 2],
    });
  });

  it('reuses watchlist-wide backend search and identifies results that are already pinned', async () => {
    const harness = createHarness({ pinnedProductIds: [4] });
    harness.backendClient.listProducts.mockResolvedValue({
      kind: 'success',
      products: [product(4), product(7)],
    });

    const result = await harness.service.searchProducts('  coffee  ');

    expect(harness.backendClient.listProducts).toHaveBeenCalledWith(
      harness.state.settings,
      harness.state.auth,
      { limit: 8, search: 'coffee' },
    );
    expect(result.items.map(({ id, isPinned }) => [id, isPinned])).toEqual([
      [4, true],
      [7, false],
    ]);
  });

  it('verifies ownership before persisting a new pin', async () => {
    const harness = createHarness({ pinnedProductIds: [2] });
    harness.backendClient.getProduct.mockResolvedValue({ kind: 'success', product: product(7) });

    const result = await harness.service.toggleProductPin(7);

    expect(result.pinnedProductIds).toEqual([7, 2]);
    expect(harness.backendClient.getProduct).toHaveBeenCalledWith(
      harness.state.settings,
      harness.state.auth,
      7,
    );
    expect(harness.state.pinnedProductsByScope).toEqual({
      'http://127.0.0.1:3000|local': [7, 2],
    });
  });
});
