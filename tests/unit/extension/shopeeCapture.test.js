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

function withoutPrice(capture, offsetMs = 1) {
  return {
    ...structuredClone(capture),
    capturedAt: new Date(Date.parse(capture.capturedAt) + offsetMs).toISOString(),
    priceEvidence: {
      modelId: null,
      priceSource: null,
      rawPrice: null,
      voucherStatus: 'unknown',
    },
  };
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

  it('rejects client-declared lifecycle coverage and derives it from product-detail evidence', async () => {
    const sourceFixture = await fixture('shopee-multi-variant-user-session.json');
    const detail = productDetailCapture(sourceFixture);
    const clientDeclaredCoverage = {
      ...detail,
      coverageConfidence: 'verified',
      lifecycleEligible: true,
      variantCoverage: 'complete',
    };

    expect(extensionCaptureMessageSchema.safeParse(clientDeclaredCoverage).success).toBe(false);

    const state = createShopeeCaptureState();
    applyShopeeCapture(state, extensionCaptureMessageSchema.parse(detail));
    const snapshot = normaliseShopeeCaptureState(state, {
      pageUrl: sourceFixture.sourceUrl,
      pricingContextKey: 'extension:test-installation',
    });

    expect(snapshot).toMatchObject({
      coverageConfidence: 'verified',
      expectedVariantCount: detail.product.models.length,
      lifecycleEligible: true,
      observedVariantCount: detail.product.models.length,
      variantCoverage: 'complete',
    });
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

    expect(snapshot).toMatchObject({
      expectedVariantCount: 1,
      pricedVariantCount: 1,
      variantCoverage: 'complete',
    });
    expect(productSnapshotSchema.parse(snapshot).variants).toEqual([
      expect.objectContaining({
        identityType: 'synthetic_default',
        modelId: 'default',
        name: 'Default',
        priceObservation: expect.objectContaining({
          priceAmount: 25_600,
          priceSource: 'product_detail_fallback',
          status: 'observed',
        }),
      }),
    ]);
  });

  it('uses product-level zero stock for a sold-out variantless product', async () => {
    const sourceFixture = await fixture('shopee-variantless-user-session.json');
    const rawResponse = structuredClone(sourceFixture.endpointEvidence.productDetail.response);
    rawResponse.data.item.stock = 0;
    rawResponse.data.item.normal_stock = null;
    rawResponse.data.item.models[0].stock = null;
    rawResponse.data.item.models[0].normal_stock = null;
    const capture = extensionCaptureMessageSchema.parse(
      sanitiseProductDetailCapture(rawResponse, { capturedAt: sourceFixture.capturedAt }),
    );
    const state = createShopeeCaptureState();
    applyShopeeCapture(state, capture);
    const snapshot = normaliseShopeeCaptureState(state, {
      pageUrl: sourceFixture.sourceUrl,
      pricingContextKey: 'extension:test-installation',
    });

    expect(capture.product.models[0].availability).toBe('sold_out');
    expect(snapshot.variants[0]).toMatchObject({
      availability: 'sold_out',
      priceObservation: { priceAmount: 25_600, status: 'observed' },
    });
    expect(createShopeeCaptureSummary(state, snapshot)).toMatchObject({
      displayedAvailability: 'sold_out',
      displayedPriceAmount: 25_600,
    });
  });

  it('uses a scoped page sold-out fallback when Shopee redacts variantless stock', async () => {
    const sourceFixture = await fixture('shopee-variantless-user-session.json');
    const rawResponse = structuredClone(sourceFixture.endpointEvidence.productDetail.response);
    rawResponse.data.item.stock = null;
    rawResponse.data.item.models[0].stock = null;
    const state = createShopeeCaptureState();
    applyShopeeCapture(
      state,
      extensionCaptureMessageSchema.parse(
        sanitiseProductDetailCapture(rawResponse, { capturedAt: sourceFixture.capturedAt }),
      ),
    );
    const snapshot = normaliseShopeeCaptureState(state, {
      pageAvailability: 'sold_out',
      pageUrl: sourceFixture.sourceUrl,
      pricingContextKey: 'extension:test-installation',
    });

    expect(snapshot.variants[0]).toMatchObject({
      availability: 'sold_out',
      identityType: 'synthetic_default',
      priceObservation: { priceAmount: 25_600, status: 'observed' },
    });
  });

  it('does not apply a page-level fallback to explicit variants', async () => {
    const sourceFixture = await fixture('shopee-multi-variant-user-session.json');
    const state = createShopeeCaptureState();
    applyShopeeCapture(
      state,
      extensionCaptureMessageSchema.parse(productDetailCapture(sourceFixture)),
    );
    const snapshot = normaliseShopeeCaptureState(state, {
      pageAvailability: 'sold_out',
      pageUrl: sourceFixture.sourceUrl,
      pricingContextKey: 'extension:test-installation',
    });

    expect(snapshot.variants.some((variant) => variant.availability === 'sold_out')).toBe(false);
  });

  it('treats negative Shopee stock as hidden rather than sold out', async () => {
    const sourceFixture = await fixture('shopee-variantless-user-session.json');
    const rawResponse = structuredClone(sourceFixture.endpointEvidence.productDetail.response);
    rawResponse.data.item.stock = -1;
    rawResponse.data.item.models[0].stock = -1;
    const capture = extensionCaptureMessageSchema.parse(
      sanitiseProductDetailCapture(rawResponse, { capturedAt: sourceFixture.capturedAt }),
    );

    expect(capture.product.models[0].availability).toBe('unknown');
  });

  it('does not let a stock-redacted duplicate erase known sold-out availability', async () => {
    const sourceFixture = await fixture('shopee-variantless-user-session.json');
    const soldOutResponse = structuredClone(sourceFixture.endpointEvidence.productDetail.response);
    soldOutResponse.data.item.stock = 0;
    soldOutResponse.data.item.models[0].stock = null;
    const soldOut = extensionCaptureMessageSchema.parse(
      sanitiseProductDetailCapture(soldOutResponse, { capturedAt: sourceFixture.capturedAt }),
    );
    const redactedResponse = structuredClone(sourceFixture.endpointEvidence.productDetail.response);
    redactedResponse.data.item.stock = null;
    redactedResponse.data.item.models[0].stock = null;
    const redacted = extensionCaptureMessageSchema.parse(
      sanitiseProductDetailCapture(redactedResponse, {
        capturedAt: new Date(Date.parse(sourceFixture.capturedAt) + 1).toISOString(),
      }),
    );
    const state = createShopeeCaptureState();
    applyShopeeCapture(state, soldOut);
    applyShopeeCapture(state, redacted);

    expect(state.productDetail.product.models[0].availability).toBe('sold_out');
  });

  it('does not let a weaker duplicate get_pc capture erase an exact price', async () => {
    const sourceFixture = await fixture('shopee-variantless-user-session.json');
    const exact = extensionCaptureMessageSchema.parse(productDetailCapture(sourceFixture));
    const state = createShopeeCaptureState();
    applyShopeeCapture(state, exact);
    applyShopeeCapture(state, extensionCaptureMessageSchema.parse(withoutPrice(exact)));

    const snapshot = normaliseShopeeCaptureState(state, {
      pageUrl: sourceFixture.sourceUrl,
      pricingContextKey: 'extension:test-installation',
    });

    expect(state.productDetail).toMatchObject({
      capturedAt: exact.capturedAt,
      priceEvidence: exact.priceEvidence,
    });
    expect(snapshot).toMatchObject({
      pricedVariantCount: 1,
      variants: [
        expect.objectContaining({
          priceObservation: expect.objectContaining({ priceAmount: 25_600, status: 'observed' }),
        }),
      ],
    });
  });

  it('allows a later exact get_pc capture to replace an earlier exact price', async () => {
    const sourceFixture = await fixture('shopee-variantless-user-session.json');
    const first = extensionCaptureMessageSchema.parse(productDetailCapture(sourceFixture));
    const later = {
      ...structuredClone(first),
      capturedAt: new Date(Date.parse(first.capturedAt) + 2).toISOString(),
      priceEvidence: {
        ...first.priceEvidence,
        rawPrice: 25_500 * 100_000,
      },
    };
    const state = createShopeeCaptureState();
    applyShopeeCapture(state, first);
    applyShopeeCapture(state, extensionCaptureMessageSchema.parse(later));

    expect(state.productDetail).toMatchObject({
      capturedAt: later.capturedAt,
      priceEvidence: { rawPrice: 25_500 * 100_000 },
    });
  });

  it('retains compatible variation captures across duplicate product details', async () => {
    const sourceFixture = await fixture('shopee-multi-variant-user-session.json');
    const detail = extensionCaptureMessageSchema.parse(productDetailCapture(sourceFixture));
    const variation = extensionCaptureMessageSchema.parse(
      variationCapture(
        sourceFixture.endpointEvidence.selectedVariations[0],
        sourceFixture.capturedAt,
      ),
    );
    const state = createShopeeCaptureState();
    applyShopeeCapture(state, detail);
    applyShopeeCapture(state, variation);
    const selectedKey = state.latestSelectedKey;
    applyShopeeCapture(state, extensionCaptureMessageSchema.parse(withoutPrice(detail)));

    expect(state.latestSelectedKey).toBe(selectedKey);
    expect(state.quantity).toBe(1);
    expect(state.variations.get(selectedKey)).toEqual(variation);
  });

  it('captures a model-matched variantless price directly from get_pc data.product_price', async () => {
    const sourceFixture = await fixture('shopee-variantless-user-session.json');
    const rawResponse = structuredClone(sourceFixture.endpointEvidence.productDetail.response);
    rawResponse.data.product_price = rawResponse.data.pricing.data.product_price;
    rawResponse.data.price_breakdown = {
      price: {
        range_max: 2_559_000_000,
        range_min: 2_559_000_000,
        single_value: 2_559_000_000,
      },
      price_model: { price_single_model_id: 99_999_999_999 },
    };
    rawResponse.data.product_price.final_price_vouchers = [
      { promotion_id: 1, voucher_code: 'private-voucher-code' },
    ];
    delete rawResponse.data.pricing;

    const capture = sanitiseProductDetailCapture(rawResponse, {
      capturedAt: sourceFixture.capturedAt,
    });
    const state = createShopeeCaptureState();
    applyShopeeCapture(state, extensionCaptureMessageSchema.parse(capture));
    const snapshot = normaliseShopeeCaptureState(state, {
      pageUrl: sourceFixture.sourceUrl,
      pricingContextKey: 'extension:test-installation',
    });

    expect(snapshot).toMatchObject({
      pricedVariantCount: 1,
      variants: [
        expect.objectContaining({
          modelId: 'default',
          priceObservation: expect.objectContaining({
            priceAmount: 25_600,
            priceSource: 'product_detail_fallback',
            status: 'observed',
          }),
        }),
      ],
    });
    expect(JSON.stringify(capture)).not.toContain('private-voucher-code');
  });

  it('rejects a direct get_pc price that names a different model', async () => {
    const sourceFixture = await fixture('shopee-variantless-user-session.json');
    const rawResponse = structuredClone(sourceFixture.endpointEvidence.productDetail.response);
    rawResponse.data.product_price = rawResponse.data.pricing.data.product_price;
    rawResponse.data.product_price.price_model.price_single_model_id = 99999999999;
    delete rawResponse.data.pricing;

    const capture = sanitiseProductDetailCapture(rawResponse, {
      capturedAt: sourceFixture.capturedAt,
    });

    expect(extensionCaptureMessageSchema.parse(capture).priceEvidence).toEqual({
      modelId: null,
      priceSource: null,
      rawPrice: null,
      voucherStatus: 'unknown',
    });
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
