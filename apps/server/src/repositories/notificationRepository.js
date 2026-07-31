import { assertIdentifier, nowIso, throwDatabaseError } from './repositoryUtils.js';

function mapNotification(row) {
  if (!row) {
    return null;
  }

  return {
    currency: row.currency,
    currentPriceLogId: row.current_price_log_id,
    id: row.id,
    newPriceAmount: row.new_price_amount,
    oldPriceAmount: row.old_price_amount,
    previousPriceLogId: row.previous_price_log_id,
    priceDefinition: row.price_definition,
    priceType: row.price_type,
    pricingContext: row.pricing_context,
    pricingContextKey: row.pricing_context_key,
    sentAt: row.sent_at,
    variantId: row.variant_id,
  };
}

/**
 * Create owner-scoped successful-notification persistence operations.
 *
 * @param {import('better-sqlite3').Database} database
 */
export function createNotificationRepository(database) {
  const insertStatement = database.prepare(`
    INSERT INTO notification_events (
      variant_id,
      previous_price_log_id,
      current_price_log_id,
      old_price_amount,
      new_price_amount,
      currency,
      price_definition,
      price_type,
      pricing_context,
      pricing_context_key,
      sent_at
    )
    SELECT
      current_price.variant_id,
      previous_price.id,
      current_price.id,
      previous_price.price_amount,
      current_price.price_amount,
      current_price.currency,
      current_price.price_definition,
      current_price.price_type,
      current_price.pricing_context,
      current_price.pricing_context_key,
      @sentAt
    FROM price_logs previous_price
    JOIN price_logs current_price
      ON current_price.variant_id = previous_price.variant_id
    JOIN product_variants pv ON pv.id = current_price.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE previous_price.id = @previousPriceLogId
      AND current_price.id = @currentPriceLogId
      AND current_price.variant_id = @variantId
      AND p.owner_user_id = @ownerUserId
      AND previous_price.price_amount = @oldPriceAmount
      AND current_price.price_amount = @newPriceAmount
      AND current_price.currency = @currency
      AND previous_price.currency = current_price.currency
      AND current_price.price_definition = @priceDefinition
      AND previous_price.price_definition = current_price.price_definition
      AND current_price.price_type = @priceType
      AND previous_price.price_type = current_price.price_type
      AND current_price.pricing_context = @pricingContext
      AND previous_price.pricing_context = current_price.pricing_context
      AND current_price.pricing_context_key = @pricingContextKey
      AND previous_price.pricing_context_key = current_price.pricing_context_key
      AND previous_price.price_source = current_price.price_source
    ON CONFLICT(
      variant_id,
      old_price_amount,
      new_price_amount,
      price_definition,
      price_type,
      pricing_context,
      pricing_context_key
    ) DO NOTHING
    RETURNING *
  `);
  const findStatement = database.prepare(`
    SELECT ne.*
    FROM notification_events ne
    JOIN product_variants pv ON pv.id = ne.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE ne.variant_id = @variantId
      AND ne.old_price_amount = @oldPriceAmount
      AND ne.new_price_amount = @newPriceAmount
      AND ne.price_definition = @priceDefinition
      AND ne.price_type = @priceType
      AND ne.pricing_context = @pricingContext
      AND ne.pricing_context_key = @pricingContextKey
      AND p.owner_user_id = @ownerUserId
  `);

  function queryTransition(parameters) {
    return mapNotification(findStatement.get(parameters));
  }

  return Object.freeze({
    /**
     * Find whether an exact comparable transition was already sent.
     *
     * @param {object} input
     */
    findTransition({
      newPriceAmount,
      oldPriceAmount,
      ownerUserId,
      priceDefinition,
      priceType,
      pricingContext,
      pricingContextKey,
      variantId,
    }) {
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(variantId, 'variantId');

      try {
        return queryTransition({
          newPriceAmount,
          oldPriceAmount,
          ownerUserId,
          priceDefinition,
          priceType,
          pricingContext,
          pricingContextKey,
          variantId,
        });
      } catch (error) {
        throwDatabaseError('Unable to find the notification transition', error);
      }
    },

    /**
     * Persist an exact transition only after successful notification delivery.
     *
     * @param {object} input
     * @returns {{created: boolean, notification: object}}
     */
    recordSent({
      currency,
      currentPriceLogId,
      newPriceAmount,
      oldPriceAmount,
      ownerUserId,
      previousPriceLogId,
      priceDefinition,
      priceType,
      pricingContext,
      pricingContextKey,
      sentAt = nowIso(),
      variantId,
    }) {
      assertIdentifier(currentPriceLogId, 'currentPriceLogId');
      assertIdentifier(ownerUserId, 'ownerUserId');
      assertIdentifier(previousPriceLogId, 'previousPriceLogId');
      assertIdentifier(variantId, 'variantId');

      const parameters = {
        currency,
        currentPriceLogId,
        newPriceAmount,
        oldPriceAmount,
        ownerUserId,
        previousPriceLogId,
        priceDefinition,
        priceType,
        pricingContext,
        pricingContextKey,
        sentAt,
        variantId,
      };

      try {
        const inserted = mapNotification(insertStatement.get(parameters));

        if (inserted) {
          return { created: true, notification: inserted };
        }

        const existing = queryTransition(parameters);

        if (!existing) {
          throw new Error('Notification price logs are outside the owner scope');
        }

        return { created: false, notification: existing };
      } catch (error) {
        throwDatabaseError('Unable to record the notification transition', error);
      }
    },
  });
}
