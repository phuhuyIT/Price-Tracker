import {
  extensionCaptureMessageSchema,
  extensionCollectionStatusSchema,
} from '../../../packages/shared/schemas/extensionCaptureSchema.js';
import { isShopeeVietnamHostname } from '../../../packages/shared/schemas/shopeeUrlSchema.js';
import {
  applyShopeeCapture,
  createShopeeCaptureState,
  createShopeeCaptureSummary,
  normaliseShopeeCaptureState,
} from '../../../packages/shared/shopee/shopeeSnapshotNormalizer.js';
import { RUNTIME_MESSAGES } from '../lib/runtimeMessages.js';
import { stableStringify } from '../lib/submissionQueue.js';
import { collectBackgroundPageVariants } from './backgroundPageCollector.js';

const EMIT_DEBOUNCE_MS = 300;
const DEDUPLICATION_WINDOW_MS = 2_000;
const captureState = createShopeeCaptureState();
let emitTimer = null;
let lastSemanticHash = null;
let lastSemanticHashAt = 0;
let backgroundCollectionStarted = false;

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
  const snapshot = normaliseShopeeCaptureState(captureState, {
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

    await collectBackgroundPageVariants(captureState, {
      deadlineAt: Date.now() + 75_000,
    });
    await emitSnapshot({ completeBackgroundCollection: true });
  } catch (error) {
    await runtimeMessage({
      errorCode: 'INVALID_SHOPEE_PAYLOAD',
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
        statusValidation.data.code === 'AUTHENTICATION_REQUIRED'
          ? 'Shopee requires sign-in in this Chrome profile'
          : 'Shopee rejected the background collection request',
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
