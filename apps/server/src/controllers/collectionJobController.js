import { createSuccessResponse } from '../utils/apiResponse.js';

/** Create thin owner-scoped collection-job HTTP adapters. */
export function createCollectionJobController(services) {
  return Object.freeze({
    claim(request, response) {
      const result = services.collectionJobs.claimNext({
        jobId: request.validated.body.jobId,
        ownerUserId: request.auth.user.id,
        pricingContextKey: request.validated.body.pricingContextKey,
        resumeWaitingAuth: request.validated.body.resumeWaitingAuth,
      });
      response.json(createSuccessResponse(result));
    },

    async complete(request, response) {
      const result = await services.collectionJobs.complete({
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

    rebind(request, response) {
      const job = services.collectionJobs.rebind({
        jobId: request.validated.params.jobId,
        ownerUserId: request.auth.user.id,
        pricingContextKey: request.validated.body.pricingContextKey,
      });
      response.json(createSuccessResponse({ job }));
    },
  });
}
