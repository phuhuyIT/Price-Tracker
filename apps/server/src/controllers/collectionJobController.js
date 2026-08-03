import { createSuccessResponse } from '../utils/apiResponse.js';

/** Create thin owner-scoped collection-job HTTP adapters. */
export function createCollectionJobController(services) {
  return Object.freeze({
    claim(request, response) {
      const result = services.collectionJobs.claimNext({
        ownerUserId: request.auth.user.id,
        pricingContextKey: request.validated.body.pricingContextKey,
      });
      response.json(createSuccessResponse(result));
    },

    complete(request, response) {
      const result = services.collectionJobs.complete({
        jobId: request.validated.params.jobId,
        leaseToken: request.validated.body.leaseToken,
        ownerUserId: request.auth.user.id,
        snapshot: request.validated.body.snapshot,
      });
      response.json(createSuccessResponse(result));
    },

    fail(request, response) {
      const job = services.collectionJobs.fail({
        ...request.validated.body,
        jobId: request.validated.params.jobId,
        ownerUserId: request.auth.user.id,
      });
      response.json(createSuccessResponse({ job }));
    },

    get(request, response) {
      const job = services.collectionJobs.get({
        jobId: request.validated.params.jobId,
        ownerUserId: request.auth.user.id,
      });
      response.json(createSuccessResponse({ job }));
    },
  });
}
