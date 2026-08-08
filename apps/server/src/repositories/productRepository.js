import { assertIdentifier, nowIso, throwDatabaseError } from './repositoryUtils.js';

function mapProduct(row) {
  if (!row) {
    return null;
  }

  return {
    alertThresholdPercent: row.alert_threshold_percent,
    canonicalUrl: row.canonical_url,
    createdAt: row.created_at,
    currency: row.currency,
    id: row.id,
    imageUrl: row.image_url,
    itemId: row.item_id,
    lastCheckedAt: row.last_checked_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    lastSuccessAt: row.last_success_at,
    ownerUserId: row.owner_user_id,
    pendingMissingConfirmationCount: row.pending_missing_confirmation_count,
    pendingMissingUpdatedAt: row.pending_missing_updated_at,
    pendingMissingVariantSetHash: row.pending_missing_variant_set_hash,
    platform: row.platform,
    shopId: row.shop_id,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

/**
 * Create owner-scoped product persistence operations.
 *
 * @param {import('better-sqlite3').Database} database
 */
export function createProductRepository(database) {
  const upsertStatement = database.prepare(`
    INSERT INTO products (
      owner_user_id,
      platform,
      shop_id,
      item_id,
      title,
      canonical_url,
      image_url,
      currency,
      alert_threshold_percent,
      created_at,
      updated_at
    )
    VALUES (
      @ownerUserId,
      @platform,
      @shopId,
      @itemId,
      @title,
      @canonicalUrl,
      @imageUrl,
      @currency,
      @alertThresholdPercent,
      @updatedAt,
      @updatedAt
    )
    ON CONFLICT(owner_user_id, platform, shop_id, item_id)
    DO UPDATE SET
      title = excluded.title,
      canonical_url = excluded.canonical_url,
      image_url = excluded.image_url,
      currency = excluded.currency,
      updated_at = excluded.updated_at
    RETURNING *
  `);
  const findByIdStatement = database.prepare(`
    SELECT *
    FROM products
    WHERE id = @productId AND owner_user_id = @ownerUserId
  `);
  const findByIdentityStatement = database.prepare(`
    SELECT *
    FROM products
    WHERE owner_user_id = @ownerUserId
      AND platform = @platform
      AND shop_id = @shopId
      AND item_id = @itemId
  `);
  const filteredProductsCte = `
    WITH product_availability AS (
      SELECT
        product_id,
        COUNT(*) AS active_count,
        SUM(current_availability = 'available') AS available_count,
        SUM(current_availability = 'sold_out') AS sold_out_count,
        SUM(current_availability IN ('sold_out', 'unavailable')) AS unavailable_count
      FROM product_variants
      WHERE lifecycle_status = 'active'
      GROUP BY product_id
    ), filtered_products AS (
      SELECT
        products.*,
        CASE
          WHEN COALESCE(product_availability.active_count, 0) = 0 THEN 'unknown'
          WHEN product_availability.available_count > 0 THEN 'available'
          WHEN product_availability.sold_out_count = product_availability.active_count
            THEN 'sold_out'
          WHEN product_availability.unavailable_count = product_availability.active_count
            THEN 'unavailable'
          ELSE 'unknown'
        END AS derived_availability
      FROM products
      LEFT JOIN product_availability ON product_availability.product_id = products.id
      WHERE products.owner_user_id = @ownerUserId
        AND (@status IS NULL OR products.status = @status)
        AND (
          @search IS NULL
          OR INSTR(LOWER(products.title), LOWER(@search)) > 0
          OR INSTR(products.shop_id, @search) > 0
          OR INSTR(products.item_id, @search) > 0
          OR EXISTS (
            SELECT 1
            FROM product_variants search_variant
            WHERE search_variant.product_id = products.id
              AND INSTR(LOWER(search_variant.name), LOWER(@search)) > 0
          )
        )
    )
  `;
  const listStatement = database.prepare(`
    ${filteredProductsCte}
    SELECT *
    FROM filtered_products
    WHERE @availability IS NULL OR derived_availability = @availability
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit OFFSET @offset
  `);
  const listActiveForSchedulingStatement = database.prepare(`
    SELECT *
    FROM products
    WHERE status = 'active'
    ORDER BY id
  `);
  const countStatement = database.prepare(`
    ${filteredProductsCte}
    SELECT COUNT(*) AS total
    FROM filtered_products
    WHERE @availability IS NULL OR derived_availability = @availability
  `);
  const deleteStatement = database.prepare(`
    DELETE FROM products
    WHERE id = @productId AND owner_user_id = @ownerUserId
  `);
  const recordMassCandidateStatement = database.prepare(`
    UPDATE products
    SET
      pending_missing_confirmation_count = CASE
        WHEN pending_missing_variant_set_hash = @variantSetHash
          THEN pending_missing_confirmation_count + 1
        ELSE 1
      END,
      pending_missing_variant_set_hash = @variantSetHash,
      pending_missing_updated_at = @updatedAt,
      updated_at = @updatedAt
    WHERE id = @productId AND owner_user_id = @ownerUserId
    RETURNING *
  `);
  const clearMassCandidateStatement = database.prepare(`
    UPDATE products
    SET
      pending_missing_variant_set_hash = NULL,
      pending_missing_confirmation_count = 0,
      pending_missing_updated_at = NULL,
      updated_at = @updatedAt
    WHERE id = @productId AND owner_user_id = @ownerUserId
    RETURNING *
  `);
  const recordSuccessfulCheckStatement = database.prepare(`
    UPDATE products
    SET
      last_checked_at = @checkedAt,
      last_success_at = @checkedAt,
      last_error_code = NULL,
      last_error_message = NULL,
      updated_at = @checkedAt
    WHERE id = @productId AND owner_user_id = @ownerUserId
    RETURNING *
  `);
  const recordFailedCheckStatement = database.prepare(`
    UPDATE products
    SET
      last_checked_at = @checkedAt,
      last_error_code = @errorCode,
      last_error_message = @errorMessage,
      updated_at = @checkedAt
    WHERE id = @productId AND owner_user_id = @ownerUserId
    RETURNING *
  `);

  return Object.freeze({
    /**
     * Clear pending mass-disappearance evidence.
     *
     * @param {object} input
     * @param {number} input.ownerUserId
     * @param {number} input.productId
     * @param {string} [input.updatedAt]
     */
    clearMassMissingCandidate({ ownerUserId, productId, updatedAt = nowIso() }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return mapProduct(clearMassCandidateStatement.get({ ownerUserId, productId, updatedAt }));
      } catch (error) {
        throwDatabaseError('Unable to clear product disappearance state', error);
      }
    },

    /**
     * Count products visible to one owner.
     *
     * @param {number} ownerUserId
     * @param {object} [filters]
     */
    countByOwner(ownerUserId, { availability = null, search = null, status = null } = {}) {
      assertIdentifier(ownerUserId, 'ownerUserId');

      try {
        return countStatement.get({ availability, ownerUserId, search, status }).total;
      } catch (error) {
        throwDatabaseError('Unable to count products', error);
      }
    },

    /**
     * Delete an owner-scoped product and all descendants.
     *
     * @param {{ownerUserId: number, productId: number}} input
     */
    delete({ ownerUserId, productId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return deleteStatement.run({ ownerUserId, productId }).changes === 1;
      } catch (error) {
        throwDatabaseError('Unable to delete the product', error);
      }
    },

    /**
     * Find one product in its owner scope.
     *
     * @param {{ownerUserId: number, productId: number}} input
     */
    findById({ ownerUserId, productId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return mapProduct(findByIdStatement.get({ ownerUserId, productId }));
      } catch (error) {
        throwDatabaseError('Unable to find the product', error);
      }
    },

    /**
     * Find one owner product by marketplace identity.
     *
     * @param {object} input
     * @param {string} input.itemId
     * @param {number} input.ownerUserId
     * @param {string} [input.platform]
     * @param {string} input.shopId
     */
    findByIdentity({ itemId, ownerUserId, platform = 'shopee', shopId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');

      try {
        return mapProduct(
          findByIdentityStatement.get({
            itemId,
            ownerUserId,
            platform,
            shopId,
          }),
        );
      } catch (error) {
        throwDatabaseError('Unable to find the product identity', error);
      }
    },

    /**
     * List products visible to one owner.
     *
     * @param {object} input
     * @param {string | null} [input.availability]
     * @param {number} [input.limit]
     * @param {number} [input.offset]
     * @param {number} input.ownerUserId
     * @param {string | null} [input.search]
     * @param {string | null} [input.status]
     */
    listByOwner({
      availability = null,
      limit = 20,
      offset = 0,
      ownerUserId,
      search = null,
      status = null,
    }) {
      assertIdentifier(ownerUserId, 'ownerUserId');

      try {
        return listStatement
          .all({ availability, limit, offset, ownerUserId, search, status })
          .map((row) => mapProduct(row));
      } catch (error) {
        throwDatabaseError('Unable to list products', error);
      }
    },

    /** List every active product for the trusted in-process scheduler. */
    listActiveForScheduling() {
      try {
        return listActiveForSchedulingStatement.all().map((row) => mapProduct(row));
      } catch (error) {
        throwDatabaseError('Unable to list active products for scheduling', error);
      }
    },

    /**
     * Advance confirmation for one exact suspicious observed-variant set.
     *
     * @param {object} input
     * @param {number} input.ownerUserId
     * @param {number} input.productId
     * @param {string} [input.updatedAt]
     * @param {string} input.variantSetHash
     */
    recordMassMissingCandidate({ ownerUserId, productId, updatedAt = nowIso(), variantSetHash }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return mapProduct(
          recordMassCandidateStatement.get({
            ownerUserId,
            productId,
            updatedAt,
            variantSetHash,
          }),
        );
      } catch (error) {
        throwDatabaseError('Unable to update product disappearance state', error);
      }
    },

    /**
     * Persist a failed product check summary.
     *
     * @param {object} input
     */
    recordFailedCheck({
      checkedAt = nowIso(),
      errorCode,
      errorMessage = null,
      ownerUserId,
      productId,
    }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return mapProduct(
          recordFailedCheckStatement.get({
            checkedAt,
            errorCode,
            errorMessage,
            ownerUserId,
            productId,
          }),
        );
      } catch (error) {
        throwDatabaseError('Unable to update the failed product check', error);
      }
    },

    /**
     * Persist a successful product check summary.
     *
     * @param {object} input
     */
    recordSuccessfulCheck({ checkedAt = nowIso(), ownerUserId, productId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return mapProduct(
          recordSuccessfulCheckStatement.get({
            checkedAt,
            ownerUserId,
            productId,
          }),
        );
      } catch (error) {
        throwDatabaseError('Unable to update the successful product check', error);
      }
    },

    /**
     * Update only supported owner product settings.
     *
     * @param {object} input
     */
    updateSettings({
      alertThresholdPercent,
      ownerUserId,
      productId,
      status,
      updatedAt = nowIso(),
    }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      const assignments = ['updated_at = @updatedAt'];
      const parameters = { ownerUserId, productId, updatedAt };

      if (alertThresholdPercent !== undefined) {
        assignments.push('alert_threshold_percent = @alertThresholdPercent');
        parameters.alertThresholdPercent = alertThresholdPercent;
      }

      if (status !== undefined) {
        assignments.push('status = @status');
        parameters.status = status;
      }

      try {
        const row = database
          .prepare(
            `
            UPDATE products
            SET ${assignments.join(', ')}
            WHERE id = @productId AND owner_user_id = @ownerUserId
            RETURNING *
          `,
          )
          .get(parameters);

        return mapProduct(row);
      } catch (error) {
        throwDatabaseError('Unable to update product settings', error);
      }
    },

    /**
     * Insert or refresh an owner product without changing user settings.
     *
     * @param {object} input
     */
    upsert({
      alertThresholdPercent,
      canonicalUrl,
      currency,
      imageUrl = null,
      itemId,
      ownerUserId,
      platform = 'shopee',
      shopId,
      title,
      updatedAt = nowIso(),
    }) {
      assertIdentifier(ownerUserId, 'ownerUserId');

      try {
        return mapProduct(
          upsertStatement.get({
            alertThresholdPercent,
            canonicalUrl,
            currency,
            imageUrl,
            itemId,
            ownerUserId,
            platform,
            shopId,
            title,
            updatedAt,
          }),
        );
      } catch (error) {
        throwDatabaseError('Unable to upsert the product', error);
      }
    },
  });
}
