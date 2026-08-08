import { describe, expect, it } from 'vitest';

import {
  escapeHtml,
  renderPagination,
  renderProductCards,
} from '../../../apps/server/public/js/dashboardRenderers.js';

function product(overrides = {}) {
  return {
    activeVariantCount: 1,
    availability: 'available',
    canonicalUrl: 'https://shopee.vn/example-i.1.2',
    currentLowestPrice: null,
    id: 1,
    imageUrl: null,
    lastError: null,
    lastSuccessAt: null,
    lowestPricesByContext: [],
    title: 'Safe product',
    trackingStatus: 'active',
    variantCount: 1,
    variants: [
      {
        availability: 'unknown',
        id: 2,
        lastSeenAt: '2026-08-08T01:00:00.000Z',
        latestResults: [{ priceStatus: 'not_observed', pricingContext: 'user_session' }],
        lifecycleStatus: 'active',
        missingSince: null,
        name: 'Default',
        preferredPrice: null,
      },
    ],
    ...overrides,
  };
}

describe('dashboard renderers', () => {
  it('escapes API-controlled product text', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');

    const html = renderProductCards([product({ title: '<script>unsafe()</script>' })]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
  });

  it('shows no observed price and the latest per-variant gap', () => {
    const html = renderProductCards([product()]);

    expect(html).toContain('No price observed');
    expect(html).toContain('Price not observed');
    expect(html).not.toContain('0&nbsp;₫');
  });

  it('renders bounded pagination controls', () => {
    const html = renderPagination({ page: 5, pages: 12 });

    expect(html).toContain('data-page="3"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-page="7"');
  });
});
