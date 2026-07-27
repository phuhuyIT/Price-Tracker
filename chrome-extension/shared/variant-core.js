(function loadVariantCore(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ShopeeVariantCore = api;
  }
})(globalThis, function createVariantCore() {
  const FINAL_PRICE_PATHS = [
    ["data", "price_breakdown", "price", "singlevalue"],
    ["data", "price_breakdown", "price", "single_value"],
    ["data", "product_price", "price", "singlevalue"],
    ["data", "product_price", "price", "single_value"],
    ["price_breakdown", "price", "singlevalue"],
    ["price_breakdown", "price", "single_value"],
  ];

  function normalizeSelectedTiers(tierIndex) {
    const entries = Array.isArray(tierIndex)
      ? tierIndex.map((value, index) => [String(index), value])
      : tierIndex && typeof tierIndex === "object"
        ? Object.entries(tierIndex)
        : [];
    const selectedTiers = {};

    for (const [tier, option] of entries) {
      const numericOption = Number(option);

      if (!Number.isInteger(numericOption) || numericOption < 0) {
        return null;
      }

      selectedTiers[String(tier)] = numericOption;
    }

    return Object.keys(selectedTiers).length > 0 ? selectedTiers : null;
  }

  function selectedTiersKey(selectedTiers) {
    const normalized = normalizeSelectedTiers(selectedTiers);

    if (!normalized) {
      return null;
    }

    return Object.keys(normalized)
      .sort((left, right) => Number(left) - Number(right))
      .map((tier) => `${tier}:${normalized[tier]}`)
      .join("|");
  }

  function normalizeId(value) {
    const numericValue = Number(value);
    return Number.isSafeInteger(numericValue) ? numericValue : value;
  }

  function createVariantRequests(item, ids) {
    const models = Array.isArray(item?.models) ? item.models : [];
    const shopId = item?.shopid ?? item?.shop_id ?? ids?.shopId;
    const itemId = item?.itemid ?? item?.item_id ?? ids?.itemId;

    return models.map((model, modelIndex) => {
      const selectedTiers = normalizeSelectedTiers(
        model?.extinfo?.tier_index,
      );

      if (!selectedTiers) {
        return {
          error: "The model does not contain a valid extinfo.tier_index.",
          modelIndex,
          selectedTiers: null,
        };
      }

      if (shopId === undefined || itemId === undefined) {
        return {
          error: "The shop ID or item ID is missing.",
          modelIndex,
          selectedTiers,
        };
      }

      return {
        body: {
          item_id: normalizeId(itemId),
          quantity: 1,
          selected_tiers: selectedTiers,
          shop_id: normalizeId(shopId),
        },
        modelIndex,
        selectedTiers,
      };
    });
  }

  function buildTierDefinitions(item, requests) {
    const sourceTiers = Array.isArray(item?.tier_variations)
      ? item.tier_variations
      : [];
    const optionCounts = [];

    for (const request of requests) {
      for (const [tier, option] of Object.entries(
        request.selectedTiers || {},
      )) {
        const tierIndex = Number(tier);
        optionCounts[tierIndex] = Math.max(
          optionCounts[tierIndex] || 0,
          Number(option) + 1,
        );
      }
    }

    return optionCounts.map((optionCount, tierIndex) => {
      const sourceOptions = Array.isArray(sourceTiers[tierIndex]?.options)
        ? sourceTiers[tierIndex].options
        : [];

      return {
        name: sourceTiers[tierIndex]?.name ?? null,
        optionCount,
        optionLabels: Array.from(
          { length: optionCount },
          (_, optionIndex) => {
            const option = sourceOptions[optionIndex];
            return typeof option === "string"
              ? option
              : option?.option ?? option?.name ?? null;
          },
        ),
      };
    });
  }

  function readPath(value, path) {
    return path.reduce(
      (current, key) =>
        current !== null && current !== undefined
          ? current[key]
          : undefined,
      value,
    );
  }

  function extractFinalDisplayPrice(payload) {
    for (const path of FINAL_PRICE_PATHS) {
      const value = readPath(payload, path);

      if (
        value !== null &&
        value !== undefined &&
        Number.isFinite(Number(value))
      ) {
        return value;
      }
    }

    return null;
  }

  function extractPriceBreakdown(payload) {
    return (
      payload?.data?.price_breakdown ??
      payload?.data?.product_price ??
      payload?.price_breakdown ??
      null
    );
  }

  function responseQuality(response) {
    if (extractFinalDisplayPrice(response?.payload) !== null) {
      return 2;
    }

    return response?.ok ? 1 : 0;
  }

  function storePreferredResponse(captured, key, response) {
    const existing = captured.get(key);

    if (!existing || responseQuality(response) >= responseQuality(existing)) {
      captured.set(key, response);
      return true;
    }

    return false;
  }

  function describeResponseShape(payload) {
    if (!payload || typeof payload !== "object") {
      return "empty payload";
    }

    const rootKeys = Object.keys(payload);
    const dataKeys =
      payload.data && typeof payload.data === "object"
        ? Object.keys(payload.data)
        : [];
    const details = [];

    if (rootKeys.length > 0) {
      details.push(`root keys: ${rootKeys.join(", ")}`);
    }

    if (dataKeys.length > 0) {
      details.push(`data keys: ${dataKeys.join(", ")}`);
    }

    return details.join("; ") || "object without enumerable keys";
  }

  function createInitialPriceResponse(initialPriceBreakdown) {
    if (!initialPriceBreakdown) {
      return null;
    }

    return {
      error: null,
      ok: true,
      payload: {
        data: {
          price_breakdown: initialPriceBreakdown,
        },
      },
      status: 200,
    };
  }

  function buildVariantResponses({
    captured,
    clickErrors,
    initialPriceBreakdown,
    requests,
  }) {
    const runnableCount = requests.filter((request) => request.body).length;
    const initialResponse = createInitialPriceResponse(
      initialPriceBreakdown,
    );

    return requests.map((request) => {
      if (!request.body) {
        return undefined;
      }

      const key = selectedTiersKey(request.selectedTiers);
      const response = captured.get(key);

      if (response) {
        return response;
      }

      if (runnableCount === 1 && initialResponse) {
        return initialResponse;
      }

      const clickError = clickErrors.get(key);

      return {
        error:
          (typeof clickError === "string"
            ? clickError
            : clickError?.message) ||
          "Shopee did not issue a variation-price request for this model.",
        errorCode:
          typeof clickError === "object" ? clickError?.code ?? null : null,
        errorDetails:
          typeof clickError === "object"
            ? clickError?.details ?? null
            : null,
        ok: false,
        payload: null,
        status: null,
      };
    });
  }

  function mergeVariantPricing(item, requests, responses) {
    const models = Array.isArray(item?.models) ? item.models : [];

    return models.map((model, modelIndex) => {
      const request = requests[modelIndex];
      const response = request?.body ? responses[modelIndex] : null;
      const finalDisplayPrice = response
        ? extractFinalDisplayPrice(response.payload)
        : null;
      let error = request?.error ?? response?.error ?? null;

      if (!error && response && !response.ok) {
        error =
          response.payload?.error_msg ??
          response.payload?.message ??
          `The variant API returned HTTP ${response.status}.`;
      }

      if (!error && response && finalDisplayPrice === null) {
        error =
          response.payload?.error_msg ??
          response.payload?.message ??
          `The response did not contain a final display price (${describeResponseShape(
            response.payload,
          )}).`;
      }

      return {
        error,
        error_code:
          request?.errorCode ?? response?.errorCode ?? null,
        error_details:
          request?.errorDetails ?? response?.errorDetails ?? null,
        final_display_price: finalDisplayPrice,
        model_id: model?.modelid ?? model?.model_id ?? null,
        name: model?.name ?? `Variation ${modelIndex + 1}`,
        price: model?.price ?? null,
        price_before_discount: model?.price_before_discount ?? null,
        price_breakdown: response
          ? extractPriceBreakdown(response.payload)
          : null,
        selected_tiers: request?.selectedTiers ?? null,
        status: response?.status ?? null,
      };
    });
  }

  return {
    buildTierDefinitions,
    buildVariantResponses,
    createInitialPriceResponse,
    createVariantRequests,
    describeResponseShape,
    extractFinalDisplayPrice,
    extractPriceBreakdown,
    mergeVariantPricing,
    normalizeSelectedTiers,
    selectedTiersKey,
    storePreferredResponse,
  };
});
