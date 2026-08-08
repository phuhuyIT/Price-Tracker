import {
  availabilityLabel,
  badgeTone,
  buildProductWarnings,
  contextLabel,
  displayPriceLabel,
  formatDateTime,
  formatVnd,
  lifecycleLabel,
  priceSourceLabel,
  selectProductDisplayPrice,
  voucherLabel,
} from './dashboardFormatters.js';

/** Escape untrusted API text before inserting it into a dashboard template. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function badge(label, tone = 'info') {
  return `<span class="badge badge-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function priceBadges(price) {
  if (!price) {
    return badge('Awaiting observation', 'warning');
  }

  return [
    badge(contextLabel(price.pricingContext), badgeTone(price.pricingContext)),
    badge(voucherLabel(price.voucherStatus), badgeTone(price.voucherStatus)),
    badge(priceSourceLabel(price.priceSource), badgeTone(price.priceSource)),
  ].join('');
}

function variantResult(variant) {
  return (
    variant.latestResults?.find(
      (result) => result.pricingContext === variant.preferredPrice?.pricingContext,
    ) ??
    variant.latestResults?.[0] ??
    variant.preferredPrice?.latestResult ??
    null
  );
}

function renderVariant(variant) {
  const price = variant.preferredPrice;
  const result = variantResult(variant);
  const priceLabel =
    result?.priceStatus === 'not_observed'
      ? `${formatVnd(price?.priceAmount)} · last known`
      : formatVnd(price?.priceAmount);
  const timestamps = [];

  if (variant.lastSeenAt) {
    timestamps.push(`Seen ${formatDateTime(variant.lastSeenAt)}`);
  }

  if (variant.missingSince) {
    timestamps.push(`Missing since ${formatDateTime(variant.missingSince)}`);
  }

  return `
    <div class="variant-item">
      <div>
        <span class="variant-name" title="${escapeHtml(variant.name)}">${escapeHtml(variant.name)}</span>
        <div class="badge-row">
          ${badge(lifecycleLabel(variant.lifecycleStatus), badgeTone(variant.lifecycleStatus))}
          ${badge(availabilityLabel(variant.availability), badgeTone(variant.availability))}
          ${result?.priceStatus === 'not_observed' ? badge('Price not observed', 'warning') : ''}
        </div>
        ${
          timestamps.length > 0
            ? `<span class="price-label">${escapeHtml(timestamps.join(' · '))}</span>`
            : ''
        }
      </div>
      <span class="variant-price">${escapeHtml(priceLabel)}</span>
    </div>
  `;
}

function renderWarnings(product) {
  const warnings = buildProductWarnings(product);

  if (warnings.length === 0) {
    return '';
  }

  return `
    <ul class="warning-list">
      ${warnings
        .map(
          (warning) =>
            `<li class="warning-item${warning.severity === 'error' ? ' is-error' : ''}">${escapeHtml(warning.message)}</li>`,
        )
        .join('')}
    </ul>
  `;
}

function renderProduct(product, busyProductIds) {
  const displayPrice = selectProductDisplayPrice(product);
  const isBusy = busyProductIds.has(product.id);
  const isPaused = product.trackingStatus === 'paused';
  const hasImage = typeof product.imageUrl === 'string' && product.imageUrl.length > 0;
  const initial = product.title?.trim().slice(0, 1).toUpperCase() || '₫';
  const actionDisabled = isBusy ? ' disabled' : '';

  return `
    <article class="product-card${product.lastError ? ' has-error' : ''}" data-product-card="${escapeHtml(product.id)}">
      <div class="product-main">
        <div class="product-media${hasImage ? ' has-image' : ''}">
          ${
            hasImage
              ? `<img src="${escapeHtml(product.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
              : ''
          }
          <span class="product-image-fallback" aria-hidden="true">${escapeHtml(initial)}</span>
        </div>
        <div>
          <div class="product-heading-row">
            <a
              class="product-title"
              href="${escapeHtml(product.canonicalUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              title="${escapeHtml(product.title)}"
            >${escapeHtml(product.title)}</a>
            ${badge(isPaused ? 'Paused' : 'Tracking', isPaused ? 'warning' : 'success')}
          </div>

          <div class="price-block">
            <span class="price-label">${escapeHtml(displayPriceLabel(displayPrice))}</span>
            <span class="price-value${displayPrice ? '' : ' is-muted'}">${escapeHtml(formatVnd(displayPrice?.priceAmount))}</span>
          </div>

          <div class="badge-row">
            ${badge(availabilityLabel(product.availability), badgeTone(product.availability))}
            ${priceBadges(displayPrice)}
          </div>

          <div class="product-meta">
            <span>Last successful check<strong>${escapeHtml(formatDateTime(product.lastSuccessAt))}</strong></span>
            <span>Variants<strong>${escapeHtml(`${product.activeVariantCount} active · ${product.variantCount} total`)}</strong></span>
          </div>
        </div>
      </div>

      ${renderWarnings(product)}

      <details class="variant-list">
        <summary>Variant lifecycle and availability</summary>
        <div class="variant-items">
          ${(product.variants ?? []).map(renderVariant).join('') || '<p class="price-label">No variants stored yet.</p>'}
        </div>
      </details>

      <footer class="card-actions">
        <button class="button button-primary button-small" type="button" data-action="refresh" data-product-id="${escapeHtml(product.id)}"${actionDisabled}>
          ${product.lastError ? 'Retry check' : 'Refresh price'}
        </button>
        <button class="button button-secondary button-small" type="button" data-action="toggle-status" data-product-id="${escapeHtml(product.id)}"${actionDisabled}>
          ${isPaused ? 'Resume' : 'Pause'}
        </button>
        <button class="button button-secondary button-small" type="button" data-action="history" data-product-id="${escapeHtml(product.id)}"${actionDisabled}>
          History
        </button>
        <button class="button button-quiet button-danger button-small" type="button" data-action="delete" data-product-id="${escapeHtml(product.id)}"${actionDisabled}>
          Delete
        </button>
      </footer>
    </article>
  `;
}

export function renderProductCards(products, busyProductIds = new Set()) {
  return products.map((product) => renderProduct(product, busyProductIds)).join('');
}

export function renderVariantOptions(variants) {
  return [
    '<option value="">All variants</option>',
    ...variants.map(
      (variant) => `<option value="${escapeHtml(variant.id)}">${escapeHtml(variant.name)}</option>`,
    ),
  ].join('');
}

export function renderPagination(pagination) {
  if (!pagination || pagination.pages <= 1) {
    return '';
  }

  const firstPage = Math.max(1, Math.min(pagination.page - 2, pagination.pages - 4));
  const lastPage = Math.min(pagination.pages, firstPage + 4);
  const pageButtons = [];

  pageButtons.push(
    `<button class="button button-small" type="button" data-page="${pagination.page - 1}"${pagination.page === 1 ? ' disabled' : ''}>Previous</button>`,
  );

  for (let page = firstPage; page <= lastPage; page += 1) {
    pageButtons.push(
      `<button class="button button-small" type="button" data-page="${page}"${page === pagination.page ? ' aria-current="page"' : ''}>${page}</button>`,
    );
  }

  pageButtons.push(
    `<button class="button button-small" type="button" data-page="${pagination.page + 1}"${pagination.page === pagination.pages ? ' disabled' : ''}>Next</button>`,
  );

  return pageButtons.join('');
}
