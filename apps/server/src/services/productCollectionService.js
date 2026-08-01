import {
  ERROR_CODES,
  getShopeeProductIdentity,
  PRICING_CONTEXTS,
  SNAPSHOT_SOURCES,
} from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';

function invalidUrl() {
  return new AppError({
    code: ERROR_CODES.INVALID_URL,
    message: 'A valid Shopee Vietnam product URL is required',
    statusCode: 400,
  });
}

function collectorUnavailable() {
  return new AppError({
    code: ERROR_CODES.COLLECTOR_UNAVAILABLE,
    message: 'Anonymous collection will be available after the Phase 8 collector is installed',
    statusCode: 503,
  });
}

function assertCollectedIdentity(snapshot, expectedIdentity) {
  if (
    !snapshot ||
    snapshot.source !== SNAPSHOT_SOURCES.PLAYWRIGHT ||
    snapshot.pricingContext !== PRICING_CONTEXTS.ANONYMOUS ||
    snapshot.shopId !== expectedIdentity.shopId ||
    snapshot.itemId !== expectedIdentity.itemId
  ) {
    throw new AppError({
      code: ERROR_CODES.INVALID_SHOPEE_PAYLOAD,
      message: 'The anonymous collector returned a snapshot for an unexpected product or context',
      statusCode: 422,
    });
  }
}

/**
 * Coordinate URL tracking and manual refresh around an injected anonymous
 * collector. Phase 8 supplies `collectProduct`; Phase 6 keeps the HTTP contract
 * stable while reporting that the collector is unavailable.
 *
 * @param {object} input
 * @param {((url: string) => Promise<unknown>) | null} [input.collectProduct]
 * @param {object} input.productQueryService
 * @param {object} input.repositories
 * @param {object} input.trackingService
 */
export function createProductCollectionService({
  collectProduct = null,
  productQueryService,
  repositories,
  trackingService,
}) {
  const activeRefreshes = new Set();

  async function collectAndSave({ identity, ownerUserId, url }) {
    if (typeof collectProduct !== 'function') {
      throw collectorUnavailable();
    }

    const snapshot = await collectProduct(url);
    assertCollectedIdentity(snapshot, identity);

    return trackingService.saveSnapshot({ ownerUserId, snapshot });
  }

  return Object.freeze({
    /**
     * Return an already tracked URL without invoking the collector, otherwise
     * collect and persist its first anonymous snapshot.
     */
    async trackProduct({ ownerUserId, url }) {
      const identity = getShopeeProductIdentity(url);

      if (!identity) {
        throw invalidUrl();
      }

      const existing = repositories.products.findByIdentity({
        itemId: identity.itemId,
        ownerUserId,
        shopId: identity.shopId,
      });

      if (existing) {
        return {
          check: null,
          comparisons: [],
          created: false,
          product: productQueryService.getProduct({
            ownerUserId,
            productId: existing.id,
          }),
        };
      }

      return collectAndSave({ identity, ownerUserId, url });
    },

    /**
     * Run at most one manual anonymous refresh for an owner/product pair.
     */
    async refreshProduct({ ownerUserId, productId }) {
      const product = productQueryService.getProduct({ ownerUserId, productId });
      const refreshKey = `${ownerUserId}:${productId}`;

      if (activeRefreshes.has(refreshKey)) {
        throw new AppError({
          code: ERROR_CODES.REFRESH_IN_PROGRESS,
          message: 'A refresh is already running for this product',
          statusCode: 409,
        });
      }

      if (typeof collectProduct !== 'function') {
        throw collectorUnavailable();
      }

      const identity = {
        itemId: product.itemId,
        shopId: product.shopId,
      };

      activeRefreshes.add(refreshKey);

      try {
        return await collectAndSave({
          identity,
          ownerUserId,
          url: product.canonicalUrl,
        });
      } finally {
        activeRefreshes.delete(refreshKey);
      }
    },
  });
}
