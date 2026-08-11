import {
  EXTENSION_CAPTURE_KINDS,
  EXTENSION_CAPTURE_MESSAGE_TYPE,
} from '../constants/extensionProtocol.js';
import { EXTENSION_MESSAGE_PROTOCOL_VERSION } from '../constants/contractValues.js';
import {
  SHOPEE_PRODUCT_DETAIL_ENDPOINT,
  SHOPEE_SELECTED_VARIATION_ENDPOINTS,
} from '../constants/shopeeEndpoints.js';

const FINAL_PRICE_PATHS = Object.freeze([
  ['price', 'singlevalue'],
  ['price', 'single_value'],
]);

function readPath(value, path) {
  return path.reduce(
    (current, key) => (current !== null && current !== undefined ? current[key] : undefined),
    value,
  );
}

function positiveId(value) {
  const result = String(value ?? '').trim();
  return /^[1-9]\d{0,29}$/u.test(result) ? result : null;
}

function positiveSafeInteger(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function safeTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

function sanitiseStockQuantity(value) {
  const stockQuantity = Number(value);
  return value !== null && value !== '' && Number.isSafeInteger(stockQuantity) && stockQuantity >= 0
    ? stockQuantity
    : null;
}

function normaliseSelectedTiers(value) {
  const entries = Array.isArray(value)
    ? value.map((option, tier) => [String(tier), option])
    : value && typeof value === 'object'
      ? Object.entries(value)
      : [];
  const result = {};

  for (const [tier, option] of entries) {
    const tierNumber = Number(tier);
    const optionNumber = Number(option);

    if (
      !Number.isSafeInteger(tierNumber) ||
      tierNumber < 0 ||
      !Number.isSafeInteger(optionNumber) ||
      optionNumber < 0
    ) {
      return null;
    }

    result[String(tierNumber)] = optionNumber;
  }

  return Object.keys(result).length > 0 ? result : null;
}

function inferAvailability(
  model,
  stockQuantity = sanitiseStockQuantity(model?.stock ?? model?.normal_stock),
) {
  if (model?.sold_out === true || model?.is_sold_out === true) {
    return 'sold_out';
  }

  const stockAvailability =
    stockQuantity === null ? 'unknown' : stockQuantity === 0 ? 'sold_out' : 'available';

  if (stockAvailability !== 'unknown') {
    return stockAvailability;
  }

  const itemStatus = String(model?.item_status ?? '')
    .trim()
    .toLowerCase();

  if (['sold_out', 'out_of_stock'].includes(itemStatus)) {
    return 'sold_out';
  }

  if (model?.status === 0 || itemStatus === 'unavailable') {
    return 'unavailable';
  }

  return 'unknown';
}

function normaliseVoucherStatus(priceContainer) {
  const discounts = priceContainer?.discount_breakdown;

  if (
    Array.isArray(discounts) &&
    discounts.some(
      (discount) =>
        discount?.shop_voucher === true ||
        discount?.platform_voucher === true ||
        discount?.ads_voucher === true,
    )
  ) {
    return 'applied';
  }

  if (priceContainer && Object.hasOwn(priceContainer, 'final_price_vouchers')) {
    const vouchers = priceContainer.final_price_vouchers;

    if (Array.isArray(vouchers)) {
      return vouchers.length > 0 ? 'applied' : 'not_applied';
    }

    if (vouchers === null) {
      return 'not_applied';
    }
  }

  return 'unknown';
}

function findPriceContainers(payload) {
  const candidates = [
    {
      container: payload?.data?.price_breakdown,
      source: 'variation_price_breakdown',
    },
    {
      container: payload?.price_breakdown,
      source: 'variation_price_breakdown',
    },
    {
      container: payload?.data?.product_price,
      source: 'verified_display_field',
    },
  ];

  return candidates.filter(
    ({ container }, index) =>
      container &&
      typeof container === 'object' &&
      candidates.findIndex((candidate) => candidate.container === container) === index,
  );
}

function priceEvidenceScore(evidence, expectedModelIds) {
  const matchesExpectedModel =
    evidence.modelId !== null && expectedModelIds.includes(evidence.modelId);

  return (
    (evidence.rawPrice === null ? 0 : 2) +
    (evidence.modelId === null ? 0 : 1) +
    (matchesExpectedModel ? 4 : 0)
  );
}

/** Extract only price fields required by the normalised snapshot contract. */
export function sanitisePriceEvidence(payload, { expectedModelIds = [], forcedSource } = {}) {
  let bestEvidence = {
    modelId: null,
    priceSource: null,
    rawPrice: null,
    voucherStatus: 'unknown',
  };

  for (const { container, source } of findPriceContainers(payload)) {
    let rawPrice = null;

    for (const path of FINAL_PRICE_PATHS) {
      rawPrice = positiveSafeInteger(readPath(container, path));

      if (rawPrice !== null) {
        break;
      }
    }

    const evidence = {
      modelId: positiveId(
        container?.price_model?.price_single_model_id ?? payload?.data?.selected_model_id,
      ),
      priceSource: rawPrice === null ? null : (forcedSource ?? source),
      rawPrice,
      voucherStatus: normaliseVoucherStatus(container),
    };

    if (
      priceEvidenceScore(evidence, expectedModelIds) >
      priceEvidenceScore(bestEvidence, expectedModelIds)
    ) {
      bestEvidence = evidence;
    }
  }

  return bestEvidence;
}

function sanitiseProductDetailPriceEvidence(payload, models) {
  const options = {
    expectedModelIds: models.map((model) => model.modelId).filter(Boolean),
    forcedSource: 'product_detail_fallback',
  };
  const nestedEvidence = sanitisePriceEvidence(payload?.data?.pricing, options);
  const matchesCatalogueModel = (evidence) =>
    evidence.rawPrice !== null &&
    evidence.modelId !== null &&
    models.some((model) => model.modelId === evidence.modelId);

  if (matchesCatalogueModel(nestedEvidence) || models.length !== 1) {
    return nestedEvidence;
  }

  const directEvidence = sanitisePriceEvidence(payload, options);
  return matchesCatalogueModel(directEvidence) ? directEvidence : nestedEvidence;
}

function sanitiseTierVariations(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((tier) => ({
    name: typeof tier?.name === 'string' ? tier.name.slice(0, 200) : '',
    options: Array.isArray(tier?.options)
      ? tier.options.map((option) =>
          String(
            typeof option === 'string' ? option : (option?.name ?? option?.option ?? ''),
          ).slice(0, 300),
        )
      : [],
  }));
}

function sanitiseModels(value, product) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((model) => {
    const selectedTiers = normaliseSelectedTiers(model?.extinfo?.tier_index);
    const modelStockQuantity = sanitiseStockQuantity(model?.stock ?? model?.normal_stock);
    const modelAvailability = inferAvailability(model, modelStockQuantity);
    const availability =
      modelAvailability !== 'unknown'
        ? modelAvailability
        : ['sold_out', 'unavailable'].includes(product.availability) || value.length === 1
          ? product.availability
          : 'unknown';
    const candidateStockQuantity =
      modelStockQuantity ??
      (modelAvailability === 'unknown' && value.length === 1 ? product.stockQuantity : null);
    const stockQuantity =
      candidateStockQuantity !== null &&
      ((candidateStockQuantity === 0 && availability === 'sold_out') ||
        (candidateStockQuantity > 0 && availability === 'available'))
        ? candidateStockQuantity
        : null;

    return {
      availability,
      modelId: positiveId(model?.modelid ?? model?.model_id),
      name: typeof model?.name === 'string' ? model.name.slice(0, 300) : '',
      stockQuantity,
      tierIndex: selectedTiers ? Object.values(selectedTiers) : [],
    };
  });
}

function captureEnvelope({ capturedAt, endpoint, kind }) {
  return {
    capturedAt: safeTimestamp(capturedAt),
    endpoint,
    kind,
    protocolVersion: EXTENSION_MESSAGE_PROTOCOL_VERSION,
    type: EXTENSION_CAPTURE_MESSAGE_TYPE,
  };
}

/** Create an allowlisted product-detail capture without retaining the raw response. */
export function sanitiseProductDetailCapture(payload, { capturedAt } = {}) {
  const item = payload?.data?.item;

  if (!item || typeof item !== 'object') {
    return null;
  }

  const productStockQuantity = sanitiseStockQuantity(item.stock ?? item.normal_stock);
  const models = sanitiseModels(item.models, {
    availability: inferAvailability(item, productStockQuantity),
    stockQuantity: productStockQuantity,
  });

  return {
    ...captureEnvelope({
      capturedAt,
      endpoint: SHOPEE_PRODUCT_DETAIL_ENDPOINT,
      kind: EXTENSION_CAPTURE_KINDS.PRODUCT_DETAIL,
    }),
    priceEvidence: sanitiseProductDetailPriceEvidence(payload, models),
    product: {
      currency: String(item.currency ?? '').toUpperCase(),
      image: typeof item.image === 'string' ? item.image.slice(0, 2_048) : null,
      itemId: positiveId(item.itemid ?? item.item_id),
      models,
      shopId: positiveId(item.shopid ?? item.shop_id),
      tierVariations: sanitiseTierVariations(item.tier_variations),
      title: String(item.title ?? item.name ?? '').slice(0, 500),
    },
  };
}

function safeErrorCode(payload) {
  const value = payload?.error_code ?? payload?.error;

  if (value === null || value === undefined || value === '') {
    return null;
  }

  return String(value).trim().slice(0, 96) || null;
}

/** Create allowlisted selected-variation evidence without request headers or credentials. */
export function sanitiseSelectedVariationCapture(
  payload,
  { capturedAt, endpoint = SHOPEE_SELECTED_VARIATION_ENDPOINTS[0], ok, requestBody, status } = {},
) {
  const selectedTiers = normaliseSelectedTiers(requestBody?.selected_tiers);
  const itemId = positiveId(requestBody?.item_id);
  const shopId = positiveId(requestBody?.shop_id);
  const quantity = positiveSafeInteger(requestBody?.quantity ?? 1);

  if (
    !selectedTiers ||
    !itemId ||
    !shopId ||
    !quantity ||
    !SHOPEE_SELECTED_VARIATION_ENDPOINTS.includes(endpoint)
  ) {
    return null;
  }

  const stockQuantity = ok === true ? sanitiseStockQuantity(payload?.data?.stock) : null;

  return {
    ...captureEnvelope({
      capturedAt,
      endpoint,
      kind: EXTENSION_CAPTURE_KINDS.SELECTED_VARIATION,
    }),
    priceEvidence: sanitisePriceEvidence(payload),
    request: { itemId, quantity, selectedTiers, shopId },
    response: {
      errorCode: safeErrorCode(payload),
      ok: ok === true,
      status: Number.isInteger(status) && status >= 0 && status <= 599 ? status : null,
    },
    stockQuantity,
  };
}

/** Parse a variation request body without reading headers or credentials. */
export function parseVariationRequestBody(value) {
  if (value && typeof value === 'object' && !(value instanceof URLSearchParams)) {
    return value;
  }

  const text = value instanceof URLSearchParams ? value.toString() : value;

  if (typeof text !== 'string' || text.length > 32_768) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    try {
      const parameters = new URLSearchParams(text);
      const body = Object.fromEntries(parameters.entries());

      if (typeof body.selected_tiers === 'string') {
        body.selected_tiers = JSON.parse(body.selected_tiers);
      }

      return body;
    } catch {
      return null;
    }
  }
}
