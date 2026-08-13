import {
  assertIdentifier,
  fromDatabaseBoolean,
  nowIso,
  throwDatabaseError,
  toDatabaseBoolean,
} from './repositoryUtils.js';
import { DatabaseError } from '../errors/DatabaseError.js';

function assertIdempotentMatch(record, expectedFields, entityName) {
  const differs = Object.entries(expectedFields).some(
    ([field, expected]) => record[field] !== expected,
  );

  if (differs) {
    throw new DatabaseError(`${entityName} idempotency key was reused with different data`);
  }
}

function mapCheck(row) {
  if (!row) {
    return null;
  }

  return {
    capturedAt: row.captured_at,
    checkedAt: row.checked_at,
    coverageConfidence: row.coverage_confidence,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    expectedVariantCount: row.expected_variant_count,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    lifecycleEligible: fromDatabaseBoolean(row.lifecycle_eligible),
    observedVariantCount: row.observed_variant_count,
    observedVariantSetHash: row.observed_variant_set_hash,
    pricedVariantCount: row.priced_variant_count,
    pricingContext: row.pricing_context,
    pricingContextKey: row.pricing_context_key,
    productId: row.product_id,
    schemaVersion: row.schema_version,
    source: row.source,
    status: row.status,
    suspiciousMassDisappearance: fromDatabaseBoolean(row.suspicious_mass_disappearance),
    variantCoverage: row.variant_coverage,
  };
}

function mapCheckResult(row) {
  if (!row) {
    return null;
  }

  return {
    availability: row.availability,
    checkId: row.check_id,
    createdAt: row.created_at,
    id: row.id,
    lifecycleEligible: fromDatabaseBoolean(row.lifecycle_eligible),
    presence: row.presence,
    priceStatus: row.price_status,
    reasonCode: row.reason_code,
    stockQuantity: row.stock_quantity,
    variantId: row.variant_id,
    variantLifecycle: row.variant_lifecycle,
  };
}

function mapPriceLog(row) {
  if (!row) {
    return null;
  }

  return {
    availability: row.availability,
    checkId: row.check_id,
    currency: row.currency,
    id: row.id,
    priceAmount: row.price_amount,
    priceDefinition: row.price_definition,
    priceSource: row.price_source,
    priceType: row.price_type,
    pricingContext: row.pricing_context,
    pricingContextKey: row.pricing_context_key,
    recordedAt: row.recorded_at,
    shippingIncluded: fromDatabaseBoolean(row.shipping_included),
    variantId: row.variant_id,
    voucherStatus: row.voucher_status,
  };
}

function mapCurrentPrice(row) {
  const price = mapPriceLog(row);

  if (!price) {
    return null;
  }

  return {
    ...price,
    variantLifecycle: row.variant_lifecycle,
    variantName: row.variant_name,
  };
}

function mapLatestResult(row) {
  const result = mapCheckResult(row);

  if (!result) {
    return null;
  }

  return {
    ...result,
    checkedAt: row.checked_at,
    pricingContext: row.pricing_context,
    pricingContextKey: row.pricing_context_key,
    source: row.check_source,
    variantName: row.variant_name,
  };
}

function mapHistoryTimelinePoint(row) {
  return {
    availability: row.availability,
    checkId: row.check_id,
    checkedAt: row.checked_at,
    currency: row.currency,
    presence: row.presence,
    priceAmount: row.price_amount,
    priceDefinition: row.price_definition,
    priceLogId: row.price_log_id,
    priceSource: row.price_source,
    priceStatus: row.price_status,
    priceType: row.price_type,
    pricingContext: row.pricing_context,
    pricingContextKey: row.pricing_context_key,
    reasonCode: row.reason_code,
    source: row.check_source,
    stockQuantity: row.stock_quantity,
    variantId: row.variant_id,
    variantLifecycle: row.variant_lifecycle,
    variantName: row.variant_name,
    voucherStatus: row.voucher_status,
  };
}

/**
 * Create owner-scoped check, gap, and price-history persistence operations.
 *
 * @param {import('better-sqlite3').Database} database
 */
export function createPriceRepository(database) {
  const createCheckStatement = database.prepare(`
    INSERT INTO price_checks (
      product_id,
      idempotency_key,
      source,
      status,
      schema_version,
      pricing_context,
      pricing_context_key,
      captured_at,
      checked_at,
      variant_coverage,
      coverage_confidence,
      lifecycle_eligible,
      expected_variant_count,
      observed_variant_count,
      priced_variant_count,
      suspicious_mass_disappearance,
      observed_variant_set_hash,
      error_code,
      error_message
    )
    SELECT
      p.id,
      @idempotencyKey,
      @source,
      @status,
      @schemaVersion,
      @pricingContext,
      @pricingContextKey,
      @capturedAt,
      @checkedAt,
      @variantCoverage,
      @coverageConfidence,
      @lifecycleEligible,
      @expectedVariantCount,
      @observedVariantCount,
      @pricedVariantCount,
      @suspiciousMassDisappearance,
      @observedVariantSetHash,
      @errorCode,
      @errorMessage
    FROM products p
    WHERE p.id = @productId AND p.owner_user_id = @ownerUserId
    ON CONFLICT(product_id, idempotency_key) DO NOTHING
    RETURNING *
  `);
  const findCheckByIdempotencyStatement = database.prepare(`
    SELECT pc.*
    FROM price_checks pc
    JOIN products p ON p.id = pc.product_id
    WHERE pc.product_id = @productId
      AND pc.idempotency_key = @idempotencyKey
      AND p.owner_user_id = @ownerUserId
  `);
  const insertCheckResultStatement = database.prepare(`
    INSERT INTO variant_check_results (
      check_id,
      variant_id,
      presence,
      price_status,
      availability,
      stock_quantity,
      reason_code,
      lifecycle_eligible,
      variant_lifecycle,
      created_at
    )
    SELECT
      pc.id,
      pv.id,
      @presence,
      @priceStatus,
      @availability,
      @stockQuantity,
      @reasonCode,
      @lifecycleEligible,
      @variantLifecycle,
      @createdAt
    FROM price_checks pc
    JOIN products p ON p.id = pc.product_id
    JOIN product_variants pv ON pv.product_id = pc.product_id
    WHERE pc.id = @checkId
      AND pv.id = @variantId
      AND p.owner_user_id = @ownerUserId
    ON CONFLICT(check_id, variant_id) DO NOTHING
    RETURNING *
  `);
  const findCheckResultStatement = database.prepare(`
    SELECT vcr.*
    FROM variant_check_results vcr
    JOIN price_checks pc ON pc.id = vcr.check_id
    JOIN products p ON p.id = pc.product_id
    WHERE vcr.check_id = @checkId
      AND vcr.variant_id = @variantId
      AND p.owner_user_id = @ownerUserId
  `);
  const listCheckResultsStatement = database.prepare(`
    SELECT vcr.*
    FROM variant_check_results vcr
    JOIN price_checks pc ON pc.id = vcr.check_id
    JOIN products p ON p.id = pc.product_id
    WHERE vcr.check_id = @checkId AND p.owner_user_id = @ownerUserId
    ORDER BY vcr.variant_id
  `);
  const insertPriceLogStatement = database.prepare(`
    INSERT INTO price_logs (
      check_id,
      variant_id,
      price_amount,
      currency,
      price_definition,
      price_type,
      pricing_context,
      pricing_context_key,
      price_source,
      voucher_status,
      shipping_included,
      availability,
      recorded_at
    )
    SELECT
      pc.id,
      pv.id,
      @priceAmount,
      @currency,
      @priceDefinition,
      @priceType,
      @pricingContext,
      @pricingContextKey,
      @priceSource,
      @voucherStatus,
      @shippingIncluded,
      @availability,
      @recordedAt
    FROM price_checks pc
    JOIN products p ON p.id = pc.product_id
    JOIN product_variants pv ON pv.product_id = pc.product_id
    WHERE pc.id = @checkId
      AND pv.id = @variantId
      AND p.owner_user_id = @ownerUserId
      AND pc.status = 'success'
      AND pc.pricing_context = @pricingContext
      AND pc.pricing_context_key = @pricingContextKey
    ON CONFLICT(
      check_id,
      variant_id,
      price_definition,
      price_type,
      pricing_context,
      pricing_context_key
    ) DO NOTHING
    RETURNING *
  `);
  const findPriceLogStatement = database.prepare(`
    SELECT pl.*
    FROM price_logs pl
    JOIN price_checks pc ON pc.id = pl.check_id
    JOIN products p ON p.id = pc.product_id
    WHERE pl.check_id = @checkId
      AND pl.variant_id = @variantId
      AND pl.price_definition = @priceDefinition
      AND pl.price_type = @priceType
      AND pl.pricing_context = @pricingContext
      AND pl.pricing_context_key = @pricingContextKey
      AND p.owner_user_id = @ownerUserId
  `);
  const listPriceLogsByCheckStatement = database.prepare(`
    SELECT pl.*
    FROM price_logs pl
    JOIN price_checks pc ON pc.id = pl.check_id
    JOIN products p ON p.id = pc.product_id
    WHERE pl.check_id = @checkId AND p.owner_user_id = @ownerUserId
    ORDER BY pl.variant_id
  `);
  const latestComparableStatement = database.prepare(`
    SELECT pl.*
    FROM price_logs pl
    JOIN product_variants pv ON pv.id = pl.variant_id
    JOIN products p ON p.id = pv.product_id
    JOIN price_checks pc ON pc.id = pl.check_id
    WHERE pl.variant_id = @variantId
      AND p.owner_user_id = @ownerUserId
      AND pc.status = 'success'
      AND pl.currency = @currency
      AND pl.price_definition = @priceDefinition
      AND pl.price_type = @priceType
      AND pl.pricing_context = @pricingContext
      AND pl.pricing_context_key = @pricingContextKey
      AND pl.price_source = @priceSource
      AND pl.availability = 'available'
      AND (@excludePriceLogId IS NULL OR pl.id <> @excludePriceLogId)
    ORDER BY pl.recorded_at DESC, pl.id DESC
    LIMIT 1
  `);
  const latestUserSessionContextStatement = database.prepare(`
    SELECT pc.pricing_context_key
    FROM price_checks pc
    INNER JOIN products p ON p.id = pc.product_id
    WHERE pc.product_id = @productId
      AND p.owner_user_id = @ownerUserId
      AND pc.status = 'success'
      AND pc.source = 'extension'
      AND pc.pricing_context = 'user_session'
    ORDER BY pc.checked_at DESC, pc.id DESC
    LIMIT 1
  `);
  const historyStatement = database.prepare(`
    SELECT pl.*
    FROM price_logs pl
    JOIN product_variants pv ON pv.id = pl.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE pv.product_id = @productId
      AND p.owner_user_id = @ownerUserId
      AND (@variantId IS NULL OR pl.variant_id = @variantId)
      AND (@fromTimestamp IS NULL OR pl.recorded_at >= @fromTimestamp)
      AND (@toTimestamp IS NULL OR pl.recorded_at <= @toTimestamp)
    ORDER BY pl.recorded_at ASC, pl.id ASC
    LIMIT @limit
  `);
  const latestPricesByProductStatement = database.prepare(`
    WITH ranked_prices AS (
      SELECT
        pl.*,
        pv.lifecycle_status AS variant_lifecycle,
        pv.name AS variant_name,
        ROW_NUMBER() OVER (
          PARTITION BY pl.variant_id, pl.pricing_context, pl.pricing_context_key
          ORDER BY pl.recorded_at DESC, pl.id DESC
        ) AS price_rank
      FROM price_logs pl
      JOIN product_variants pv ON pv.id = pl.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE pv.product_id = @productId AND p.owner_user_id = @ownerUserId
    )
    SELECT *
    FROM ranked_prices
    WHERE price_rank = 1
    ORDER BY variant_id, pricing_context, pricing_context_key
  `);
  const latestResultsByProductStatement = database.prepare(`
    WITH ranked_results AS (
      SELECT
        vcr.*,
        pc.checked_at,
        pc.pricing_context,
        pc.pricing_context_key,
        pc.source AS check_source,
        pv.name AS variant_name,
        ROW_NUMBER() OVER (
          PARTITION BY vcr.variant_id, pc.pricing_context, pc.pricing_context_key
          ORDER BY pc.checked_at DESC, pc.id DESC
        ) AS result_rank
      FROM variant_check_results vcr
      JOIN price_checks pc ON pc.id = vcr.check_id
      JOIN product_variants pv ON pv.id = vcr.variant_id
      JOIN products p ON p.id = pc.product_id
      WHERE pc.product_id = @productId
        AND pc.status = 'success'
        AND p.owner_user_id = @ownerUserId
    )
    SELECT *
    FROM ranked_results
    WHERE result_rank = 1
    ORDER BY variant_id, pricing_context, pricing_context_key
  `);
  const historyTimelineStatement = database.prepare(`
    WITH selected_checks AS (
      SELECT pc.*
      FROM price_checks pc
      JOIN products p ON p.id = pc.product_id
      WHERE pc.product_id = @productId
        AND pc.status = 'success'
        AND p.owner_user_id = @ownerUserId
        AND (@fromTimestamp IS NULL OR pc.checked_at >= @fromTimestamp)
        AND (@toTimestamp IS NULL OR pc.checked_at <= @toTimestamp)
        AND EXISTS (
          SELECT 1
          FROM variant_check_results selected_result
          WHERE selected_result.check_id = pc.id
            AND (@variantId IS NULL OR selected_result.variant_id = @variantId)
        )
      ORDER BY pc.checked_at DESC, pc.id DESC
      LIMIT @limit
    )
    SELECT
      selected_checks.id AS check_id,
      selected_checks.checked_at,
      selected_checks.pricing_context,
      selected_checks.pricing_context_key,
      selected_checks.source AS check_source,
      vcr.variant_id,
      vcr.presence,
      vcr.price_status,
      vcr.availability,
      vcr.stock_quantity,
      vcr.reason_code,
      vcr.variant_lifecycle,
      pv.name AS variant_name,
      pl.id AS price_log_id,
      pl.price_amount,
      pl.currency,
      pl.price_definition,
      pl.price_type,
      pl.price_source,
      pl.voucher_status
    FROM selected_checks
    JOIN variant_check_results vcr ON vcr.check_id = selected_checks.id
    JOIN product_variants pv ON pv.id = vcr.variant_id
    LEFT JOIN price_logs pl
      ON pl.check_id = selected_checks.id AND pl.variant_id = vcr.variant_id
    WHERE (@variantId IS NULL OR vcr.variant_id = @variantId)
    ORDER BY selected_checks.checked_at ASC, selected_checks.id ASC, vcr.variant_id ASC
  `);

  return Object.freeze({
    /**
     * Create an owner product check exactly once per idempotency key.
     *
     * @param {object} input
     * @returns {{check: object, created: boolean}}
     */
    createCheck({
      capturedAt = null,
      checkedAt = nowIso(),
      coverageConfidence = 'unknown',
      errorCode = null,
      errorMessage = null,
      expectedVariantCount = null,
      idempotencyKey,
      lifecycleEligible = false,
      observedVariantCount = 0,
      observedVariantSetHash = null,
      ownerUserId,
      pricedVariantCount = 0,
      pricingContext,
      pricingContextKey,
      productId,
      schemaVersion = null,
      source,
      status,
      suspiciousMassDisappearance = false,
      variantCoverage = 'unknown',
    }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      const parameters = {
        capturedAt,
        checkedAt,
        coverageConfidence,
        errorCode,
        errorMessage,
        expectedVariantCount,
        idempotencyKey,
        lifecycleEligible: toDatabaseBoolean(lifecycleEligible),
        observedVariantCount,
        observedVariantSetHash,
        ownerUserId,
        pricedVariantCount,
        pricingContext,
        pricingContextKey,
        productId,
        schemaVersion,
        source,
        status,
        suspiciousMassDisappearance: toDatabaseBoolean(suspiciousMassDisappearance),
        variantCoverage,
      };

      try {
        const inserted = mapCheck(createCheckStatement.get(parameters));

        if (inserted) {
          return { check: inserted, created: true };
        }

        const existing = mapCheck(findCheckByIdempotencyStatement.get(parameters));

        if (!existing) {
          throw new Error('Owner product does not exist');
        }

        assertIdempotentMatch(
          existing,
          {
            capturedAt,
            coverageConfidence,
            errorCode,
            errorMessage,
            expectedVariantCount,
            lifecycleEligible,
            observedVariantCount,
            observedVariantSetHash,
            pricedVariantCount,
            pricingContext,
            pricingContextKey,
            schemaVersion,
            source,
            status,
            suspiciousMassDisappearance,
            variantCoverage,
          },
          'Price check',
        );

        return { check: existing, created: false };
      } catch (error) {
        throwDatabaseError('Unable to create the price check', error);
      }
    },

    /**
     * Find one replay/idempotency record inside an owner product scope.
     *
     * @param {{idempotencyKey: string, ownerUserId: number, productId: number}} input
     */
    findCheckByIdempotency({ idempotencyKey, ownerUserId, productId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return mapCheck(
          findCheckByIdempotencyStatement.get({ idempotencyKey, ownerUserId, productId }),
        );
      } catch (error) {
        throwDatabaseError('Unable to find the idempotent price check', error);
      }
    },

    /**
     * Find the immediately previous comparable available price.
     *
     * @param {object} input
     */
    findLatestComparable({
      currency,
      excludePriceLogId = null,
      ownerUserId,
      priceDefinition,
      priceSource,
      priceType,
      pricingContext,
      pricingContextKey,
      variantId,
    }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(variantId, 'variantId');

      try {
        return mapPriceLog(
          latestComparableStatement.get({
            currency,
            excludePriceLogId,
            ownerUserId,
            priceDefinition,
            priceSource,
            priceType,
            pricingContext,
            pricingContextKey,
            variantId,
          }),
        );
      } catch (error) {
        throwDatabaseError('Unable to find the latest comparable price', error);
      }
    },

    /** Return the most recent extension installation key for one product. */
    findLatestUserSessionContextKey({ ownerUserId, productId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return (
          latestUserSessionContextStatement.get({ ownerUserId, productId })?.pricing_context_key ??
          null
        );
      } catch (error) {
        throwDatabaseError('Unable to find the latest user-session context', error);
      }
    },

    /**
     * Insert one per-variant result without creating null price rows.
     *
     * @param {object} input
     * @returns {{created: boolean, result: object}}
     */
    insertCheckResult({
      availability,
      checkId,
      createdAt = nowIso(),
      lifecycleEligible,
      ownerUserId,
      presence,
      priceStatus,
      reasonCode = null,
      stockQuantity = null,
      variantId,
      variantLifecycle,
    }) {
      assertIdentifier(checkId, 'checkId');
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(variantId, 'variantId');

      const parameters = {
        availability,
        checkId,
        createdAt,
        lifecycleEligible: toDatabaseBoolean(lifecycleEligible),
        ownerUserId,
        presence,
        priceStatus,
        reasonCode,
        stockQuantity,
        variantId,
        variantLifecycle,
      };

      try {
        const inserted = mapCheckResult(insertCheckResultStatement.get(parameters));

        if (inserted) {
          return { created: true, result: inserted };
        }

        const existing = mapCheckResult(findCheckResultStatement.get(parameters));

        if (!existing) {
          throw new Error('Check and variant are outside the owner product scope');
        }

        assertIdempotentMatch(
          existing,
          {
            availability,
            lifecycleEligible,
            presence,
            priceStatus,
            reasonCode,
            stockQuantity,
            variantLifecycle,
          },
          'Variant check result',
        );

        return { created: false, result: existing };
      } catch (error) {
        throwDatabaseError('Unable to insert the variant check result', error);
      }
    },

    /**
     * Insert one validated observed price.
     *
     * @param {object} input
     * @returns {{created: boolean, priceLog: object}}
     */
    insertPriceLog({
      availability,
      checkId,
      currency,
      ownerUserId,
      priceAmount,
      priceDefinition,
      priceSource,
      priceType,
      pricingContext,
      pricingContextKey,
      recordedAt = nowIso(),
      shippingIncluded = false,
      variantId,
      voucherStatus,
    }) {
      assertIdentifier(checkId, 'checkId');
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(variantId, 'variantId');

      const parameters = {
        availability,
        checkId,
        currency,
        ownerUserId,
        priceAmount,
        priceDefinition,
        priceSource,
        priceType,
        pricingContext,
        pricingContextKey,
        recordedAt,
        shippingIncluded: toDatabaseBoolean(shippingIncluded),
        variantId,
        voucherStatus,
      };

      try {
        const inserted = mapPriceLog(insertPriceLogStatement.get(parameters));

        if (inserted) {
          return { created: true, priceLog: inserted };
        }

        const existing = mapPriceLog(findPriceLogStatement.get(parameters));

        if (!existing) {
          throw new Error('Check and variant are outside the owner product scope');
        }

        assertIdempotentMatch(
          existing,
          {
            availability,
            currency,
            priceAmount,
            priceDefinition,
            priceSource,
            priceType,
            pricingContext,
            pricingContextKey,
            shippingIncluded,
            voucherStatus,
          },
          'Price log',
        );

        return { created: false, priceLog: existing };
      } catch (error) {
        throwDatabaseError('Unable to insert the price log', error);
      }
    },

    /**
     * List per-variant check outcomes for one owner check.
     *
     * @param {{checkId: number, ownerUserId: number}} input
     */
    listCheckResults({ checkId, ownerUserId }) {
      assertIdentifier(checkId, 'checkId');
      assertIdentifier(ownerUserId, 'ownerUserId');

      try {
        return listCheckResultsStatement
          .all({ checkId, ownerUserId })
          .map((row) => mapCheckResult(row));
      } catch (error) {
        throwDatabaseError('Unable to list variant check results', error);
      }
    },

    /**
     * List real price history with optional owner-scoped filters.
     *
     * @param {object} input
     */
    listHistory({
      from: fromTimestamp = null,
      limit = 500,
      ownerUserId,
      productId,
      to: toTimestamp = null,
      variantId = null,
    }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      if (variantId !== null) {
        assertIdentifier(variantId, 'variantId');
      }

      try {
        return historyStatement
          .all({
            fromTimestamp,
            limit,
            ownerUserId,
            productId,
            toTimestamp,
            variantId,
          })
          .map((row) => mapPriceLog(row));
      } catch (error) {
        throwDatabaseError('Unable to list price history', error);
      }
    },

    /**
     * List the latest real price for each variant and pricing-context stream.
     *
     * @param {{ownerUserId: number, productId: number}} input
     */
    listLatestPricesByProduct({ ownerUserId, productId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return latestPricesByProductStatement
          .all({ ownerUserId, productId })
          .map((row) => mapCurrentPrice(row));
      } catch (error) {
        throwDatabaseError('Unable to list current product prices', error);
      }
    },

    /**
     * List the latest check result for each variant and pricing-context stream.
     *
     * @param {{ownerUserId: number, productId: number}} input
     */
    listLatestResultsByProduct({ ownerUserId, productId }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      try {
        return latestResultsByProductStatement
          .all({ ownerUserId, productId })
          .map((row) => mapLatestResult(row));
      } catch (error) {
        throwDatabaseError('Unable to list current product check results', error);
      }
    },

    /**
     * List check-aligned variant outcomes and optional real price values.
     *
     * @param {object} input
     */
    listHistoryTimeline({
      from: fromTimestamp = null,
      limit = 500,
      ownerUserId,
      productId,
      to: toTimestamp = null,
      variantId = null,
    }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(productId, 'productId');

      if (variantId !== null) {
        assertIdentifier(variantId, 'variantId');
      }

      try {
        return historyTimelineStatement
          .all({
            fromTimestamp,
            limit,
            ownerUserId,
            productId,
            toTimestamp,
            variantId,
          })
          .map((row) => mapHistoryTimelinePoint(row));
      } catch (error) {
        throwDatabaseError('Unable to list product history timeline', error);
      }
    },

    /**
     * List observed prices grouped under one owner check.
     *
     * @param {{checkId: number, ownerUserId: number}} input
     */
    listPriceLogsByCheck({ checkId, ownerUserId }) {
      assertIdentifier(checkId, 'checkId');
      assertIdentifier(ownerUserId, 'ownerUserId');

      try {
        return listPriceLogsByCheckStatement
          .all({ checkId, ownerUserId })
          .map((row) => mapPriceLog(row));
      } catch (error) {
        throwDatabaseError('Unable to list check price logs', error);
      }
    },
  });
}
