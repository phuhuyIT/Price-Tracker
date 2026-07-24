const core = require("./chrome-extension/shared/variant-core");
const {
  createVariationClicker,
  findVariationButtonInPage,
} = require("./chrome-extension/shared/variation-page");
const {
  collectVariantResponses,
} = require("./chrome-extension/shared/variation-flow");

const SELECT_VARIATION_API_FRAGMENT = "/select_variation_";

function parseRequestBody(request) {
  try {
    return request.postDataJSON();
  } catch {
    try {
      return JSON.parse(request.postData() || "");
    } catch {
      return null;
    }
  }
}

function createResponseCollector(page) {
  const captured = new Map();
  const responseTasks = new Set();

  const handleResponse = (response) => {
    if (!response.url().includes(SELECT_VARIATION_API_FRAGMENT)) {
      return;
    }

    const requestBody = parseRequestBody(response.request());
    const key = core.selectedTiersKey(requestBody?.selected_tiers);

    if (!key) {
      return;
    }

    const task = (async () => {
      let payload = null;
      let error = null;

      try {
        payload = await response.json();
      } catch {
        error = `The API returned a non-JSON response (HTTP ${response.status()}).`;
      }

      core.storePreferredResponse(captured, key, {
        error,
        ok: response.ok(),
        payload,
        status: response.status(),
      });
    })();

    responseTasks.add(task);
    task.finally(() => responseTasks.delete(task));
  };

  page.on("response", handleResponse);

  return {
    captured,
    async stop() {
      page.off("response", handleResponse);
      await Promise.all([...responseTasks]);
    },
    async waitFor(expectedKeys, timeoutMs) {
      const deadline = Date.now() + timeoutMs;

      while (
        expectedKeys.some((key) => !captured.has(key)) &&
        Date.now() < deadline
      ) {
        await page.waitForTimeout(100);
      }
    },
  };
}

function createPlaywrightClicker(page) {
  return createVariationClicker({
    click: (x, y) => page.mouse.click(x, y),
    locate: (definitions, tierIndex, optionIndex) =>
      page.evaluate(findVariationButtonInPage, {
        definitions,
        optionIndex,
        tierIndex,
      }),
    wait: (timeoutMs) => page.waitForTimeout(timeoutMs),
  });
}

async function fetchVariantPricing(page, item, ids, options = {}) {
  const requests = core.createVariantRequests(item, ids);
  const definitions = core.buildTierDefinitions(item, requests);
  const responses = await collectVariantResponses({
    clicker: createPlaywrightClicker(page),
    collector: createResponseCollector(page),
    definitions,
    initialPriceBreakdown: options.initialPriceBreakdown,
    requests,
    responseTimeoutMs: options.timeoutMs,
    settleTimeoutMs: options.settleTimeoutMs,
  });

  return {
    ...item,
    variant_pricing: core.mergeVariantPricing(item, requests, responses),
  };
}

module.exports = {
  ...core,
  createPlaywrightClicker,
  createResponseCollector,
  fetchVariantPricing,
  findVariationButtonInPage,
};
