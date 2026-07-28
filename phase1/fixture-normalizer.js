const {
  extractFinalDisplayPrice,
  normalizeSelectedTiers,
  selectedTiersKey,
} = require("../chrome-extension/shared/variant-core");

const DEFAULT_PRICE_SCALE = 100_000;
const PRICE_DEFINITION = "displayed_post_voucher_excluding_shipping";

function normalizeId(value, fieldName) {
  const result = String(value ?? "").trim();

  if (!/^\d+$/.test(result)) {
    throw new Error(`${fieldName} must be a numeric Shopee identifier.`);
  }

  return result;
}

/**
 * Converts Shopee's scaled integer price into an integer VND amount.
 *
 * @param {unknown} rawPrice
 * @param {number} [priceScale]
 * @returns {number}
 */
function convertRawPriceToVnd(
  rawPrice,
  priceScale = DEFAULT_PRICE_SCALE,
) {
  const numericPrice = Number(rawPrice);

  if (
    !Number.isSafeInteger(priceScale) ||
    priceScale <= 0 ||
    !Number.isSafeInteger(numericPrice) ||
    numericPrice <= 0
  ) {
    throw new Error("Raw price and price scale must be positive safe integers.");
  }

  const priceAmount = numericPrice / priceScale;

  if (!Number.isSafeInteger(priceAmount) || priceAmount <= 0) {
    throw new Error("Converted VND price must be a positive safe integer.");
  }

  return priceAmount;
}

function inferAvailability(model, response) {
  if (
    response?.errorCode === "VARIATION_COMBINATION_UNAVAILABLE"
  ) {
    return "unavailable";
  }

  const stock = model?.stock ?? model?.normal_stock;

  if (
    stock !== null &&
    stock !== undefined &&
    stock !== "" &&
    Number.isFinite(Number(stock))
  ) {
    return Number(stock) > 0 ? "available" : "sold_out";
  }

  return "unknown";
}

function createVariationResponseMap(selectedVariations) {
  const responses = new Map();

  for (const evidence of selectedVariations) {
    const selectedTiers =
      evidence?.request?.body?.selected_tiers ??
      evidence?.request?.selectedTiers;
    const key = selectedTiersKey(selectedTiers);

    if (key) {
      responses.set(key, evidence.response);
    }
  }

  return responses;
}

function createProductDetailFallbackMap(pricing) {
  const productPrice = pricing?.data?.product_price;
  const modelId =
    productPrice?.price_model?.price_single_model_id;
  const payload = {
    data: { product_price: productPrice },
  };

  if (
    modelId === null ||
    modelId === undefined ||
    extractFinalDisplayPrice(payload) === null
  ) {
    return new Map();
  }

  return new Map([
    [
      String(modelId),
      {
        error: null,
        ok: true,
        payload,
        priceSource: "product_detail_fallback",
        status: 200,
      },
    ],
  ]);
}

function identifyPriceSource(payload, response) {
  if (response?.priceSource === "product_detail_fallback") {
    return response.priceSource;
  }

  if (payload?.data?.price_breakdown || payload?.price_breakdown) {
    return "variation_price_breakdown";
  }

  if (payload?.data?.product_price) {
    return "verified_display_field";
  }

  return "unknown";
}

function inferVoucherStatus(payload) {
  const priceBreakdown =
    payload?.data?.price_breakdown ?? payload?.price_breakdown;
  const productPrice = payload?.data?.product_price;
  const discountBreakdown = priceBreakdown?.discount_breakdown;
  const finalPriceVouchers =
    productPrice &&
    Object.hasOwn(productPrice, "final_price_vouchers")
      ? productPrice.final_price_vouchers
      : priceBreakdown?.final_price_vouchers;

  if (
    Array.isArray(discountBreakdown) &&
    discountBreakdown.some(
      (discount) =>
        discount?.shop_voucher ||
        discount?.platform_voucher ||
        discount?.ads_voucher,
    )
  ) {
    return "applied";
  }

  if (Array.isArray(finalPriceVouchers)) {
    return finalPriceVouchers.length > 0
      ? "applied"
      : "not_applied";
  }

  if (finalPriceVouchers === null) {
    return "not_applied";
  }

  return "unknown";
}

function missingPriceReason(response) {
  if (!response) {
    return "variation_response_missing";
  }

  if (
    response.errorCode === "VARIATION_COMBINATION_UNAVAILABLE"
  ) {
    return "variation_combination_unavailable";
  }

  if (
    response.errorCode === "VARIATION_SELECTION_RESET_FAILED"
  ) {
    return "variation_selection_reset_failed";
  }

  if (/variation button .* is disabled/i.test(response.error ?? "")) {
    return "variation_option_disabled";
  }

  if (response.ok === false) {
    return "variation_response_failed";
  }

  return "variation_response_missing_display_price";
}

function optionLabel(option) {
  if (typeof option === "string") {
    return option.trim();
  }

  return String(option?.name ?? option?.option ?? "").trim();
}

function isImplicitDefaultVariant(item) {
  const models = Array.isArray(item?.models) ? item.models : [];

  if (
    models.length !== 1 ||
    String(models[0]?.name ?? "").trim() !== ""
  ) {
    return false;
  }

  const tiers = Array.isArray(item?.tier_variations)
    ? item.tier_variations
    : [];

  return tiers.every(
    (tier) =>
      String(tier?.name ?? "").trim() === "" &&
      (!Array.isArray(tier?.options) ||
        tier.options.every((option) => optionLabel(option) === "")),
  );
}

function normalizeVariant(
  model,
  modelIndex,
  responses,
  fallbackResponses,
  priceScale,
  options = {},
) {
  const implicitDefault = options.implicitDefault === true;
  const selectedTiers = normalizeSelectedTiers(model?.extinfo?.tier_index);
  const selectedResponse = selectedTiers
    ? responses.get(selectedTiersKey(selectedTiers))
    : null;
  const identity = model?.modelid ?? model?.model_id;
  const externalModelId = normalizeId(
    identity,
    `models[${modelIndex}].modelid`,
  );
  const responseModelId =
    selectedResponse?.payload?.data?.product_price?.price_model
      ?.price_single_model_id ??
    selectedResponse?.payload?.data?.selected_model_id;
  const base = {
    availability: inferAvailability(model, selectedResponse),
    modelId: implicitDefault ? "default" : externalModelId,
    name: implicitDefault
      ? "Default"
      : model?.name || `Variant ${modelIndex + 1}`,
  };

  if (
    responseModelId !== null &&
    responseModelId !== undefined &&
    String(responseModelId) !== externalModelId
  ) {
    return {
      ...base,
      priceObservation: {
        reason: "variation_response_model_mismatch",
        status: "not_observed",
      },
    };
  }

  const selectedRawPrice = extractFinalDisplayPrice(
    selectedResponse?.payload,
  );
  const fallbackResponse = fallbackResponses.get(externalModelId);
  const response =
    selectedRawPrice === null && fallbackResponse
      ? fallbackResponse
      : selectedResponse;
  const rawPrice = extractFinalDisplayPrice(response?.payload);

  if (rawPrice === null) {
    return {
      ...base,
      priceObservation: {
        reason: missingPriceReason(response),
        status: "not_observed",
      },
    };
  }

  return {
    ...base,
    priceObservation: {
      availability: base.availability,
      currency: "VND",
      priceAmount: convertRawPriceToVnd(rawPrice, priceScale),
      priceDefinition: PRICE_DEFINITION,
      priceSource: implicitDefault
        ? "product_detail_fallback"
        : identifyPriceSource(response.payload, response),
      shippingIncluded: false,
      status: "observed",
      voucherStatus: inferVoucherStatus(response.payload),
    },
  };
}

function readSourceUrlIds(sourceUrl) {
  const match = String(sourceUrl ?? "").match(/i\.(\d+)\.(\d+)/);

  if (!match) {
    throw new Error("Fixture source URL does not contain Shopee product IDs.");
  }

  return {
    itemId: match[2],
    shopId: match[1],
  };
}

function normalizeImageUrl(image) {
  const value = String(image ?? "").trim();

  if (!value) {
    return null;
  }

  if (/^https:\/\//i.test(value)) {
    return value;
  }

  return `https://down-vn.img.susercontent.com/file/${encodeURIComponent(
    value,
  )}`;
}

/**
 * Converts a saved Phase 1 fixture into the proposed shared snapshot shape.
 *
 * @param {object} fixture
 * @param {object} [options]
 * @returns {object}
 */
function normalizeFixtureToSnapshot(fixture, options = {}) {
  const productDetail = fixture?.endpointEvidence?.productDetail;
  const item = productDetail?.response?.data?.item;
  const models = Array.isArray(item?.models) ? item.models : null;

  if (
    productDetail?.endpoint !== "/api/v4/pdp/get_pc" ||
    !item ||
    !models ||
    models.length === 0
  ) {
    throw new Error(
      "Fixture must contain a non-empty get_pc product model catalogue.",
    );
  }

  if (
    typeof fixture.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(fixture.capturedAt))
  ) {
    throw new Error("Fixture capturedAt must be a valid timestamp.");
  }

  if (typeof item.title !== "string" || item.title.trim() === "") {
    throw new Error("Fixture product title is missing.");
  }

  const priceScale = options.priceScale ?? DEFAULT_PRICE_SCALE;
  const sourceUrlIds = readSourceUrlIds(fixture.sourceUrl);
  const itemId = normalizeId(
    item.itemid ?? item.item_id,
    "response.data.item.itemid",
  );
  const shopId = normalizeId(
    item.shopid ?? item.shop_id,
    "response.data.item.shopid",
  );

  if (
    itemId !== sourceUrlIds.itemId ||
    shopId !== sourceUrlIds.shopId
  ) {
    throw new Error("Fixture product IDs do not match its source URL.");
  }

  const selectedVariations =
    fixture?.endpointEvidence?.selectedVariations ?? [];
  const responses = createVariationResponseMap(selectedVariations);
  const fallbackResponses = createProductDetailFallbackMap(
    productDetail.response.data.pricing,
  );
  const implicitDefault = isImplicitDefaultVariant(item);
  const variants = models.map((model, modelIndex) =>
    normalizeVariant(
      model,
      modelIndex,
      responses,
      fallbackResponses,
      priceScale,
      { implicitDefault },
    ),
  );
  const uniqueModelIds = new Set(
    variants.map((variant) => variant.modelId),
  );

  if (uniqueModelIds.size !== variants.length) {
    throw new Error("Fixture model catalogue contains duplicate model IDs.");
  }

  const pricedVariantCount = variants.filter(
    (variant) => variant.priceObservation.status === "observed",
  ).length;

  return {
    canonicalUrl: fixture.sourceUrl,
    capturedAt: fixture.capturedAt,
    coverageConfidence: "verified",
    currency: "VND",
    expectedVariantCount: models.length,
    imageUrl: normalizeImageUrl(item.image),
    itemId,
    observedVariantCount: models.length,
    platform: "shopee",
    pricedVariantCount,
    pricingContext: fixture.pricingContext,
    shopId,
    source: "extension",
    title: item.title,
    variantCoverage: "complete",
    variants,
  };
}

module.exports = {
  DEFAULT_PRICE_SCALE,
  PRICE_DEFINITION,
  convertRawPriceToVnd,
  normalizeFixtureToSnapshot,
};
