import { PINNED_PRODUCT_LIMIT } from '../lib/productPins.js';
import { RUNTIME_MESSAGES } from '../lib/runtimeMessages.js';

/** Create the popup's compact pinned/recent product controller. */
export function createProductQuickWatch({
  callServiceWorker,
  chromeApi = chrome,
  documentReference = document,
  formatPrice,
}) {
  const elements = {
    pinCount: documentReference.querySelector('#pin-count'),
    productSearch: documentReference.querySelector('#product-search'),
    productSearchClear: documentReference.querySelector('#product-search-clear'),
    productSearchForm: documentReference.querySelector('#product-search-form'),
    productSearchList: documentReference.querySelector('#product-search-list'),
    productSearchResults: documentReference.querySelector('#product-search-results'),
    productSearchStatus: documentReference.querySelector('#product-search-status'),
    quickWatchList: documentReference.querySelector('#quick-watch-list'),
    quickWatchStatus: documentReference.querySelector('#quick-watch-status'),
  };
  const state = {
    error: null,
    feedback: '',
    items: [],
    loading: true,
    pinLimit: PINNED_PRODUCT_LIMIT,
    pinnedProductIds: [],
    searchError: null,
    searchItems: [],
    searchLoading: false,
  };
  let pinMutationPending = false;
  let searchDebounceTimer = null;
  let searchRequestSequence = 0;

  function productPrice(product) {
    if (product.availability === 'sold_out') {
      return 'Sold out';
    }

    if (product.availability === 'unavailable') {
      return 'Unavailable';
    }

    return Number.isSafeInteger(product.priceAmount) && product.priceAmount > 0
      ? formatPrice(product.priceAmount)
      : 'Price not observed';
  }

  function productSource(product, searchResult) {
    const source = searchResult
      ? product.isPinned
        ? 'Pinned'
        : 'Search match'
      : product.listReason === 'pinned'
        ? 'Pinned'
        : 'Recent';

    return product.trackingStatus === 'paused' ? `${source} · Paused` : source;
  }

  function createProductListItem(product, { searchResult = false } = {}) {
    const item = documentReference.createElement('li');
    item.className = `product-item${product.isPinned ? ' is-pinned' : ''}`;

    const initial = documentReference.createElement('span');
    initial.className = 'product-initial';
    initial.setAttribute('aria-hidden', 'true');
    initial.textContent = product.title.trim().slice(0, 1).toUpperCase() || '₫';

    const openButton = documentReference.createElement('button');
    openButton.className = 'product-open';
    openButton.type = 'button';
    openButton.disabled = !product.canonicalUrl;
    openButton.title = product.canonicalUrl
      ? `Open ${product.title} on Shopee`
      : 'This product URL is unavailable';

    const name = documentReference.createElement('span');
    name.className = 'product-name';
    name.textContent = product.title;

    const priceRow = documentReference.createElement('span');
    priceRow.className = 'product-price-row';

    const price = documentReference.createElement('span');
    price.className = 'product-price';
    price.textContent = productPrice(product);

    const source = documentReference.createElement('span');
    source.className = 'product-source';
    source.textContent = productSource(product, searchResult);

    priceRow.append(price, source);
    openButton.append(name, priceRow);
    openButton.addEventListener('click', () => {
      if (product.canonicalUrl) {
        void chromeApi.tabs.create({ url: product.canonicalUrl });
      }
    });

    const pinButton = documentReference.createElement('button');
    const pinLimitReached = state.pinnedProductIds.length >= state.pinLimit && !product.isPinned;
    pinButton.className = 'pin-button';
    pinButton.type = 'button';
    pinButton.disabled = pinMutationPending || pinLimitReached;
    pinButton.setAttribute('aria-pressed', String(product.isPinned));
    pinButton.setAttribute(
      'aria-label',
      product.isPinned ? `Unpin ${product.title}` : `Pin ${product.title}`,
    );
    pinButton.title = pinLimitReached
      ? `Unpin a product before adding another (maximum ${state.pinLimit})`
      : product.isPinned
        ? 'Remove from pinned products'
        : 'Pin this product';
    pinButton.textContent = product.isPinned ? '★' : '☆';
    pinButton.addEventListener('click', () => {
      void toggleProductPin(product);
    });

    item.append(initial, openButton, pinButton);
    return item;
  }

  function setPinnedProductIds(value) {
    state.pinnedProductIds = Array.isArray(value) ? value : [];
    const pinnedIds = new Set(state.pinnedProductIds);
    state.searchItems = state.searchItems.map((product) => ({
      ...product,
      isPinned: pinnedIds.has(product.id),
    }));
  }

  function renderQuickWatch() {
    const pinnedCount = state.pinnedProductIds.length;
    elements.pinCount.textContent = `${pinnedCount}/${state.pinLimit} pinned`;
    elements.quickWatchList.replaceChildren();

    if (state.loading) {
      elements.quickWatchStatus.textContent = 'Loading tracked products…';
      return;
    }

    if (state.error) {
      elements.quickWatchStatus.textContent = state.error;
      return;
    }

    if (state.items.length === 0) {
      elements.quickWatchStatus.textContent =
        'No tracked products yet. Track one from Shopee or the dashboard.';
      return;
    }

    elements.quickWatchStatus.textContent = state.feedback;
    elements.quickWatchList.append(...state.items.map((product) => createProductListItem(product)));
  }

  function renderProductSearch() {
    const query = elements.productSearch.value.trim();
    const hasQuery = query.length > 0;
    const pinLimitReached =
      state.pinnedProductIds.length >= state.pinLimit &&
      state.searchItems.some((product) => !product.isPinned);
    elements.productSearchClear.hidden = !hasQuery;
    elements.productSearchResults.hidden = !hasQuery;
    elements.productSearch.setAttribute('aria-expanded', String(hasQuery));
    elements.productSearchList.replaceChildren();

    if (!hasQuery) {
      elements.productSearchStatus.textContent = '';
      return;
    }

    if (state.searchLoading) {
      elements.productSearchStatus.textContent = 'Searching your watchlist…';
      return;
    }

    if (state.searchError) {
      elements.productSearchStatus.textContent = state.searchError;
      return;
    }

    if (state.searchItems.length === 0) {
      elements.productSearchStatus.textContent = 'No tracked products match this search.';
      return;
    }

    elements.productSearchStatus.textContent = pinLimitReached
      ? `All ${state.pinLimit} pin positions are filled. Unpin one to add another.`
      : `${state.searchItems.length} matching tracked product${
          state.searchItems.length === 1 ? '' : 's'
        }.`;
    elements.productSearchList.append(
      ...state.searchItems.map((product) => createProductListItem(product, { searchResult: true })),
    );
  }

  async function load({ showLoading = true } = {}) {
    if (showLoading) {
      state.loading = true;
      renderQuickWatch();
    }

    try {
      const result = await callServiceWorker({ type: RUNTIME_MESSAGES.GET_PRODUCT_SHORTLIST });
      state.error = null;
      state.items = result.items;
      state.pinLimit = result.pinLimit;
      setPinnedProductIds(result.pinnedProductIds);
    } catch (error) {
      state.error = error.message;
    } finally {
      state.loading = false;
      renderQuickWatch();
      renderProductSearch();
    }
  }

  async function searchProducts(query, requestSequence) {
    try {
      const result = await callServiceWorker({
        query,
        type: RUNTIME_MESSAGES.SEARCH_PRODUCTS,
      });

      if (requestSequence !== searchRequestSequence) {
        return;
      }

      state.pinLimit = result.pinLimit;
      state.searchError = null;
      state.searchItems = result.items;
      setPinnedProductIds(result.pinnedProductIds);
    } catch (error) {
      if (requestSequence !== searchRequestSequence) {
        return;
      }

      state.searchError = error.message;
      state.searchItems = [];
    } finally {
      if (requestSequence === searchRequestSequence) {
        state.searchLoading = false;
        renderProductSearch();
      }
    }
  }

  function scheduleProductSearch({ immediately = false } = {}) {
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }

    const query = elements.productSearch.value.trim();
    const requestSequence = ++searchRequestSequence;
    state.searchError = null;
    state.searchItems = [];

    if (!query) {
      state.searchLoading = false;
      renderProductSearch();
      return;
    }

    state.searchLoading = true;
    renderProductSearch();
    searchDebounceTimer = setTimeout(
      () => {
        searchDebounceTimer = null;
        void searchProducts(query, requestSequence);
      },
      immediately ? 0 : 250,
    );
  }

  async function toggleProductPin(product) {
    if (pinMutationPending) {
      return;
    }

    pinMutationPending = true;
    state.feedback = product.isPinned ? 'Removing pin…' : 'Pinning product…';
    renderQuickWatch();
    renderProductSearch();

    try {
      const result = await callServiceWorker({
        productId: product.id,
        type: RUNTIME_MESSAGES.TOGGLE_PRODUCT_PIN,
      });
      setPinnedProductIds(result.pinnedProductIds);
      state.feedback = product.isPinned ? 'Product unpinned.' : 'Product pinned.';
      await load({ showLoading: false });
    } catch (error) {
      state.feedback = error.message;
    } finally {
      pinMutationPending = false;
      renderQuickWatch();
      renderProductSearch();
    }
  }

  elements.productSearchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    scheduleProductSearch({ immediately: true });
  });

  elements.productSearch.addEventListener('input', () => {
    scheduleProductSearch();
  });

  elements.productSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      elements.productSearch.value = '';
      scheduleProductSearch({ immediately: true });
    }
  });

  elements.productSearchClear.addEventListener('click', () => {
    elements.productSearch.value = '';
    elements.productSearch.focus();
    scheduleProductSearch({ immediately: true });
  });

  return Object.freeze({ load });
}
