import { RUNTIME_MESSAGES } from '../lib/runtimeMessages.js';

const elements = {
  backendStatus: document.querySelector('#backend-status'),
  captureDetails: document.querySelector('#capture-details'),
  capturePlaceholder: document.querySelector('#capture-placeholder'),
  collectionStatus: document.querySelector('#collection-status'),
  dashboardButton: document.querySelector('#dashboard-button'),
  displayedPrice: document.querySelector('#displayed-price'),
  optionsButton: document.querySelector('#options-button'),
  pollCollectionJobs: document.querySelector('#poll-collection-jobs'),
  pageBadge: document.querySelector('#page-badge'),
  productTitle: document.querySelector('#product-title'),
  queueStatus: document.querySelector('#queue-status'),
  selectedVariant: document.querySelector('#selected-variant'),
  submissionStatus: document.querySelector('#submission-status'),
  trackButton: document.querySelector('#track-button'),
  voucherStatus: document.querySelector('#voucher-status'),
};

const vndFormatter = new Intl.NumberFormat('vi-VN', {
  currency: 'VND',
  maximumFractionDigits: 0,
  style: 'currency',
});

let activeTab = null;
let popupState = null;

async function callServiceWorker(message) {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.success) {
    throw new Error(response?.error?.message ?? 'Extension service worker request failed');
  }

  return response.data;
}

function submissionMessage(status, automaticCapture) {
  if (automaticCapture) {
    return 'Automatic capture is enabled.';
  }

  switch (status?.state) {
    case 'success':
      return 'The latest snapshot was stored successfully.';
    case 'blocked_auth':
      return 'Queued snapshot is waiting for price-tracker sign-in.';
    case 'retry_wait':
      return 'Backend unavailable. The snapshot is queued for retry.';
    case 'retry_exhausted':
      return 'Automatic retries stopped. Retry the queue from Options.';
    case 'failed_permanent':
      return status.error?.message ?? 'The backend rejected the snapshot.';
    case 'queued':
    case 'sending':
      return 'Submitting the snapshot…';
    default:
      return 'Automatic capture is off. Click Track Product when ready.';
  }
}

function render(state) {
  popupState = state;
  elements.pageBadge.textContent = state.supportedPage ? 'Supported' : 'Unsupported';
  elements.pageBadge.className = `badge ${state.supportedPage ? 'badge-success' : 'badge-warning'}`;
  elements.backendStatus.textContent =
    state.backend.status === 'connected'
      ? 'Connected'
      : state.backend.status === 'unavailable'
        ? 'Offline'
        : 'Unknown';
  elements.queueStatus.textContent =
    state.queue.total === 0
      ? 'Empty'
      : `${state.queue.total} (${state.queue.failed + state.queue.blocked} need attention)`;
  elements.submissionStatus.textContent = submissionMessage(
    state.lastSubmission,
    state.automaticCapture,
  );
  elements.collectionStatus.textContent = state.collectionStatus.error
    ? `Background collection: ${state.collectionStatus.error}`
    : `Background collection: ${state.collectionStatus.state}.`;
  elements.dashboardButton.disabled = !state.dashboardUrl;

  if (state.capture) {
    const summary = state.capture.summary;
    elements.capturePlaceholder.hidden = true;
    elements.captureDetails.hidden = false;
    elements.productTitle.textContent = summary.title;
    elements.displayedPrice.textContent =
      summary.displayedPriceAmount === null
        ? 'Price not observed'
        : vndFormatter.format(summary.displayedPriceAmount);
    elements.selectedVariant.textContent = summary.selectedVariant ?? 'Not selected';
    elements.voucherStatus.textContent = summary.voucherStatus.replaceAll('_', ' ');
    elements.trackButton.disabled = false;
    return;
  }

  elements.capturePlaceholder.hidden = false;
  elements.captureDetails.hidden = true;
  elements.capturePlaceholder.textContent = state.supportedPage
    ? 'Waiting for a validated Shopee product response. Reload the page if this does not update.'
    : 'This is not a supported Shopee Vietnam product page.';
  elements.trackButton.disabled = true;
}

async function loadPopupState() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const state = await callServiceWorker({
    pageUrl: activeTab?.url ?? '',
    tabId: activeTab?.id ?? -1,
    type: RUNTIME_MESSAGES.GET_POPUP_STATE,
  });
  render(state);
}

elements.trackButton.addEventListener('click', async () => {
  elements.trackButton.disabled = true;
  elements.submissionStatus.textContent = 'Submitting the snapshot…';

  try {
    await callServiceWorker({
      pageUrl: activeTab?.url ?? '',
      tabId: activeTab?.id ?? -1,
      type: RUNTIME_MESSAGES.TRACK_CAPTURE,
    });
    await loadPopupState();
  } catch (error) {
    elements.submissionStatus.textContent = error.message;
    elements.trackButton.disabled = false;
  }
});

elements.dashboardButton.addEventListener('click', () => {
  if (popupState?.dashboardUrl) {
    void chrome.tabs.create({ url: popupState.dashboardUrl });
  }
});

elements.pollCollectionJobs.addEventListener('click', async () => {
  elements.collectionStatus.textContent = 'Checking for queued jobs...';

  try {
    await callServiceWorker({ type: RUNTIME_MESSAGES.POLL_COLLECTION_JOBS });
    await loadPopupState();
  } catch (error) {
    elements.collectionStatus.textContent = error.message;
  }
});

elements.optionsButton.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void loadPopupState()
  .then(async () => {
    await callServiceWorker({ type: RUNTIME_MESSAGES.CHECK_BACKEND });
    await loadPopupState();
  })
  .catch((error) => {
    elements.submissionStatus.textContent = error.message;
  });
