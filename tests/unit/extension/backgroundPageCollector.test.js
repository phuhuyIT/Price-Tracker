import { describe, expect, it, vi } from 'vitest';

import { collectBackgroundPageVariants } from '../../../apps/extension/content/backgroundPageCollector.js';

const MODEL_ID = 'variantless-model';
const RAW_PRICE = 25_600 * 100_000;

function createCaptureState({ availability = 'unknown', priceEvidence = null } = {}) {
  return {
    productDetail: {
      priceEvidence,
      product: {
        itemId: '26882883164',
        models: [
          {
            availability,
            modelId: MODEL_ID,
            name: '',
            tierIndex: [],
          },
        ],
        shopId: '1259293184',
        tierVariations: [],
      },
    },
    variations: new Map(),
  };
}

async function collect(captureState, onProgress = vi.fn()) {
  await collectBackgroundPageVariants(captureState, {
    deadlineAt: Date.now() + 1_000,
    implicitDefaultPriceWaitMs: 0,
    onProgress,
  });

  return onProgress;
}

describe('background page collection for products without visible variants', () => {
  it('accepts an exact model-matched product-detail price without selecting a variant', async () => {
    const onProgress = await collect(
      createCaptureState({
        priceEvidence: {
          modelId: MODEL_ID,
          priceSource: 'product_detail_fallback',
          rawPrice: RAW_PRICE,
        },
      }),
    );

    expect(onProgress.mock.calls).toEqual([
      [{ expectedVariantCount: 1, processedVariantCount: 0 }],
      [{ expectedVariantCount: 1, processedVariantCount: 1 }],
    ]);
  });

  it('allows an explicitly unavailable product to complete without inventing a price', async () => {
    const onProgress = await collect(createCaptureState({ availability: 'unavailable' }));

    expect(onProgress).toHaveBeenLastCalledWith({
      expectedVariantCount: 1,
      processedVariantCount: 1,
    });
  });

  it('raises a retryable timeout when an available product has no exact price', async () => {
    await expect(collect(createCaptureState())).rejects.toMatchObject({
      code: 'PRICE_SELECTOR_TIMEOUT',
    });
  });

  it('does not accept price evidence belonging to another model', async () => {
    await expect(
      collect(
        createCaptureState({
          priceEvidence: {
            modelId: 'different-model',
            priceSource: 'product_detail_fallback',
            rawPrice: RAW_PRICE,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'PRICE_SELECTOR_TIMEOUT' });
  });
});
