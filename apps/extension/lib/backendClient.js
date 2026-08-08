import { ERROR_CODES } from '../../../packages/shared/errors/errorCodes.js';
import { classifySubmissionFailure, REQUEST_TIMEOUT_MS } from './submissionQueue.js';

function requestHeaders(auth, { includeJson = false } = {}) {
  const headers = {};

  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }

  if (auth.mode === 'enabled' && auth.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  }

  return headers;
}

function backendStatus(status, error = null) {
  return { checkedAt: new Date().toISOString(), error, status };
}

/** Create the extension's bounded JSON transport for the price-tracker backend. */
export function createBackendClient(fetchImplementation = fetch) {
  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchImplementation(url, { ...options, signal: controller.signal });
      let body = null;

      try {
        body = await response.json();
      } catch {
        // The HTTP status still determines retry handling for a malformed body.
      }

      return { body, response };
    } finally {
      clearTimeout(timeout);
    }
  }

  return Object.freeze({
    /** Atomically claim the next job available to this Chrome profile. */
    async claimCollectionJob(
      settings,
      auth,
      pricingContextKey,
      resumeWaitingAuth = false,
      jobId = null,
    ) {
      try {
        const { body, response } = await fetchJson(
          `${settings.backendBaseUrl}/api/collection-jobs/claim`,
          {
            body: JSON.stringify({
              ...(jobId === null ? {} : { jobId }),
              pricingContextKey,
              resumeWaitingAuth,
            }),
            headers: requestHeaders(auth, { includeJson: true }),
            method: 'POST',
          },
        );

        if (response.ok && body?.success === true) {
          return { claim: body.data, kind: 'success' };
        }

        const errorCode = body?.error?.code ?? null;
        return {
          error: body?.error?.message ?? `Backend returned HTTP ${response.status}`,
          errorCode,
          kind: classifySubmissionFailure({ errorCode, status: response.status }),
        };
      } catch (error) {
        return {
          error:
            error?.name === 'AbortError' ? 'Backend request timed out' : 'Backend is unavailable',
          errorCode: null,
          kind: 'temporary',
        };
      }
    },

    /** Read one owner-scoped job so local manual-queue state can be reconciled. */
    async getCollectionJob(settings, auth, jobId) {
      try {
        const { body, response } = await fetchJson(
          `${settings.backendBaseUrl}/api/collection-jobs/${jobId}`,
          {
            headers: requestHeaders(auth),
          },
        );

        if (response.ok && body?.success === true) {
          return { job: body.data?.job ?? null, kind: 'success' };
        }

        const errorCode = body?.error?.code ?? null;
        return {
          error: body?.error?.message ?? `Backend returned HTTP ${response.status}`,
          errorCode,
          kind: classifySubmissionFailure({ errorCode, status: response.status }),
        };
      } catch (error) {
        return {
          error:
            error?.name === 'AbortError' ? 'Backend request timed out' : 'Backend is unavailable',
          errorCode: null,
          kind: 'temporary',
        };
      }
    },

    /** Explicitly move one unclaimed manual target to this extension context. */
    async rebindCollectionJob(settings, auth, jobId, pricingContextKey) {
      try {
        const { body, response } = await fetchJson(
          `${settings.backendBaseUrl}/api/collection-jobs/${jobId}/rebind`,
          {
            body: JSON.stringify({ pricingContextKey }),
            headers: requestHeaders(auth, { includeJson: true }),
            method: 'POST',
          },
        );

        if (response.ok && body?.success === true) {
          return { job: body.data?.job ?? null, kind: 'success' };
        }

        const errorCode = body?.error?.code ?? null;
        return {
          error: body?.error?.message ?? `Backend returned HTTP ${response.status}`,
          errorCode,
          kind: classifySubmissionFailure({ errorCode, status: response.status }),
        };
      } catch (error) {
        return {
          error:
            error?.name === 'AbortError' ? 'Backend request timed out' : 'Backend is unavailable',
          errorCode: null,
          kind: 'temporary',
        };
      }
    },

    /** Queue first-time collection for one canonical Shopee product URL. */
    async trackProduct(settings, auth, url) {
      try {
        const { body, response } = await fetchJson(
          `${settings.backendBaseUrl}/api/products/track`,
          {
            body: JSON.stringify({ url }),
            headers: requestHeaders(auth, { includeJson: true }),
            method: 'POST',
          },
        );

        if (response.ok && body?.success === true) {
          return { body, kind: 'success' };
        }

        const errorCode = body?.error?.code ?? null;
        return {
          error: body?.error?.message ?? `Backend returned HTTP ${response.status}`,
          errorCode,
          kind: classifySubmissionFailure({ errorCode, status: response.status }),
          status: response.status,
        };
      } catch (error) {
        return {
          error:
            error?.name === 'AbortError' ? 'Backend request timed out' : 'Backend is unavailable',
          errorCode: null,
          kind: classifySubmissionFailure({ networkError: true }),
          status: null,
        };
      }
    },

    /** Queue a full-price refresh for an existing tracked product. */
    async refreshProduct(settings, auth, productId) {
      try {
        const { body, response } = await fetchJson(
          `${settings.backendBaseUrl}/api/products/${productId}/refresh`,
          {
            body: '{}',
            headers: requestHeaders(auth, { includeJson: true }),
            method: 'POST',
          },
        );

        if (response.ok && body?.success === true) {
          return { body, kind: 'success' };
        }

        const errorCode = body?.error?.code ?? null;
        return {
          error: body?.error?.message ?? `Backend returned HTTP ${response.status}`,
          errorCode,
          kind: classifySubmissionFailure({ errorCode, status: response.status }),
          status: response.status,
        };
      } catch (error) {
        return {
          error:
            error?.name === 'AbortError' ? 'Backend request timed out' : 'Backend is unavailable',
          errorCode: null,
          kind: classifySubmissionFailure({ networkError: true }),
          status: null,
        };
      }
    },

    /** Return connection state from the public backend health endpoint. */
    async checkHealth(settings) {
      try {
        const { body, response } = await fetchJson(`${settings.backendBaseUrl}/api/health`);
        return response.ok && body?.success === true
          ? backendStatus('connected')
          : backendStatus('unavailable', `Backend returned HTTP ${response.status}`);
      } catch (error) {
        return backendStatus(
          'unavailable',
          error?.name === 'AbortError' ? 'Backend request timed out' : 'Backend is unavailable',
        );
      }
    },

    /** Complete a claimed job with one validated extension snapshot. */
    async completeCollectionJob(settings, auth, jobId, leaseToken, snapshot) {
      try {
        const { body, response } = await fetchJson(
          `${settings.backendBaseUrl}/api/collection-jobs/${jobId}/complete`,
          {
            body: JSON.stringify({ leaseToken, snapshot }),
            headers: requestHeaders(auth, { includeJson: true }),
            method: 'POST',
          },
        );

        if (response.ok && body?.success === true) {
          return { body, kind: 'success' };
        }

        const errorCode = body?.error?.code ?? null;
        return {
          error: body?.error?.message ?? `Backend returned HTTP ${response.status}`,
          errorCode,
          kind: classifySubmissionFailure({ errorCode, status: response.status }),
        };
      } catch (error) {
        return {
          error:
            error?.name === 'AbortError' ? 'Backend request timed out' : 'Backend is unavailable',
          errorCode: null,
          kind: 'temporary',
        };
      }
    },

    /** Record a typed collection failure for one valid lease. */
    async failCollectionJob(settings, auth, jobId, leaseToken, errorCode, errorMessage) {
      try {
        const { body, response } = await fetchJson(
          `${settings.backendBaseUrl}/api/collection-jobs/${jobId}/fail`,
          {
            body: JSON.stringify({ errorCode, errorMessage, leaseToken }),
            headers: requestHeaders(auth, { includeJson: true }),
            method: 'POST',
          },
        );

        if (response.ok && body?.success === true) {
          return { body, kind: 'success' };
        }

        const responseErrorCode = body?.error?.code ?? null;
        return {
          error: body?.error?.message ?? `Backend returned HTTP ${response.status}`,
          errorCode: responseErrorCode,
          kind: classifySubmissionFailure({
            errorCode: responseErrorCode,
            status: response.status,
          }),
        };
      } catch (error) {
        return {
          error:
            error?.name === 'AbortError' ? 'Backend request timed out' : 'Backend is unavailable',
          errorCode: null,
          kind: 'temporary',
        };
      }
    },

    /** Create an extension bearer session without retaining the plaintext password. */
    async login(settings, credentials) {
      const { body, response } = await fetchJson(`${settings.backendBaseUrl}/api/auth/login`, {
        body: JSON.stringify({ clientType: 'extension', ...credentials }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok || body?.success !== true || !body.data?.session?.token) {
        return {
          error: body?.error?.message ?? 'Sign-in failed',
          errorCode: body?.error?.code ?? 'LOGIN_FAILED',
          success: false,
        };
      }

      return {
        auth: {
          expiresAt: body.data.session.expiresAt,
          mode: 'enabled',
          token: body.data.session.token,
          user: body.data.user,
        },
        success: true,
      };
    },

    /** Revoke an extension session when reachable; local removal is caller-owned. */
    async logout(settings, auth) {
      if (auth.mode !== 'enabled' || !auth.token) {
        return;
      }

      try {
        await fetchJson(`${settings.backendBaseUrl}/api/auth/logout`, {
          body: '{}',
          headers: requestHeaders(auth, { includeJson: true }),
          method: 'POST',
        });
      } catch {
        // Local credential removal still completes when the backend is unavailable.
      }
    },

    /** Detect disabled, enabled-signed-out, and enabled-signed-in backend auth modes. */
    async probeAuthentication(settings, auth) {
      try {
        const { body, response } = await fetchJson(`${settings.backendBaseUrl}/api/auth/me`, {
          headers: requestHeaders(auth),
        });
        let nextAuth = auth;
        let backend = backendStatus('connected');

        if (response.ok && body?.success === true) {
          nextAuth = {
            expiresAt: body.data.session.expiresAt,
            mode: 'enabled',
            token: auth.token,
            user: body.data.user,
          };
        } else if (body?.error?.code === ERROR_CODES.AUTH_DISABLED) {
          nextAuth = { expiresAt: null, mode: 'disabled', token: null, user: null };
        } else if (
          response.status === 401 ||
          [
            ERROR_CODES.AUTHENTICATION_REQUIRED,
            ERROR_CODES.SESSION_EXPIRED,
            ERROR_CODES.SESSION_REVOKED,
          ].includes(body?.error?.code)
        ) {
          nextAuth = { expiresAt: null, mode: 'enabled', token: null, user: null };
        } else {
          backend = backendStatus(
            'unavailable',
            body?.error?.message ?? `Backend returned HTTP ${response.status}`,
          );
        }

        return { auth: nextAuth, backend };
      } catch (error) {
        return {
          auth,
          backend: backendStatus(
            'unavailable',
            error?.name === 'AbortError' ? 'Backend request timed out' : 'Backend is unavailable',
          ),
        };
      }
    },

    /** Submit one normalised snapshot and classify failures for queue policy. */
    async submitSnapshot(settings, auth, snapshot) {
      try {
        const { body, response } = await fetchJson(
          `${settings.backendBaseUrl}/api/products/snapshot`,
          {
            body: JSON.stringify(snapshot),
            headers: requestHeaders(auth, { includeJson: true }),
            method: 'POST',
          },
        );

        if (response.ok && body?.success === true) {
          return { body, kind: 'success' };
        }

        const errorCode = body?.error?.code ?? null;
        return {
          error: body?.error?.message ?? `Backend returned HTTP ${response.status}`,
          errorCode,
          kind: classifySubmissionFailure({ errorCode, status: response.status }),
          status: response.status,
        };
      } catch (error) {
        return {
          error:
            error?.name === 'AbortError' ? 'Backend request timed out' : 'Backend is unavailable',
          errorCode: null,
          kind: classifySubmissionFailure({ networkError: true }),
          status: null,
        };
      }
    },
  });
}
