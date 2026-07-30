import { describe, expect, it } from 'vitest';

import {
  canonicalShopeeProductUrlSchema,
  getShopeeProductIdentity,
  shopeeProductUrlSchema,
} from '../../../packages/shared/index.js';

describe('Shopee product URL schema', () => {
  const canonicalUrl = 'https://shopee.vn/ca-phe-fine-robusta-i.1259293184.26882883164';

  it('accepts a canonical Shopee Vietnam product URL', () => {
    expect(canonicalShopeeProductUrlSchema.parse(canonicalUrl)).toBe(canonicalUrl);
    expect(getShopeeProductIdentity(canonicalUrl)).toEqual({
      itemId: '26882883164',
      shopId: '1259293184',
    });
  });

  it('accepts query and fragment input before canonicalisation', () => {
    const input = `${canonicalUrl}?utm_source=test#details`;

    expect(shopeeProductUrlSchema.safeParse(input).success).toBe(true);
    expect(canonicalShopeeProductUrlSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    'http://shopee.vn/product-i.1.2',
    'https://example.com/product-i.1.2',
    'https://shopee.vn/product',
    'https://shopee.vn/product-i.0.2',
    'not-a-url',
  ])('rejects unsupported URL %s', (url) => {
    expect(shopeeProductUrlSchema.safeParse(url).success).toBe(false);
  });
});
