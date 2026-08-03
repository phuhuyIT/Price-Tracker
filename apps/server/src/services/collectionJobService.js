import { createHash, randomBytes } from 'node:crypto';

import {
  ERROR_CODES,
  getShopeeProductIdentity,
  PRICING_CONTEXTS,
  SNAPSHOT_SOURCES,
} from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';

function leaseHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function publicJob(job) {
  return {
    canonicalUrl: job.canonicalUrl,
    claimedContextKey: job.claimedContextKey,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    id: job.id,
    itemId: job.itemId,
    jobType: job.jobType,
    leaseExpiresAt: job.leaseExpiresAt,
    productId: job.productId,
    shopId: job.shopId,
    status: job.status,
    targetContextKey: job.targetContextKey,
    updatedAt: job.updatedAt,
  };
}

function jobNotFound() {
  return new AppError({
    code: ERROR_CODES.COLLECTION_JOB_NOT_FOUND,
    message: 'The collection job was not found',
    statusCode: 404,
  });
}

function invalidLease() {
  return new AppError({
    code: ERROR_CODES.COLLECTION_LEASE_INVALID,
    message: 'The collection lease is invalid or expired',
    statusCode: 409,
  });
}

/** Coordinate persistent extension collection jobs and lease ownership. */
export function createCollectionJobService({
  clock = () => new Date(),
  leaseMs,
  repositories,
  tokenFactory = () => randomBytes(32).toString('hex'),
  trackingService,
}) {
  function now() {
    const value = clock();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  function requireClaim({ jobId, leaseToken, ownerUserId, updatedAt }) {
    const job = repositories.collectionJobs.findValidClaim({
      jobId,
      leaseTokenHash: leaseHash(leaseToken),
      ownerUserId,
      updatedAt,
    });

    if (!job) {
      throw invalidLease();
    }

    return job;
  }

  return Object.freeze({
    claimNext({ ownerUserId, pricingContextKey }) {
      const leaseToken = tokenFactory();
      const updatedAt = now();
      const leaseExpiresAt = new Date(Date.parse(updatedAt) + leaseMs).toISOString();
      const job = repositories.collectionJobs.claimNext({
        leaseExpiresAt,
        leaseTokenHash: leaseHash(leaseToken),
        ownerUserId,
        pricingContextKey,
        updatedAt,
      });

      return job ? { job: publicJob(job), leaseToken } : null;
    },

    complete({ jobId, leaseToken, ownerUserId, snapshot }) {
      const updatedAt = now();
      return repositories.transaction((transactionRepositories) => {
        const job = transactionRepositories.collectionJobs.findValidClaim({
          jobId,
          leaseTokenHash: leaseHash(leaseToken),
          ownerUserId,
          updatedAt,
        });

        if (!job) {
          throw invalidLease();
        }

        const identity = getShopeeProductIdentity(snapshot?.canonicalUrl);

        if (
          snapshot?.source !== SNAPSHOT_SOURCES.EXTENSION ||
          snapshot?.pricingContext !== PRICING_CONTEXTS.USER_SESSION ||
          snapshot?.pricingContextKey !== job.targetContextKey ||
          identity?.shopId !== job.shopId ||
          identity?.itemId !== job.itemId
        ) {
          throw new AppError({
            code: ERROR_CODES.INVALID_SHOPEE_PAYLOAD,
            message: 'The snapshot does not match the claimed collection job and Chrome profile',
            statusCode: 422,
          });
        }

        const tracked = trackingService.saveSnapshot({
          ownerUserId,
          repositoryScope: transactionRepositories,
          snapshot,
        });

        if (job.productId !== null && tracked.product.id !== job.productId) {
          throw new AppError({
            code: ERROR_CODES.INVALID_SHOPEE_PAYLOAD,
            message: 'The snapshot does not belong to the product being refreshed',
            statusCode: 422,
          });
        }

        const completed = transactionRepositories.collectionJobs.complete({
          jobId,
          leaseTokenHash: leaseHash(leaseToken),
          ownerUserId,
          productId: tracked.product.id,
          updatedAt,
        });

        if (!completed) {
          throw invalidLease();
        }

        return { job: publicJob(completed), product: tracked.product };
      });
    },

    create(input) {
      const existing = repositories.collectionJobs.findActiveByIdentity(input);

      if (existing) {
        return { created: false, job: publicJob(existing) };
      }

      const createdAt = now();
      const job = repositories.collectionJobs.create({ ...input, createdAt });
      return { created: true, job: publicJob(job) };
    },

    fail({ errorCode, errorMessage, jobId, leaseToken, ownerUserId }) {
      const updatedAt = now();
      requireClaim({ jobId, leaseToken, ownerUserId, updatedAt });
      const failed = repositories.collectionJobs.fail({
        errorCode,
        errorMessage,
        jobId,
        leaseTokenHash: leaseHash(leaseToken),
        ownerUserId,
        updatedAt,
      });

      if (!failed) {
        throw invalidLease();
      }

      return publicJob(failed);
    },

    get({ jobId, ownerUserId }) {
      const job = repositories.collectionJobs.findById({ jobId, ownerUserId });

      if (!job) {
        throw jobNotFound();
      }

      return publicJob(job);
    },
  });
}
