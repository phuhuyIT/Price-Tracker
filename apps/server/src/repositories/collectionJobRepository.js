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
    jobSource: row.job_source,
    jobType: row.job_type,
    leaseExpiresAt: row.lease_expires_at,
    nextAttemptAt: row.next_attempt_at,
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
      job_source,
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
      @jobSource,
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
      AND status IN ('pending', 'claimed', 'retry_wait', 'waiting_auth')
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
  const claimNextStatement = database.prepare(`
    WITH candidate AS (
      SELECT id
      FROM collection_jobs
      WHERE owner_user_id = @ownerUserId
        AND (
          status = 'pending'
          OR (status = 'retry_wait' AND next_attempt_at <= @updatedAt)
          OR (@resumeWaitingAuth = 1 AND status = 'waiting_auth')
        )
        AND attempt_count < @maxAttempts
        AND (@jobId IS NULL OR id = @jobId)
        AND (target_context_key IS NULL OR target_context_key = @pricingContextKey)
      ORDER BY
        CASE WHEN status = 'waiting_auth' THEN 0 ELSE 1 END,
        created_at,
        id
      LIMIT 1
    )
    UPDATE collection_jobs
    SET
      status = 'claimed',
      target_context_key = COALESCE(target_context_key, @pricingContextKey),
      claimed_context_key = @pricingContextKey,
      lease_token_hash = @leaseTokenHash,
      lease_expires_at = @leaseExpiresAt,
      next_attempt_at = NULL,
      attempt_count = attempt_count + 1,
      error_code = NULL,
      error_message = NULL,
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
  const rebindStatement = database.prepare(`
    UPDATE collection_jobs
    SET
      target_context_key = @pricingContextKey,
      updated_at = @updatedAt
    WHERE id = @jobId
      AND owner_user_id = @ownerUserId
      AND status IN ('pending', 'retry_wait', 'waiting_auth')
      AND claimed_context_key IS NULL
      AND lease_token_hash IS NULL
    RETURNING *
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
      next_attempt_at = NULL,
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
  const failExpiredStatement = database.prepare(`
    UPDATE collection_jobs
    SET
      status = 'failed',
      claimed_context_key = NULL,
      lease_token_hash = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      error_code = @errorCode,
      error_message = @errorMessage,
      completed_at = @updatedAt,
      updated_at = @updatedAt
    WHERE id = @jobId
      AND status = 'claimed'
      AND lease_expires_at <= @updatedAt
    RETURNING *
  `);
  const retryStatement = database.prepare(`
    UPDATE collection_jobs
    SET
      status = 'retry_wait',
      claimed_context_key = NULL,
      lease_token_hash = NULL,
      lease_expires_at = NULL,
      next_attempt_at = @nextAttemptAt,
      error_code = @errorCode,
      error_message = @errorMessage,
      updated_at = @updatedAt
    WHERE id = @jobId
      AND owner_user_id = @ownerUserId
      AND status = 'claimed'
      AND lease_token_hash = @leaseTokenHash
      AND lease_expires_at > @updatedAt
    RETURNING *
  `);
  const retryExpiredStatement = database.prepare(`
    UPDATE collection_jobs
    SET
      status = 'retry_wait',
      claimed_context_key = NULL,
      lease_token_hash = NULL,
      lease_expires_at = NULL,
      next_attempt_at = @nextAttemptAt,
      error_code = @errorCode,
      error_message = @errorMessage,
      updated_at = @updatedAt
    WHERE id = @jobId
      AND status = 'claimed'
      AND lease_expires_at <= @updatedAt
    RETURNING *
  `);
  const waitForAuthenticationStatement = database.prepare(`
    UPDATE collection_jobs
    SET
      status = 'waiting_auth',
      claimed_context_key = NULL,
      lease_token_hash = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      error_code = 'AUTHENTICATION_REQUIRED',
      error_message = @errorMessage,
      attempt_count = MAX(attempt_count - 1, 0),
      updated_at = @updatedAt
    WHERE id = @jobId
      AND owner_user_id = @ownerUserId
      AND status = 'claimed'
      AND lease_token_hash = @leaseTokenHash
      AND lease_expires_at > @updatedAt
    RETURNING *
  `);
  const findExpiredByOwnerStatement = database.prepare(`
    SELECT * FROM collection_jobs
    WHERE owner_user_id = @ownerUserId
      AND status = 'claimed'
      AND lease_expires_at <= @updatedAt
    ORDER BY lease_expires_at, id
  `);
  const findAllExpiredStatement = database.prepare(`
    SELECT * FROM collection_jobs
    WHERE status = 'claimed'
      AND lease_expires_at <= @updatedAt
    ORDER BY lease_expires_at, id
  `);

  return Object.freeze({
    claimNext(input) {
      try {
        return mapCollectionJob(
          claimNextStatement.get({
            ...input,
            jobId: input.jobId ?? null,
            resumeWaitingAuth: input.resumeWaitingAuth ? 1 : 0,
          }),
        );
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

    failExpired(input) {
      try {
        return mapCollectionJob(failExpiredStatement.get(input));
      } catch (error) {
        throwDatabaseError('Unable to fail an expired collection job', error);
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

    findExpired({ ownerUserId, updatedAt }) {
      try {
        const rows = ownerUserId
          ? findExpiredByOwnerStatement.all({ ownerUserId, updatedAt })
          : findAllExpiredStatement.all({ updatedAt });
        return rows.map((row) => mapCollectionJob(row));
      } catch (error) {
        throwDatabaseError('Unable to find expired collection jobs', error);
      }
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

    rebind(input) {
      try {
        return mapCollectionJob(rebindStatement.get(input));
      } catch (error) {
        throwDatabaseError('Unable to move the collection job to another Chrome profile', error);
      }
    },

    retry(input) {
      try {
        return mapCollectionJob(retryStatement.get(input));
      } catch (error) {
        throwDatabaseError('Unable to retry a collection job', error);
      }
    },

    retryExpired(input) {
      try {
        return mapCollectionJob(retryExpiredStatement.get(input));
      } catch (error) {
        throwDatabaseError('Unable to retry an expired collection job', error);
      }
    },

    waitForAuthentication(input) {
      try {
        return mapCollectionJob(waitForAuthenticationStatement.get(input));
      } catch (error) {
        throwDatabaseError('Unable to wait for Shopee authentication', error);
      }
    },
  });
}
