import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { extensionCaptureMessageSchema } from '../../packages/shared/schemas/extensionCaptureSchema.js';
import {
  sanitiseProductDetailCapture,
  sanitiseSelectedVariationCapture,
} from '../../packages/shared/shopee/shopeeCaptureSanitizer.js';
import {
  applyShopeeCapture,
  createShopeeCaptureState,
  normaliseShopeeCaptureState,
} from '../../packages/shared/shopee/shopeeSnapshotNormalizer.js';
import { createApiHarness, requestJson } from './apiTestUtils.js';

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnop';
const harnesses = new Set();

afterEach(async () => {
  await Promise.all([...harnesses].map((harness) => harness.cleanup()));
  harnesses.clear();
});

async function createExtensionSnapshot() {
  const sourceFixture = JSON.parse(
    await readFile(
      new URL('../fixtures/shopee-multi-variant-user-session.json', import.meta.url),
      'utf8',
    ),
  );
  const state = createShopeeCaptureState();
  applyShopeeCapture(
    state,
    extensionCaptureMessageSchema.parse(
      sanitiseProductDetailCapture(sourceFixture.endpointEvidence.productDetail.response, {
        capturedAt: sourceFixture.capturedAt,
      }),
    ),
  );

  for (const evidence of sourceFixture.endpointEvidence.selectedVariations) {
    applyShopeeCapture(
      state,
      extensionCaptureMessageSchema.parse(
        sanitiseSelectedVariationCapture(evidence.response.payload, {
          capturedAt: sourceFixture.capturedAt,
          ok: evidence.response.ok,
          requestBody: evidence.request.body,
          status: evidence.response.status,
        }),
      ),
    );
  }

  return normaliseShopeeCaptureState(state, {
    pageUrl: sourceFixture.sourceUrl,
    pricingContextKey: 'extension:integration-installation',
  });
}

describe('extension-to-backend snapshot contract', () => {
  it('stores a normalised user-session capture as one grouped check through allowed CORS', async () => {
    const harness = await createApiHarness({ extensionAllowedOrigin: EXTENSION_ORIGIN });
    harnesses.add(harness);
    const snapshot = await createExtensionSnapshot();
    const saved = await requestJson(harness.baseUrl, '/api/products/snapshot', {
      body: snapshot,
      headers: { origin: EXTENSION_ORIGIN },
      method: 'POST',
    });

    expect(saved.response.status).toBe(201);
    expect(saved.response.headers.get('access-control-allow-origin')).toBe(EXTENSION_ORIGIN);
    expect(saved.payload.data).toMatchObject({
      created: true,
      product: {
        preferredPricingContext: 'user_session',
        title: snapshot.title,
      },
    });
    expect(
      harness.databaseHarness.database.prepare('SELECT COUNT(*) AS count FROM price_checks').get()
        .count,
    ).toBe(1);
    expect(
      harness.databaseHarness.database.prepare('SELECT COUNT(*) AS count FROM price_logs').get()
        .count,
    ).toBe(3);
  });
});
