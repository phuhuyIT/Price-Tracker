const COMPARISON_REASONS = Object.freeze({
  BELOW_THRESHOLD: 'below_threshold',
  DUPLICATE_TRANSITION: 'duplicate_transition',
  INITIAL_BASELINE: 'initial_baseline',
  INVALID_CURRENT_PRICE: 'invalid_current_price',
  NEW_BASELINE_AFTER_REACTIVATION: 'new_baseline_after_reactivation',
  PRICE_INCREASED: 'price_increased',
  PRICE_UNCHANGED: 'price_unchanged',
  QUALIFYING_DROP: 'qualifying_drop',
  UNAVAILABLE_CURRENT_PRICE: 'unavailable_current_price',
});

function noAlert(reason, extra = {}) {
  return {
    dropPercentage: null,
    previousPrice: null,
    reason,
    shouldNotify: false,
    ...extra,
  };
}

/**
 * Calculate the percentage decrease between two positive integer amounts.
 *
 * @param {number} oldPriceAmount
 * @param {number} newPriceAmount
 * @returns {number}
 */
export function calculatePriceDropPercentage(oldPriceAmount, newPriceAmount) {
  if (
    !Number.isSafeInteger(oldPriceAmount) ||
    oldPriceAmount <= 0 ||
    !Number.isSafeInteger(newPriceAmount) ||
    newPriceAmount <= 0
  ) {
    throw new TypeError('Price amounts must be positive safe integers');
  }

  return ((oldPriceAmount - newPriceAmount) / oldPriceAmount) * 100;
}

/**
 * Create comparable-price and notification-candidate business logic.
 *
 * @param {object} input
 * @param {object} input.repositories
 */
export function createPriceComparisonService({ repositories }) {
  return Object.freeze({
    /**
     * Evaluate one newly persisted price without sending a notification.
     *
     * @param {object} input
     * @param {object} input.currentPrice
     * @param {boolean} [input.isNewBaseline]
     * @param {number} input.ownerUserId
     * @param {number} input.thresholdPercent
     */
    evaluate({ currentPrice, isNewBaseline = false, ownerUserId, thresholdPercent }) {
      if (
        !currentPrice ||
        !Number.isSafeInteger(currentPrice.priceAmount) ||
        currentPrice.priceAmount <= 0
      ) {
        return noAlert(COMPARISON_REASONS.INVALID_CURRENT_PRICE);
      }

      if (currentPrice.availability !== 'available') {
        return noAlert(COMPARISON_REASONS.UNAVAILABLE_CURRENT_PRICE);
      }

      if (isNewBaseline) {
        return noAlert(COMPARISON_REASONS.NEW_BASELINE_AFTER_REACTIVATION);
      }

      const previousPrice = repositories.prices.findLatestComparable({
        currency: currentPrice.currency,
        excludePriceLogId: currentPrice.id,
        ownerUserId,
        priceDefinition: currentPrice.priceDefinition,
        priceSource: currentPrice.priceSource,
        priceType: currentPrice.priceType,
        pricingContext: currentPrice.pricingContext,
        pricingContextKey: currentPrice.pricingContextKey,
        variantId: currentPrice.variantId,
      });

      if (!previousPrice) {
        return noAlert(COMPARISON_REASONS.INITIAL_BASELINE);
      }

      if (currentPrice.priceAmount === previousPrice.priceAmount) {
        return noAlert(COMPARISON_REASONS.PRICE_UNCHANGED, { previousPrice });
      }

      if (currentPrice.priceAmount > previousPrice.priceAmount) {
        return noAlert(COMPARISON_REASONS.PRICE_INCREASED, { previousPrice });
      }

      const dropPercentage = calculatePriceDropPercentage(
        previousPrice.priceAmount,
        currentPrice.priceAmount,
      );

      if (dropPercentage < thresholdPercent) {
        return noAlert(COMPARISON_REASONS.BELOW_THRESHOLD, {
          dropPercentage,
          previousPrice,
        });
      }

      const existingNotification = repositories.notifications.findTransition({
        newPriceAmount: currentPrice.priceAmount,
        oldPriceAmount: previousPrice.priceAmount,
        ownerUserId,
        priceDefinition: currentPrice.priceDefinition,
        priceType: currentPrice.priceType,
        pricingContext: currentPrice.pricingContext,
        pricingContextKey: currentPrice.pricingContextKey,
        variantId: currentPrice.variantId,
      });

      if (existingNotification) {
        return noAlert(COMPARISON_REASONS.DUPLICATE_TRANSITION, {
          dropPercentage,
          existingNotification,
          previousPrice,
        });
      }

      return {
        dropPercentage,
        previousPrice,
        reason: COMPARISON_REASONS.QUALIFYING_DROP,
        shouldNotify: true,
        transition: {
          currency: currentPrice.currency,
          currentPriceLogId: currentPrice.id,
          newPriceAmount: currentPrice.priceAmount,
          oldPriceAmount: previousPrice.priceAmount,
          ownerUserId,
          previousPriceLogId: previousPrice.id,
          priceDefinition: currentPrice.priceDefinition,
          priceType: currentPrice.priceType,
          pricingContext: currentPrice.pricingContext,
          pricingContextKey: currentPrice.pricingContextKey,
          variantId: currentPrice.variantId,
        },
      };
    },
  });
}

export { COMPARISON_REASONS };
