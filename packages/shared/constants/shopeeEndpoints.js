export const SHOPEE_HOSTNAME = 'shopee.vn';

export const SHOPEE_PRODUCT_DETAIL_ENDPOINT = '/api/v4/pdp/get_pc';

export const SHOPEE_SELECTED_VARIATION_ENDPOINTS = Object.freeze([
  '/api/v4/pdp/cart_panel/select_variation_pc',
  '/api/v4/pdp/cart_panel/select_variant_pc',
]);

export const SHOPEE_PRODUCT_ENDPOINTS = Object.freeze([
  SHOPEE_PRODUCT_DETAIL_ENDPOINT,
  ...SHOPEE_SELECTED_VARIATION_ENDPOINTS,
]);

/** Return whether a pathname is a supported selected-variation endpoint. */
export function isShopeeSelectedVariationEndpoint(pathname) {
  return SHOPEE_SELECTED_VARIATION_ENDPOINTS.includes(pathname);
}
