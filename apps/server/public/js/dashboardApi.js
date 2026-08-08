const REQUEST_TIMEOUT_MS = 15_000;

export class DashboardApiError extends Error {
  constructor({ code = 'REQUEST_FAILED', message, status = 0 }) {
    super(message);
    this.name = 'DashboardApiError';
    this.code = code;
    this.status = status;
  }
}

function requestHeaders(body) {
  return body === undefined ? {} : { 'content-type': 'application/json' };
}

/** Create the same-origin dashboard API client. */
export function createDashboardApi({ fetchImplementation = window.fetch.bind(window) } = {}) {
  async function request(path, { body, method = 'GET' } = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchImplementation(path, {
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        headers: requestHeaders(body),
        method,
        signal: controller.signal,
      });
      let payload;

      try {
        payload = await response.json();
      } catch {
        throw new DashboardApiError({
          code: 'INVALID_SERVER_RESPONSE',
          message: 'The server returned an unreadable response.',
          status: response.status,
        });
      }

      if (!response.ok || payload?.success !== true) {
        throw new DashboardApiError({
          code: payload?.error?.code,
          message: payload?.error?.message ?? `Request failed with status ${response.status}.`,
          status: response.status,
        });
      }

      return payload;
    } catch (error) {
      if (error instanceof DashboardApiError) {
        throw error;
      }

      if (error?.name === 'AbortError') {
        throw new DashboardApiError({
          code: 'REQUEST_TIMEOUT',
          message: 'The local server took too long to respond.',
        });
      }

      throw new DashboardApiError({
        code: 'NETWORK_ERROR',
        message: 'The local price-tracker server could not be reached.',
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return Object.freeze({
    configuration() {
      return request('/api/dashboard-config');
    },

    currentUser() {
      return request('/api/auth/me');
    },

    deleteProduct(productId) {
      return request(`/api/products/${productId}`, { body: {}, method: 'DELETE' });
    },

    history(productId, filters = {}) {
      const query = new URLSearchParams({ limit: '500' });

      for (const key of ['from', 'to', 'variantId']) {
        if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
          query.set(key, String(filters[key]));
        }
      }

      return request(`/api/products/${productId}/history?${query.toString()}`);
    },

    listProducts({ availability, limit = 20, page = 1, search, status } = {}) {
      const query = new URLSearchParams({ limit, page });

      for (const [key, value] of Object.entries({ availability, search, status })) {
        if (value !== undefined && value !== null && value !== '') {
          query.set(key, value);
        }
      }

      return request(`/api/products?${query.toString()}`);
    },

    login({ email, password }) {
      return request('/api/auth/login', {
        body: { clientType: 'dashboard', email, password },
        method: 'POST',
      });
    },

    logout() {
      return request('/api/auth/logout', { body: {}, method: 'POST' });
    },

    refreshProduct(productId) {
      return request(`/api/products/${productId}/refresh`, { body: {}, method: 'POST' });
    },

    register({ email, password }) {
      return request('/api/auth/register', {
        body: { clientType: 'dashboard', email, password },
        method: 'POST',
      });
    },

    trackProduct(url) {
      return request('/api/products/track', { body: { url }, method: 'POST' });
    },

    updateProduct(productId, update) {
      return request(`/api/products/${productId}`, { body: update, method: 'PATCH' });
    },
  });
}
