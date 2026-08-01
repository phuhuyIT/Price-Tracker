import { ERROR_CODES } from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';

function productNotFound() {
  return new AppError({
    code: ERROR_CODES.PRODUCT_NOT_FOUND,
    message: 'The tracked product was not found',
    statusCode: 404,
  });
}

/**
 * Create owner-scoped product mutation business logic.
 *
 * @param {object} input
 * @param {object} input.productQueryService
 * @param {object} input.repositories
 */
export function createProductManagementService({ productQueryService, repositories }) {
  return Object.freeze({
    /**
     * Delete one product and its foreign-key-cascaded records.
     */
    deleteProduct({ ownerUserId, productId }) {
      const deleted = repositories.products.delete({ ownerUserId, productId });

      if (!deleted) {
        throw productNotFound();
      }

      return { deleted: true, productId };
    },

    /**
     * Change supported settings without exposing repository rows.
     */
    updateProduct({ alertThresholdPercent, ownerUserId, productId, status }) {
      const updated = repositories.products.updateSettings({
        alertThresholdPercent,
        ownerUserId,
        productId,
        status,
      });

      if (!updated) {
        throw productNotFound();
      }

      return productQueryService.getProduct({ ownerUserId, productId });
    },
  });
}
