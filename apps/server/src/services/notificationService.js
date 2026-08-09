import { logger } from '../logging/logger.js';
import { formatTelegramPriceDropMessage } from './telegramMessageFormatter.js';

function emptySummary(disabled = false) {
  return {
    disabled,
    eligible: 0,
    failed: 0,
    sent: 0,
    skipped: 0,
  };
}

/** Deliver post-commit price-drop candidates and persist only confirmed sends. */
export function createNotificationService({
  clock = () => new Date(),
  notificationLogger = logger,
  repositories,
  telegramClient,
}) {
  let pendingDelivery = Promise.resolve();

  function enqueue(work) {
    const operation = pendingDelivery.then(work);
    pendingDelivery = operation.catch(() => {});
    return operation;
  }

  async function deliverCandidate({ comparison, product, variant }) {
    const transition = comparison.transition;

    try {
      const existing = repositories.notifications.findTransition(transition);

      if (existing) {
        return 'skipped';
      }

      const text = formatTelegramPriceDropMessage({
        dropPercentage: comparison.dropPercentage,
        newPriceAmount: transition.newPriceAmount,
        oldPriceAmount: transition.oldPriceAmount,
        priceDefinition: transition.priceDefinition,
        pricingContext: transition.pricingContext,
        productTitle: product.title,
        productUrl: product.canonicalUrl,
        variantName: variant.name,
      });
      await telegramClient.sendMessage(text);
      const recorded = repositories.notifications.recordSent({
        ...transition,
        sentAt: clock().toISOString(),
      });
      notificationLogger.info(
        {
          notificationEventId: recorded.notification.id,
          pricingContext: transition.pricingContext,
          productId: product.id,
          variantId: transition.variantId,
        },
        recorded.created
          ? 'Telegram price-drop notification sent'
          : 'Telegram price-drop notification already recorded',
      );
      return recorded.created ? 'sent' : 'skipped';
    } catch (error) {
      notificationLogger.warn(
        {
          errorCode: error?.code ?? 'TELEGRAM_ERROR',
          pricingContext: transition.pricingContext,
          productId: product.id,
          variantId: transition.variantId,
        },
        'Telegram price-drop notification failed after price history was saved',
      );
      return 'failed';
    }
  }

  return Object.freeze({
    /** Process all qualifying comparisons from one committed tracking result. */
    async deliverTrackingResult(trackingResult) {
      const candidates = (trackingResult?.comparisons ?? []).filter(
        (entry) => entry.comparison?.shouldNotify === true && entry.comparison.transition,
      );
      const summary = emptySummary(!telegramClient.enabled);
      summary.eligible = candidates.length;

      if (!telegramClient.enabled || candidates.length === 0) {
        return summary;
      }

      return enqueue(async () => {
        for (const candidate of candidates) {
          const outcome = await deliverCandidate({
            ...candidate,
            product: trackingResult.product,
          });
          summary[outcome] += 1;
        }

        return summary;
      });
    },
  });
}
