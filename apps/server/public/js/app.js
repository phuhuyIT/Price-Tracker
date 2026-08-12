import { createDashboardApi, DashboardApiError } from './dashboardApi.js';
import { formatDateTime, localDateTimeToIso } from './dashboardFormatters.js';
import {
  renderCollectionJobs,
  renderPagination,
  renderProductCards,
  renderVariantOptions,
} from './dashboardRenderers.js';
import { createHistoryChartController } from './historyChart.js';

const PAGE_SIZE = 20;
const QUEUE_POLL_INTERVAL_MS = 10_000;
const AUTH_ERROR_CODES = new Set(['AUTHENTICATION_REQUIRED', 'SESSION_EXPIRED', 'SESSION_REVOKED']);

const elements = Object.freeze({
  accountEmail: document.querySelector('#account-email'),
  accountMenu: document.querySelector('#account-menu'),
  authTabs: document.querySelector('#auth-tabs'),
  authView: document.querySelector('#auth-view'),
  chartShell: document.querySelector('#chart-shell'),
  clearWatchlistFilters: document.querySelector('#clear-watchlist-filters'),
  closeHistoryButton: document.querySelector('#close-history-button'),
  connectionStatus: document.querySelector('#connection-status'),
  dashboardView: document.querySelector('#dashboard-view'),
  emptyClearFilters: document.querySelector('#empty-clear-filters'),
  emptyState: document.querySelector('#empty-state'),
  emptyTrackButton: document.querySelector('#empty-track-button'),
  filteredEmptyState: document.querySelector('#filtered-empty-state'),
  historyCanvas: document.querySelector('#history-chart'),
  historyDialog: document.querySelector('#history-dialog'),
  historyEmpty: document.querySelector('#history-empty'),
  historyFilters: document.querySelector('#history-filters'),
  historyStatus: document.querySelector('#history-status'),
  historySubtitle: document.querySelector('#history-subtitle'),
  historyTitle: document.querySelector('#history-title'),
  historyVariant: document.querySelector('#history-variant'),
  loadingGrid: document.querySelector('#loading-grid'),
  loginForm: document.querySelector('#login-form'),
  logoutButton: document.querySelector('#logout-button'),
  pageError: document.querySelector('#page-error'),
  pagination: document.querySelector('#pagination'),
  productGrid: document.querySelector('#product-grid'),
  queueCount: document.querySelector('#queue-count'),
  queueEmpty: document.querySelector('#queue-empty'),
  queueError: document.querySelector('#queue-error'),
  queueList: document.querySelector('#queue-list'),
  queueLoading: document.querySelector('#queue-loading'),
  queueReloadButton: document.querySelector('#queue-reload-button'),
  queueRetryButton: document.querySelector('#queue-retry-button'),
  queueUpdateStatus: document.querySelector('#queue-update-status'),
  registerForm: document.querySelector('#register-form'),
  registerTab: document.querySelector('#register-tab'),
  reloadButton: document.querySelector('#reload-button'),
  retryLoadButton: document.querySelector('#retry-load-button'),
  toastRegion: document.querySelector('#toast-region'),
  trackForm: document.querySelector('#track-form'),
  trackedCount: document.querySelector('#tracked-count'),
  watchlistFilters: document.querySelector('#watchlist-filters'),
  watchlistResultSummary: document.querySelector('#watchlist-result-summary'),
});

const api = createDashboardApi();
const historyChart = createHistoryChartController({ canvas: elements.historyCanvas });
const state = {
  authentication: { allowRegistration: false, enabled: false },
  busyProductIds: new Set(),
  collectionJobs: [],
  filters: { availability: '', search: '', status: '' },
  historyProduct: null,
  page: 1,
  pagination: null,
  products: [],
  user: null,
  watchlistTotal: 0,
};

let productRequestSequence = 0;
let collectionJobRequestSequence = 0;
let collectionJobsLoading = false;
let queuePollTimer = null;
let searchDebounceTimer = null;

function setConnection(status, label) {
  elements.connectionStatus.classList.toggle('is-online', status === 'online');
  elements.connectionStatus.classList.toggle('is-offline', status === 'offline');
  elements.connectionStatus.querySelector('span:last-child').textContent = label;
}

function showToast(message, { error = false } = {}) {
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' is-error' : ''}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 5_000);
}

function errorMessage(error) {
  if (error instanceof DashboardApiError) {
    return error.message;
  }

  return 'An unexpected dashboard error occurred.';
}

function isAuthenticationError(error) {
  return error instanceof DashboardApiError && AUTH_ERROR_CODES.has(error.code);
}

function stopQueuePolling() {
  if (queuePollTimer !== null) {
    window.clearInterval(queuePollTimer);
    queuePollTimer = null;
  }
}

function startQueuePolling() {
  stopQueuePolling();
  queuePollTimer = window.setInterval(() => {
    if (!document.hidden) {
      void loadCollectionJobs({ showLoading: false });
    }
  }, QUEUE_POLL_INTERVAL_MS);
}

function showAuthView(message = null) {
  stopQueuePolling();
  collectionJobRequestSequence += 1;
  collectionJobsLoading = false;
  state.collectionJobs = [];
  state.user = null;
  setAuthPanel('login');
  elements.accountMenu.hidden = true;
  elements.dashboardView.hidden = true;
  elements.authView.hidden = false;

  if (message) {
    const error = elements.loginForm.querySelector('[data-form-error]');
    error.textContent = message;
    error.hidden = false;
  }
}

function showDashboardView(user = null) {
  state.user = user;
  elements.authView.hidden = true;
  elements.dashboardView.hidden = false;
  elements.accountMenu.hidden = !user;
  elements.accountEmail.textContent = user?.email ?? '';
  startQueuePolling();
}

function setFormBusy(form, busy) {
  for (const control of form.elements) {
    control.disabled = busy;
  }
}

function showFormError(form, error) {
  const target = form.querySelector('[data-form-error]');
  target.textContent = error ? errorMessage(error) : '';
  target.hidden = !error;
}

function showPageError(error = null) {
  elements.pageError.hidden = !error;
  elements.pageError.querySelector('p').textContent = error ? errorMessage(error) : '';
}

function showQueueError(error = null) {
  elements.queueError.hidden = !error;
  elements.queueError.querySelector('span').textContent = error ? errorMessage(error) : '';
}

function renderCollectionQueue() {
  elements.queueCount.textContent = String(state.collectionJobs.length);
  elements.queueList.innerHTML = renderCollectionJobs(state.collectionJobs);
  elements.queueList.hidden = state.collectionJobs.length === 0;
  elements.queueEmpty.hidden = state.collectionJobs.length > 0;
}

async function loadCollectionJobs({ showLoading = state.collectionJobs.length === 0 } = {}) {
  if (collectionJobsLoading) {
    return;
  }

  const requestSequence = ++collectionJobRequestSequence;
  collectionJobsLoading = true;
  elements.queueReloadButton.disabled = true;
  elements.queueLoading.hidden = !showLoading;
  showQueueError();

  try {
    const response = await api.listCollectionJobs();

    if (requestSequence !== collectionJobRequestSequence) {
      return;
    }

    state.collectionJobs = Array.isArray(response.data?.jobs) ? response.data.jobs : [];
    elements.queueUpdateStatus.textContent = `Updated ${formatDateTime(new Date().toISOString())}. Refreshes automatically every 10 seconds.`;
    renderCollectionQueue();
  } catch (error) {
    if (requestSequence !== collectionJobRequestSequence) {
      return;
    }

    if (isAuthenticationError(error)) {
      showAuthView('Your dashboard session ended. Please sign in again.');
      return;
    }

    elements.queueUpdateStatus.textContent = 'The last visible queue state may be out of date.';
    showQueueError(error);
  } finally {
    if (requestSequence === collectionJobRequestSequence) {
      collectionJobsLoading = false;
      elements.queueLoading.hidden = true;
      elements.queueReloadButton.disabled = false;
    }
  }
}

function bindImageFallbacks() {
  for (const image of elements.productGrid.querySelectorAll('.product-media img')) {
    image.addEventListener(
      'error',
      () => image.closest('.product-media')?.classList.add('image-error'),
      { once: true },
    );
  }
}

function hasWatchlistFilters() {
  return Object.values(state.filters).some(Boolean);
}

function renderResultSummary() {
  const filteredTotal = state.pagination?.total ?? state.products.length;

  if (state.watchlistTotal === 0) {
    elements.watchlistResultSummary.textContent = '';
    return;
  }

  if (filteredTotal === 0) {
    elements.watchlistResultSummary.textContent = `No matches in ${state.watchlistTotal} tracked products.`;
    return;
  }

  const page = state.pagination?.page ?? state.page;
  const limit = state.pagination?.limit ?? PAGE_SIZE;
  const firstResult = (page - 1) * limit + 1;
  const lastResult = Math.min(page * limit, filteredTotal);
  const resultType = hasWatchlistFilters() ? 'matches' : 'tracked products';
  elements.watchlistResultSummary.textContent = `Showing ${firstResult}–${lastResult} of ${filteredTotal} ${resultType}.`;
}

function renderProducts() {
  const filteredTotal = state.pagination?.total ?? state.products.length;
  const filtersActive = hasWatchlistFilters();

  elements.productGrid.innerHTML = renderProductCards(state.products, state.busyProductIds);
  elements.emptyState.hidden = state.watchlistTotal > 0;
  elements.filteredEmptyState.hidden =
    state.watchlistTotal === 0 || !filtersActive || filteredTotal > 0;
  elements.clearWatchlistFilters.hidden = !filtersActive;
  elements.trackedCount.textContent = String(state.watchlistTotal);
  elements.pagination.innerHTML = renderPagination(state.pagination);
  elements.pagination.hidden = elements.pagination.innerHTML === '';
  renderResultSummary();
  bindImageFallbacks();
}

async function loadProducts({ page = state.page, showLoading = true } = {}) {
  const requestSequence = ++productRequestSequence;
  state.page = page;
  elements.reloadButton.disabled = true;
  elements.loadingGrid.hidden = !showLoading;
  elements.emptyState.hidden = true;
  elements.filteredEmptyState.hidden = true;
  showPageError();

  try {
    const response = await api.listProducts({ ...state.filters, limit: PAGE_SIZE, page });

    if (requestSequence !== productRequestSequence) {
      return;
    }

    const products = Array.isArray(response.data) ? response.data : [];
    const pagination = response.meta?.pagination ?? {
      limit: PAGE_SIZE,
      page,
      pages: products.length > 0 ? page : 0,
      total: products.length,
    };

    if (pagination.pages > 0 && page > pagination.pages) {
      await loadProducts({ page: pagination.pages, showLoading: false });
      return;
    }

    state.products = products;
    state.pagination = pagination;
    state.watchlistTotal = response.meta?.watchlistTotal ?? pagination.total;
    setConnection('online', 'Backend connected');
    renderProducts();
  } catch (error) {
    if (requestSequence !== productRequestSequence) {
      return;
    }

    if (isAuthenticationError(error)) {
      showAuthView('Your dashboard session ended. Please sign in again.');
      return;
    }

    setConnection('offline', 'Backend unavailable');
    showPageError(error);
  } finally {
    if (requestSequence === productRequestSequence) {
      elements.loadingGrid.hidden = true;
      elements.reloadButton.disabled = false;
    }
  }
}

function applyWatchlistFilters() {
  window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = null;

  const data = new FormData(elements.watchlistFilters);
  state.filters = {
    availability: String(data.get('availability') ?? ''),
    search: String(data.get('search') ?? '').trim(),
    status: String(data.get('status') ?? ''),
  };
  void loadProducts({ page: 1 });
}

function clearWatchlistFilters() {
  window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = null;
  elements.watchlistFilters.reset();
  state.filters = { availability: '', search: '', status: '' };
  void loadProducts({ page: 1 });
}

function setAuthPanel(panelName) {
  const showRegister = panelName === 'register' && state.authentication.allowRegistration;
  elements.loginForm.hidden = showRegister;
  elements.registerForm.hidden = !showRegister;

  for (const tab of elements.authTabs.querySelectorAll('[data-auth-panel]')) {
    const active = tab.dataset.authPanel === (showRegister ? 'register' : 'login');
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
}

async function submitAuthForm(form, operation) {
  showFormError(form);
  const data = new FormData(form);
  setFormBusy(form, true);

  try {
    const response = await operation({
      email: data.get('email'),
      password: data.get('password'),
    });
    form.reset();
    showDashboardView(response.data.user);
    setConnection('online', 'Backend connected');
    await Promise.all([loadProducts({ page: 1 }), loadCollectionJobs()]);
  } catch (error) {
    showFormError(form, error);
  } finally {
    setFormBusy(form, false);
  }
}

async function trackProduct(event) {
  event.preventDefault();
  const submitButton = elements.trackForm.querySelector('button[type="submit"]');
  const input = elements.trackForm.elements.url;
  submitButton.disabled = true;

  try {
    const response = await api.trackProduct(input.value.trim());
    elements.trackForm.reset();

    if (response.data.queued) {
      showToast(
        'Price collection queued. Use Check now in the extension if background checks are disabled.',
      );
    } else {
      showToast('This product is already in your watchlist.');
    }

    await Promise.all([
      loadProducts({ page: 1, showLoading: false }),
      loadCollectionJobs({ showLoading: false }),
    ]);
  } catch (error) {
    if (isAuthenticationError(error)) {
      showAuthView('Your dashboard session ended. Please sign in again.');
      return;
    }

    showToast(errorMessage(error), { error: true });
    input.focus();
  } finally {
    submitButton.disabled = false;
  }
}

function productById(productId) {
  return state.products.find((product) => product.id === productId) ?? null;
}

async function withBusyProduct(productId, operation) {
  state.busyProductIds.add(productId);
  renderProducts();

  try {
    await operation();
  } catch (error) {
    if (isAuthenticationError(error)) {
      showAuthView('Your dashboard session ended. Please sign in again.');
      return;
    }

    showToast(errorMessage(error), { error: true });
  } finally {
    state.busyProductIds.delete(productId);
    renderProducts();
  }
}

async function refreshProduct(productId) {
  await withBusyProduct(productId, async () => {
    const response = await api.refreshProduct(productId);
    const job = response.data.job;
    const message =
      job.status === 'waiting_auth'
        ? 'This check is waiting for Shopee sign-in. Sign in, then use Check now in the extension.'
        : 'Price refresh queued for your Chrome extension.';
    showToast(message);
    await Promise.all([
      loadProducts({ showLoading: false }),
      loadCollectionJobs({ showLoading: false }),
    ]);
  });
}

async function toggleProductStatus(productId) {
  const product = productById(productId);

  if (!product) {
    return;
  }

  await withBusyProduct(productId, async () => {
    const status = product.trackingStatus === 'paused' ? 'active' : 'paused';
    await api.updateProduct(productId, { status });
    showToast(status === 'active' ? 'Tracking resumed.' : 'Tracking paused.');
    await loadProducts({ showLoading: false });
  });
}

async function deleteProduct(productId) {
  const product = productById(productId);

  if (!product) {
    return;
  }

  const confirmed = window.confirm(
    `Delete “${product.title}” and all of its stored price history? This cannot be undone.`,
  );

  if (!confirmed) {
    return;
  }

  await withBusyProduct(productId, async () => {
    await api.deleteProduct(productId);
    showToast('Product and its price history were deleted.');
    const nextPage = state.products.length === 1 && state.page > 1 ? state.page - 1 : state.page;
    await Promise.all([
      loadProducts({ page: nextPage, showLoading: false }),
      loadCollectionJobs({ showLoading: false }),
    ]);
  });
}

function historyFilters() {
  const data = new FormData(elements.historyFilters);
  const from = localDateTimeToIso(data.get('from'));
  const to = localDateTimeToIso(data.get('to'));

  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new DashboardApiError({
      code: 'INVALID_HISTORY_RANGE',
      message: 'The history start date must not be after the end date.',
    });
  }

  return {
    from,
    to,
    variantId: data.get('variantId') || null,
  };
}

async function loadHistory() {
  if (!state.historyProduct) {
    return;
  }

  historyChart.destroy();
  elements.chartShell.hidden = true;
  elements.historyEmpty.hidden = true;
  elements.historyStatus.textContent = 'Loading price history…';
  elements.historyStatus.dataset.state = 'loading';

  try {
    const response = await api.history(state.historyProduct.id, historyFilters());
    const history = response.data;
    const hasPoints = history.datasets.some((dataset) => dataset.data.length > 0);

    if (!hasPoints) {
      elements.historyStatus.textContent = '';
      elements.historyStatus.dataset.state = '';
      elements.historyEmpty.hidden = false;
      return;
    }

    elements.chartShell.hidden = false;
    historyChart.render(history);
    elements.historyStatus.textContent =
      'Gaps mark successful checks where Shopee did not expose a valid price.';
    elements.historyStatus.dataset.state = 'note';
  } catch (error) {
    historyChart.destroy();
    elements.chartShell.hidden = true;
    elements.historyStatus.textContent = errorMessage(error);
    elements.historyStatus.dataset.state = 'error';
  }
}

function openHistory(productId) {
  const product = productById(productId);

  if (!product) {
    return;
  }

  state.historyProduct = product;
  elements.historyTitle.textContent = product.title;
  elements.historySubtitle.textContent =
    'Each line represents one variant and one compatible pricing context.';
  elements.historyVariant.innerHTML = renderVariantOptions(product.variants ?? []);
  elements.historyFilters.reset();
  elements.historyDialog.showModal();
  void loadHistory();
}

function closeHistory() {
  if (elements.historyDialog.open) {
    elements.historyDialog.close();
  }
}

async function handleProductAction(event) {
  const button = event.target.closest('[data-action][data-product-id]');

  if (!button || button.disabled) {
    return;
  }

  const productId = Number(button.dataset.productId);

  if (!Number.isSafeInteger(productId) || productId < 1) {
    return;
  }

  const actions = {
    delete: deleteProduct,
    history: openHistory,
    refresh: refreshProduct,
    'toggle-status': toggleProductStatus,
  };

  await actions[button.dataset.action]?.(productId);
}

async function logout() {
  elements.logoutButton.disabled = true;

  try {
    await api.logout();
  } catch (error) {
    if (!isAuthenticationError(error)) {
      showToast(errorMessage(error), { error: true });
      return;
    }
  } finally {
    elements.logoutButton.disabled = false;
  }

  showAuthView();
}

function bindEvents() {
  elements.authTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-auth-panel]');
    if (tab) {
      setAuthPanel(tab.dataset.authPanel);
    }
  });
  elements.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitAuthForm(elements.loginForm, api.login);
  });
  elements.registerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitAuthForm(elements.registerForm, api.register);
  });
  elements.logoutButton.addEventListener('click', () => void logout());
  elements.trackForm.addEventListener('submit', (event) => void trackProduct(event));
  elements.reloadButton.addEventListener('click', () => {
    void Promise.all([loadProducts(), loadCollectionJobs({ showLoading: false })]);
  });
  elements.retryLoadButton.addEventListener('click', () => void loadProducts());
  elements.queueReloadButton.addEventListener('click', () => void loadCollectionJobs());
  elements.queueRetryButton.addEventListener('click', () => void loadCollectionJobs());
  elements.emptyTrackButton.addEventListener('click', () =>
    elements.trackForm.elements.url.focus(),
  );
  elements.watchlistFilters.addEventListener('submit', (event) => {
    event.preventDefault();
    applyWatchlistFilters();
  });
  elements.watchlistFilters.elements.search.addEventListener('input', () => {
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = window.setTimeout(applyWatchlistFilters, 300);
  });
  for (const select of elements.watchlistFilters.querySelectorAll('select')) {
    select.addEventListener('change', applyWatchlistFilters);
  }
  elements.clearWatchlistFilters.addEventListener('click', clearWatchlistFilters);
  elements.emptyClearFilters.addEventListener('click', clearWatchlistFilters);
  elements.productGrid.addEventListener('click', (event) => void handleProductAction(event));
  elements.pagination.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    const page = Number(button?.dataset.page);
    if (Number.isSafeInteger(page) && page > 0 && !button.disabled) {
      void loadProducts({ page });
    }
  });
  elements.historyFilters.addEventListener('submit', (event) => {
    event.preventDefault();
    void loadHistory();
  });
  elements.closeHistoryButton.addEventListener('click', closeHistory);
  elements.historyDialog.addEventListener('close', () => {
    historyChart.destroy();
    state.historyProduct = null;
  });
  elements.historyDialog.addEventListener('click', (event) => {
    if (event.target === elements.historyDialog) {
      closeHistory();
    }
  });
}

async function bootstrap() {
  bindEvents();

  try {
    const configuration = await api.configuration();
    state.authentication = configuration.data.authentication;
    elements.registerTab.hidden = !state.authentication.allowRegistration;
    elements.authTabs.classList.toggle('single-tab', !state.authentication.allowRegistration);
    setAuthPanel('login');
    setConnection('online', 'Backend connected');

    if (!state.authentication.enabled) {
      showDashboardView();
      await Promise.all([loadProducts(), loadCollectionJobs()]);
      return;
    }

    try {
      const current = await api.currentUser();
      showDashboardView(current.data.user);
      await Promise.all([loadProducts(), loadCollectionJobs()]);
    } catch (error) {
      if (isAuthenticationError(error)) {
        showAuthView();
        return;
      }

      throw error;
    }
  } catch (error) {
    setConnection('offline', 'Backend unavailable');
    showDashboardView();
    showPageError(error);
  }
}

void bootstrap();
