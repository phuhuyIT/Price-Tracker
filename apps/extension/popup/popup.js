import { RUNTIME_MESSAGES } from '../lib/runtimeMessages.js';
import { createCollectionJobQueueView } from './collectionJobQueueView.js';
import { createProductCaptureView } from './productCaptureView.js';
import { createProductQuickWatch } from './productQuickWatch.js';

const elements = {
  backendStatus: document.querySelector('#backend-status'),
  captureDetails: document.querySelector('#capture-details'),
  capturePlaceholder: document.querySelector('#capture-placeholder'),
  collectionJobStatus: document.querySelector('#collection-job-status'),
  collectionJobSummary: document.querySelector('#collection-job-summary'),
  collectionStatus: document.querySelector('#collection-status'),
  dashboardButton: document.querySelector('#dashboard-button'),
  displayedPrice: document.querySelector('#displayed-price'),
  optionsButton: document.querySelector('#options-button'),
  pollCollectionJobs: document.querySelector('#poll-collection-jobs'),
  pageBadge: document.querySelector('#page-badge'),
  priceCoverage: document.querySelector('#price-coverage'),
  productTitle: document.querySelector('#product-title'),
  selectedVariant: document.querySelector('#selected-variant'),
  stockQuantity: document.querySelector('#stock-quantity'),
  submissionStatus: document.querySelector('#submission-status'),
  trackButton: document.querySelector('#track-button'),
  uploadQueueStatus: document.querySelector('#upload-queue-status'),
  voucherStatus: document.querySelector('#voucher-status'),
};

const vndFormatter = new Intl.NumberFormat('vi-VN', {
  currency: 'VND',
  maximumFractionDigits: 0,
  style: 'currency',
});

const quantityFormatter = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 0,
});

let activeTab = null;
let collectionJobQueue = null;
let collectionJobRefreshTimer = null;
let popupState = null;
let refreshTimer = null;

async function callServiceWorker(message) {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.success) {
    throw new Error(response?.error?.message ?? 'Extension service worker request failed');
  }

  return response.data;
}

const productQuickWatch = createProductQuickWatch({
  callServiceWorker,
  formatPrice: (priceAmount) => vndFormatter.format(priceAmount),
});

function submissionMessage(status, automaticCapture) {
  if (automaticCapture) {
    return 'Automatic capture is enabled.';
  }

  switch (status?.state) {
    case 'success': {
      const expected = status.expectedVariantCount;
      const priced = status.pricedVariantCount;

      if (Number.isSafeInteger(expected) && Number.isSafeInteger(priced)) {
        if (priced === 0) {
          return 'The catalogue was stored, but no exact price was observed.';
        }

        return `The snapshot was stored with ${priced} of ${expected} exact prices.`;
      }

      return 'The latest snapshot was stored successfully.';
    }
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
      return 'Automatic capture is off. Collect prices when you are ready.';
  }
}

function isCollectionForCapture(collectionStatus, summary) {
  if (!collectionStatus?.itemId || !collectionStatus?.shopId) {
    return true;
  }

  return collectionStatus.itemId === summary.itemId && collectionStatus.shopId === summary.shopId;
}

function priceCoverageMessage(collectionStatus) {
  const expected = collectionStatus?.expectedVariantCount;
  const priced = collectionStatus?.pricedVariantCount;
  const resolved = collectionStatus?.resolvedVariantCount;

  if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(priced)) {
    return 'Not collected';
  }

  if (Number.isSafeInteger(resolved) && resolved > priced) {
    return `${priced}/${expected} priced, ${resolved - priced} unavailable`;
  }

  return `${priced}/${expected} exact prices`;
}

function collectionMessage(status) {
  switch (status?.state) {
    case 'disabled':
      return 'Scheduled background collection is disabled. Manual collection remains available.';
    case 'idle':
      return 'No background price collection is running.';
    case 'queued':
      return status.error ?? 'Price collection is queued.';
    case 'collecting':
      return Number.isSafeInteger(status.processedVariantCount) &&
        Number.isSafeInteger(status.expectedVariantCount)
        ? `Collecting available prices: ${status.processedVariantCount}/${status.expectedVariantCount} variants checked.`
        : 'Collecting available variant prices in an inactive tab.';
    case 'success':
      return `Collection complete: ${priceCoverageMessage(status)} saved.`;
    case 'partial':
      return `Collection complete with partial coverage: ${priceCoverageMessage(status)}.`;
    case 'no_prices':
      return 'The catalogue was saved, but Shopee exposed no exact variant price.';
    case 'unavailable':
      return status.availability === 'sold_out'
        ? 'Collection complete: Shopee reports this product is sold out.'
        : 'Collection complete: Shopee reports this product is unavailable.';
    case 'waiting_auth':
      return status.error ?? 'Sign in to Shopee, then retry this collection.';
    case 'retry_wait':
      return status.error ?? 'Collection will retry after a temporary error.';
    case 'waiting_browser':
    case 'backend_error':
    case 'failed':
      return status.error ?? 'Background price collection failed.';
    default:
      return `Background collection: ${status?.state ?? 'unknown'}.`;
  }
}

function renderCollectionJobQueue(queue) {
  collectionJobQueue = queue;

  if (collectionJobRefreshTimer !== null) {
    clearTimeout(collectionJobRefreshTimer);
    collectionJobRefreshTimer = null;
  }

  const view = createCollectionJobQueueView(queue, {
    backgroundCollectionEnabled: popupState?.backgroundCollectionEnabled,
    localCollectionState: popupState?.collectionStatus?.state,
  });
  elements.collectionJobSummary.textContent = view.label;
  elements.collectionJobStatus.textContent = view.message;
  elements.pollCollectionJobs.disabled = view.buttonDisabled;
  elements.pollCollectionJobs.textContent = view.buttonLabel;

  if (view.shouldRefresh) {
    collectionJobRefreshTimer = setTimeout(() => {
      void loadCollectionJobQueue();
    }, 2_000);
  }
}

function render(state) {
  popupState = state;

  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  if (['collecting', 'queued', 'retry_wait'].includes(state.collectionStatus.state)) {
    refreshTimer = setTimeout(() => {
      void loadPopupState().catch((error) => {
        elements.collectionStatus.textContent = error.message;
      });
    }, 1_000);
  }

  elements.pageBadge.textContent = state.supportedPage ? 'Supported' : 'Unsupported';
  elements.pageBadge.className = `badge ${state.supportedPage ? 'badge-success' : 'badge-warning'}`;
  elements.backendStatus.textContent =
    state.backend.status === 'connected'
      ? 'Connected'
      : state.backend.status === 'unavailable'
        ? 'Offline'
        : 'Unknown';
  elements.uploadQueueStatus.textContent =
    state.queue.total === 0
      ? 'Empty'
      : `${state.queue.total} (${state.queue.failed + state.queue.blocked} need attention)`;
  elements.dashboardButton.disabled = !state.dashboardUrl;

  if (collectionJobQueue !== null) {
    renderCollectionJobQueue(collectionJobQueue);
  }

  if (state.capture) {
    const summary = state.capture.summary;
    const relevantCollection = isCollectionForCapture(state.collectionStatus, summary)
      ? state.collectionStatus
      : null;
    const productView = createProductCaptureView(summary, relevantCollection);
    const currentSelection = productView.currentSelection;
    const hasCollectionActivity =
      relevantCollection && !['disabled', 'idle'].includes(relevantCollection.state);
    elements.capturePlaceholder.hidden = true;
    elements.captureDetails.hidden = false;
    elements.productTitle.textContent = summary.title;
    elements.displayedPrice.textContent =
      currentSelection.availability === 'sold_out'
        ? 'Sold out'
        : currentSelection.availability === 'unavailable'
          ? 'Unavailable'
          : currentSelection.priceAmount === null
            ? 'Price not observed'
            : vndFormatter.format(currentSelection.priceAmount);
    elements.selectedVariant.textContent = currentSelection.selectedVariant ?? 'Not selected';
    const stockQuantity = currentSelection.stockQuantity;
    elements.stockQuantity.textContent =
      Number.isSafeInteger(stockQuantity) && stockQuantity >= 0
        ? quantityFormatter.format(stockQuantity)
        : 'Unknown';
    elements.voucherStatus.textContent = currentSelection.voucherStatus.replaceAll('_', ' ');
    elements.priceCoverage.textContent = productView.collectionStatus
      ? priceCoverageMessage(productView.collectionStatus)
      : 'Not collected';
    elements.submissionStatus.textContent = hasCollectionActivity
      ? ''
      : submissionMessage(state.lastSubmission, state.automaticCapture);
    elements.collectionStatus.textContent = relevantCollection
      ? collectionMessage(relevantCollection)
      : 'Another product has background collection activity.';
    const collecting = ['collecting', 'queued'].includes(relevantCollection?.state);
    elements.trackButton.disabled = collecting;
    elements.trackButton.textContent = collecting
      ? relevantCollection.state === 'queued'
        ? 'Price collection queued'
        : 'Collecting available prices…'
      : ['no_prices', 'partial', 'success', 'unavailable'].includes(relevantCollection?.state)
        ? 'Refresh available prices'
        : 'Track & collect available prices';
    return;
  }

  elements.capturePlaceholder.hidden = false;
  elements.captureDetails.hidden = true;
  elements.capturePlaceholder.textContent = state.supportedPage
    ? 'Waiting for a validated Shopee product response. Reload the page if this does not update.'
    : 'This is not a supported Shopee Vietnam product page.';
  elements.submissionStatus.textContent = submissionMessage(
    state.lastSubmission,
    state.automaticCapture,
  );
  elements.collectionStatus.textContent = collectionMessage(state.collectionStatus);
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

async function loadCollectionJobQueue() {
  try {
    const queue = await callServiceWorker({ type: RUNTIME_MESSAGES.GET_COLLECTION_JOB_QUEUE });
    renderCollectionJobQueue(queue);
  } catch (error) {
    renderCollectionJobQueue({ error: error.message, kind: 'temporary' });
  }
}

elements.trackButton.addEventListener('click', async () => {
  elements.trackButton.disabled = true;
  elements.trackButton.textContent = 'Queueing full price collection…';
  elements.collectionStatus.textContent = 'Queueing full variant-price collection…';

  try {
    await callServiceWorker({
      pageUrl: activeTab?.url ?? '',
      tabId: activeTab?.id ?? -1,
      type: RUNTIME_MESSAGES.START_FULL_COLLECTION,
    });
    await Promise.all([loadPopupState(), loadCollectionJobQueue()]);
  } catch (error) {
    elements.collectionStatus.textContent = error.message;
    elements.trackButton.textContent = 'Track & collect available prices';
    elements.trackButton.disabled = false;
  }
});

elements.dashboardButton.addEventListener('click', () => {
  if (popupState?.dashboardUrl) {
    void chrome.tabs.create({ url: popupState.dashboardUrl });
  }
});

elements.pollCollectionJobs.addEventListener('click', async () => {
  elements.pollCollectionJobs.disabled = true;
  elements.collectionJobStatus.textContent = 'Claiming the next available price-check job…';

  try {
    await callServiceWorker({ type: RUNTIME_MESSAGES.POLL_COLLECTION_JOBS });
    await Promise.all([loadPopupState(), loadCollectionJobQueue()]);
  } catch (error) {
    elements.collectionJobStatus.textContent = error.message;
    elements.pollCollectionJobs.disabled = false;
    elements.pollCollectionJobs.textContent = 'Retry price-check queue';
  }
});

elements.optionsButton.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

async function initialisePopup() {
  try {
    await loadPopupState();
  } catch (error) {
    elements.submissionStatus.textContent = error.message;
  }

  await Promise.allSettled([
    callServiceWorker({ type: RUNTIME_MESSAGES.CHECK_BACKEND }),
    loadCollectionJobQueue(),
    productQuickWatch.load(),
  ]);

  try {
    await loadPopupState();
  } catch (error) {
    elements.submissionStatus.textContent = error.message;
  }
}

void initialisePopup();
