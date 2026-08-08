import {
  extensionCaptureMessageSchema,
  extensionCollectionStatusSchema,
} from '../../../packages/shared/schemas/extensionCaptureSchema.js';
import { isShopeeVietnamHostname } from '../../../packages/shared/schemas/shopeeUrlSchema.js';
import {
  applyShopeeCapture,
  createShopeeCaptureState,
  createShopeeCaptureSummary,
  isImplicitDefaultShopeeProduct,
  normaliseShopeeCaptureState,
} from '../../../packages/shared/shopee/shopeeSnapshotNormalizer.js';
import { RUNTIME_MESSAGES } from '../lib/runtimeMessages.js';
import { stableStringify } from '../lib/submissionQueue.js';
import { collectBackgroundPageVariants } from './backgroundPageCollector.js';
import {
  detectShopeeProductPageAvailability,
  waitForShopeeProductPageAvailability,
} from './pageAvailability.js';

const EMIT_DEBOUNCE_MS = 300;
const DEDUPLICATION_WINDOW_MS = 2_000;
const PAGE_AVAILABILITY_WAIT_MS = 2_000;
const captureState = createShopeeCaptureState();
let emitTimer = null;
let lastSemanticHash = null;
let lastSemanticHashAt = 0;
let backgroundCollectionStarted = false;

const COLLECTION_ERROR_MESSAGES = Object.freeze({
  AUTHENTICATION_REQUIRED: 'Shopee requires sign-in in this Chrome profile',
  FETCH_FAILED: 'The Shopee product request failed',
  NETWORK_TIMEOUT: 'The Shopee product request timed out',
  PRICE_SELECTOR_TIMEOUT: 'Shopee did not expose an exact product price before timeout',
  PRODUCT_UNAVAILABLE: 'Shopee reports that this product is unavailable',
  RATE_LIMITED: 'Shopee rate-limited the product request',
  SHOPEE_SERVER_ERROR: 'Shopee returned a temporary server error',
});

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function runtimeMessage(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.success) {
      throw new Error(response?.error?.message ?? 'Extension service worker request failed');
    }

    return response.data;
  });
}

async function emitSnapshot({ completeBackgroundCollection = false } = {}) {
  const config = await runtimeMessage({ type: RUNTIME_MESSAGES.GET_COLLECTOR_CONFIG });
  const product = captureState.productDetail?.product;
  const needsPageAvailabilityFallback =
    product &&
    isImplicitDefaultShopeeProduct(product) &&
    product.models[0].availability === 'unknown';
  const pageAvailability = needsPageAvailabilityFallback
    ? completeBackgroundCollection
      ? await waitForShopeeProductPageAvailability(document, {
          timeoutMs: PAGE_AVAILABILITY_WAIT_MS,
          title: product.title,
        })
      : detectShopeeProductPageAvailability(document, { title: product.title })
    : 'unknown';
  const snapshot = normaliseShopeeCaptureState(captureState, {
    pageAvailability,
    pageUrl: window.location.href,
    pricingContextKey: config.pricingContextKey,
  });

  if (!snapshot) {
    return;
  }

  const semanticSnapshot = { ...snapshot, capturedAt: null };
  const semanticHash = await sha256(stableStringify(semanticSnapshot));
  const now = Date.now();

  const isRecentDuplicate =
    semanticHash === lastSemanticHash && now - lastSemanticHashAt < DEDUPLICATION_WINDOW_MS;

  if (isRecentDuplicate && completeBackgroundCollection && config.collectionJobId !== null) {
    await runtimeMessage({
      snapshot,
      type: RUNTIME_MESSAGES.BACKGROUND_COLLECTION_COMPLETED,
    });
    return;
  }

  if (isRecentDuplicate) {
    return;
  }

  lastSemanticHash = semanticHash;
  lastSemanticHashAt = now;
  const summary = createShopeeCaptureSummary(captureState, snapshot);
  await runtimeMessage({
    semanticHash,
    snapshot,
    summary,
    type: RUNTIME_MESSAGES.CAPTURE_UPDATED,
  });

  if (completeBackgroundCollection && config.collectionJobId !== null) {
    await runtimeMessage({
      snapshot,
      type: RUNTIME_MESSAGES.BACKGROUND_COLLECTION_COMPLETED,
    });
  }

  if (config.debugMode) {
    console.debug('[Shopee Price Tracker] Validated capture', summary);
  }
}

async function runBackgroundCollection() {
  if (backgroundCollectionStarted) {
    return;
  }

  const config = await runtimeMessage({ type: RUNTIME_MESSAGES.GET_COLLECTOR_CONFIG });

  if (config.collectionJobId === null) {
    return;
  }

  backgroundCollectionStarted = true;

  try {
    if (/\/(?:buyer\/)?login(?:\/|$)/iu.test(window.location.pathname)) {
      await runtimeMessage({
        errorCode: 'AUTHENTICATION_REQUIRED',
        errorMessage: 'Shopee requires sign-in in this Chrome profile',
        type: RUNTIME_MESSAGES.BACKGROUND_COLLECTION_FAILED,
      });
      return;
    }

    const collectionDeadlineAt = Number.isFinite(config.collectionDeadlineAt)
      ? config.collectionDeadlineAt
      : Date.now() + 75_000;
    await collectBackgroundPageVariants(captureState, {
      deadlineAt: collectionDeadlineAt,
      onProgress: (progress) =>
        runtimeMessage({
          ...progress,
          type: RUNTIME_MESSAGES.BACKGROUND_COLLECTION_PROGRESS,
        }),
    });
    await emitSnapshot({ completeBackgroundCollection: true });
  } catch (error) {
    const errorCode =
      error instanceof Error &&
      typeof error.code === 'string' &&
      Object.hasOwn(COLLECTION_ERROR_MESSAGES, error.code)
        ? error.code
        : 'SCHEMA_PARSE_ERROR';

    await runtimeMessage({
      errorCode,
      errorMessage: error instanceof Error ? error.message : 'Shopee collection failed',
      type: RUNTIME_MESSAGES.BACKGROUND_COLLECTION_FAILED,
    });
  }
}

async function reportAuthenticationRedirect() {
  if (!/\/(?:buyer\/)?login(?:\/|$)/iu.test(window.location.pathname)) {
    return;
  }

  const config = await runtimeMessage({ type: RUNTIME_MESSAGES.GET_COLLECTOR_CONFIG });

  if (config.collectionJobId !== null) {
    await runtimeMessage({
      errorCode: 'AUTHENTICATION_REQUIRED',
      errorMessage: 'Shopee requires sign-in in this Chrome profile',
      type: RUNTIME_MESSAGES.BACKGROUND_COLLECTION_FAILED,
    });
  }
}

function scheduleSnapshotEmission() {
  if (emitTimer !== null) {
    clearTimeout(emitTimer);
  }

  emitTimer = setTimeout(() => {
    emitTimer = null;
    void emitSnapshot().catch(() => undefined);
  }, EMIT_DEBOUNCE_MS);
}

window.addEventListener('message', (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    !isShopeeVietnamHostname(window.location.hostname)
  ) {
    return;
  }

  const validation = extensionCaptureMessageSchema.safeParse(event.data);

  const statusValidation = extensionCollectionStatusSchema.safeParse(event.data);

  if (statusValidation.success) {
    void runtimeMessage({
      errorCode: statusValidation.data.code,
      errorMessage:
        COLLECTION_ERROR_MESSAGES[statusValidation.data.code] ??
        'Shopee rejected the background collection request',
      type: RUNTIME_MESSAGES.BACKGROUND_COLLECTION_FAILED,
    }).catch(() => undefined);
    return;
  }

  if (!validation.success) {
    return;
  }

  applyShopeeCapture(captureState, validation.data);
  scheduleSnapshotEmission();

  if (validation.data.kind === 'product_detail') {
    void runBackgroundCollection();
  }
});

void reportAuthenticationRedirect().catch(() => undefined);
