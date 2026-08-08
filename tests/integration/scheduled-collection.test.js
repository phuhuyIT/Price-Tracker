import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@shopee-price-tracker/shared';

import { createCollectionJobService } from '../../apps/server/src/services/collectionJobService.js';
import { createTrackingService } from '../../apps/server/src/services/trackingService.js';
import { createTestDatabase, createTestOwner, loadValidSnapshot } from './databaseTestUtils.js';

const LIFECYCLE_CONFIG = Object.freeze({
  massMissingConfirmations: 2,
  maxMissingRatio: 0.5,
  missingThreshold: 3,
});

let collectionJobs;
let currentTime;
let harness;
let owner;
let product;
let snapshot;

function setTime(value) {
  currentTime = value;
}

function queueRefresh() {
  return collectionJobs.create({
    canonicalUrl: product.canonicalUrl,
    itemId: product.itemId,
    jobSource: 'scheduler',
    jobType: 'refresh',
    ownerUserId: owner.id,
    productId: product.id,
    shopId: product.shopId,
    targetContextKey: snapshot.pricingContextKey,
  }).job;
}

function claim(resumeWaitingAuth = false) {
  return collectionJobs.claimNext({
    ownerUserId: owner.id,
    pricingContextKey: snapshot.pricingContextKey,
    resumeWaitingAuth,
  });
}

beforeEach(() => {
  harness = createTestDatabase();
  owner = createTestOwner(harness.repositories);
  currentTime = '2026-08-07T00:00:00.000Z';
  snapshot = loadValidSnapshot();
  snapshot.capturedAt = currentTime;
  const tracking = createTrackingService({
    clock: () => new Date(currentTime),
    lifecycleConfig: LIFECYCLE_CONFIG,
    priceDropThresholdPercent: 1,
    repositories: harness.repositories,
  });
  product = tracking.saveSnapshot({ ownerUserId: owner.id, snapshot }).product;
  collectionJobs = createCollectionJobService({
    clock: () => new Date(currentTime),
    leaseMs: 120_000,
    maxAttempts: 4,
    random: () => 0,
    repositories: harness.repositories,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 1_000,
    tokenFactory: () => 'a'.repeat(64),
    trackingService: tracking,
  });
});

afterEach(() => {
  harness.cleanup();
});

describe('scheduled collection outcomes', () => {
  it('waits for authentication without a failed check and resumes only explicitly', () => {
    const job = queueRefresh();
    const firstClaim = claim();
    const waiting = collectionJobs.fail({
      errorCode: ERROR_CODES.AUTHENTICATION_REQUIRED,
      errorMessage: 'Shopee sign-in is required',
      jobId: job.id,
      leaseToken: firstClaim.leaseToken,
      ownerUserId: owner.id,
    });

    expect(waiting).toMatchObject({
      attemptCount: 0,
      errorCode: ERROR_CODES.AUTHENTICATION_REQUIRED,
      status: 'waiting_auth',
    });
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM price_checks').get().count).toBe(
      1,
    );
    expect(claim()).toBeNull();

    for (let authenticationAttempt = 0; authenticationAttempt < 4; authenticationAttempt += 1) {
      const authenticationClaim = claim(true);
      expect(authenticationClaim.job).toMatchObject({ attemptCount: 1, id: job.id });
      expect(
        collectionJobs.fail({
          errorCode: ERROR_CODES.AUTHENTICATION_REQUIRED,
          errorMessage: 'Shopee sign-in is still required',
          jobId: job.id,
          leaseToken: authenticationClaim.leaseToken,
          ownerUserId: owner.id,
        }),
      ).toMatchObject({ attemptCount: 0, status: 'waiting_auth' });
    }

    const resumed = claim(true);
    expect(resumed.job).toMatchObject({ attemptCount: 1, id: job.id, status: 'claimed' });

    setTime('2026-08-07T00:00:01.000Z');
    const failed = collectionJobs.fail({
      errorCode: ERROR_CODES.PRODUCT_UNAVAILABLE,
      errorMessage: 'Shopee reports that the product is unavailable',
      jobId: job.id,
      leaseToken: resumed.leaseToken,
      ownerUserId: owner.id,
    });
    expect(failed.status).toBe('failed');
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM price_checks').get().count).toBe(
      2,
    );
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM price_logs').get().count).toBe(
      snapshot.pricedVariantCount,
    );
    expect(
      harness.repositories.products.findById({ ownerUserId: owner.id, productId: product.id }),
    ).toMatchObject({
      lastErrorCode: ERROR_CODES.PRODUCT_UNAVAILABLE,
      lastSuccessAt: '2026-08-07T00:00:00.000Z',
    });
  });

  it('uses four total attempts before persisting one terminal failed check', () => {
    const job = queueRefresh();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      setTime(`2026-08-07T00:00:0${attempt}.000Z`);
      const active = claim();
      expect(active.job.attemptCount).toBe(attempt);

      const result = collectionJobs.fail({
        errorCode: ERROR_CODES.RATE_LIMITED,
        errorMessage: 'Shopee rate limited the request',
        jobId: job.id,
        leaseToken: active.leaseToken,
        ownerUserId: owner.id,
      });

      expect(result.status).toBe(attempt < 4 ? 'retry_wait' : 'failed');
    }

    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM price_checks').get().count).toBe(
      2,
    );
    const failedCheck = harness.database
      .prepare("SELECT * FROM price_checks WHERE status = 'failed'")
      .get();
    expect(failedCheck).toMatchObject({
      error_code: ERROR_CODES.RATE_LIMITED,
      idempotency_key: `collection-job-failure:${job.id}`,
      pricing_context: 'user_session',
      source: 'extension',
    });
  });

  it('lists only active products for scheduler dispatch', () => {
    expect(harness.repositories.products.listActiveForScheduling()).toHaveLength(1);
    harness.repositories.products.updateSettings({
      ownerUserId: owner.id,
      productId: product.id,
      status: 'paused',
    });
    expect(harness.repositories.products.listActiveForScheduling()).toEqual([]);
  });
});
