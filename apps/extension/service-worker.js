import { COLLECTION_JOB_FAILURE_CODES } from '../../packages/shared/schemas/collectionJobSchemas.js';
import { productSnapshotSchema } from '../../packages/shared/schemas/productSnapshotSchema.js';
import {
  getShopeeProductIdentity,
  isShopeeVietnamHostname,
} from '../../packages/shared/schemas/shopeeUrlSchema.js';
import { createBackendClient } from './lib/backendClient.js';
import {
  COLLECTION_POLL_ALARM_NAME,
  COLLECTION_RETRY_ALARM_NAME,
  COLLECTION_TIMEOUT_ALARM_PREFIX,
  createBackgroundCollectionAgent,
} from './lib/backgroundCollection.js';
import {
  createPricingContextKey,
  normaliseBackendBaseUrl,
  normaliseExtensionSettings,
} from './lib/extensionSettings.js';
import { createFullProductCollectionCoordinator } from './lib/fullProductCollection.js';
import { RUNTIME_MESSAGES } from './lib/runtimeMessages.js';
import { createServiceWorkerQueue, RETRY_ALARM_NAME } from './lib/serviceWorkerQueue.js';
import {
  DEFAULT_AUTH_STATE,
  DEFAULT_BACKEND_STATUS,
  publicAuthState,
  queueSummary,
  createServiceWorkerStore,
  STORAGE_KEYS,
} from './lib/serviceWorkerStore.js';

const MAX_LATEST_CAPTURES = 10;
const store = createServiceWorkerStore(chrome);
const backendClient = createBackendClient();
const submissionQueue = createServiceWorkerQueue({
  alarms: chrome.alarms,
  backendClient,
  store,
});
const backgroundCollection = createBackgroundCollectionAgent({
  action: chrome.action,
  alarms: chrome.alarms,
  backendClient,
  notifications: chrome.notifications,
  store,
  tabs: chrome.tabs,
  windows: chrome.windows,
});
const fullProductCollection = createFullProductCollectionCoordinator({
  backendClient,
  backgroundCollection,
  store,
});

function success(data) {
  return { data, success: true };
}

function failure(error) {
  return {
    error: {
      code: error?.code ?? 'EXTENSION_ERROR',
      message: error instanceof Error ? error.message : 'Extension request failed',
    },
    success: false,
  };
}

function extensionError(message, code = 'EXTENSION_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isSupportedProductPage(value) {
  try {
    const url = new URL(value);
    return (
      isShopeeVietnamHostname(url.hostname) && getShopeeProductIdentity(url.toString()) !== null
    );
  } catch {
    return false;
  }
}

function isSupportedShopeePage(value) {
  try {
    return isShopeeVietnamHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

function sameSnapshotPage(snapshot, pageUrl) {
  const identity = getShopeeProductIdentity(pageUrl);
  return identity?.itemId === snapshot.itemId && identity?.shopId === snapshot.shopId;
}

function sanitiseCaptureSummary(value, snapshot) {
  const displayedPriceAmount = Number(value?.displayedPriceAmount);
  const capturedAt =
    typeof value?.capturedAt === 'string' && Number.isFinite(Date.parse(value.capturedAt))
      ? value.capturedAt
      : snapshot.capturedAt;

  return {
    capturedAt,
    displayedAvailability: ['available', 'sold_out', 'unavailable', 'unknown'].includes(
      value?.displayedAvailability,
    )
      ? value.displayedAvailability
      : 'unknown',
    displayedPriceAmount:
      Number.isSafeInteger(displayedPriceAmount) && displayedPriceAmount > 0
        ? displayedPriceAmount
        : null,
    itemId: snapshot.itemId,
    selectedVariant:
      typeof value?.selectedVariant === 'string' ? value.selectedVariant.slice(0, 300) : null,
    shopId: snapshot.shopId,
    title: snapshot.title,
    voucherStatus: ['applied', 'not_applied', 'not_available', 'unknown'].includes(
      value?.voucherStatus,
    )
      ? value.voucherStatus
      : 'unknown',
  };
}

async function storeLatestCapture(message, sender) {
  const validation = productSnapshotSchema.safeParse(message.snapshot);

  if (
    sender.id !== chrome.runtime.id ||
    !sender.tab?.id ||
    !sender.tab.url ||
    !validation.success
  ) {
    throw extensionError(
      'Only a validated Shopee content script may provide a capture',
      'INVALID_CAPTURE',
    );
  }

  const snapshot = validation.data;

  if (!isSupportedProductPage(sender.tab.url) || !sameSnapshotPage(snapshot, sender.tab.url)) {
    throw extensionError(
      'The capture does not match the current Shopee product page',
      'CAPTURE_PAGE_MISMATCH',
    );
  }

  if (!/^[a-f0-9]{64}$/u.test(message.semanticHash)) {
    throw extensionError('The capture semantic hash is invalid', 'INVALID_CAPTURE_HASH');
  }

  const state = await store.load();
  const previous = state.captures[String(sender.tab.id)];
  const captures = {
    ...state.captures,
    [String(sender.tab.id)]: {
      pageUrl: snapshot.canonicalUrl,
      receivedAt: new Date().toISOString(),
      semanticHash: message.semanticHash,
      snapshot,
      summary: sanitiseCaptureSummary(message.summary, snapshot),
    },
  };
  const trimmedCaptures = Object.fromEntries(
    Object.entries(captures)
      .sort(([, left], [, right]) => right.receivedAt.localeCompare(left.receivedAt))
      .slice(0, MAX_LATEST_CAPTURES),
  );
  await store.set({ [STORAGE_KEYS.LATEST_CAPTURES]: trimmedCaptures });

  const isBackgroundCollectionTab = state.activeCollection?.tabId === sender.tab.id;

  if (
    !isBackgroundCollectionTab &&
    state.settings.automaticCapture &&
    previous?.semanticHash !== message.semanticHash
  ) {
    await submissionQueue.enqueue(snapshot, message.semanticHash);
  }

  return { captured: true };
}

async function checkBackend() {
  const state = await store.load();
  const backend = await backendClient.checkHealth(state.settings);
  await store.set({ [STORAGE_KEYS.BACKEND]: backend });
  return backend;
}

async function probeAuthentication() {
  const state = await store.load();
  const result = await backendClient.probeAuthentication(state.settings, state.auth);
  await store.set({
    [STORAGE_KEYS.AUTH]: result.auth,
    [STORAGE_KEYS.BACKEND]: result.backend,
  });
  return { auth: publicAuthState(result.auth), backend: result.backend };
}

async function login(credentials) {
  const state = await store.load();
  const result = await backendClient.login(state.settings, credentials);

  if (!result.success) {
    throw extensionError(result.error, result.errorCode);
  }

  await store.set({
    [STORAGE_KEYS.AUTH]: result.auth,
    [STORAGE_KEYS.BACKEND]: {
      checkedAt: new Date().toISOString(),
      error: null,
      status: 'connected',
    },
  });
  await submissionQueue.unblockAfterLogin();
  return publicAuthState(result.auth);
}

async function logout() {
  const state = await store.load();
  await backendClient.logout(state.settings, state.auth);
  const auth = { ...DEFAULT_AUTH_STATE, mode: state.auth.mode };
  await store.set({ [STORAGE_KEYS.AUTH]: auth });
  return publicAuthState(auth);
}

async function getPopupState(message) {
  const state = await store.load();
  const supportedPage = isSupportedProductPage(message.pageUrl);
  const capture = state.captures[String(message.tabId)];
  const matchingCapture =
    supportedPage && capture && sameSnapshotPage(capture.snapshot, message.pageUrl)
      ? capture
      : null;

  return {
    automaticCapture: state.settings.automaticCapture,
    backend: state.backend,
    capture: matchingCapture
      ? { receivedAt: matchingCapture.receivedAt, summary: matchingCapture.summary }
      : null,
    dashboardUrl: state.settings.backendBaseUrl,
    collectionStatus: state.collectionStatus,
    lastSubmission: state.lastSubmission,
    queue: queueSummary(state.queue),
    supportedPage,
  };
}

async function trackCapture(message) {
  const state = await store.load();
  const capture = state.captures[String(message.tabId)];

  if (!capture || !sameSnapshotPage(capture.snapshot, message.pageUrl)) {
    throw extensionError(
      'No validated capture is available for this product page',
      'CAPTURE_NOT_READY',
    );
  }

  return submissionQueue.enqueue(capture.snapshot, capture.semanticHash);
}

async function startFullCollection(message) {
  const state = await store.load();
  const capture = state.captures[String(message.tabId)];

  if (!capture || !sameSnapshotPage(capture.snapshot, message.pageUrl)) {
    throw extensionError(
      'No validated capture is available for this product page',
      'CAPTURE_NOT_READY',
    );
  }

  return fullProductCollection.start(capture.snapshot.canonicalUrl);
}

async function getOptionsState() {
  const state = await store.load();
  return {
    auth: publicAuthState(state.auth),
    backend: state.backend,
    collectionStatus: state.collectionStatus,
    queue: queueSummary(state.queue),
    settings: state.settings,
  };
}

async function saveSettings(input) {
  const backendBaseUrl = normaliseBackendBaseUrl(input.backendBaseUrl);

  if (!backendBaseUrl) {
    throw extensionError(
      'Use an HTTPS backend URL or a loopback HTTP origin without a path',
      'INVALID_BACKEND_URL',
    );
  }

  const state = await store.load();
  const backendChanged = backendBaseUrl !== state.settings.backendBaseUrl;
  const settings = normaliseExtensionSettings({
    ...state.settings,
    automaticCapture: input.automaticCapture,
    backendBaseUrl,
    backgroundCollectionEnabled: input.backgroundCollectionEnabled,
    collectionPollIntervalMinutes: input.collectionPollIntervalMinutes,
    debugMode: input.debugMode,
  });
  const update = { [STORAGE_KEYS.SETTINGS]: settings };

  if (backendChanged) {
    update[STORAGE_KEYS.AUTH] = { ...DEFAULT_AUTH_STATE };
    update[STORAGE_KEYS.BACKEND] = { ...DEFAULT_BACKEND_STATUS };
  }

  await store.set(update);
  await backgroundCollection.configureAlarm();

  if (settings.backgroundCollectionEnabled) {
    void backgroundCollection.poll();
  }

  return settings;
}

async function regenerateContext() {
  const state = await store.load();
  const settings = { ...state.settings, pricingContextKey: createPricingContextKey() };
  await store.set({ [STORAGE_KEYS.SETTINGS]: settings });
  return settings;
}

function requireExtensionPage(sender) {
  if (sender.id !== chrome.runtime.id || sender.tab) {
    throw extensionError('This action is restricted to extension pages', 'UNTRUSTED_SENDER');
  }
}

async function handleMessage(message, sender) {
  await store.ready;

  switch (message?.type) {
    case RUNTIME_MESSAGES.CAPTURE_UPDATED:
      return storeLatestCapture(message, sender);
    case RUNTIME_MESSAGES.BACKGROUND_COLLECTION_COMPLETED: {
      const validation = productSnapshotSchema.safeParse(message.snapshot);

      if (
        sender.id !== chrome.runtime.id ||
        !sender.tab?.id ||
        !sender.tab.url ||
        !validation.success ||
        !sameSnapshotPage(validation.data, sender.tab.url)
      ) {
        throw extensionError('The background collection result is invalid', 'INVALID_CAPTURE');
      }

      return backgroundCollection.complete({ snapshot: validation.data, tabId: sender.tab.id });
    }
    case RUNTIME_MESSAGES.BACKGROUND_COLLECTION_FAILED:
      if (
        sender.id !== chrome.runtime.id ||
        !sender.tab?.id ||
        !COLLECTION_JOB_FAILURE_CODES.includes(message.errorCode) ||
        typeof message.errorMessage !== 'string'
      ) {
        throw extensionError('The background collection failure is invalid', 'INVALID_CAPTURE');
      }

      return backgroundCollection.fail({
        errorCode: message.errorCode,
        errorMessage: message.errorMessage.slice(0, 500),
        tabId: sender.tab.id,
      });
    case RUNTIME_MESSAGES.BACKGROUND_COLLECTION_PROGRESS:
      if (
        sender.id !== chrome.runtime.id ||
        !sender.tab?.id ||
        !Number.isSafeInteger(message.expectedVariantCount) ||
        message.expectedVariantCount <= 0 ||
        !Number.isSafeInteger(message.processedVariantCount) ||
        message.processedVariantCount < 0 ||
        message.processedVariantCount > message.expectedVariantCount
      ) {
        throw extensionError('The background collection progress is invalid', 'INVALID_CAPTURE');
      }

      return backgroundCollection.progress({
        expectedVariantCount: message.expectedVariantCount,
        processedVariantCount: message.processedVariantCount,
        tabId: sender.tab.id,
      });
    case RUNTIME_MESSAGES.GET_COLLECTOR_CONFIG: {
      if (
        sender.id !== chrome.runtime.id ||
        !sender.tab?.id ||
        !sender.tab.url ||
        !isSupportedShopeePage(sender.tab.url)
      ) {
        throw extensionError('Collector configuration is restricted to Shopee pages');
      }

      const state = await store.load();
      const isActiveCollectionTab = state.activeCollection?.tabId === sender.tab.id;

      if (!isActiveCollectionTab && !isSupportedProductPage(sender.tab.url)) {
        throw extensionError('Collector configuration is restricted to Shopee product pages');
      }

      return {
        collectionDeadlineAt: isActiveCollectionTab
          ? (state.activeCollection.deadlineAt ?? null)
          : null,
        collectionJobId: isActiveCollectionTab ? state.activeCollection.job.id : null,
        debugMode: state.settings.debugMode,
        pricingContextKey: state.settings.pricingContextKey,
      };
    }
    case RUNTIME_MESSAGES.GET_POPUP_STATE:
      requireExtensionPage(sender);
      return getPopupState(message);
    case RUNTIME_MESSAGES.TRACK_CAPTURE:
      requireExtensionPage(sender);
      return trackCapture(message);
    case RUNTIME_MESSAGES.START_FULL_COLLECTION:
      requireExtensionPage(sender);
      return startFullCollection(message);
    case RUNTIME_MESSAGES.CHECK_BACKEND:
      requireExtensionPage(sender);
      return checkBackend();
    case RUNTIME_MESSAGES.GET_OPTIONS_STATE:
      requireExtensionPage(sender);
      return getOptionsState();
    case RUNTIME_MESSAGES.SAVE_SETTINGS:
      requireExtensionPage(sender);
      return saveSettings(message.settings ?? {});
    case RUNTIME_MESSAGES.REGENERATE_CONTEXT:
      requireExtensionPage(sender);
      return regenerateContext();
    case RUNTIME_MESSAGES.PROBE_AUTH:
      requireExtensionPage(sender);
      return probeAuthentication();
    case RUNTIME_MESSAGES.LOGIN:
      requireExtensionPage(sender);
      return login(message.credentials ?? {});
    case RUNTIME_MESSAGES.LOGOUT:
      requireExtensionPage(sender);
      return logout();
    case RUNTIME_MESSAGES.RETRY_QUEUE:
      requireExtensionPage(sender);
      return submissionQueue.retry();
    case RUNTIME_MESSAGES.CLEAR_FAILED_QUEUE:
      requireExtensionPage(sender);
      return submissionQueue.clearFailed();
    case RUNTIME_MESSAGES.POLL_COLLECTION_JOBS:
      requireExtensionPage(sender);
      return backgroundCollection.pollNow();
    default:
      throw extensionError('Unknown extension message', 'UNKNOWN_MESSAGE');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then((data) => sendResponse(success(data)))
    .catch((error) => sendResponse(failure(error)));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM_NAME) {
    void submissionQueue.process();
  }

  if (
    alarm.name === COLLECTION_POLL_ALARM_NAME ||
    alarm.name === COLLECTION_RETRY_ALARM_NAME ||
    alarm.name.startsWith(COLLECTION_TIMEOUT_ALARM_PREFIX)
  ) {
    void backgroundCollection.handleAlarm(alarm.name);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void backgroundCollection.handleTabRemoved(tabId);
});

chrome.runtime.onInstalled.addListener(() => {
  void submissionQueue.initialise();
  void backgroundCollection.initialise();
});

chrome.runtime.onStartup.addListener(() => {
  void submissionQueue.initialise();
  void backgroundCollection.initialise();
});

void submissionQueue.initialise();
void backgroundCollection.initialise();
