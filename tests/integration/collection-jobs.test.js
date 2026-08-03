import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../apps/server/src/db/connection.js';
import { createRepositories } from '../../apps/server/src/repositories/index.js';
import { createTestDatabase, createTestOwner } from './databaseTestUtils.js';

let harness;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

function createPendingJob(repositories, ownerUserId) {
  return repositories.collectionJobs.create({
    canonicalUrl: 'https://shopee.vn/product-i.1259293184.26882883164',
    createdAt: '2026-08-02T00:00:00.000Z',
    itemId: '26882883164',
    jobType: 'track',
    ownerUserId,
    productId: null,
    shopId: '1259293184',
    targetContextKey: null,
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

  it('releases expired leases without allowing another Chrome profile to take the job', () => {
    harness = createTestDatabase();
    const owner = createTestOwner(harness.repositories);
    const created = createPendingJob(harness.repositories, owner.id);
    const firstClaim = harness.repositories.collectionJobs.claimNext({
      leaseExpiresAt: '2026-08-02T00:02:00.000Z',
      leaseTokenHash: '1'.repeat(64),
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

    const wrongProfile = harness.repositories.collectionJobs.claimNext({
      leaseExpiresAt: '2026-08-02T00:05:00.000Z',
      leaseTokenHash: '2'.repeat(64),
      ownerUserId: owner.id,
      pricingContextKey: 'extension:profile-b',
      updatedAt: '2026-08-02T00:03:00.000Z',
    });
    expect(wrongProfile).toBeNull();

    const reclaimed = harness.repositories.collectionJobs.claimNext({
      leaseExpiresAt: '2026-08-02T00:05:00.000Z',
      leaseTokenHash: '3'.repeat(64),
      ownerUserId: owner.id,
      pricingContextKey: 'extension:profile-a',
      updatedAt: '2026-08-02T00:03:00.000Z',
    });
    expect(reclaimed).toMatchObject({
      attemptCount: 2,
      id: created.id,
      status: 'claimed',
      targetContextKey: 'extension:profile-a',
    });
  });
});
