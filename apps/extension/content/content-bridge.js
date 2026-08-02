import { extensionCaptureMessageSchema } from '../../../packages/shared/schemas/extensionCaptureSchema.js';
import { isShopeeVietnamHostname } from '../../../packages/shared/schemas/shopeeUrlSchema.js';
import {
  applyShopeeCapture,
  createShopeeCaptureState,
  createShopeeCaptureSummary,
  normaliseShopeeCaptureState,
} from '../../../packages/shared/shopee/shopeeSnapshotNormalizer.js';
import { RUNTIME_MESSAGES } from '../lib/runtimeMessages.js';
import { stableStringify } from '../lib/submissionQueue.js';

const EMIT_DEBOUNCE_MS = 300;
const DEDUPLICATION_WINDOW_MS = 2_000;
const captureState = createShopeeCaptureState();
let emitTimer = null;
let lastSemanticHash = null;
let lastSemanticHashAt = 0;

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

async function emitSnapshot() {
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

  if (semanticHash === lastSemanticHash && now - lastSemanticHashAt < DEDUPLICATION_WINDOW_MS) {
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

  if (config.debugMode) {
    console.debug('[Shopee Price Tracker] Validated capture', summary);
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

  if (!validation.success) {
    return;
  }

  applyShopeeCapture(captureState, validation.data);
  scheduleSnapshotEmission();
});
