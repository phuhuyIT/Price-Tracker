const DEFAULT_BACKEND_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_COLLECTION_POLL_INTERVAL_MINUTES = 30;

/** Generate an opaque local context key that contains no Shopee identity. */
export function createPricingContextKey(randomUuid = () => crypto.randomUUID()) {
  return `extension:${randomUuid()}`;
}

function isLoopbackHostname(hostname) {
  const value = hostname.toLowerCase().replace(/^\[(.*)\]$/u, '$1');
  return value === 'localhost' || value === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(value);
}

/** Validate and canonicalise the extension's backend origin. */
export function normaliseBackendBaseUrl(value) {
  try {
    const url = new URL(String(value).trim());

    if (url.username || url.password || url.search || url.hash) {
      return null;
    }

    if (url.protocol !== 'http:' || !isLoopbackHostname(url.hostname)) {
      return null;
    }

    if (url.pathname !== '/' && url.pathname !== '') {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

/** Return complete, validated settings using safe defaults for missing values. */
export function normaliseExtensionSettings(value = {}, { randomUuid } = {}) {
  const backendBaseUrl = normaliseBackendBaseUrl(value.backendBaseUrl);
  const pricingContextKey =
    typeof value.pricingContextKey === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value.pricingContextKey)
      ? value.pricingContextKey
      : createPricingContextKey(randomUuid);

  return {
    automaticCapture: value.automaticCapture === true,
    backendBaseUrl: backendBaseUrl ?? DEFAULT_BACKEND_BASE_URL,
    backgroundCollectionEnabled: value.backgroundCollectionEnabled === true,
    collectionPollIntervalMinutes:
      Number.isInteger(Number(value.collectionPollIntervalMinutes)) &&
      Number(value.collectionPollIntervalMinutes) >= 1 &&
      Number(value.collectionPollIntervalMinutes) <= 1_440
        ? Number(value.collectionPollIntervalMinutes)
        : DEFAULT_COLLECTION_POLL_INTERVAL_MINUTES,
    debugMode: value.debugMode === true,
    pricingContextKey,
  };
}
