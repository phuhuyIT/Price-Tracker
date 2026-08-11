import {
  PRICE_OBSERVATION_STATUS,
  PRODUCT_SNAPSHOT_SCHEMA_VERSION,
  PRICING_CONTEXTS,
  SNAPSHOT_SOURCES,
  VARIANT_IDENTITY_TYPES,
} from '../constants/contractValues.js';
import {
  PRICE_DEFINITIONS,
  PRICE_TYPES,
  SUPPORTED_CURRENCIES,
} from '../constants/priceDefinitions.js';
import { SHOPEE_HOSTNAME } from '../constants/shopeeEndpoints.js';
import { productSnapshotSchema } from '../schemas/productSnapshotSchema.js';
import { getShopeeProductIdentity } from '../schemas/shopeeUrlSchema.js';

export const DEFAULT_SHOPEE_PRICE_SCALE = 100_000;

function selectedTiersKey(selectedTiers) {
  const entries = Array.isArray(selectedTiers)
    ? selectedTiers.map((option, tier) => [String(tier), option])
    : Object.entries(selectedTiers ?? {});

  return entries
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([tier, option]) => `${tier}:${Number(option)}`)
    .join('|');
}

function normaliseImageUrl(image) {
  const value = String(image ?? '').trim();

  if (!value) {
    return null;
  }

  if (/^https:\/\//iu.test(value)) {
    return value;
  }

  return `https://down-vn.img.susercontent.com/file/${encodeURIComponent(value)}`;
}

function canonicaliseProductUrl(value) {
  const identity = getShopeeProductIdentity(value);

  if (!identity) {
    return null;
  }

  const url = new URL(value);
  url.hash = '';
  url.hostname = SHOPEE_HOSTNAME;
  url.password = '';
  url.port = '';
  url.search = '';
  url.username = '';
  return url.toString();
}

/** Return whether a verified catalogue represents one product with no visible variants. */
export function isImplicitDefaultShopeeProduct(product) {
  if (product.models.length !== 1 || product.models[0].name.trim() !== '') {
    return false;
  }

  return product.tierVariations.every(
    (tier) => tier.name.trim() === '' && tier.options.every((option) => option.trim() === ''),
  );
}

function convertRawPrice(rawPrice, priceScale) {
  if (
    !Number.isSafeInteger(rawPrice) ||
    rawPrice <= 0 ||
    !Number.isSafeInteger(priceScale) ||
    priceScale <= 0
  ) {
    return null;
  }

  const amount = rawPrice / priceScale;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function observedPrice(evidence, priceScale) {
  const priceAmount = convertRawPrice(evidence?.rawPrice, priceScale);

  if (priceAmount === null || evidence?.priceSource === null) {
    return null;
  }

  return {
    currency: SUPPORTED_CURRENCIES.VND,
    priceAmount,
    priceDefinition: PRICE_DEFINITIONS.DISPLAYED_POST_VOUCHER_EXCLUDING_SHIPPING,
    priceSource: evidence.priceSource,
    priceType: PRICE_TYPES.LISTED,
    shippingIncluded: false,
    status: PRICE_OBSERVATION_STATUS.OBSERVED,
    voucherStatus: evidence.voucherStatus,
  };
}

function notObserved(reason) {
  return { reason, status: PRICE_OBSERVATION_STATUS.NOT_OBSERVED };
}

function variationFailureReason(capture) {
  if (!capture) {
    return 'variation_response_missing';
  }

  if (capture.response.errorCode === 'VARIATION_COMBINATION_UNAVAILABLE') {
    return 'variation_combination_unavailable';
  }

  if (!capture.response.ok) {
    return 'variation_response_failed';
  }

  return 'variation_response_missing_display_price';
}

function normaliseVariant({ implicitDefault, index, model, priceScale, state }) {
  const externalModelId = model.modelId;
  const variation = state.variations.get(selectedTiersKey(model.tierIndex));
  const fallback = state.productDetail.priceEvidence;
  const variationModelMismatch =
    variation?.priceEvidence.modelId && variation.priceEvidence.modelId !== externalModelId;
  const targetedStockQuantity =
    variation?.response.ok && !variationModelMismatch ? variation.stockQuantity : null;
  const targetedAvailability =
    targetedStockQuantity === null
      ? 'unknown'
      : targetedStockQuantity === 0
        ? 'sold_out'
        : 'available';
  const base = {
    availability: targetedAvailability !== 'unknown' ? targetedAvailability : model.availability,
    identityType: implicitDefault
      ? VARIANT_IDENTITY_TYPES.SYNTHETIC_DEFAULT
      : VARIANT_IDENTITY_TYPES.SHOPEE_MODEL,
    modelId: implicitDefault ? 'default' : externalModelId,
    name: implicitDefault ? 'Default' : model.name.trim() || `Variant ${index + 1}`,
    stockQuantity: targetedStockQuantity ?? model.stockQuantity,
  };

  if (variationModelMismatch) {
    return { ...base, priceObservation: notObserved('variation_response_model_mismatch') };
  }

  const selectedObservation = observedPrice(variation?.priceEvidence, priceScale);

  if (selectedObservation) {
    return { ...base, priceObservation: selectedObservation };
  }

  if (fallback.modelId === externalModelId) {
    const fallbackObservation = observedPrice(fallback, priceScale);

    if (fallbackObservation) {
      return { ...base, priceObservation: fallbackObservation };
    }
  }

  return { ...base, priceObservation: notObserved(variationFailureReason(variation)) };
}

/** Create the per-page state used to assemble product and variation captures. */
export function createShopeeCaptureState() {
  return {
    latestSelectedKey: null,
    productDetail: null,
    quantity: null,
    variations: new Map(),
  };
}

function sameProduct(product, request) {
  return product.itemId === request.itemId && product.shopId === request.shopId;
}

function hasExactProductDetailPrice(capture, product = capture?.product) {
  const evidence = capture?.priceEvidence;
  return (
    product?.models.some((model) => model.modelId === evidence?.modelId) === true &&
    observedPrice(evidence, DEFAULT_SHOPEE_PRICE_SCALE) !== null
  );
}

function mergeSameProductDetail(previous, incoming) {
  const previousModels = new Map(previous.product.models.map((model) => [model.modelId, model]));
  const product = {
    ...incoming.product,
    models: incoming.product.models.map((model) => {
      const previousModel = previousModels.get(model.modelId);

      return model.availability === 'unknown' && previousModel?.availability !== 'unknown'
        ? { ...model, availability: previousModel.availability }
        : model;
    }),
  };
  const keepPreviousPrice =
    !hasExactProductDetailPrice(incoming) && hasExactProductDetailPrice(previous, incoming.product);

  return keepPreviousPrice
    ? {
        ...incoming,
        capturedAt: previous.capturedAt,
        priceEvidence: previous.priceEvidence,
        product,
      }
    : { ...incoming, product };
}

function retainCompatibleVariations(state, product) {
  const validKeys = new Set(product.models.map((model) => selectedTiersKey(model.tierIndex)));

  for (const key of state.variations.keys()) {
    if (!validKeys.has(key)) {
      state.variations.delete(key);
    }
  }

  if (state.latestSelectedKey && !state.variations.has(state.latestSelectedKey)) {
    state.latestSelectedKey = null;
  }

  if (state.variations.size === 0) {
    state.quantity = null;
  }
}

/** Apply one validated, sanitised capture to an in-memory page catalogue. */
export function applyShopeeCapture(state, capture) {
  if (capture.kind === 'product_detail') {
    if (!state.productDetail || !sameProduct(state.productDetail.product, capture.product)) {
      state.productDetail = capture;
      state.latestSelectedKey = null;
      state.quantity = null;
      state.variations.clear();
      return state;
    }

    state.productDetail = mergeSameProductDetail(state.productDetail, capture);
    retainCompatibleVariations(state, capture.product);
    return state;
  }

  if (!state.productDetail || !sameProduct(state.productDetail.product, capture.request)) {
    return state;
  }

  const key = selectedTiersKey(capture.request.selectedTiers);
  const existing = state.variations.get(key);
  const contextChanged =
    (state.quantity !== null && state.quantity !== capture.request.quantity) ||
    (existing !== undefined &&
      (JSON.stringify(existing.priceEvidence) !== JSON.stringify(capture.priceEvidence) ||
        existing.stockQuantity !== capture.stockQuantity));

  if (contextChanged) {
    state.variations.clear();
  }

  state.latestSelectedKey = key;
  state.quantity = capture.request.quantity;
  state.variations.set(key, capture);
  return state;
}

/** Convert assembled evidence into the shared, backend-validated snapshot contract. */
export function normaliseShopeeCaptureState(
  state,
  {
    pageAvailability = 'unknown',
    pageUrl,
    priceScale = DEFAULT_SHOPEE_PRICE_SCALE,
    pricingContextKey,
  },
) {
  if (!state.productDetail) {
    return null;
  }

  const canonicalUrl = canonicaliseProductUrl(pageUrl);
  const urlIdentity = canonicalUrl ? getShopeeProductIdentity(canonicalUrl) : null;
  const product = state.productDetail.product;

  if (
    !urlIdentity ||
    urlIdentity.itemId !== product.itemId ||
    urlIdentity.shopId !== product.shopId
  ) {
    return null;
  }

  const implicitDefault = isImplicitDefaultShopeeProduct(product);
  let variants = product.models.map((model, index) =>
    normaliseVariant({ implicitDefault, index, model, priceScale, state }),
  );

  if (
    implicitDefault &&
    variants.length === 1 &&
    variants[0].availability === 'unknown' &&
    ['sold_out', 'unavailable'].includes(pageAvailability)
  ) {
    variants = [{ ...variants[0], availability: pageAvailability }];
  }
  const pricedVariantCount = variants.filter(
    (variant) => variant.priceObservation.status === PRICE_OBSERVATION_STATUS.OBSERVED,
  ).length;
  const snapshot = {
    canonicalUrl,
    capturedAt: state.productDetail.capturedAt,
    coverageConfidence: 'verified',
    currency: SUPPORTED_CURRENCIES.VND,
    expectedVariantCount: variants.length,
    imageUrl: normaliseImageUrl(product.image),
    itemId: product.itemId,
    lifecycleEligible: true,
    observedVariantCount: variants.length,
    platform: 'shopee',
    pricedVariantCount,
    pricingContext: PRICING_CONTEXTS.USER_SESSION,
    pricingContextKey,
    schemaVersion: PRODUCT_SNAPSHOT_SCHEMA_VERSION,
    shopId: product.shopId,
    source: SNAPSHOT_SOURCES.EXTENSION,
    title: product.title,
    variantCoverage: 'complete',
    variants,
  };

  const latestCapture = state.latestSelectedKey
    ? state.variations.get(state.latestSelectedKey)
    : null;

  if (latestCapture) {
    snapshot.capturedAt = latestCapture.capturedAt;
  }

  const validation = productSnapshotSchema.safeParse(snapshot);
  return validation.success ? validation.data : null;
}

/** Build a popup-safe summary containing no raw response evidence. */
export function createShopeeCaptureSummary(state, snapshot) {
  const selectedCapture = state.latestSelectedKey
    ? state.variations.get(state.latestSelectedKey)
    : null;
  const selectedModel = selectedCapture
    ? state.productDetail.product.models.find(
        (model) => selectedTiersKey(model.tierIndex) === state.latestSelectedKey,
      )
    : state.productDetail.product.models.find(
        (model) => model.modelId === state.productDetail.priceEvidence.modelId,
      );
  const selectedVariant = selectedModel
    ? snapshot.variants.find(
        (variant) =>
          variant.modelId === selectedModel.modelId ||
          (variant.modelId === 'default' && snapshot.variants.length === 1),
      )
    : null;
  const observedVariants = snapshot.variants.filter(
    (variant) => variant.priceObservation.status === PRICE_OBSERVATION_STATUS.OBSERVED,
  );
  const purchasableObservedVariants = observedVariants.filter(
    (variant) => !['sold_out', 'unavailable'].includes(variant.availability),
  );
  const displayedVariant =
    selectedVariant?.priceObservation.status === PRICE_OBSERVATION_STATUS.OBSERVED
      ? selectedVariant
      : (purchasableObservedVariants.length > 0
          ? purchasableObservedVariants
          : observedVariants
        ).toSorted(
          (left, right) => left.priceObservation.priceAmount - right.priceObservation.priceAmount,
        )[0];

  return {
    capturedAt: snapshot.capturedAt,
    displayedAvailability:
      displayedVariant?.availability ?? selectedVariant?.availability ?? 'unknown',
    displayedPriceAmount: displayedVariant?.priceObservation.priceAmount ?? null,
    displayedStockQuantity:
      displayedVariant?.stockQuantity ?? selectedVariant?.stockQuantity ?? null,
    itemId: snapshot.itemId,
    selectedVariant: selectedVariant?.name ?? displayedVariant?.name ?? null,
    shopId: snapshot.shopId,
    title: snapshot.title,
    voucherStatus:
      displayedVariant?.priceObservation.status === PRICE_OBSERVATION_STATUS.OBSERVED
        ? displayedVariant.priceObservation.voucherStatus
        : 'unknown',
  };
}
