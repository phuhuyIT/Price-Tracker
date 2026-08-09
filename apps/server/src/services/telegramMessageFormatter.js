const priceFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

const PRICE_DEFINITION_LABELS = Object.freeze({
  displayed_post_voucher_excluding_shipping:
    'Displayed after applicable discounts and vouchers, excluding shipping',
});

const PRICING_CONTEXT_LABELS = Object.freeze({
  anonymous: 'Anonymous',
  user_session: 'User session',
});

/** Escape text for Telegram's HTML parse mode. */
export function escapeTelegramHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Format one positive integer VND amount for a Telegram alert. */
export function formatTelegramVnd(priceAmount) {
  if (!Number.isSafeInteger(priceAmount) || priceAmount <= 0) {
    throw new TypeError('Telegram prices must be positive safe integers');
  }

  return `${priceFormatter.format(priceAmount)} VND`;
}

/** Build one HTML-safe Telegram price-drop alert. */
export function formatTelegramPriceDropMessage({
  dropPercentage,
  newPriceAmount,
  oldPriceAmount,
  priceDefinition,
  pricingContext,
  productTitle,
  productUrl,
  variantName,
}) {
  if (!Number.isFinite(dropPercentage) || dropPercentage <= 0) {
    throw new TypeError('Telegram price-drop percentage must be positive');
  }

  const definitionLabel = PRICE_DEFINITION_LABELS[priceDefinition] ?? priceDefinition;
  const contextLabel = PRICING_CONTEXT_LABELS[pricingContext] ?? pricingContext;

  return [
    '🚨 <b>PRICE DROP ALERT</b>',
    '',
    `<b>Product:</b> ${escapeTelegramHtml(productTitle)}`,
    `<b>Variant:</b> ${escapeTelegramHtml(variantName)}`,
    `<b>Old price:</b> ${formatTelegramVnd(oldPriceAmount)}`,
    `<b>New price:</b> ${formatTelegramVnd(newPriceAmount)}`,
    `<b>Price reduction:</b> ${dropPercentage.toFixed(1)}%`,
    `<b>Price definition:</b> ${escapeTelegramHtml(definitionLabel)}`,
    `<b>Pricing context:</b> ${escapeTelegramHtml(contextLabel)}`,
    '',
    '<b>Product link:</b>',
    escapeTelegramHtml(productUrl),
  ].join('\n');
}
