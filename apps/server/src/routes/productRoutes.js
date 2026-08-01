import express from 'express';

import {
  emptyRequestBodySchema,
  ERROR_CODES,
  productHistoryQuerySchema,
  productIdParamsSchema,
  productListQuerySchema,
  trackProductRequestSchema,
  updateProductRequestSchema,
} from '@shopee-price-tracker/shared';

import { createProductController } from '../controllers/productController.js';
import { createOwnershipMiddleware } from '../middleware/authentication.js';
import { createMutationRateLimit } from '../middleware/rateLimit.js';
import { rejectUnsafeSnapshot } from '../middleware/snapshotPrivacy.js';
import { validateRequest } from '../middleware/validateRequest.js';

/** Create owner-scoped product routes. */
export function createProductRoutes({ applicationConfig, services }) {
  const router = express.Router();
  const controller = createProductController(services);
  const mutationRateLimit = createMutationRateLimit(applicationConfig.rateLimit);
  const resolveOwner = createOwnershipMiddleware({
    authConfig: applicationConfig.auth,
    authenticationService: services.authentication,
  });
  const validateProductId = validateRequest({ params: productIdParamsSchema });

  router.use((request, response, next) => {
    if (['POST', 'PATCH', 'DELETE'].includes(request.method)) {
      mutationRateLimit(request, response, next);
      return;
    }

    next();
  });
  router.use(resolveOwner);

  router.post(
    '/track',
    validateRequest(
      { body: trackProductRequestSchema },
      {
        code: ERROR_CODES.INVALID_URL,
        message: 'A valid Shopee Vietnam product URL is required',
      },
    ),
    controller.trackProduct,
  );
  router.post('/snapshot', rejectUnsafeSnapshot, controller.saveSnapshot);
  router.get('/', validateRequest({ query: productListQuerySchema }), controller.listProducts);
  router.get(
    '/:productId/history',
    validateProductId,
    validateRequest({ query: productHistoryQuerySchema }),
    controller.getProductHistory,
  );
  router.post(
    '/:productId/refresh',
    validateProductId,
    validateRequest({ body: emptyRequestBodySchema }),
    controller.refreshProduct,
  );
  router.patch(
    '/:productId',
    validateProductId,
    validateRequest({ body: updateProductRequestSchema }),
    controller.updateProduct,
  );
  router.delete(
    '/:productId',
    validateProductId,
    validateRequest({ body: emptyRequestBodySchema }),
    controller.deleteProduct,
  );
  router.get('/:productId', validateProductId, controller.getProduct);

  return router;
}
