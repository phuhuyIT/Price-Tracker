const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const vndFormatter = new Intl.NumberFormat('vi-VN', {
  currency: 'VND',
  maximumFractionDigits: 0,
  style: 'currency',
});

const CONTEXT_LABELS = Object.freeze({
  anonymous: 'Anonymous collector',
  unknown: 'Unknown context',
  user_session: 'Your Chrome session',
});

const SOURCE_LABELS = Object.freeze({
  dom_display_fallback: 'Page display fallback',
  product_detail_fallback: 'Product detail fallback',
  unknown: 'Unknown source',
  variation_price_breakdown: 'Variant price API',
  verified_display_field: 'Verified display price',
});

const VOUCHER_LABELS = Object.freeze({
  applied: 'Voucher applied',
  not_applied: 'No voucher applied',
  not_available: 'Voucher unavailable',
  unknown: 'Voucher unknown',
});

const AVAILABILITY_LABELS = Object.freeze({
  available: 'Available',
  sold_out: 'Sold out',
  unavailable: 'Unavailable',
  unknown: 'Availability unknown',
});

const LIFECYCLE_LABELS = Object.freeze({
  active: 'Active variant',
  inactive: 'Inactive variant',
  suspected_missing: 'Possibly removed',
});

/** Format a positive integer VND amount for display. */
export function formatVnd(amount) {
  return Number.isSafeInteger(amount) && amount > 0 ? vndFormatter.format(amount) : 'Not observed';
}

/** Format an ISO timestamp in the browser's locale. */
export function formatDateTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? dateFormatter.format(timestamp) : 'Never';
}

export function contextLabel(value) {
  return CONTEXT_LABELS[value] ?? 'Unknown context';
}

export function priceSourceLabel(value) {
  return SOURCE_LABELS[value] ?? 'Unknown source';
}

export function voucherLabel(value) {
  return VOUCHER_LABELS[value] ?? 'Voucher unknown';
}

export function availabilityLabel(value) {
  return AVAILABILITY_LABELS[value] ?? 'Availability unknown';
}

export function lifecycleLabel(value) {
  return LIFECYCLE_LABELS[value] ?? 'Unknown lifecycle';
}

export function badgeTone(value) {
  if (['active', 'applied', 'available', 'current'].includes(value)) {
    return 'success';
  }

  if (['inactive', 'sold_out', 'unavailable'].includes(value)) {
    return 'danger';
  }

  if (['anonymous', 'last_known', 'not_observed', 'suspected_missing', 'unknown'].includes(value)) {
    return 'warning';
  }

  return 'info';
}

function compareDisplayPrices(left, right) {
  return (
    left.priceAmount - right.priceAmount ||
    String(right.recordedAt).localeCompare(String(left.recordedAt))
  );
}

/** Select the current price, or a clearly labelled retained observation. */
export function selectProductDisplayPrice(product) {
  if (product?.currentLowestPrice) {
    return product.currentLowestPrice;
  }

  const retained = (product?.variants ?? [])
    .map((variant) => ({
      lifecycleRank: variant.lifecycleStatus === 'active' ? 0 : 1,
      price: variant.preferredPrice,
    }))
    .filter((candidate) => candidate.price)
    .sort(
      (left, right) =>
        left.lifecycleRank - right.lifecycleRank || compareDisplayPrices(left.price, right.price),
    );

  return retained[0]?.price ?? null;
}

export function displayPriceLabel(price) {
  if (!price) {
    return 'No price observed';
  }

  if (price.displayStatus === 'last_known') {
    return 'Last known price';
  }

  if (price.displayStatus === 'unavailable') {
    return 'Last observed · not purchasable';
  }

  return 'Current lowest price';
}

function plural(count, singular, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

/** Build user-facing transparency warnings from the complete API summary. */
export function buildProductWarnings(product) {
  const warnings = [];
  const displayPrice = selectProductDisplayPrice(product);
  const variants = product?.variants ?? [];

  if (displayPrice?.pricingContext === 'anonymous') {
    warnings.push({
      code: 'anonymous_price',
      message: 'This price was observed anonymously and may differ from your Chrome session.',
      severity: 'warning',
    });
  }

  if (['dom_display_fallback', 'product_detail_fallback'].includes(displayPrice?.priceSource)) {
    warnings.push({
      code: 'fallback_price',
      message: 'This is a fallback observation; Shopee did not expose the preferred price field.',
      severity: 'warning',
    });
  }

  if (displayPrice?.voucherStatus === 'unknown') {
    warnings.push({
      code: 'voucher_unknown',
      message: 'Voucher status is unknown for the displayed observation.',
      severity: 'warning',
    });
  }

  if (product?.lastError) {
    warnings.push({
      code: 'latest_check_failed',
      message: `Latest check failed: ${product.lastError.message}`,
      severity: 'error',
    });
  }

  const notObserved = variants.filter((variant) =>
    variant.latestResults?.some((result) => result.priceStatus === 'not_observed'),
  );
  if (notObserved.length > 0) {
    warnings.push({
      code: 'prices_not_observed',
      message: `${plural(notObserved.length, 'variant')} had no price in its latest check.`,
      severity: 'warning',
    });
  }

  const lifecycleWarnings = variants.filter((variant) => variant.lifecycleStatus !== 'active');
  if (lifecycleWarnings.length > 0) {
    warnings.push({
      code: 'variant_lifecycle',
      message: `${plural(lifecycleWarnings.length, 'variant')} may be missing or inactive. Open variants for last-seen details.`,
      severity: 'warning',
    });
  }

  const soldOut = variants.filter((variant) => variant.availability === 'sold_out');
  if (soldOut.length > 0) {
    warnings.push({
      code: 'sold_out',
      message: `${plural(soldOut.length, 'variant')} currently sold out.`,
      severity: 'warning',
    });
  }

  const sessionPrice = product?.lowestPricesByContext?.find(
    (price) => price.pricingContext === 'user_session',
  );
  const anonymousPrice = product?.lowestPricesByContext?.find(
    (price) => price.pricingContext === 'anonymous',
  );
  if (sessionPrice && anonymousPrice && sessionPrice.priceAmount !== anonymousPrice.priceAmount) {
    warnings.push({
      code: 'context_price_difference',
      message: `Your Chrome-session price differs from the retained anonymous price (${formatVnd(anonymousPrice.priceAmount)}).`,
      severity: 'warning',
    });
  }

  return warnings;
}

/** Convert a datetime-local control value into the API's ISO timestamp. */
export function localDateTimeToIso(value) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}
