(function loadVariationFlow(root, factory) {
  const core =
    typeof module === "object" && module.exports
      ? require("./variant-core")
      : root.ShopeeVariantCore;
  const api = factory(core);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ShopeeVariationFlow = api;
  }
})(globalThis, function createVariationFlow(core) {
  const DEFAULT_SETTLE_TIMEOUT_MS = 1_500;
  const DEFAULT_RESPONSE_TIMEOUT_MS = 10_000;

  async function collectVariantResponses({
    clicker,
    collector,
    definitions,
    initialPriceBreakdown,
    requests,
    responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS,
    settleTimeoutMs = DEFAULT_SETTLE_TIMEOUT_MS,
  }) {
    const runnableRequests = requests.filter((request) => request.body);
    const clickErrors = new Map();

    try {
      let fatalButtonError = null;

      for (const request of runnableRequests) {
        const key = core.selectedTiersKey(request.selectedTiers);

        if (collector.captured.has(key)) {
          continue;
        }

        const error =
          fatalButtonError ||
          (await clicker.clickCombination(
            definitions,
            request.selectedTiers,
          ));

        if (error) {
          clickErrors.set(key, error);

          if (error.startsWith("Could not find")) {
            fatalButtonError = error;
          }

          continue;
        }

        await collector.waitFor([key], settleTimeoutMs);

        if (collector.captured.has(key)) {
          continue;
        }

        const forceError = await clicker.forceCombinationRequest(
          definitions,
          request.selectedTiers,
        );

        if (forceError) {
          clickErrors.set(key, forceError);
          continue;
        }

        await collector.waitFor([key], settleTimeoutMs);
      }

      await collector.waitFor(
        runnableRequests.map((request) =>
          core.selectedTiersKey(request.selectedTiers),
        ),
        responseTimeoutMs,
      );
    } finally {
      await collector.stop();
    }

    return core.buildVariantResponses({
      captured: collector.captured,
      clickErrors,
      initialPriceBreakdown,
      requests,
    });
  }

  return {
    collectVariantResponses,
  };
});
