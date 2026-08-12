/**
 * Keep the current page selection separate from aggregate full-catalogue results.
 *
 * @param {object} summary
 * @param {object|null} collectionStatus
 */
export function createProductCaptureView(summary, collectionStatus = null) {
  return {
    collectionStatus,
    currentSelection: {
      availability: summary.displayedAvailability ?? 'unknown',
      priceAmount: summary.displayedPriceAmount,
      selectedVariant: summary.selectedVariant,
      stockQuantity: summary.displayedStockQuantity,
      voucherStatus: summary.voucherStatus,
    },
  };
}
