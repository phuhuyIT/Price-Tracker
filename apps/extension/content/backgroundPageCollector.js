import {
  DEFAULT_SHOPEE_PRICE_SCALE,
  isImplicitDefaultShopeeProduct,
} from '../../../packages/shared/shopee/shopeeSnapshotNormalizer.js';
import {
  buildTierDefinitions,
  createVariantRequests,
  selectedTiersKey,
} from './variantSelection.js';
import {
  createVariationClicker,
  findSelectedVariationButtonsInPage,
  findVariationButtonInPage,
} from './variationControls.js';

const CAPTURE_WAIT_MS = 4_000;
const IMPLICIT_DEFAULT_PRICE_WAIT_MS = 3_000;
const POLL_INTERVAL_MS = 100;

function wait(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function clickAt(x, y) {
  const element = document.elementFromPoint(x, y);
  const target = element?.closest("button, [role='button'], .product-variation") ?? element;

  if (!target) {
    throw new Error('The selected Shopee variation control is no longer visible');
  }

  target.click();
}

async function waitForCapture(captureState, key, deadlineAt) {
  const deadline = Math.min(Date.now() + CAPTURE_WAIT_MS, deadlineAt);

  while (!captureState.variations.has(key) && Date.now() < deadline) {
    await wait(POLL_INTERVAL_MS);
  }

  return captureState.variations.has(key);
}

function exactPriceEvidence(evidence, modelId) {
  return (
    evidence?.modelId === modelId &&
    evidence.priceSource !== null &&
    Number.isSafeInteger(evidence.rawPrice) &&
    evidence.rawPrice > 0 &&
    evidence.rawPrice % DEFAULT_SHOPEE_PRICE_SCALE === 0
  );
}

function hasExactImplicitDefaultPrice(captureState, modelId, variationKey = null) {
  if (exactPriceEvidence(captureState.productDetail?.priceEvidence, modelId)) {
    return true;
  }

  if (variationKey === null) {
    return false;
  }

  return exactPriceEvidence(captureState.variations.get(variationKey)?.priceEvidence, modelId);
}

async function waitForImplicitDefaultPrice(captureState, modelId, variationKey, deadlineAt) {
  while (
    !hasExactImplicitDefaultPrice(captureState, modelId, variationKey) &&
    Date.now() < deadlineAt
  ) {
    await wait(POLL_INTERVAL_MS);
  }

  return hasExactImplicitDefaultPrice(captureState, modelId, variationKey);
}

function priceSelectorTimeout(message) {
  const error = new Error(message);
  error.code = 'PRICE_SELECTOR_TIMEOUT';
  return error;
}

async function collectImplicitDefaultPrice({
  captureState,
  clicker,
  deadlineAt,
  definitions,
  onProgress,
  requests,
  waitMs,
}) {
  const model = captureState.productDetail.product.models[0];
  const request = requests[0];
  const variationKey = request?.selectedTiers ? selectedTiersKey(request.selectedTiers) : null;

  await onProgress({ expectedVariantCount: 1, processedVariantCount: 0 });

  if (hasExactImplicitDefaultPrice(captureState, model.modelId, variationKey)) {
    await onProgress({ expectedVariantCount: 1, processedVariantCount: 1 });
    return;
  }

  if (['sold_out', 'unavailable'].includes(model.availability)) {
    await onProgress({ expectedVariantCount: 1, processedVariantCount: 1 });
    return;
  }

  const passiveDeadline = Math.min(Date.now() + waitMs, deadlineAt);

  if (
    await waitForImplicitDefaultPrice(captureState, model.modelId, variationKey, passiveDeadline)
  ) {
    await onProgress({ expectedVariantCount: 1, processedVariantCount: 1 });
    return;
  }

  if (request?.body && variationKey !== null && Date.now() < deadlineAt) {
    const selectionError = await clicker.clickCombination(definitions, request.selectedTiers);

    if (!selectionError) {
      const selectionDeadline = Math.min(Date.now() + CAPTURE_WAIT_MS, deadlineAt);

      if (
        await waitForImplicitDefaultPrice(
          captureState,
          model.modelId,
          variationKey,
          selectionDeadline,
        )
      ) {
        await onProgress({ expectedVariantCount: 1, processedVariantCount: 1 });
        return;
      }
    }
  }

  await onProgress({ expectedVariantCount: 1, processedVariantCount: 1 });
  throw priceSelectorTimeout(
    'Shopee did not expose an exact price for the product without visible variants',
  );
}

/** Select every verified catalogue model through Shopee's rendered controls. */
export async function collectBackgroundPageVariants(
  captureState,
  {
    deadlineAt,
    implicitDefaultPriceWaitMs = IMPLICIT_DEFAULT_PRICE_WAIT_MS,
    onProgress = async () => undefined,
  },
) {
  const productCapture = captureState.productDetail;

  if (!productCapture) {
    throw new Error('Shopee product details were not captured');
  }

  const requests = createVariantRequests(productCapture.product);
  const definitions = buildTierDefinitions(productCapture.product, requests);
  const clicker = createVariationClicker({
    click: clickAt,
    locate: (tierDefinitions, tierIndex, optionIndex) =>
      findVariationButtonInPage({
        definitions: tierDefinitions,
        optionIndex,
        tierIndex,
      }),
    locateSelected: (tierDefinitions) =>
      findSelectedVariationButtonsInPage({ definitions: tierDefinitions }),
    wait,
  });

  if (isImplicitDefaultShopeeProduct(productCapture.product)) {
    await collectImplicitDefaultPrice({
      captureState,
      clicker,
      deadlineAt,
      definitions,
      onProgress,
      requests,
      waitMs: implicitDefaultPriceWaitMs,
    });
    return;
  }

  let processedVariantCount = 0;

  await onProgress({
    expectedVariantCount: requests.length,
    processedVariantCount,
  });

  for (const request of requests) {
    if (Date.now() >= deadlineAt) {
      break;
    }

    if (!request.body || request.skip === true) {
      processedVariantCount += 1;
      await onProgress({
        expectedVariantCount: requests.length,
        processedVariantCount,
      });
      continue;
    }

    const key = selectedTiersKey(request.selectedTiers);

    if (captureState.variations.has(key)) {
      processedVariantCount += 1;
      await onProgress({
        expectedVariantCount: requests.length,
        processedVariantCount,
      });
      continue;
    }

    const selectionError = await clicker.clickCombination(definitions, request.selectedTiers);

    if (!selectionError && !(await waitForCapture(captureState, key, deadlineAt))) {
      const forceError = await clicker.forceCombinationRequest(definitions, request.selectedTiers);

      if (!forceError) {
        await waitForCapture(captureState, key, deadlineAt);
      }
    }

    processedVariantCount += 1;
    await onProgress({
      expectedVariantCount: requests.length,
      processedVariantCount,
    });
  }
}
