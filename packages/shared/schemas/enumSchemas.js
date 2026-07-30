import { z } from 'zod';

import {
  AUTH_CLIENT_TYPES,
  AVAILABILITY_STATUSES,
  COVERAGE_CONFIDENCE,
  PRICE_OBSERVATION_STATUS,
  PRICE_SOURCES,
  PRICING_CONTEXTS,
  PRODUCT_TRACKING_STATUSES,
  SESSION_TRANSPORTS,
  SNAPSHOT_SOURCES,
  VARIANT_COVERAGE,
  VARIANT_IDENTITY_TYPES,
  VARIANT_LIFECYCLE,
  VARIANT_PRESENCE,
  VOUCHER_STATUSES,
} from '../constants/contractValues.js';
import {
  PRICE_DEFINITIONS,
  PRICE_TYPES,
  SUPPORTED_CURRENCIES,
} from '../constants/priceDefinitions.js';

export const pricingContextSchema = z.enum(Object.values(PRICING_CONTEXTS));
export const livePricingContextSchema = z.enum([
  PRICING_CONTEXTS.USER_SESSION,
  PRICING_CONTEXTS.ANONYMOUS,
]);
export const priceSourceSchema = z.enum(Object.values(PRICE_SOURCES));
export const observedPriceSourceSchema = z.enum([
  PRICE_SOURCES.VARIATION_PRICE_BREAKDOWN,
  PRICE_SOURCES.VERIFIED_DISPLAY_FIELD,
  PRICE_SOURCES.PRODUCT_DETAIL_FALLBACK,
  PRICE_SOURCES.DOM_DISPLAY_FALLBACK,
]);
export const voucherStatusSchema = z.enum(Object.values(VOUCHER_STATUSES));
export const availabilityStatusSchema = z.enum(Object.values(AVAILABILITY_STATUSES));
export const variantCoverageSchema = z.enum(Object.values(VARIANT_COVERAGE));
export const coverageConfidenceSchema = z.enum(Object.values(COVERAGE_CONFIDENCE));
export const variantLifecycleSchema = z.enum(Object.values(VARIANT_LIFECYCLE));
export const variantPresenceSchema = z.enum(Object.values(VARIANT_PRESENCE));
export const priceObservationStatusSchema = z.enum(Object.values(PRICE_OBSERVATION_STATUS));
export const snapshotSourceSchema = z.enum(Object.values(SNAPSHOT_SOURCES));
export const variantIdentityTypeSchema = z.enum(Object.values(VARIANT_IDENTITY_TYPES));
export const authClientTypeSchema = z.enum(Object.values(AUTH_CLIENT_TYPES));
export const sessionTransportSchema = z.enum(Object.values(SESSION_TRANSPORTS));
export const productTrackingStatusSchema = z.enum(Object.values(PRODUCT_TRACKING_STATUSES));
export const currencySchema = z.enum(Object.values(SUPPORTED_CURRENCIES));
export const priceDefinitionSchema = z.enum(Object.values(PRICE_DEFINITIONS));
export const priceTypeSchema = z.enum(Object.values(PRICE_TYPES));
