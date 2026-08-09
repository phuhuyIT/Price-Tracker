import { createHash, randomBytes } from 'node:crypto';

import {
  COLLECTION_JOB_SOURCES,
  ERROR_CODES,
  getShopeeProductIdentity,
  PRICING_CONTEXTS,
  SNAPSHOT_SOURCES,
} from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';
import {
  calculateCollectionRetryDelayMs,
  classifyCollectionFailure,
} from './collectionRetryPolicy.js';

function leaseHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function publicJob(job) {
  return {
    attemptCount: job.attemptCount,
    canonicalUrl: job.canonicalUrl,
    claimedContextKey: job.claimedContextKey,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    id: job.id,
    itemId: job.itemId,
    jobSource: job.jobSource,
    jobType: job.jobType,
    leaseExpiresAt: job.leaseExpiresAt,
    nextAttemptAt: job.nextAttemptAt,
    productId: job.productId,
    shopId: job.shopId,
    status: job.status,
    targetContextKey: job.targetContextKey,
    updatedAt: job.updatedAt,
  };
}

function publicQueueJob(job) {
  return {
    ...publicJob(job),
    productTitle: job.productTitle,
  };
}

function activeJobSummary(jobs) {
  const summary = {
    claimed: 0,
    pending: 0,
    remaining: jobs.length,
    retryWait: 0,
    waitingAuth: 0,
  };

  for (const job of jobs) {
    const key =
      job.status === 'retry_wait'
        ? 'retryWait'
        : job.status === 'waiting_auth'
          ? 'waitingAuth'
          : job.status;
    summary[key] += 1;
  }

  return summary;
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

function persistFailedCheck({ errorCode, errorMessage, job, repositories, updatedAt }) {
  if (job.productId === null) {
    return null;
  }

  const created = repositories.prices.createCheck({
    checkedAt: updatedAt,
    errorCode,
    errorMessage,
    idempotencyKey: `collection-job-failure:${job.id}`,
    ownerUserId: job.ownerUserId,
    pricingContext: PRICING_CONTEXTS.USER_SESSION,
    pricingContextKey: job.targetContextKey,
    productId: job.productId,
    source: SNAPSHOT_SOURCES.EXTENSION,
    status: 'failed',
  });

  if (created.created) {
    repositories.products.recordFailedCheck({
      checkedAt: updatedAt,
      errorCode,
      errorMessage,
      ownerUserId: job.ownerUserId,
      productId: job.productId,
    });
  }

  return created.check;
}

/** Coordinate persistent extension collection jobs and lease ownership. */
export function createCollectionJobService({
  clock = () => new Date(),
  leaseMs,
  maxAttempts = 4,
  notificationService = null,
  random = Math.random,
  repositories,
  retryBaseDelayMs = 5_000,
  retryMaxDelayMs = 300_000,
  tokenFactory = () => randomBytes(32).toString('hex'),
  trackingService,
}) {
  function now() {
    const value = clock();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  function retryAt(job, updatedAt) {
    const delayMs = calculateCollectionRetryDelayMs({
      attempt: job.attemptCount,
      baseDelayMs: retryBaseDelayMs,
      maxDelayMs: retryMaxDelayMs,
      random,
    });
    return new Date(Date.parse(updatedAt) + delayMs).toISOString();
  }

  function recoverExpiredClaims({ ownerUserId } = {}) {
    const updatedAt = now();
    const expiredJobs = repositories.collectionJobs.findExpired({ ownerUserId, updatedAt });
    const summary = { failed: 0, retried: 0 };

    for (const job of expiredJobs) {
      repositories.transaction((transactionRepositories) => {
        const errorCode = ERROR_CODES.COLLECTION_TIMEOUT;
        const errorMessage = 'The extension collection lease expired before completion';

        if (job.attemptCount < maxAttempts) {
          const retried = transactionRepositories.collectionJobs.retryExpired({
            errorCode,
            errorMessage,
            jobId: job.id,
            nextAttemptAt: retryAt(job, updatedAt),
            updatedAt,
          });

          if (retried) {
            summary.retried += 1;
          }
          return;
        }

        const failed = transactionRepositories.collectionJobs.failExpired({
          errorCode,
          errorMessage,
          jobId: job.id,
          updatedAt,
        });

        if (failed) {
          persistFailedCheck({
            errorCode,
            errorMessage,
            job,
            repositories: transactionRepositories,
            updatedAt,
          });
          summary.failed += 1;
        }
      });
    }

    return summary;
  }

  return Object.freeze({
    claimNext({ jobId = null, ownerUserId, pricingContextKey, resumeWaitingAuth = false }) {
      recoverExpiredClaims({ ownerUserId });
      const updatedAt = now();
      const leaseToken = tokenFactory();
      const leaseExpiresAt = new Date(Date.parse(updatedAt) + leaseMs).toISOString();
      const job = repositories.collectionJobs.claimNext({
        jobId,
        leaseExpiresAt,
        leaseTokenHash: leaseHash(leaseToken),
        maxAttempts,
        ownerUserId,
        pricingContextKey,
        resumeWaitingAuth,
        updatedAt,
      });

      return job ? { job: publicJob(job), leaseToken } : null;
    },

    async complete({ jobId, leaseToken, ownerUserId, snapshot }) {
      const updatedAt = now();
      const result = repositories.transaction((transactionRepositories) => {
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

        return { job: publicJob(completed), product: tracked.product, trackingResult: tracked };
      });

      if (notificationService) {
        await notificationService.deliverTrackingResult(result.trackingResult);
      }

      return { job: result.job, product: result.product };
    },

    create(input) {
      const existing = repositories.collectionJobs.findActiveByIdentity(input);

      if (existing) {
        return { created: false, job: publicJob(existing) };
      }

      const createdAt = now();
      const job = repositories.collectionJobs.create({
        ...input,
        createdAt,
        jobSource: input.jobSource ?? COLLECTION_JOB_SOURCES.MANUAL,
      });
      return { created: true, job: publicJob(job) };
    },

    fail({ errorCode, errorMessage, jobId, leaseToken, ownerUserId }) {
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

        const failureType = classifyCollectionFailure(errorCode);
        let transitioned;

        if (failureType === 'waiting_auth') {
          transitioned = transactionRepositories.collectionJobs.waitForAuthentication({
            errorMessage,
            jobId,
            leaseTokenHash: leaseHash(leaseToken),
            ownerUserId,
            updatedAt,
          });
        } else if (failureType === 'retryable' && job.attemptCount < maxAttempts) {
          transitioned = transactionRepositories.collectionJobs.retry({
            errorCode,
            errorMessage,
            jobId,
            leaseTokenHash: leaseHash(leaseToken),
            nextAttemptAt: retryAt(job, updatedAt),
            ownerUserId,
            updatedAt,
          });
        } else {
          transitioned = transactionRepositories.collectionJobs.fail({
            errorCode,
            errorMessage,
            jobId,
            leaseTokenHash: leaseHash(leaseToken),
            ownerUserId,
            updatedAt,
          });

          if (transitioned) {
            persistFailedCheck({
              errorCode,
              errorMessage,
              job,
              repositories: transactionRepositories,
              updatedAt,
            });
          }
        }

        if (!transitioned) {
          throw invalidLease();
        }

        return publicJob(transitioned);
      });
    },

    get({ jobId, ownerUserId }) {
      const job = repositories.collectionJobs.findById({ jobId, ownerUserId });

      if (!job) {
        throw jobNotFound();
      }

      return publicJob(job);
    },

    listActive({ ownerUserId }) {
      const jobs = repositories.collectionJobs.listActive({ ownerUserId });

      return {
        jobs: jobs.map((job) => publicQueueJob(job)),
        summary: activeJobSummary(jobs),
      };
    },

    rebind({ jobId, ownerUserId, pricingContextKey }) {
      const updatedAt = now();
      const job = repositories.collectionJobs.rebind({
        jobId,
        ownerUserId,
        pricingContextKey,
        updatedAt,
      });

      if (job) {
        return publicJob(job);
      }

      if (!repositories.collectionJobs.findById({ jobId, ownerUserId })) {
        throw jobNotFound();
      }

      throw new AppError({
        code: ERROR_CODES.COLLECTION_LEASE_INVALID,
        message: 'Only an unclaimed active collection job can change Chrome profile',
        statusCode: 409,
      });
    },

    recoverExpiredClaims,
  });
}
