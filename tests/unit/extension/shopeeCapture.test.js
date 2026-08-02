import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { extensionCaptureMessageSchema } from '../../../packages/shared/schemas/extensionCaptureSchema.js';
import { productSnapshotSchema } from '../../../packages/shared/schemas/productSnapshotSchema.js';
import {
  sanitiseProductDetailCapture,
  sanitiseSelectedVariationCapture,
} from '../../../packages/shared/shopee/shopeeCaptureSanitizer.js';
import {
  applyShopeeCapture,
  createShopeeCaptureState,
  createShopeeCaptureSummary,
  normaliseShopeeCaptureState,
} from '../../../packages/shared/shopee/shopeeSnapshotNormalizer.js';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));
}

function productDetailCapture(sourceFixture) {
  return sanitiseProductDetailCapture(sourceFixture.endpointEvidence.productDetail.response, {
    capturedAt: sourceFixture.capturedAt,
  });
}

function variationCapture(evidence, capturedAt) {
  return sanitiseSelectedVariationCapture(evidence.response.payload, {
    capturedAt,
    ok: evidence.response.ok,
    requestBody: evidence.request.body,
    status: evidence.response.status,
  });
}

describe('Shopee extension capture normalisation', () => {
  it('assembles an exact, complete multi-variant snapshot from sanitised evidence', async () => {
    const sourceFixture = await fixture('shopee-multi-variant-user-session.json');
    const state = createShopeeCaptureState();
    const detail = extensionCaptureMessageSchema.parse(productDetailCapture(sourceFixture));
    applyShopeeCapture(state, detail);

    for (const evidence of sourceFixture.endpointEvidence.selectedVariations) {
      applyShopeeCapture(
        state,
        extensionCaptureMessageSchema.parse(variationCapture(evidence, sourceFixture.capturedAt)),
      );
    }

    const snapshot = normaliseShopeeCaptureState(state, {
      pageUrl: sourceFixture.sourceUrl,
      pricingContextKey: 'extension:test-installation',
    });

    expect(productSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot).toMatchObject({
      lifecycleEligible: true,
      observedVariantCount: 3,
      pricedVariantCount: 3,
      pricingContext: 'user_session',
      source: 'extension',
      variantCoverage: 'complete',
    });
    expect(snapshot.variants.map((variant) => variant.priceObservation.priceAmount)).toEqual([
      151_250, 151_250, 151_250,
    ]);
    expect(createShopeeCaptureSummary(state, snapshot)).toMatchObject({
      displayedPriceAmount: 151_250,
      selectedVariant: 'PHA MÁY ESPRESSO',
      voucherStatus: 'not_applied',
    });
  });

  it('keeps complete model presence separate from partial price success', async () => {
    const sourceFixture = await fixture('shopee-multi-variant-user-session.json');
    const state = createShopeeCaptureState();
    applyShopeeCapture(
      state,
      extensionCaptureMessageSchema.parse(productDetailCapture(sourceFixture)),
    );
    const snapshot = normaliseShopeeCaptureState(state, {
      pageUrl: sourceFixture.sourceUrl,
      pricingContextKey: 'extension:test-installation',
    });

    expect(snapshot.variantCoverage).toBe('complete');
    expect(snapshot.observedVariantCount).toBe(3);
    expect(snapshot.pricedVariantCount).toBe(1);
    expect(
      snapshot.variants.filter((variant) => variant.priceObservation.status === 'not_observed'),
    ).toHaveLength(2);
  });

  it('does not create a catalogue from selected-variation evidence alone', async () => {
    const sourceFixture = await fixture('shopee-multi-variant-user-session.json');
    const state = createShopeeCaptureState();
    const evidence = sourceFixture.endpointEvidence.selectedVariations[0];
    applyShopeeCapture(
      state,
      extensionCaptureMessageSchema.parse(variationCapture(evidence, sourceFixture.capturedAt)),
    );

    expect(
      normaliseShopeeCaptureState(state, {
        pageUrl: sourceFixture.sourceUrl,
        pricingContextKey: 'extension:test-installation',
      }),
    ).toBeNull();
  });

  it('creates the required synthetic default variant for verified variantless products', async () => {
    const sourceFixture = await fixture('shopee-variantless-user-session.json');
    const state = createShopeeCaptureState();
    applyShopeeCapture(
      state,
      extensionCaptureMessageSchema.parse(productDetailCapture(sourceFixture)),
    );
    const snapshot = normaliseShopeeCaptureState(state, {
      pageUrl: sourceFixture.sourceUrl,
      pricingContextKey: 'extension:test-installation',
    });

    expect(productSnapshotSchema.parse(snapshot).variants).toEqual([
      expect.objectContaining({
        identityType: 'synthetic_default',
        modelId: 'default',
        name: 'Default',
      }),
    ]);
  });

  it('never forwards credentials, headers, or voucher contents from a raw response', async () => {
    const sourceFixture = await fixture('shopee-multi-variant-user-session.json');
    const rawResponse = structuredClone(sourceFixture.endpointEvidence.productDetail.response);
    rawResponse.cookie = 'cookie-secret';
    rawResponse.authorization = 'bearer-secret';
    rawResponse.data.item.user_id = 'account-secret';
    rawResponse.data.pricing.data.product_price.final_price_vouchers = [
      { signature: 'voucher-secret', token: 'voucher-token' },
    ];
    const sanitised = productDetailCapture({
      ...sourceFixture,
      endpointEvidence: {
        ...sourceFixture.endpointEvidence,
        productDetail: {
          ...sourceFixture.endpointEvidence.productDetail,
          response: rawResponse,
        },
      },
    });
    const serialised = JSON.stringify(sanitised);

    expect(extensionCaptureMessageSchema.safeParse(sanitised).success).toBe(true);
    expect(serialised).not.toContain('cookie-secret');
    expect(serialised).not.toContain('bearer-secret');
    expect(serialised).not.toContain('account-secret');
    expect(serialised).not.toContain('voucher-secret');
    expect(serialised).not.toContain('voucher-token');
  });
});
