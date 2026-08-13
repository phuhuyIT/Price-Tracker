import { getShopeeProductIdentity } from '../../../packages/shared/schemas/shopeeUrlSchema.js';

export const PINNED_PRODUCT_LIMIT = 5;
export const PINNED_PRODUCT_STORAGE_KEY = 'pinnedProductsByScope';
const PRODUCT_SEARCH_RESULT_LIMIT = 8;

function productPinsError(message, code, status = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function isPositiveIdentifier(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/** Repair one persisted pin list into five unique positive product IDs. */
export function normalisePinnedProductIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(Number).filter(isPositiveIdentifier))].slice(
    0,
    PINNED_PRODUCT_LIMIT,
  );
}

/** Repair the account-scoped pin record loaded from extension storage. */
export function normalisePinnedProductScopes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([scope]) => scope.length > 0 && scope.length <= 500)
      .map(([scope, productIds]) => [scope, normalisePinnedProductIds(productIds)]),
  );
}

/** Identify the local pin namespace without exposing the bearer credential. */
export function productPinScope(state) {
  const backendBaseUrl = state?.settings?.backendBaseUrl ?? 'unknown-backend';
  const userId = Number(state?.auth?.user?.id);
  const owner =
    state?.auth?.mode === 'enabled'
      ? isPositiveIdentifier(userId)
        ? `user:${userId}`
        : 'signed-out'
      : 'local';

  return `${backendBaseUrl}|${owner}`;
}

/** Add or remove one pin while preserving most-recently-pinned order. */
export function togglePinnedProductId(value, productId) {
  const pinnedProductIds = normalisePinnedProductIds(value);
  const numericProductId = Number(productId);

  if (!isPositiveIdentifier(numericProductId)) {
    throw productPinsError('A valid tracked product is required', 'INVALID_PRODUCT_ID');
  }

  if (pinnedProductIds.includes(numericProductId)) {
    return pinnedProductIds.filter((id) => id !== numericProductId);
  }

  if (pinnedProductIds.length >= PINNED_PRODUCT_LIMIT) {
    throw productPinsError(
      `You can pin up to ${PINNED_PRODUCT_LIMIT} products`,
      'PIN_LIMIT_REACHED',
    );
  }

  return [numericProductId, ...pinnedProductIds];
}

function safeCanonicalUrl(value) {
  if (typeof value !== 'string' || getShopeeProductIdentity(value) === null) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Reduce the dashboard product contract to fields that are safe and useful in the popup. */
function compactPopupProduct(product) {
  const id = Number(product?.id);

  if (!isPositiveIdentifier(id)) {
    return null;
  }

  const title = typeof product.title === 'string' ? product.title.trim().slice(0, 500) : '';
  const priceAmount = Number(product?.currentLowestPrice?.priceAmount);

  return {
    availability: ['available', 'sold_out', 'unavailable', 'unknown'].includes(product.availability)
      ? product.availability
      : 'unknown',
    canonicalUrl: safeCanonicalUrl(product.canonicalUrl),
    id,
    lastSuccessAt:
      typeof product.lastSuccessAt === 'string' &&
      Number.isFinite(Date.parse(product.lastSuccessAt))
        ? product.lastSuccessAt
        : null,
    priceAmount: isPositiveIdentifier(priceAmount) ? priceAmount : null,
    title: title || 'Untitled tracked product',
    trackingStatus: product.trackingStatus === 'paused' ? 'paused' : 'active',
  };
}

/** Put pinned products first, then fill the five available positions with recent products. */
export function selectPopupProducts(products, pinnedProductIds) {
  const compactProducts = products.map(compactPopupProduct).filter(Boolean);
  const productById = new Map(compactProducts.map((product) => [product.id, product]));
  const pinnedIds = normalisePinnedProductIds(pinnedProductIds);
  const selectedIds = new Set();
  const selected = [];

  for (const productId of pinnedIds) {
    const product = productById.get(productId);

    if (product) {
      selected.push({ ...product, isPinned: true, listReason: 'pinned' });
      selectedIds.add(productId);
    }
  }

  for (const product of compactProducts) {
    if (selected.length >= PINNED_PRODUCT_LIMIT) {
      break;
    }

    if (!selectedIds.has(product.id)) {
      selected.push({ ...product, isPinned: false, listReason: 'recent' });
      selectedIds.add(product.id);
    }
  }

  return selected;
}

function requireBackendResult(result, fallbackMessage) {
  if (result?.kind === 'success') {
    return result;
  }

  throw productPinsError(
    result?.error ?? fallbackMessage,
    result?.errorCode ?? 'PRODUCT_LIST_UNAVAILABLE',
    result?.status ?? null,
  );
}

/** Create the popup pin/search service over the existing owner-scoped backend client. */
export function createProductPinsService({ backendClient, store }) {
  let pendingPinOperation = Promise.resolve();

  function enqueuePinOperation(callback) {
    const operation = pendingPinOperation.then(callback);
    pendingPinOperation = operation.catch(() => {});
    return operation;
  }

  async function loadContext() {
    const state = await store.load();
    const pinnedProductsByScope = normalisePinnedProductScopes(state.pinnedProductsByScope);
    const scope = productPinScope(state);

    return {
      auth: state.auth,
      pinnedProductIds: pinnedProductsByScope[scope] ?? [],
      pinnedProductsByScope,
      scope,
      settings: state.settings,
    };
  }

  async function savePinnedProductIds(context, pinnedProductIds) {
    await store.set({
      [PINNED_PRODUCT_STORAGE_KEY]: {
        ...context.pinnedProductsByScope,
        [context.scope]: normalisePinnedProductIds(pinnedProductIds),
      },
    });
  }

  async function loadProduct(productId, context) {
    const result = await backendClient.getProduct(context.settings, context.auth, productId);
    return requireBackendResult(result, 'Tracked product could not be loaded').product;
  }

  async function loadShortlistOnce() {
    const context = await loadContext();
    const recentResult = requireBackendResult(
      await backendClient.listProducts(context.settings, context.auth, {
        limit: PINNED_PRODUCT_LIMIT,
      }),
      'Tracked products could not be loaded',
    );
    const recentProducts = recentResult.products;
    const recentIds = new Set(recentProducts.map((product) => Number(product?.id)));
    const missingPinnedIds = context.pinnedProductIds.filter((id) => !recentIds.has(id));
    const pinnedResults = await Promise.all(
      missingPinnedIds.map(async (productId) => ({
        productId,
        result: await backendClient.getProduct(context.settings, context.auth, productId),
      })),
    );
    const loadedPinnedProducts = [];
    const missingProductIds = new Set();

    for (const { productId, result } of pinnedResults) {
      if (result?.kind === 'success') {
        loadedPinnedProducts.push(result.product);
      } else if (result?.status === 404) {
        missingProductIds.add(productId);
      } else {
        requireBackendResult(result, 'A pinned product could not be loaded');
      }
    }

    const pinnedProductIds = context.pinnedProductIds.filter((id) => !missingProductIds.has(id));

    if (pinnedProductIds.length !== context.pinnedProductIds.length) {
      await savePinnedProductIds(context, pinnedProductIds);
    }

    return {
      items: selectPopupProducts([...recentProducts, ...loadedPinnedProducts], pinnedProductIds),
      pinLimit: PINNED_PRODUCT_LIMIT,
      pinnedProductIds,
    };
  }

  function loadShortlist() {
    return enqueuePinOperation(loadShortlistOnce);
  }

  async function searchProducts(query) {
    if (typeof query !== 'string' || query.trim().length > 200) {
      throw productPinsError('Search must contain at most 200 characters', 'INVALID_SEARCH');
    }

    const search = query.trim();
    const context = await loadContext();

    if (!search) {
      return {
        items: [],
        pinLimit: PINNED_PRODUCT_LIMIT,
        pinnedProductIds: context.pinnedProductIds,
      };
    }

    const result = requireBackendResult(
      await backendClient.listProducts(context.settings, context.auth, {
        limit: PRODUCT_SEARCH_RESULT_LIMIT,
        search,
      }),
      'Tracked products could not be searched',
    );
    const pinnedIds = new Set(context.pinnedProductIds);

    return {
      items: result.products
        .map(compactPopupProduct)
        .filter(Boolean)
        .map((product) => ({ ...product, isPinned: pinnedIds.has(product.id) })),
      pinLimit: PINNED_PRODUCT_LIMIT,
      pinnedProductIds: context.pinnedProductIds,
    };
  }

  function toggleProductPin(productId) {
    return enqueuePinOperation(async () => {
      const context = await loadContext();
      const numericProductId = Number(productId);
      const isRemoving = context.pinnedProductIds.includes(numericProductId);
      const pinnedProductIds = togglePinnedProductId(context.pinnedProductIds, numericProductId);

      if (!isRemoving) {
        await loadProduct(numericProductId, context);
      }

      await savePinnedProductIds(context, pinnedProductIds);

      return { pinLimit: PINNED_PRODUCT_LIMIT, pinnedProductIds };
    });
  }

  return Object.freeze({ loadShortlist, searchProducts, toggleProductPin });
}
