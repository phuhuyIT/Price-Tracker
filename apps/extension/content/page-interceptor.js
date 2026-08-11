import { EXTENSION_MESSAGE_PROTOCOL_VERSION } from '../../../packages/shared/constants/contractValues.js';
import {
  EXTENSION_COLLECTION_STATUS_CODES,
  EXTENSION_COLLECTION_STATUS_MESSAGE_TYPE,
} from '../../../packages/shared/constants/extensionProtocol.js';
import {
  isShopeeSelectedVariationEndpoint,
  SHOPEE_PRODUCT_DETAIL_ENDPOINT,
  SHOPEE_PRODUCT_ENDPOINTS,
} from '../../../packages/shared/constants/shopeeEndpoints.js';
import {
  parseVariationRequestBody,
  sanitiseProductDetailCapture,
  sanitiseSelectedVariationCapture,
} from '../../../packages/shared/shopee/shopeeCaptureSanitizer.js';

const INSTALL_MARKER = '__shopeePriceTrackerPageInterceptorV1';

function endpointPath(value, baseUrl) {
  try {
    const pathname = new URL(String(value), baseUrl).pathname;
    return SHOPEE_PRODUCT_ENDPOINTS.includes(pathname) ? pathname : null;
  } catch {
    return null;
  }
}

async function fetchRequestBody(input, init) {
  if (init?.body !== undefined) {
    return parseVariationRequestBody(init.body);
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      return parseVariationRequestBody(await input.clone().text());
    } catch {
      return null;
    }
  }

  return null;
}

function postCapture(target, capture) {
  if (capture) {
    target.postMessage(capture, target.location.origin);
  }
}

function collectionStatusCode(status, payload) {
  const shopeeError = String(payload?.error ?? payload?.error_code ?? '');

  if ([401, 403].includes(status) || shopeeError === '90309999') {
    return EXTENSION_COLLECTION_STATUS_CODES.AUTHENTICATION_REQUIRED;
  }

  if (status === 429) {
    return EXTENSION_COLLECTION_STATUS_CODES.RATE_LIMITED;
  }

  if ([404, 410].includes(status)) {
    return EXTENSION_COLLECTION_STATUS_CODES.PRODUCT_UNAVAILABLE;
  }

  if (status >= 500 && status <= 599) {
    return EXTENSION_COLLECTION_STATUS_CODES.SHOPEE_SERVER_ERROR;
  }

  return null;
}

function postCollectionFailureCode(target, code) {
  target.postMessage(
    {
      capturedAt: new Date().toISOString(),
      code,
      protocolVersion: EXTENSION_MESSAGE_PROTOCOL_VERSION,
      type: EXTENSION_COLLECTION_STATUS_MESSAGE_TYPE,
    },
    target.location.origin,
  );
}

function postCollectionStatus(target, status, payload, capturedAt) {
  const code = collectionStatusCode(status, payload);

  if (code) {
    target.postMessage(
      {
        capturedAt,
        code,
        protocolVersion: EXTENSION_MESSAGE_PROTOCOL_VERSION,
        type: EXTENSION_COLLECTION_STATUS_MESSAGE_TYPE,
      },
      target.location.origin,
    );
  }
}

async function inspectFetchResponse(target, input, init, response) {
  const path = endpointPath(response.url || input?.url || input, target.location.href);

  if (!path) {
    return;
  }

  const clone = response.clone();
  const requestBodyPromise = isShopeeSelectedVariationEndpoint(path)
    ? fetchRequestBody(input, init)
    : Promise.resolve(null);

  try {
    const [payload, requestBody] = await Promise.all([clone.json(), requestBodyPromise]);
    const capturedAt = new Date().toISOString();
    postCollectionStatus(target, response.status, payload, capturedAt);
    const capture =
      path === SHOPEE_PRODUCT_DETAIL_ENDPOINT
        ? sanitiseProductDetailCapture(payload, { capturedAt })
        : sanitiseSelectedVariationCapture(payload, {
            capturedAt,
            endpoint: path,
            ok: response.ok,
            requestBody,
            status: response.status,
          });
    postCapture(target, capture);
  } catch {
    // The original Shopee response remains untouched when inspection fails.
  }
}

function readXhrPayload(xhr) {
  if (xhr.responseType === 'json') {
    return xhr.response;
  }

  if (xhr.responseType === '' || xhr.responseType === 'text') {
    return JSON.parse(xhr.responseText);
  }

  return null;
}

/** Install transparent fetch and XMLHttpRequest observation in the page world. */
export function installPageInterceptor(target = window) {
  if (target[INSTALL_MARKER]) {
    return;
  }

  Object.defineProperty(target, INSTALL_MARKER, { configurable: false, value: true });

  const originalFetch = target.fetch;

  if (typeof originalFetch === 'function') {
    target.fetch = async function interceptedFetch(...arguments_) {
      try {
        const response = await Reflect.apply(originalFetch, this, arguments_);
        void inspectFetchResponse(target, arguments_[0], arguments_[1], response);
        return response;
      } catch (error) {
        if (endpointPath(arguments_[0]?.url ?? arguments_[0], target.location.href)) {
          postCollectionFailureCode(target, EXTENSION_COLLECTION_STATUS_CODES.FETCH_FAILED);
        }
        throw error;
      }
    };
  }

  const Xhr = target.XMLHttpRequest;

  if (!Xhr?.prototype) {
    return;
  }

  const metadata = new WeakMap();
  const originalOpen = Xhr.prototype.open;
  const originalSend = Xhr.prototype.send;

  Xhr.prototype.open = function interceptedOpen(method, url, ...rest) {
    metadata.set(this, { body: null, method, url });
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };

  Xhr.prototype.send = function interceptedSend(body) {
    const request = metadata.get(this);

    if (request) {
      request.body = body;
      this.addEventListener(
        'timeout',
        () => {
          if (endpointPath(this.responseURL || request.url, target.location.href)) {
            postCollectionFailureCode(target, EXTENSION_COLLECTION_STATUS_CODES.NETWORK_TIMEOUT);
          }
        },
        { once: true },
      );
      this.addEventListener(
        'error',
        () => {
          if (endpointPath(this.responseURL || request.url, target.location.href)) {
            postCollectionFailureCode(target, EXTENSION_COLLECTION_STATUS_CODES.FETCH_FAILED);
          }
        },
        { once: true },
      );
      this.addEventListener(
        'loadend',
        () => {
          const path = endpointPath(this.responseURL || request.url, target.location.href);

          if (!path) {
            return;
          }

          try {
            const payload = readXhrPayload(this);
            const capturedAt = new Date().toISOString();
            postCollectionStatus(target, this.status, payload, capturedAt);
            const capture =
              path === SHOPEE_PRODUCT_DETAIL_ENDPOINT
                ? sanitiseProductDetailCapture(payload, { capturedAt })
                : sanitiseSelectedVariationCapture(payload, {
                    capturedAt,
                    endpoint: path,
                    ok: this.status >= 200 && this.status < 300,
                    requestBody: parseVariationRequestBody(request.body),
                    status: this.status,
                  });
            postCapture(target, capture);
          } catch {
            // Unsupported response types and malformed JSON are ignored.
          }
        },
        { once: true },
      );
    }

    return Reflect.apply(originalSend, this, [body]);
  };
}

if (typeof window !== 'undefined') {
  installPageInterceptor(window);
}
