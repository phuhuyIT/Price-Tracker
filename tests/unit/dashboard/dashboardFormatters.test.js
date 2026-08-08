import { describe, expect, it } from 'vitest';

import {
  buildProductWarnings,
  displayPriceLabel,
  formatVnd,
  localDateTimeToIso,
  selectProductDisplayPrice,
} from '../../../apps/server/public/js/dashboardFormatters.js';

function observedPrice(overrides = {}) {
  return {
    displayStatus: 'current',
    priceAmount: 199_000,
    priceSource: 'variation_price_breakdown',
    pricingContext: 'user_session',
    recordedAt: '2026-08-08T01:00:00.000Z',
    voucherStatus: 'applied',
    ...overrides,
  };
}

describe('dashboard formatters', () => {
  it('formats only positive integer VND prices', () => {
    const expected = new Intl.NumberFormat('vi-VN', {
      currency: 'VND',
      maximumFractionDigits: 0,
      style: 'currency',
    }).format(199_000);

    expect(formatVnd(199_000)).toBe(expected);
    expect(formatVnd(0)).toBe('Not observed');
    expect(formatVnd(null)).toBe('Not observed');
  });

  it('prefers the purchasable current price and labels retained prices honestly', () => {
    const retained = observedPrice({ displayStatus: 'last_known', priceAmount: 210_000 });
    const current = observedPrice();
    const product = {
      currentLowestPrice: current,
      variants: [{ lifecycleStatus: 'active', preferredPrice: retained }],
    };

    expect(selectProductDisplayPrice(product)).toBe(current);
    expect(displayPriceLabel(current)).toBe('Current lowest price');

    product.currentLowestPrice = null;
    expect(selectProductDisplayPrice(product)).toBe(retained);
    expect(displayPriceLabel(retained)).toBe('Last known price');
  });

  it('builds transparency warnings without treating a missing price as zero', () => {
    const product = {
      currentLowestPrice: null,
      lastError: { code: 'FETCH_FAILED', message: 'Network request failed' },
      lowestPricesByContext: [],
      variants: [
        {
          availability: 'sold_out',
          latestResults: [{ priceStatus: 'not_observed' }],
          lifecycleStatus: 'suspected_missing',
          preferredPrice: observedPrice({
            displayStatus: 'last_known',
            priceSource: 'product_detail_fallback',
            pricingContext: 'anonymous',
            voucherStatus: 'unknown',
          }),
        },
      ],
    };
    const warnings = buildProductWarnings(product);

    expect(warnings.map((warning) => warning.code)).toEqual([
      'anonymous_price',
      'fallback_price',
      'voucher_unknown',
      'latest_check_failed',
      'prices_not_observed',
      'variant_lifecycle',
      'sold_out',
    ]);
    expect(formatVnd(product.variants[0].preferredPrice.priceAmount)).not.toContain('0 ₫');
  });

  it('converts history datetime-local values to ISO timestamps', () => {
    expect(localDateTimeToIso('')).toBeNull();
    expect(localDateTimeToIso('not-a-date')).toBeNull();
    expect(localDateTimeToIso('2026-08-08T12:30')).toMatch(/^2026-08-08T/u);
  });
});
