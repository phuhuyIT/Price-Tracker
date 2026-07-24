# Maintainer Guide

The project has one collection pipeline and two browser adapters.

## Collection pipeline

1. Capture Shopee's `get_pc` response.
2. Build one request descriptor for every model and its `tier_index`.
3. Select each variation sequentially on the product page.
4. Capture the Shopee-generated `select_variation_*` response.
5. Keep the best response for each exact tier combination.
6. Merge the final display price back into the matching model.

The shared implementation lives in `chrome-extension/shared/`:

- `variant-core.js`: pure data transformations and price parsing.
- `variation-page.js`: variation-button lookup and click behavior.
- `variation-flow.js`: sequential collection, waits, and retry behavior.

These files use a small dual-runtime wrapper so Node.js can load them with
`require()` and the Chrome service worker can load them with `importScripts()`.
Business rules belong here so both browser modes stay consistent.

## Runtime adapters

- `variant-pricing.js` captures Playwright responses and provides Playwright
  mouse input.
- `chrome-extension/background.js` captures CDP responses and provides CDP
  mouse input.

Adapters should translate browser APIs only. They should not contain their own
price paths, tier normalization, response ranking, or retry sequence.

## Safe change workflow

1. Add or update a focused unit assertion in
   `tests/variant-pricing.test.js`.
2. Change the shared module that owns the behavior.
3. Run `npm.cmd test`.
4. Reload the unpacked extension in `chrome://extensions`.

When Shopee introduces another successful response shape, add its price path
to `FINAL_PRICE_PATHS` in `variant-core.js` and include a matching fixture in
the unit test.
