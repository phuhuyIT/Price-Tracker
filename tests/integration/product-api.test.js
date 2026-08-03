import { afterEach, describe, expect, it } from 'vitest';

import { createApiHarness, requestJson } from './apiTestUtils.js';
import { loadValidSnapshot } from './databaseTestUtils.js';

const harnesses = new Set();

afterEach(async () => {
  await Promise.all([...harnesses].map((harness) => harness.cleanup()));
  harnesses.clear();
});

async function startApi(options) {
  const harness = await createApiHarness(options);
  harnesses.add(harness);
  return harness;
}

async function postSnapshot(baseUrl, snapshot = loadValidSnapshot(), headers) {
  return requestJson(baseUrl, '/api/products/snapshot', {
    body: snapshot,
    headers,
    method: 'POST',
  });
}

function secondProductSnapshot() {
  const snapshot = loadValidSnapshot();
  snapshot.itemId = '26882883165';
  snapshot.title = 'Second tracked product';
  snapshot.canonicalUrl = 'https://shopee.vn/second-product-i.1259293184.26882883165';
  return snapshot;
}

describe('product REST API', () => {
  it('stores valid snapshots, makes exact replays idempotent, and returns duplicate URL tracks', async () => {
    const { baseUrl } = await startApi();
    const snapshot = loadValidSnapshot();
    const created = await postSnapshot(baseUrl, snapshot);

    expect(created.response.status).toBe(201);
    expect(created.payload.data).toMatchObject({
      created: true,
      product: { title: snapshot.title },
    });

    const replay = await postSnapshot(baseUrl, snapshot);
    expect(replay.response.status).toBe(200);
    expect(replay.payload.data.created).toBe(false);

    const duplicateTrack = await requestJson(baseUrl, '/api/products/track', {
      body: { url: `${snapshot.canonicalUrl}?from=duplicate#same-product` },
      method: 'POST',
    });
    expect(duplicateTrack.response.status).toBe(200);
    expect(duplicateTrack.payload.data).toMatchObject({
      job: null,
      product: { id: created.payload.data.product.id },
      queued: false,
    });
  });

  it('rejects invalid URLs and queues new products for the Chrome extension', async () => {
    const { baseUrl } = await startApi();
    const invalid = await requestJson(baseUrl, '/api/products/track', {
      body: { url: 'https://example.com/not-shopee' },
      method: 'POST',
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.payload.error.code).toBe('INVALID_URL');

    const queued = await requestJson(baseUrl, '/api/products/track', {
      body: { url: loadValidSnapshot().canonicalUrl },
      method: 'POST',
    });
    expect(queued.response.status).toBe(202);
    expect(queued.payload.data).toMatchObject({
      job: { jobType: 'track', status: 'pending', targetContextKey: null },
      product: null,
      queued: true,
    });
  });

  it('rejects invalid, unsafe, and oversized snapshot bodies', async () => {
    const { baseUrl } = await startApi();
    const invalidSnapshot = loadValidSnapshot();
    invalidSnapshot.variants[0].priceObservation.priceAmount = 0;

    const invalid = await postSnapshot(baseUrl, invalidSnapshot);
    expect(invalid.response.status).toBe(422);
    expect(invalid.payload.error.code).toBe('INVALID_SHOPEE_PAYLOAD');

    const unsafe = await postSnapshot(baseUrl, { rawResponse: { cookie: 'secret' } });
    expect(unsafe.response.status).toBe(422);
    expect(unsafe.payload.error.code).toBe('INVALID_SHOPEE_PAYLOAD');

    const oversized = await postSnapshot(baseUrl, { padding: 'x'.repeat(70_000) });
    expect(oversized.response.status).toBe(413);
    expect(oversized.payload.error.code).toBe('REQUEST_TOO_LARGE');
  });

  it('lists products with pagination and retrieves owner-scoped details', async () => {
    const { baseUrl } = await startApi();
    const first = await postSnapshot(baseUrl);
    const second = await postSnapshot(baseUrl, secondProductSnapshot());

    const page = await requestJson(baseUrl, '/api/products?page=2&limit=1');
    expect(page.response.status).toBe(200);
    expect(page.payload.data).toHaveLength(1);
    expect(page.payload.meta.pagination).toEqual({ limit: 1, page: 2, pages: 2, total: 2 });

    const detail = await requestJson(baseUrl, `/api/products/${first.payload.data.product.id}`);
    expect(detail.payload.data).toMatchObject({
      id: first.payload.data.product.id,
      variants: expect.any(Array),
    });
    expect(second.response.status).toBe(201);
  });

  it('filters chart-ready history without storing synthetic zero prices', async () => {
    const { baseUrl, databaseHarness } = await startApi();
    const first = await postSnapshot(baseUrl);
    const productId = first.payload.data.product.id;
    const variantId = first.payload.data.product.variants[0].id;
    const second = loadValidSnapshot();
    second.capturedAt = '2026-08-01T00:01:00.000Z';
    second.variants[0].priceObservation = {
      reason: 'price_request_failed',
      status: 'not_observed',
    };
    second.pricedVariantCount = 0;
    await postSnapshot(baseUrl, second);

    const history = await requestJson(
      baseUrl,
      `/api/products/${productId}/history?variantId=${variantId}&from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-01T01%3A00%3A00.000Z&limit=10`,
    );
    expect(history.response.status).toBe(200);
    expect(history.payload.data.datasets).toHaveLength(1);
    expect(history.payload.data.datasets[0].data.map((point) => point.y)).toEqual([199_000, null]);
    expect(
      databaseHarness.database.prepare('SELECT COUNT(*) AS count FROM price_logs').get().count,
    ).toBe(1);
  });

  it('pauses, resumes, changes thresholds, deletes, and hides unknown products', async () => {
    const { baseUrl } = await startApi();
    const saved = await postSnapshot(baseUrl);
    const productId = saved.payload.data.product.id;

    const paused = await requestJson(baseUrl, `/api/products/${productId}`, {
      body: { alertThresholdPercent: 3.5, status: 'paused' },
      method: 'PATCH',
    });
    expect(paused.payload.data).toMatchObject({ alertThresholdPercent: 3.5, status: 'paused' });

    const resumed = await requestJson(baseUrl, `/api/products/${productId}`, {
      body: { status: 'active' },
      method: 'PATCH',
    });
    expect(resumed.payload.data.status).toBe('active');

    const deleted = await requestJson(baseUrl, `/api/products/${productId}`, {
      body: {},
      method: 'DELETE',
    });
    expect(deleted.payload.data).toEqual({ deleted: true, productId });

    const missing = await requestJson(baseUrl, `/api/products/${productId}`);
    expect(missing.response.status).toBe(404);
    expect(missing.payload.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('claims, completes, and binds collection jobs to one extension profile', async () => {
    const { baseUrl, databaseHarness } = await startApi();
    const snapshot = loadValidSnapshot();
    const tracked = await requestJson(baseUrl, '/api/products/track', {
      body: { url: `${snapshot.canonicalUrl}?from=dashboard#track` },
      method: 'POST',
    });
    const claim = await requestJson(baseUrl, '/api/collection-jobs/claim', {
      body: { pricingContextKey: snapshot.pricingContextKey },
      method: 'POST',
    });
    expect(claim.payload.data).toMatchObject({
      job: {
        id: tracked.payload.data.job.id,
        status: 'claimed',
        targetContextKey: snapshot.pricingContextKey,
      },
      leaseToken: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    const storedLease = databaseHarness.database
      .prepare('SELECT lease_token_hash FROM collection_jobs WHERE id = ?')
      .get(claim.payload.data.job.id).lease_token_hash;
    expect(storedLease).toMatch(/^[a-f0-9]{64}$/u);
    expect(storedLease).not.toBe(claim.payload.data.leaseToken);
    const completed = await requestJson(
      baseUrl,
      `/api/collection-jobs/${claim.payload.data.job.id}/complete`,
      {
        body: { leaseToken: claim.payload.data.leaseToken, snapshot },
        method: 'POST',
      },
    );
    expect(completed.response.status).toBe(200);
    expect(completed.payload.data).toMatchObject({
      job: { status: 'completed' },
      product: { preferredPricingContext: 'user_session' },
    });

    const refreshed = await requestJson(
      baseUrl,
      `/api/products/${completed.payload.data.product.id}/refresh`,
      { body: {}, method: 'POST' },
    );
    expect(refreshed.response.status).toBe(202);
    expect(refreshed.payload.data.job.targetContextKey).toBe(snapshot.pricingContextKey);

    const wrongProfile = await requestJson(baseUrl, '/api/collection-jobs/claim', {
      body: { pricingContextKey: 'extension:other-profile' },
      method: 'POST',
    });
    expect(wrongProfile.payload.data).toBeNull();

    const sameProfile = await requestJson(baseUrl, '/api/collection-jobs/claim', {
      body: { pricingContextKey: snapshot.pricingContextKey },
      method: 'POST',
    });
    expect(sameProfile.payload.data.job.id).toBe(refreshed.payload.data.job.id);
  });

  it('rejects invalid leases and records authentication-required job failures', async () => {
    const { baseUrl } = await startApi();
    const tracked = await requestJson(baseUrl, '/api/products/track', {
      body: { url: loadValidSnapshot().canonicalUrl },
      method: 'POST',
    });
    const claimed = await requestJson(baseUrl, '/api/collection-jobs/claim', {
      body: { pricingContextKey: loadValidSnapshot().pricingContextKey },
      method: 'POST',
    });
    const invalidLease = await requestJson(
      baseUrl,
      `/api/collection-jobs/${tracked.payload.data.job.id}/fail`,
      {
        body: {
          errorCode: 'AUTHENTICATION_REQUIRED',
          errorMessage: 'Shopee sign-in required',
          leaseToken: '0'.repeat(64),
        },
        method: 'POST',
      },
    );
    expect(invalidLease.response.status).toBe(409);
    expect(invalidLease.payload.error.code).toBe('COLLECTION_LEASE_INVALID');

    const failed = await requestJson(
      baseUrl,
      `/api/collection-jobs/${tracked.payload.data.job.id}/fail`,
      {
        body: {
          errorCode: 'AUTHENTICATION_REQUIRED',
          errorMessage: 'Shopee sign-in required',
          leaseToken: claimed.payload.data.leaseToken,
        },
        method: 'POST',
      },
    );
    expect(failed.payload.data.job).toMatchObject({
      errorCode: 'AUTHENTICATION_REQUIRED',
      status: 'failed',
    });

    const job = await requestJson(baseUrl, `/api/collection-jobs/${tracked.payload.data.job.id}`);
    expect(job.payload.data.job.status).toBe('failed');

    const retried = await requestJson(baseUrl, '/api/products/track', {
      body: { url: loadValidSnapshot().canonicalUrl },
      method: 'POST',
    });
    expect(retried.payload.data.job).toMatchObject({
      status: 'pending',
      targetContextKey: loadValidSnapshot().pricingContextKey,
    });
  });

  it('rate limits mutation endpoints with a standard error envelope', async () => {
    const { baseUrl } = await startApi({ rateLimitMax: 2 });
    const request = () =>
      requestJson(baseUrl, '/api/products/track', {
        body: { url: 'invalid' },
        method: 'POST',
      });

    await request();
    await request();
    const limited = await request();

    expect(limited.response.status).toBe(429);
    expect(limited.payload).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests; try again later',
      },
      success: false,
    });
  });
});
