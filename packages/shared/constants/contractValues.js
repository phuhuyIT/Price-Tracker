export const PRICING_CONTEXTS = Object.freeze({
  ANONYMOUS: 'anonymous',
  UNKNOWN: 'unknown',
  USER_SESSION: 'user_session',
});

export const PRODUCT_SNAPSHOT_SCHEMA_VERSION = 1;
export const EXTENSION_MESSAGE_PROTOCOL_VERSION = 1;

export const PRICE_SOURCES = Object.freeze({
  DOM_DISPLAY_FALLBACK: 'dom_display_fallback',
  PRODUCT_DETAIL_FALLBACK: 'product_detail_fallback',
  UNKNOWN: 'unknown',
  VARIATION_PRICE_BREAKDOWN: 'variation_price_breakdown',
  VERIFIED_DISPLAY_FIELD: 'verified_display_field',
});

export const VOUCHER_STATUSES = Object.freeze({
  APPLIED: 'applied',
  NOT_APPLIED: 'not_applied',
  NOT_AVAILABLE: 'not_available',
  UNKNOWN: 'unknown',
});

export const AVAILABILITY_STATUSES = Object.freeze({
  AVAILABLE: 'available',
  SOLD_OUT: 'sold_out',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
});

export const VARIANT_COVERAGE = Object.freeze({
  COMPLETE: 'complete',
  PARTIAL: 'partial',
  UNKNOWN: 'unknown',
});

export const COVERAGE_CONFIDENCE = Object.freeze({
  LIKELY_COMPLETE: 'likely_complete',
  PARTIAL: 'partial',
  UNKNOWN: 'unknown',
  VERIFIED: 'verified',
});

export const VARIANT_LIFECYCLE = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPECTED_MISSING: 'suspected_missing',
});

export const VARIANT_PRESENCE = Object.freeze({
  ABSENT: 'absent',
  PRESENT: 'present',
  UNKNOWN: 'unknown',
});

export const PRICE_OBSERVATION_STATUS = Object.freeze({
  NOT_OBSERVED: 'not_observed',
  OBSERVED: 'observed',
});

export const SNAPSHOT_SOURCES = Object.freeze({
  EXTENSION: 'extension',
  PLAYWRIGHT: 'playwright',
});

export const VARIANT_IDENTITY_TYPES = Object.freeze({
  SHOPEE_MODEL: 'shopee_model',
  SYNTHETIC_DEFAULT: 'synthetic_default',
});

export const AUTH_CLIENT_TYPES = Object.freeze({
  DASHBOARD: 'dashboard',
  EXTENSION: 'extension',
});

export const SESSION_TRANSPORTS = Object.freeze({
  BEARER: 'bearer',
  COOKIE: 'cookie',
});

export const PRODUCT_TRACKING_STATUSES = Object.freeze({
  ACTIVE: 'active',
  PAUSED: 'paused',
});

export const COLLECTION_JOB_TYPES = Object.freeze({
  REFRESH: 'refresh',
  TRACK: 'track',
});

export const COLLECTION_JOB_STATUSES = Object.freeze({
  CLAIMED: 'claimed',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PENDING: 'pending',
});
