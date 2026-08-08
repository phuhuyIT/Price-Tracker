const SOLD_OUT_LABELS = new Set(['đã bán hết', 'hết hàng', 'sold out', 'out of stock']);
const MAX_COMMON_ANCESTOR_DEPTH = 16;
const PAGE_REGION_MIN_VERTICAL_DISTANCE_PX = 360;
const PAGE_REGION_VIEWPORT_RATIO = 0.75;

function normaliseVisibleText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('vi-VN');
}

function isHiddenElement(element, documentReference) {
  for (let current = element; current; current = current.parentElement) {
    if (
      current.hidden === true ||
      current.getAttribute?.('aria-hidden') === 'true' ||
      ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(current.tagName)
    ) {
      return true;
    }

    const style = documentReference.defaultView?.getComputedStyle?.(current);

    if (
      style &&
      (style.display === 'none' ||
        ['hidden', 'collapse'].includes(style.visibility) ||
        style.opacity === '0')
    ) {
      return true;
    }
  }

  return false;
}

function isVisibleElement(element, documentReference) {
  if (!element?.isConnected || isHiddenElement(element, documentReference)) {
    return false;
  }

  return typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
}

function hasScopedCommonAncestor(left, right, documentReference) {
  let current = left;

  for (let depth = 0; current && depth <= MAX_COMMON_ANCESTOR_DEPTH; depth += 1) {
    if (current === documentReference.body || current === documentReference.documentElement) {
      return false;
    }

    if (current.contains?.(right)) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function isNearProductHeading(label, heading, documentReference) {
  if (
    typeof label.getBoundingClientRect !== 'function' ||
    typeof heading.getBoundingClientRect !== 'function'
  ) {
    return true;
  }

  const labelRect = label.getBoundingClientRect();
  const headingRect = heading.getBoundingClientRect();
  const viewportHeight = Number(documentReference.defaultView?.innerHeight) || 800;
  const maxDistance = Math.max(
    PAGE_REGION_MIN_VERTICAL_DISTANCE_PX,
    viewportHeight * PAGE_REGION_VIEWPORT_RATIO,
  );

  return Math.abs(labelRect.top - headingRect.top) <= maxDistance;
}

/**
 * Detect an explicit sold-out label in the main Shopee product region.
 *
 * This is a conservative fallback for stock-redacted, variantless responses.
 * It deliberately ignores generic page text and recommendation-card labels.
 */
export function detectShopeeProductPageAvailability(documentReference, { title } = {}) {
  const expectedTitle = normaliseVisibleText(title);

  if (!documentReference?.body || !expectedTitle) {
    return 'unknown';
  }

  const elements = [...documentReference.querySelectorAll('body *')];
  const headings = elements.filter(
    (element) =>
      normaliseVisibleText(element.textContent) === expectedTitle &&
      isVisibleElement(element, documentReference),
  );

  if (headings.length === 0) {
    return 'unknown';
  }

  const soldOutLabels = elements.filter(
    (element) =>
      SOLD_OUT_LABELS.has(normaliseVisibleText(element.textContent)) &&
      isVisibleElement(element, documentReference),
  );

  for (const label of soldOutLabels) {
    for (const heading of headings) {
      if (
        hasScopedCommonAncestor(label, heading, documentReference) &&
        isNearProductHeading(label, heading, documentReference)
      ) {
        return 'sold_out';
      }
    }
  }

  return 'unknown';
}

/** Wait briefly for Shopee to render explicit product-page availability. */
export function waitForShopeeProductPageAvailability(
  documentReference,
  { timeoutMs = 2_000, title } = {},
) {
  const current = detectShopeeProductPageAvailability(documentReference, { title });

  if (current !== 'unknown' || timeoutMs <= 0 || typeof MutationObserver === 'undefined') {
    return Promise.resolve(current);
  }

  return new Promise((resolve) => {
    let checkTimer = null;
    let timeoutTimer = null;
    let settled = false;

    const observer = new MutationObserver(() => {
      if (checkTimer !== null) {
        return;
      }

      checkTimer = setTimeout(() => {
        checkTimer = null;
        const availability = detectShopeeProductPageAvailability(documentReference, { title });

        if (availability !== 'unknown') {
          finish(availability);
        }
      }, 50);
    });

    function finish(availability) {
      if (settled) {
        return;
      }

      settled = true;
      observer.disconnect();
      clearTimeout(timeoutTimer);

      if (checkTimer !== null) {
        clearTimeout(checkTimer);
      }

      resolve(availability);
    }

    observer.observe(documentReference.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    timeoutTimer = setTimeout(() => finish('unknown'), timeoutMs);
  });
}
