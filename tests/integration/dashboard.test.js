import { afterEach, describe, expect, it } from 'vitest';

import { createApiHarness, requestJson } from './apiTestUtils.js';
import { loadValidSnapshot } from './databaseTestUtils.js';

const harnesses = new Set();

afterEach(async () => {
  await Promise.all([...harnesses].map((harness) => harness.cleanup()));
  harnesses.clear();
});

async function startDashboard(options) {
  const harness = await createApiHarness(options);
  harnesses.add(harness);
  return harness;
}

describe('Phase 11 dashboard', () => {
  it('serves the dashboard and locally installed Chart.js under a restrictive CSP', async () => {
    const { baseUrl } = await startDashboard();
    const dashboard = await fetch(`${baseUrl}/`);
    const html = await dashboard.text();

    expect(dashboard.status).toBe(200);
    expect(dashboard.headers.get('content-type')).toContain('text/html');
    expect(dashboard.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(dashboard.headers.get('content-security-policy')).toContain(
      "img-src 'self' data: https://*.shopee.vn https://*.susercontent.com",
    );
    expect(html).toContain('id="track-form"');
    expect(html).toContain('id="watchlist-filters"');
    expect(html).toContain('id="watchlist-search"');
    expect(html).toContain('id="watchlist-availability"');
    expect(html).toContain('src="/vendor/chart.umd.min.js"');
    expect(html).not.toMatch(/<script[^>]+src="https:\/\//u);

    const [styles, application, chart] = await Promise.all([
      fetch(`${baseUrl}/css/style.css`),
      fetch(`${baseUrl}/js/app.js`),
      fetch(`${baseUrl}/vendor/chart.umd.min.js`),
    ]);

    expect(styles.status).toBe(200);
    expect(styles.headers.get('content-type')).toContain('text/css');
    expect(application.status).toBe(200);
    expect(application.headers.get('content-type')).toContain('javascript');
    expect(chart.status).toBe(200);
    expect(chart.headers.get('content-type')).toContain('javascript');
    await Promise.all([styles.text(), application.text(), chart.arrayBuffer()]);
  });

  it('exposes only the public authentication switches needed by the dashboard', async () => {
    const local = await startDashboard();
    const localConfig = await requestJson(local.baseUrl, '/api/dashboard-config');

    expect(localConfig.payload).toEqual({
      data: {
        authentication: {
          allowRegistration: false,
          enabled: false,
        },
      },
      success: true,
    });

    const authenticated = await startDashboard({ allowRegistration: true, authEnabled: true });
    const authenticatedConfig = await requestJson(authenticated.baseUrl, '/api/dashboard-config');

    expect(authenticatedConfig.payload.data.authentication).toEqual({
      allowRegistration: true,
      enabled: true,
    });
  });

  it('returns latest per-variant gaps even when a variant has never had a price', async () => {
    const { baseUrl } = await startDashboard();
    const snapshot = loadValidSnapshot();
    const created = await requestJson(baseUrl, '/api/products/snapshot', {
      body: snapshot,
      method: 'POST',
    });
    const product = created.payload.data.product;
    const missingPriceVariant = product.variants.find(
      (variant) => variant.modelId === snapshot.variants[1].modelId,
    );

    expect(missingPriceVariant.preferredPrice).toBeNull();
    expect(missingPriceVariant.latestPrices).toEqual([]);
    expect(missingPriceVariant.latestResults).toEqual([
      expect.objectContaining({
        priceStatus: 'not_observed',
        pricingContext: 'user_session',
        reasonCode: 'variation_response_missing',
      }),
    ]);
  });
});
