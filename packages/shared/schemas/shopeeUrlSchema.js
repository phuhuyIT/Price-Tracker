import { z } from 'zod';

import { SHOPEE_HOSTNAME } from '../constants/shopeeEndpoints.js';
import { shopeeIdSchema } from './commonSchemas.js';

const PRODUCT_ID_PATH_PATTERN = /-i\.([1-9]\d{0,29})\.([1-9]\d{0,29})\/?$/u;

/**
 * Check whether a hostname belongs to Shopee Vietnam.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isShopeeVietnamHostname(hostname) {
  const value = hostname.trim().toLowerCase();
  return value === SHOPEE_HOSTNAME || value.endsWith(`.${SHOPEE_HOSTNAME}`);
}

/**
 * Read public shop and item identifiers from a Shopee product URL.
 *
 * @param {string} value
 * @returns {{shopId: string, itemId: string} | null}
 */
export function getShopeeProductIdentity(value) {
  try {
    const url = new URL(value);

    if (
      url.protocol !== 'https:' ||
      !isShopeeVietnamHostname(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }

    const match = url.pathname.match(PRODUCT_ID_PATH_PATTERN);

    if (!match) {
      return null;
    }

    const [, shopId, itemId] = match;

    if (!shopeeIdSchema.safeParse(shopId).success || !shopeeIdSchema.safeParse(itemId).success) {
      return null;
    }

    return { itemId, shopId };
  } catch {
    return null;
  }
}

/** Return a canonical public Shopee Vietnam product URL. */
export function canonicaliseShopeeProductUrl(value) {
  const identity = getShopeeProductIdentity(value);

  if (!identity) {
    return null;
  }

  const url = new URL(value);
  url.hash = '';
  url.hostname = SHOPEE_HOSTNAME;
  url.search = '';
  return url.toString();
}

export const shopeeProductUrlSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    if (!getShopeeProductIdentity(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected an HTTPS Shopee Vietnam product URL containing shop and item IDs',
      });
    }
  });

export const canonicalShopeeProductUrlSchema = shopeeProductUrlSchema.superRefine(
  (value, context) => {
    const url = new URL(value);

    if (
      url.hostname !== SHOPEE_HOSTNAME ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Canonical Shopee URLs must use shopee.vn without credentials, port, query, or fragment',
      });
    }
  },
);
