const SENSITIVE_KEY_PATTERN =
  /(account|address|authorization|buyer|cookie|device|email|fingerprint|phone|session|signature|token|user_?id)/i;

const ITEM_FIELDS = [
  "currency",
  "image",
  "item_status",
  "itemid",
  "item_id",
  "normal_stock",
  "price",
  "price_before_discount",
  "price_max",
  "price_min",
  "shopid",
  "shop_id",
  "status",
  "stock",
  "title",
];

const MODEL_FIELDS = [
  "item_status",
  "model_id",
  "modelid",
  "name",
  "normal_stock",
  "price",
  "price_before_discount",
  "status",
  "stock",
];

function copyDefinedFields(source, fields) {
  const result = {};

  for (const field of fields) {
    if (source?.[field] !== undefined) {
      result[field] = source[field];
    }
  }

  return result;
}

function sanitizeNestedValue(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeNestedValue(entry, seen));
  }

  if (typeof value !== "object") {
    return undefined;
  }

  if (seen.has(value)) {
    return undefined;
  }

  seen.add(value);

  const result = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }

    const sanitisedValue = sanitizeNestedValue(nestedValue, seen);

    if (sanitisedValue !== undefined) {
      result[key] = sanitisedValue;
    }
  }

  seen.delete(value);
  return result;
}

function sanitizeTierVariations(tierVariations) {
  if (!Array.isArray(tierVariations)) {
    return undefined;
  }

  return tierVariations.map((tier) => ({
    name: typeof tier?.name === "string" ? tier.name : null,
    options: Array.isArray(tier?.options)
      ? tier.options.map((option) => {
          if (typeof option === "string") {
            return option;
          }

          return {
            name: option?.name ?? option?.option ?? null,
          };
        })
      : [],
  }));
}

function sanitizeItem(item, ids) {
  const models = Array.isArray(item?.models) ? item.models : [];
  const tierVariations = sanitizeTierVariations(item?.tier_variations);
  const sanitisedItem = {
    ...copyDefinedFields(item, ITEM_FIELDS),
    itemid: item?.itemid ?? item?.item_id ?? ids.itemId,
    models: models.map((model) => ({
      ...copyDefinedFields(model, MODEL_FIELDS),
      extinfo: {
        tier_index: Array.isArray(model?.extinfo?.tier_index)
          ? [...model.extinfo.tier_index]
          : model?.extinfo?.tier_index ?? null,
      },
    })),
    shopid: item?.shopid ?? item?.shop_id ?? ids.shopId,
  };

  if (tierVariations) {
    sanitisedItem.tier_variations = tierVariations;
  }

  return sanitisedItem;
}

function sanitizeRequest(request) {
  const body = request?.body;

  if (!body || typeof body !== "object") {
    return {
      error: request?.error ?? "variation_request_missing",
      modelIndex: request?.modelIndex ?? null,
      selectedTiers: request?.selectedTiers ?? null,
    };
  }

  return {
    body: {
      item_id: body.item_id,
      quantity: body.quantity,
      selected_tiers: sanitizeNestedValue(body.selected_tiers),
      shop_id: body.shop_id,
    },
    modelIndex: request?.modelIndex ?? null,
    selectedTiers: sanitizeNestedValue(request?.selectedTiers),
  };
}

function sanitizeVariationPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const result = copyDefinedFields(payload, [
    "error",
    "error_msg",
    "message",
  ]);
  const data = copyDefinedFields(payload.data, [
    "price_breakdown",
    "product_price",
    "selected_model_id",
  ]);

  if (Object.keys(data).length > 0) {
    result.data = sanitizeNestedValue(data);
  }

  if (payload.price_breakdown !== undefined) {
    result.price_breakdown = sanitizeNestedValue(payload.price_breakdown);
  }

  return sanitizeNestedValue(result);
}

function sanitizeResponse(response) {
  return {
    error: response?.error ?? null,
    errorCode: response?.errorCode ?? response?.error_code ?? null,
    ok: response?.ok === true,
    payload: sanitizeVariationPayload(response?.payload),
    status: Number.isInteger(response?.status) ? response.status : null,
  };
}

function canonicalizeProductUrl(targetUrl) {
  const url = new URL(targetUrl);
  url.hash = "";
  url.search = "";
  return url.toString();
}

/**
 * Creates a deliberately allowlisted fixture from the local extension bridge.
 * Browser headers, cookies and raw requests are never accepted by this API.
 *
 * @param {object} input
 * @returns {object}
 */
function createSanitizedFixture({
  capturedAt,
  initialPricingPayload,
  item,
  targetUrl,
  variantRequests,
  variantResponses,
}) {
  const canonicalUrl = canonicalizeProductUrl(targetUrl);
  const urlIds = canonicalUrl.match(/i\.(\d+)\.(\d+)/);
  const ids = {
    itemId: urlIds?.[2] ?? null,
    shopId: urlIds?.[1] ?? null,
  };
  const requests = Array.isArray(variantRequests) ? variantRequests : [];
  const responses = Array.isArray(variantResponses) ? variantResponses : [];

  return {
    fixtureVersion: 1,
    capturedAt,
    platform: "shopee",
    pricingContext: "user_session",
    provenance: "sanitized_live_capture",
    sourceUrl: canonicalUrl,
    endpointEvidence: {
      productDetail: {
        endpoint: "/api/v4/pdp/get_pc",
        response: {
          data: {
            item: sanitizeItem(item, ids),
            pricing: sanitizeNestedValue(initialPricingPayload ?? {}),
          },
        },
      },
      selectedVariations: requests.map((request, index) => ({
        endpoint: "/api/v4/pdp/cart_panel/select_variation_pc",
        request: sanitizeRequest(request),
        response: sanitizeResponse(responses[index]),
      })),
    },
  };
}

module.exports = {
  canonicalizeProductUrl,
  createSanitizedFixture,
  sanitizeNestedValue,
};
