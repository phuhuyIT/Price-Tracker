import { createSuccessResponse } from '../utils/apiResponse.js';

/**
 * Create thin owner-scoped product HTTP adapters.
 *
 * @param {object} services
 */
export function createProductController(services) {
  return Object.freeze({
    /** Delete a tracked product and its cascaded records. */
    deleteProduct(request, response) {
      const result = services.productManagement.deleteProduct({
        ownerUserId: request.auth.user.id,
        productId: request.validated.params.productId,
      });
      response.json(createSuccessResponse(result));
    },

    /** Return one complete owner-scoped product. */
    getProduct(request, response) {
      const product = services.productQuery.getProduct({
        ownerUserId: request.auth.user.id,
        productId: request.validated.params.productId,
      });
      response.json(createSuccessResponse(product));
    },

    /** Return chart-ready, filterable history. */
    getProductHistory(request, response) {
      const history = services.productQuery.getHistory({
        ...request.validated.query,
        ownerUserId: request.auth.user.id,
        productId: request.validated.params.productId,
      });
      response.json(createSuccessResponse(history));
    },

    /** Return one owner-scoped product page and pagination metadata. */
    listProducts(request, response) {
      const result = services.productQuery.listProducts({
        ...request.validated.query,
        ownerUserId: request.auth.user.id,
      });
      response.json(createSuccessResponse(result.items, { pagination: result.pagination }));
    },

    /** Run an injected anonymous collector for one known product. */
    async refreshProduct(request, response) {
      const result = await services.productCollection.refreshProduct({
        ownerUserId: request.auth.user.id,
        productId: request.validated.params.productId,
      });
      response.json(
        createSuccessResponse({
          created: result.created,
          product: result.product,
        }),
      );
    },

    /** Persist one sanitised extension snapshot. */
    saveSnapshot(request, response) {
      const result = services.tracking.saveSnapshot({
        ownerUserId: request.auth.user.id,
        snapshot: request.body,
      });
      response.status(result.created ? 201 : 200).json(
        createSuccessResponse({
          created: result.created,
          product: result.product,
        }),
      );
    },

    /** Return an existing URL or collect a new anonymous product. */
    async trackProduct(request, response) {
      const result = await services.productCollection.trackProduct({
        ownerUserId: request.auth.user.id,
        url: request.validated.body.url,
      });
      response.status(result.created ? 201 : 200).json(
        createSuccessResponse({
          created: result.created,
          product: result.product,
        }),
      );
    },

    /** Update pause/resume state or the alert threshold. */
    updateProduct(request, response) {
      const product = services.productManagement.updateProduct({
        ...request.validated.body,
        ownerUserId: request.auth.user.id,
        productId: request.validated.params.productId,
      });
      response.json(createSuccessResponse(product));
    },
  });
}
