import {
  COLLECTION_JOB_TYPES,
  ERROR_CODES,
  canonicaliseShopeeProductUrl,
  getShopeeProductIdentity,
} from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';

function invalidUrl() {
  return new AppError({
    code: ERROR_CODES.INVALID_URL,
    message: 'A valid Shopee Vietnam product URL is required',
    statusCode: 400,
  });
}

/** Queue owner-scoped collection work for the installed Chrome extension. */
export function createProductCollectionService({
  collectionJobService,
  productQueryService,
  repositories,
}) {
  return Object.freeze({
    trackProduct({ ownerUserId, url }) {
      const identity = getShopeeProductIdentity(url);
      const canonicalUrl = canonicaliseShopeeProductUrl(url);

      if (!identity || !canonicalUrl) {
        throw invalidUrl();
      }

      const existing = repositories.products.findByIdentity({
        itemId: identity.itemId,
        ownerUserId,
        shopId: identity.shopId,
      });

      if (existing) {
        return {
          created: false,
          job: null,
          product: productQueryService.getProduct({ ownerUserId, productId: existing.id }),
          queued: false,
        };
      }

      const queued = collectionJobService.create({
        canonicalUrl,
        itemId: identity.itemId,
        jobType: COLLECTION_JOB_TYPES.TRACK,
        ownerUserId,
        productId: null,
        shopId: identity.shopId,
        targetContextKey: repositories.collectionJobs.findLatestTargetContextKey({
          itemId: identity.itemId,
          ownerUserId,
          shopId: identity.shopId,
        }),
      });

      return { ...queued, product: null, queued: true };
    },

    refreshProduct({ ownerUserId, productId }) {
      const product = productQueryService.getProduct({ ownerUserId, productId });
      const targetContextKey =
        repositories.collectionJobs.findLatestTargetContextKey({
          itemId: product.itemId,
          ownerUserId,
          shopId: product.shopId,
        }) ??
        repositories.prices.findLatestUserSessionContextKey({
          ownerUserId,
          productId,
        });
      const queued = collectionJobService.create({
        canonicalUrl: product.canonicalUrl,
        itemId: product.itemId,
        jobType: COLLECTION_JOB_TYPES.REFRESH,
        ownerUserId,
        productId,
        shopId: product.shopId,
        targetContextKey,
      });

      return { ...queued, product, queued: true };
    },
  });
}
