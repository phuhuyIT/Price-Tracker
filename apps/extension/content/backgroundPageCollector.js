import variantCore from '../../../chrome-extension/shared/variant-core.js';
import variationPage from '../../../chrome-extension/shared/variation-page.js';

const CAPTURE_WAIT_MS = 4_000;
const POLL_INTERVAL_MS = 100;

function toLegacyItem(productCapture) {
  return {
    itemid: productCapture.product.itemId,
    models: productCapture.product.models.map((model) => ({
      extinfo: { tier_index: [...model.tierIndex] },
      modelid: model.modelId,
      name: model.name,
    })),
    shopid: productCapture.product.shopId,
    tier_variations: productCapture.product.tierVariations.map((tier) => ({
      name: tier.name,
      options: [...tier.options],
    })),
  };
}

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

/** Select every verified catalogue model through Shopee's rendered controls. */
export async function collectBackgroundPageVariants(captureState, { deadlineAt }) {
  const productCapture = captureState.productDetail;

  if (!productCapture) {
    throw new Error('Shopee product details were not captured');
  }

  const item = toLegacyItem(productCapture);
  const requests = variantCore.createVariantRequests(item, {
    itemId: productCapture.product.itemId,
    shopId: productCapture.product.shopId,
  });
  const definitions = variantCore.buildTierDefinitions(item, requests);
  const clicker = variationPage.createVariationClicker({
    click: clickAt,
    locate: (tierDefinitions, tierIndex, optionIndex) =>
      variationPage.findVariationButtonInPage({
        definitions: tierDefinitions,
        optionIndex,
        tierIndex,
      }),
    locateSelected: (tierDefinitions) =>
      variationPage.findSelectedVariationButtonsInPage({ definitions: tierDefinitions }),
    wait,
  });

  for (const request of requests) {
    if (!request.body || request.skip === true || Date.now() >= deadlineAt) {
      continue;
    }

    const key = variantCore.selectedTiersKey(request.selectedTiers);

    if (captureState.variations.has(key)) {
      continue;
    }

    const selectionError = await clicker.clickCombination(definitions, request.selectedTiers);

    if (selectionError || (await waitForCapture(captureState, key, deadlineAt))) {
      continue;
    }

    const forceError = await clicker.forceCombinationRequest(definitions, request.selectedTiers);

    if (!forceError) {
      await waitForCapture(captureState, key, deadlineAt);
    }
  }
}
