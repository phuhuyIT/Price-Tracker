import express from 'express';

import {
  collectionJobClaimRequestSchema,
  collectionJobCompleteRequestSchema,
  collectionJobFailureRequestSchema,
  collectionJobIdParamsSchema,
  collectionJobRebindRequestSchema,
} from '@shopee-price-tracker/shared';

import { createCollectionJobController } from '../controllers/collectionJobController.js';
import { createOwnershipMiddleware } from '../middleware/authentication.js';
import { createMutationRateLimit } from '../middleware/rateLimit.js';
import { rejectUnsafeSnapshot } from '../middleware/snapshotPrivacy.js';
import { validateRequest } from '../middleware/validateRequest.js';

/** Create extension-facing, owner-scoped collection-job routes. */
export function createCollectionJobRoutes({ applicationConfig, services }) {
  const router = express.Router();
  const controller = createCollectionJobController(services);
  const resolveOwner = createOwnershipMiddleware({
    authConfig: applicationConfig.auth,
    authenticationService: services.authentication,
  });
  const mutationRateLimit = createMutationRateLimit(applicationConfig.rateLimit);
  const validateJobId = validateRequest({ params: collectionJobIdParamsSchema });

  router.use(resolveOwner);
  router.get('/', controller.list);
  router.post(
    '/claim',
    mutationRateLimit,
    validateRequest({ body: collectionJobClaimRequestSchema }),
    controller.claim,
  );
  router.post(
    '/:jobId/complete',
    mutationRateLimit,
    validateJobId,
    rejectUnsafeSnapshot,
    validateRequest({ body: collectionJobCompleteRequestSchema }),
    controller.complete,
  );
  router.post(
    '/:jobId/fail',
    mutationRateLimit,
    validateJobId,
    validateRequest({ body: collectionJobFailureRequestSchema }),
    controller.fail,
  );
  router.post(
    '/:jobId/rebind',
    mutationRateLimit,
    validateJobId,
    validateRequest({ body: collectionJobRebindRequestSchema }),
    controller.rebind,
  );
  router.get('/:jobId', validateJobId, controller.get);

  return router;
}
