import { assertIdentifier, nowIso, throwDatabaseError } from './repositoryUtils.js';

function mapVariant(row) {
  if (!row) {
    return null;
  }

  return {
    availabilityUpdatedAt: row.availability_updated_at,
    consecutiveCompleteMisses: row.consecutive_complete_misses,
    createdAt: row.created_at,
    currentAvailability: row.current_availability,
    currentStockQuantity: row.current_stock_quantity,
    externalModelId: row.external_model_id,
    id: row.id,
    identityType: row.identity_type,
    inactiveReason: row.inactive_reason,
    lastSeenAt: row.last_seen_at,
    lifecycleStatus: row.lifecycle_status,
    missingSince: row.missing_since,
    name: row.name,
    productId: row.product_id,
    updatedAt: row.updated_at,
  };
}

/**
 * Create owner-scoped product-variant persistence operations.
 *
 * @param {import('better-sqlite3').Database} database
 */
export function createVariantRepository(database) {
  const findByIdStatement = database.prepare(`
    SELECT pv.*
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = @variantId AND p.owner_user_id = @ownerUserId
  `);
  const findByExternalIdStatement = database.prepare(`
    SELECT pv.*
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.product_id = @productId
      AND pv.external_model_id = @externalModelId
      AND p.owner_user_id = @ownerUserId
  `);
  const listByProductStatement = database.prepare(`
    SELECT pv.*
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.product_id = @productId AND p.owner_user_id = @ownerUserId
    ORDER BY pv.id
  `);
  const listNonInactiveStatement = database.prepare(`
    SELECT pv.*
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.product_id = @productId
      AND p.owner_user_id = @ownerUserId
      AND pv.lifecycle_status <> 'inactive'
    ORDER BY pv.id
  `);
  const upsertPresentStatement = database.prepare(`
    INSERT INTO product_variants (
      product_id,
      external_model_id,
      identity_type,
      name,
      lifecycle_status,
      last_seen_at,
      consecutive_complete_misses,
      missing_since,
      inactive_reason,
      current_availability,
      current_stock_quantity,
      availability_updated_at,
      created_at,
      updated_at
    )
    SELECT
      p.id,
      @externalModelId,
      @identityType,
      @name,
      'active',
      @seenAt,
      0,
      NULL,
      NULL,
      @availability,
      @stockQuantity,
      @seenAt,
      @seenAt,
      @seenAt
    FROM products p
    WHERE p.id = @productId AND p.owner_user_id = @ownerUserId
    ON CONFLICT(product_id, external_model_id)
    DO UPDATE SET
      identity_type = excluded.identity_type,
      name = excluded.name,
      lifecycle_status = 'active',
      last_seen_at = excluded.last_seen_at,
      consecutive_complete_misses = 0,
      missing_since = NULL,
      inactive_reason = NULL,
      current_availability = excluded.current_availability,
      current_stock_quantity = excluded.current_stock_quantity,
      availability_updated_at = excluded.availability_updated_at,
      updated_at = excluded.updated_at
    RETURNING *
  `);
  const recordEligibleMissStatement = database.prepare(`
    UPDATE product_variants
    SET
      consecutive_complete_misses = consecutive_complete_misses + 1,
      missing_since = COALESCE(missing_since, @checkedAt),
      lifecycle_status = CASE
        WHEN consecutive_complete_misses + 1 >= @missingThreshold
          THEN 'inactive'
        ELSE 'suspected_missing'
      END,
      inactive_reason = CASE
        WHEN consecutive_complete_misses + 1 >= @missingThreshold
          THEN 'missing_from_verified_complete_snapshots'
        ELSE NULL
      END,
      updated_at = @checkedAt
    WHERE id = @variantId
      AND lifecycle_status <> 'inactive'
      AND EXISTS (
        SELECT 1
        FROM products p
        WHERE p.id = product_variants.product_id
          AND p.owner_user_id = @ownerUserId
      )
    RETURNING *
  `);

  return Object.freeze({
    /**
     * Find one owner-scoped variant by external marketplace identity.
     *
     * @param {object} input
     */
    findByExternalModelId({ externalModelId, ownerUserId, productId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return mapVariant(
          findByExternalIdStatement.get({
            externalModelId,
            ownerUserId,
            productId,
          }),
        );
      } catch (error) {
        throwDatabaseError('Unable to find the product variant identity', error);
      }
    },

    /**
     * Find one owner-scoped variant by internal ID.
     *
     * @param {{ownerUserId: number, variantId: number}} input
     */
    findById({ ownerUserId, variantId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(variantId, 'variantId');

      try {
        return mapVariant(findByIdStatement.get({ ownerUserId, variantId }));
      } catch (error) {
        throwDatabaseError('Unable to find the product variant', error);
      }
    },

    /**
     * List all retained variants for an owner product.
     *
     * @param {{ownerUserId: number, productId: number}} input
     */
    listByProduct({ ownerUserId, productId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return listByProductStatement.all({ ownerUserId, productId }).map((row) => mapVariant(row));
      } catch (error) {
        throwDatabaseError('Unable to list product variants', error);
      }
    },

    /**
     * List known non-inactive variants used by missing-ratio evaluation.
     *
     * @param {{ownerUserId: number, productId: number}} input
     */
    listNonInactiveByProduct({ ownerUserId, productId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return listNonInactiveStatement
          .all({ ownerUserId, productId })
          .map((row) => mapVariant(row));
      } catch (error) {
        throwDatabaseError('Unable to list active product variants', error);
      }
    },

    /**
     * Apply one eligible verified-complete miss to a non-inactive variant.
     *
     * @param {object} input
     * @param {string} [input.checkedAt]
     * @param {number} input.missingThreshold
     * @param {number} input.ownerUserId
     * @param {number} input.variantId
     */
    recordEligibleMiss({ checkedAt = nowIso(), missingThreshold, ownerUserId, variantId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(variantId, 'variantId');

      if (!Number.isSafeInteger(missingThreshold) || missingThreshold <= 0) {
        throw new TypeError('missingThreshold must be a positive safe integer');
      }

      try {
        return mapVariant(
          recordEligibleMissStatement.get({
            checkedAt,
            missingThreshold,
            ownerUserId,
            variantId,
          }),
        );
      } catch (error) {
        throwDatabaseError('Unable to update missing-variant lifecycle', error);
      }
    },

    /**
     * Insert, rename, or reactivate a positively present variant.
     *
     * @param {object} input
     * @returns {{variant: object, wasReactivated: boolean}}
     */
    upsertPresent({
      availability,
      externalModelId,
      identityType,
      name,
      ownerUserId,
      productId,
      seenAt = nowIso(),
      stockQuantity = null,
    }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        const existing = mapVariant(
          findByExternalIdStatement.get({
            externalModelId,
            ownerUserId,
            productId,
          }),
        );
        const variant = mapVariant(
          upsertPresentStatement.get({
            availability,
            externalModelId,
            identityType,
            name,
            ownerUserId,
            productId,
            seenAt,
            stockQuantity,
          }),
        );

        if (!variant) {
          throw new Error('Owner product does not exist');
        }

        return {
          variant,
          wasReactivated: existing !== null && existing.lifecycleStatus !== 'active',
        };
      } catch (error) {
        throwDatabaseError('Unable to upsert the product variant', error);
      }
    },
  });
}
