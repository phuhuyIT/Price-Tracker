import { ERROR_CODES, PRICING_CONTEXTS } from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';

function streamKey(record) {
  return `${record.variantId}:${record.pricingContext}:${record.pricingContextKey}`;
}

function groupBy(items, getKey) {
  const groups = new Map();

  for (const item of items) {
    const key = getKey(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  return groups;
}

function compareRecordedAtDescending(left, right) {
  return right.recordedAt.localeCompare(left.recordedAt) || right.priceLogId - left.priceLogId;
}

function latestPriceForContext(prices, pricingContext) {
  return (
    prices
      .filter((price) => price.pricingContext === pricingContext)
      .sort(compareRecordedAtDescending)[0] ?? null
  );
}

function selectLowestPrice(prices) {
  if (prices.length === 0) {
    return null;
  }

  return [...prices].sort(
    (left, right) =>
      left.priceAmount - right.priceAmount ||
      right.recordedAt.localeCompare(left.recordedAt) ||
      left.variantId - right.variantId,
  )[0];
}

function productNotFound() {
  return new AppError({
    code: ERROR_CODES.PRODUCT_NOT_FOUND,
    message: 'The tracked product was not found',
    statusCode: 404,
  });
}

function publicLatestResult(result) {
  if (!result) {
    return null;
  }

  return {
    availability: result.availability,
    checkedAt: result.checkedAt,
    presence: result.presence,
    priceStatus: result.priceStatus,
    reasonCode: result.reasonCode,
    variantLifecycle: result.variantLifecycle,
  };
}

function publicProduct(product) {
  return {
    alertThresholdPercent: product.alertThresholdPercent,
    canonicalUrl: product.canonicalUrl,
    createdAt: product.createdAt,
    currency: product.currency,
    id: product.id,
    imageUrl: product.imageUrl,
    itemId: product.itemId,
    lastCheckedAt: product.lastCheckedAt,
    lastSuccessAt: product.lastSuccessAt,
    platform: product.platform,
    shopId: product.shopId,
    status: product.status,
    title: product.title,
    updatedAt: product.updatedAt,
  };
}

function publicVariant(variant) {
  return {
    availability: variant.currentAvailability,
    availabilityUpdatedAt: variant.availabilityUpdatedAt,
    consecutiveCompleteMisses: variant.consecutiveCompleteMisses,
    id: variant.id,
    identityType: variant.identityType,
    inactiveReason: variant.inactiveReason,
    lastSeenAt: variant.lastSeenAt,
    lifecycleStatus: variant.lifecycleStatus,
    missingSince: variant.missingSince,
    modelId: variant.externalModelId,
    name: variant.name,
  };
}

function decorateProduct(product, repositories, ownerUserId) {
  const variants = repositories.variants.listByProduct({
    ownerUserId,
    productId: product.id,
  });
  const latestPrices = repositories.prices.listLatestPricesByProduct({
    ownerUserId,
    productId: product.id,
  });
  const latestResults = repositories.prices.listLatestResultsByProduct({
    ownerUserId,
    productId: product.id,
  });
  const latestResultByStream = new Map(latestResults.map((result) => [streamKey(result), result]));

  const decoratedPrices = latestPrices.map((price) => {
    const latestResult = latestResultByStream.get(streamKey(price)) ?? null;
    const isCurrent =
      latestResult?.checkId === price.checkId && latestResult.priceStatus === 'observed';

    return {
      availability: price.availability,
      currency: price.currency,
      displayStatus: isCurrent ? 'current' : 'last_known',
      isCurrent,
      latestResult: publicLatestResult(latestResult),
      priceAmount: price.priceAmount,
      priceDefinition: price.priceDefinition,
      priceLogId: price.id,
      priceSource: price.priceSource,
      priceType: price.priceType,
      pricingContext: price.pricingContext,
      pricingContextKey: price.pricingContextKey,
      recordedAt: price.recordedAt,
      variantId: price.variantId,
      variantName: price.variantName,
      voucherStatus: price.voucherStatus,
    };
  });
  const pricesByVariant = groupBy(decoratedPrices, (price) => price.variantId);
  const decoratedVariants = variants.map((variant) => {
    const prices = pricesByVariant.get(variant.id) ?? [];
    const preferredPrice =
      latestPriceForContext(prices, PRICING_CONTEXTS.USER_SESSION) ??
      latestPriceForContext(prices, PRICING_CONTEXTS.ANONYMOUS);

    return {
      ...publicVariant(variant),
      latestPrices: prices,
      preferredPrice,
    };
  });
  const activeVariants = decoratedVariants.filter(
    (variant) => variant.lifecycleStatus === 'active',
  );

  function lowestForContext(pricingContext) {
    const prices = activeVariants
      .map((variant) => latestPriceForContext(variant.latestPrices, pricingContext))
      .filter(Boolean);
    const price = selectLowestPrice(prices);

    return price ? { ...price, pricingContext } : null;
  }

  const userSessionLowest = lowestForContext(PRICING_CONTEXTS.USER_SESSION);
  const anonymousLowest = lowestForContext(PRICING_CONTEXTS.ANONYMOUS);
  const lowestPricesByContext = [userSessionLowest, anonymousLowest].filter(Boolean);
  const currentLowestPrice = userSessionLowest ?? anonymousLowest ?? null;

  return {
    ...publicProduct(product),
    activeVariantCount: activeVariants.length,
    currentLowestPrice,
    lastError:
      product.lastErrorCode === null
        ? null
        : {
            code: product.lastErrorCode,
            message: product.lastErrorMessage,
          },
    lowestPricesByContext,
    preferredPricingContext: currentLowestPrice?.pricingContext ?? null,
    variantCount: decoratedVariants.length,
    variants: decoratedVariants,
  };
}

function assertPagination(page, limit) {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new TypeError('page must be a positive safe integer');
  }

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('limit must be a safe integer between 1 and 100');
  }
}

/**
 * Create owner-scoped product summaries, details, and chart-ready history.
 *
 * @param {object} input
 * @param {object} input.repositories
 */
export function createProductQueryService({ repositories }) {
  function getProduct({ ownerUserId, productId }) {
    const product = repositories.products.findById({ ownerUserId, productId });

    if (!product) {
      throw productNotFound();
    }

    return decorateProduct(product, repositories, ownerUserId);
  }

  return Object.freeze({
    /**
     * Return complete product and variant state for one owner.
     */
    getProduct,

    /**
     * Build check-aligned chart points. A null y-value represents a persisted
     * not-observed check result; no null or zero price row is stored.
     *
     * @param {object} input
     */
    getHistory({ from = null, limit = 500, ownerUserId, productId, to = null, variantId = null }) {
      const product = repositories.products.findById({ ownerUserId, productId });

      if (!product) {
        throw productNotFound();
      }

      if (variantId !== null) {
        const variant = repositories.variants.findById({ ownerUserId, variantId });

        if (!variant || variant.productId !== productId) {
          throw productNotFound();
        }
      }

      const timeline = repositories.prices.listHistoryTimeline({
        from,
        limit,
        ownerUserId,
        productId,
        to,
        variantId,
      });
      const grouped = groupBy(
        timeline,
        (point) => `${point.variantId}:${point.pricingContext}:${point.pricingContextKey}`,
      );
      const datasets = [...grouped.values()].map((points) => {
        const first = points[0];

        return {
          data: points.map((point) => ({
            availability: point.availability,
            checkId: point.checkId,
            priceSource: point.priceSource,
            reasonCode: point.reasonCode,
            voucherStatus: point.voucherStatus,
            x: point.checkedAt,
            y: point.priceStatus === 'observed' ? point.priceAmount : null,
          })),
          label: `${first.variantName} (${first.pricingContext})`,
          pricingContext: first.pricingContext,
          pricingContextKey: first.pricingContextKey,
          variantId: first.variantId,
        };
      });
      const labels = [...new Set(timeline.map((point) => point.checkedAt))].sort();

      return {
        datasets,
        labels,
        productId,
      };
    },

    /**
     * Return one page of owner products with context-safe current prices.
     *
     * @param {object} input
     */
    listProducts({ limit = 20, ownerUserId, page = 1 }) {
      assertPagination(page, limit);
      const total = repositories.products.countByOwner(ownerUserId);
      const offset = (page - 1) * limit;
      const products = repositories.products
        .listByOwner({ limit, offset, ownerUserId })
        .map((product) => decorateProduct(product, repositories, ownerUserId));

      return {
        items: products,
        pagination: {
          limit,
          page,
          pages: total === 0 ? 0 : Math.ceil(total / limit),
          total,
        },
      };
    },
  });
}
