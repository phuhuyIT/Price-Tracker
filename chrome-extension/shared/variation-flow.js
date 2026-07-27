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
    onProgress,
    requests,
    responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS,
    settleTimeoutMs = DEFAULT_SETTLE_TIMEOUT_MS,
  }) {
    const runnableRequests = requests.filter(
      (request) => request.body && request.skip !== true,
    );
    const clickErrors = new Map();
    let completedRequests = 0;

    async function reportProgress(key, outcome) {
      completedRequests += 1;

      if (typeof onProgress !== "function") {
        return;
      }

      await Promise.resolve(
        onProgress({
          completed: completedRequests,
          key,
          outcome,
          total: runnableRequests.length,
        }),
      ).catch(() => {});
    }

    try {
      let fatalButtonError = null;

      for (const request of runnableRequests) {
        const key = core.selectedTiersKey(request.selectedTiers);

        if (collector.captured.has(key)) {
          await reportProgress(key, "captured");
          continue;
        }

        const selectionError =
          fatalButtonError ||
          (await clicker.clickCombination(
            definitions,
            request.selectedTiers,
          ));

        if (selectionError) {
          const errorMessage =
            typeof selectionError === "string"
              ? selectionError
              : selectionError.message;
          const errorCode =
            typeof selectionError === "string"
              ? null
              : selectionError.code;
          clickErrors.set(key, {
            code: errorCode,
            details:
              typeof selectionError === "object"
                ? selectionError.details ?? null
                : null,
            message: errorMessage,
          });

          if (
            errorCode === "VARIATION_BUTTON_NOT_FOUND" ||
            errorMessage.startsWith("Could not find")
          ) {
            fatalButtonError = selectionError;
          }

          await reportProgress(
            key,
            errorCode ?? "selection_failed",
          );
          continue;
        }

        await collector.waitFor([key], settleTimeoutMs);

        if (collector.captured.has(key)) {
          await reportProgress(key, "captured");
          continue;
        }

        const forceError = await clicker.forceCombinationRequest(
          definitions,
          request.selectedTiers,
        );

        if (forceError) {
          clickErrors.set(key, {
            code:
              typeof forceError === "string"
                ? null
                : forceError.code,
            details:
              typeof forceError === "object"
                ? forceError.details ?? null
                : null,
            message:
              typeof forceError === "string"
                ? forceError
                : forceError.message,
          });
          await reportProgress(
            key,
            typeof forceError === "string"
              ? "request_not_triggered"
              : forceError.code,
          );
          continue;
        }

        await collector.waitFor([key], settleTimeoutMs);
        await reportProgress(
          key,
          collector.captured.has(key)
            ? "captured"
            : "response_missing",
        );
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
