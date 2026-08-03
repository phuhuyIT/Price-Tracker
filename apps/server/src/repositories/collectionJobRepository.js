import { assertIdentifier, throwDatabaseError } from './repositoryUtils.js';

function mapCollectionJob(row) {
  if (!row) {
    return null;
  }

  return {
    attemptCount: row.attempt_count,
    canonicalUrl: row.canonical_url,
    claimedContextKey: row.claimed_context_key,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    id: row.id,
    itemId: row.item_id,
    jobType: row.job_type,
    leaseExpiresAt: row.lease_expires_at,
    ownerUserId: row.owner_user_id,
    platform: row.platform,
    productId: row.product_id,
    shopId: row.shop_id,
    status: row.status,
    targetContextKey: row.target_context_key,
    updatedAt: row.updated_at,
  };
}

/** Create owner-scoped persistent collection-job operations. */
export function createCollectionJobRepository(database) {
  const insertStatement = database.prepare(`
    INSERT INTO collection_jobs (
      owner_user_id,
      product_id,
      platform,
      shop_id,
      item_id,
      canonical_url,
      job_type,
      target_context_key,
      created_at,
      updated_at
    ) VALUES (
      @ownerUserId,
      @productId,
      'shopee',
      @shopId,
      @itemId,
      @canonicalUrl,
      @jobType,
      @targetContextKey,
      @createdAt,
      @createdAt
    )
    RETURNING *
  `);
  const findByIdStatement = database.prepare(`
    SELECT * FROM collection_jobs
    WHERE id = @jobId AND owner_user_id = @ownerUserId
  `);
  const findActiveByIdentityStatement = database.prepare(`
    SELECT * FROM collection_jobs
    WHERE owner_user_id = @ownerUserId
      AND platform = 'shopee'
      AND shop_id = @shopId
      AND item_id = @itemId
      AND status IN ('pending', 'claimed')
    ORDER BY id DESC
    LIMIT 1
  `);
  const findLatestTargetByIdentityStatement = database.prepare(`
    SELECT target_context_key
    FROM collection_jobs
    WHERE owner_user_id = @ownerUserId
      AND platform = 'shopee'
      AND shop_id = @shopId
      AND item_id = @itemId
      AND target_context_key IS NOT NULL
    ORDER BY id DESC
    LIMIT 1
  `);
  const releaseExpiredStatement = database.prepare(`
    UPDATE collection_jobs
    SET
      status = 'pending',
      claimed_context_key = NULL,
      lease_token_hash = NULL,
      lease_expires_at = NULL,
      updated_at = @updatedAt
    WHERE owner_user_id = @ownerUserId
      AND status = 'claimed'
      AND lease_expires_at <= @updatedAt
  `);
  const claimNextStatement = database.prepare(`
    WITH candidate AS (
      SELECT id
      FROM collection_jobs
      WHERE owner_user_id = @ownerUserId
        AND status = 'pending'
        AND (target_context_key IS NULL OR target_context_key = @pricingContextKey)
      ORDER BY created_at, id
      LIMIT 1
    )
    UPDATE collection_jobs
    SET
      status = 'claimed',
      target_context_key = COALESCE(target_context_key, @pricingContextKey),
      claimed_context_key = @pricingContextKey,
      lease_token_hash = @leaseTokenHash,
      lease_expires_at = @leaseExpiresAt,
      attempt_count = attempt_count + 1,
      updated_at = @updatedAt
    WHERE id = (SELECT id FROM candidate)
    RETURNING *
  `);
  const findClaimStatement = database.prepare(`
    SELECT * FROM collection_jobs
    WHERE id = @jobId
      AND owner_user_id = @ownerUserId
      AND status = 'claimed'
      AND lease_token_hash = @leaseTokenHash
      AND lease_expires_at > @updatedAt
  `);
  const completeStatement = database.prepare(`
    UPDATE collection_jobs
    SET
      status = 'completed',
      product_id = @productId,
      claimed_context_key = NULL,
      lease_token_hash = NULL,
      lease_expires_at = NULL,
      completed_at = @updatedAt,
      updated_at = @updatedAt
    WHERE id = @jobId
      AND owner_user_id = @ownerUserId
      AND status = 'claimed'
      AND lease_token_hash = @leaseTokenHash
      AND lease_expires_at > @updatedAt
    RETURNING *
  `);
  const failStatement = database.prepare(`
    UPDATE collection_jobs
    SET
      status = 'failed',
      claimed_context_key = NULL,
      lease_token_hash = NULL,
      lease_expires_at = NULL,
      error_code = @errorCode,
      error_message = @errorMessage,
      completed_at = @updatedAt,
      updated_at = @updatedAt
    WHERE id = @jobId
      AND owner_user_id = @ownerUserId
      AND status = 'claimed'
      AND lease_token_hash = @leaseTokenHash
      AND lease_expires_at > @updatedAt
    RETURNING *
  `);

  return Object.freeze({
    claimNext(input) {
      try {
        releaseExpiredStatement.run(input);
        return mapCollectionJob(claimNextStatement.get(input));
      } catch (error) {
        throwDatabaseError('Unable to claim a collection job', error);
      }
    },

    complete(input) {
      try {
        return mapCollectionJob(completeStatement.get(input));
      } catch (error) {
        throwDatabaseError('Unable to complete a collection job', error);
      }
    },

    create(input) {
      try {
        return mapCollectionJob(insertStatement.get(input));
      } catch (error) {
        throwDatabaseError('Unable to create a collection job', error);
      }
    },

    fail(input) {
      try {
        return mapCollectionJob(failStatement.get(input));
      } catch (error) {
        throwDatabaseError('Unable to fail a collection job', error);
      }
    },

    findActiveByIdentity({ itemId, ownerUserId, shopId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      return mapCollectionJob(findActiveByIdentityStatement.get({ itemId, ownerUserId, shopId }));
    },

    findById({ jobId, ownerUserId }) {
      assertIdentifier(jobId, 'jobId');
      assertIdentifier(ownerUserId, 'ownerUserId');
      return mapCollectionJob(findByIdStatement.get({ jobId, ownerUserId }));
    },

    findLatestTargetContextKey({ itemId, ownerUserId, shopId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      return (
        findLatestTargetByIdentityStatement.get({ itemId, ownerUserId, shopId })
          ?.target_context_key ?? null
      );
    },

    findValidClaim(input) {
      return mapCollectionJob(findClaimStatement.get(input));
    },
  });
}
