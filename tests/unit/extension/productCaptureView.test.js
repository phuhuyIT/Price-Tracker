import { describe, expect, it } from 'vitest';

import { createProductCaptureView } from '../../../apps/extension/popup/productCaptureView.js';

describe('extension popup product capture view', () => {
  it('keeps the current page selection separate from a completed catalogue minimum', () => {
    const view = createProductCaptureView(
      {
        displayedAvailability: 'available',
        displayedPriceAmount: 450_000,
        displayedStockQuantity: 12,
        selectedVariant: 'Xám 2026',
        voucherStatus: 'not_applied',
      },
      {
        expectedVariantCount: 6,
        lowestPriceAmount: 424_000,
        lowestPriceVariant: 'Đen 2026',
        pricedVariantCount: 6,
        state: 'success',
      },
    );

    expect(view.currentSelection).toEqual({
      availability: 'available',
      priceAmount: 450_000,
      selectedVariant: 'Xám 2026',
      stockQuantity: 12,
      voucherStatus: 'not_applied',
    });
    expect(view.collectionStatus).toMatchObject({
      lowestPriceAmount: 424_000,
      lowestPriceVariant: 'Đen 2026',
    });
  });
});
