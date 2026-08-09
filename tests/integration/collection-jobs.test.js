import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../apps/server/src/db/connection.js';
import { createRepositories } from '../../apps/server/src/repositories/index.js';
import { createTestDatabase, createTestOwner } from './databaseTestUtils.js';

let harness;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

function createPendingJob(repositories, ownerUserId, overrides = {}) {
  return repositories.collectionJobs.create({
    canonicalUrl: 'https://shopee.vn/product-i.1259293184.26882883164',
    createdAt: '2026-08-02T00:00:00.000Z',
    itemId: '26882883164',
    jobSource: 'manual',
    jobType: 'track',
    ownerUserId,
    productId: null,
    shopId: '1259293184',
    targetContextKey: null,
    ...overrides,
  });
}

describe('collection-job persistence', () => {
  it('keeps queued work across a database restart', () => {
    harness = createTestDatabase();
    const owner = createTestOwner(harness.repositories);
    const created = createPendingJob(harness.repositories, owner.id);
    harness.database.close();

    const reopenedDatabase = openDatabase(harness.databasePath);

    try {
      const reopenedRepositories = createRepositories(reopenedDatabase);
      expect(
        reopenedRepositories.collectionJobs.findById({
          jobId: created.id,
          ownerUserId: owner.id,
        }),
      ).toMatchObject({ id: created.id, status: 'pending' });
    } finally {
      reopenedDatabase.close();
    }
  });

  it('retries expired leases without allowing another Chrome profile to take the job', () => {
    harness = createTestDatabase();
    const owner = createTestOwner(harness.repositories);
    const created = createPendingJob(harness.repositories, owner.id);
    const firstClaim = harness.repositories.collectionJobs.claimNext({
      leaseExpiresAt: '2026-08-02T00:02:00.000Z',
      leaseTokenHash: '1'.repeat(64),
      maxAttempts: 4,
      ownerUserId: owner.id,
      pricingContextKey: 'extension:profile-a',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });

    expect(firstClaim).toMatchObject({
      attemptCount: 1,
      id: created.id,
      status: 'claimed',
      targetContextKey: 'extension:profile-a',
    });

    expect(
      harness.repositories.collectionJobs.findExpired({
        ownerUserId: owner.id,
        updatedAt: '2026-08-02T00:03:00.000Z',
      }),
    ).toHaveLength(1);
    harness.repositories.collectionJobs.retryExpired({
      errorCode: 'COLLECTION_TIMEOUT',
      errorMessage: 'The lease expired',
      jobId: created.id,
      nextAttemptAt: '2026-08-02T00:03:01.000Z',
      updatedAt: '2026-08-02T00:03:00.000Z',
    });

    const wrongProfile = harness.repositories.collectionJobs.claimNext({
      leaseExpiresAt: '2026-08-02T00:05:00.000Z',
      leaseTokenHash: '2'.repeat(64),
      maxAttempts: 4,
      ownerUserId: owner.id,
      pricingContextKey: 'extension:profile-b',
      updatedAt: '2026-08-02T00:03:01.000Z',
    });
    expect(wrongProfile).toBeNull();

    const reclaimed = harness.repositories.collectionJobs.claimNext({
      leaseExpiresAt: '2026-08-02T00:05:00.000Z',
      leaseTokenHash: '3'.repeat(64),
      maxAttempts: 4,
      ownerUserId: owner.id,
      pricingContextKey: 'extension:profile-a',
      updatedAt: '2026-08-02T00:03:01.000Z',
    });
    expect(reclaimed).toMatchObject({
      attemptCount: 2,
      id: created.id,
      status: 'claimed',
      targetContextKey: 'extension:profile-a',
    });
  });

  it('moves only an unclaimed active job after an explicit profile reassignment', () => {
    harness = createTestDatabase();
    const owner = createTestOwner(harness.repositories);
    const created = createPendingJob(harness.repositories, owner.id);
    const bound = harness.repositories.collectionJobs.rebind({
      jobId: created.id,
      ownerUserId: owner.id,
      pricingContextKey: 'extension:profile-a',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(bound).toMatchObject({ status: 'pending', targetContextKey: 'extension:profile-a' });

    harness.repositories.collectionJobs.claimNext({
      leaseExpiresAt: '2026-08-02T00:02:00.000Z',
      leaseTokenHash: '1'.repeat(64),
      maxAttempts: 4,
      ownerUserId: owner.id,
      pricingContextKey: 'extension:profile-a',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(
      harness.repositories.collectionJobs.rebind({
        jobId: created.id,
        ownerUserId: owner.id,
        pricingContextKey: 'extension:profile-b',
        updatedAt: '2026-08-02T00:01:00.000Z',
      }),
    ).toBeNull();

    harness.repositories.collectionJobs.retryExpired({
      errorCode: 'COLLECTION_TIMEOUT',
      errorMessage: 'The lease expired',
      jobId: created.id,
      nextAttemptAt: '2026-08-02T00:03:01.000Z',
      updatedAt: '2026-08-02T00:03:00.000Z',
    });
    const moved = harness.repositories.collectionJobs.rebind({
      jobId: created.id,
      ownerUserId: owner.id,
      pricingContextKey: 'extension:profile-b',
      updatedAt: '2026-08-02T00:03:00.500Z',
    });
    expect(moved).toMatchObject({
      attemptCount: 1,
      status: 'retry_wait',
      targetContextKey: 'extension:profile-b',
    });

    expect(
      harness.repositories.collectionJobs.claimNext({
        leaseExpiresAt: '2026-08-02T00:05:00.000Z',
        leaseTokenHash: '2'.repeat(64),
        maxAttempts: 4,
        ownerUserId: owner.id,
        pricingContextKey: 'extension:profile-b',
        updatedAt: '2026-08-02T00:03:01.000Z',
      }),
    ).toMatchObject({ status: 'claimed', targetContextKey: 'extension:profile-b' });
  });

  it('lists only active collection jobs owned by the requested user', () => {
    harness = createTestDatabase();
    const owner = createTestOwner(harness.repositories, 'queue-owner@example.com');
    const otherOwner = createTestOwner(harness.repositories, 'other-queue-owner@example.com');
    const active = createPendingJob(harness.repositories, owner.id);
    const terminal = createPendingJob(harness.repositories, owner.id, {
      canonicalUrl: 'https://shopee.vn/terminal-i.1259293184.26882883165',
      itemId: '26882883165',
    });
    createPendingJob(harness.repositories, otherOwner.id);
    harness.repositories.collectionJobs.claimNext({
      jobId: terminal.id,
      leaseExpiresAt: '2026-08-02T00:02:00.000Z',
      leaseTokenHash: '4'.repeat(64),
      maxAttempts: 4,
      ownerUserId: owner.id,
      pricingContextKey: 'extension:profile-a',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
    harness.repositories.collectionJobs.fail({
      errorCode: 'PRODUCT_NOT_FOUND',
      errorMessage: 'The product was not found',
      jobId: terminal.id,
      leaseTokenHash: '4'.repeat(64),
      ownerUserId: owner.id,
      updatedAt: '2026-08-02T00:01:00.000Z',
    });

    expect(harness.repositories.collectionJobs.listActive({ ownerUserId: owner.id })).toEqual([
      expect.objectContaining({ id: active.id, productTitle: null, status: 'pending' }),
    ]);
  });
});
