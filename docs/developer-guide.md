# Developer guide

This guide describes the v1.0.0 contracts and extension points. Phase records
under `docs/phase-*.md` preserve implementation evidence; this document is the
maintainer-facing summary of the released design.

## Module boundaries

```text
apps/extension
  page interceptor -> capture sanitizer -> shared Shopee normaliser
  service worker -> persistent upload and collection-job queues
  popup/options -> presentation and user controls

packages/shared
  constants, endpoint matching, strict Zod schemas, Shopee adapter helpers

apps/server/src
  routes -> controllers -> services -> repositories -> SQLite
                    -> notification service -> Telegram
  jobs -> persistent collection-job dispatch

apps/server/public
  same-origin dashboard and locally bundled Chart.js
```

Keep marketplace payload interpretation in the shared adapter. Repositories
alone execute SQL, services own transactions and business rules, controllers
translate HTTP, and jobs orchestrate work without embedding capture logic.

## Shared product snapshot

`packages/shared/schemas/productSnapshotSchema.js` is the backend persistence
boundary. The extension capture contract is narrower and cannot declare
lifecycle coverage directly; the normaliser derives it from validated Shopee
evidence.

An abbreviated complete snapshot is:

```json
{
  "schemaVersion": 1,
  "platform": "shopee",
  "shopId": "1259293184",
  "itemId": "26882883164",
  "title": "Product title",
  "canonicalUrl": "https://shopee.vn/product-i.1259293184.26882883164",
  "imageUrl": "https://down-vn.img.susercontent.com/file/example",
  "currency": "VND",
  "capturedAt": "2026-08-12T10:00:00.000Z",
  "source": "extension",
  "pricingContext": "user_session",
  "pricingContextKey": "extension:opaque-local-id",
  "variantCoverage": "complete",
  "coverageConfidence": "verified",
  "expectedVariantCount": 2,
  "observedVariantCount": 2,
  "pricedVariantCount": 1,
  "lifecycleEligible": true,
  "variants": [
    {
      "modelId": "123456",
      "identityType": "shopee_model",
      "name": "Black",
      "availability": "available",
      "stockQuantity": 12,
      "priceObservation": {
        "status": "observed",
        "priceAmount": 199000,
        "currency": "VND",
        "priceType": "listed",
        "priceDefinition": "displayed_post_voucher_excluding_shipping",
        "priceSource": "variation_price_breakdown",
        "voucherStatus": "applied",
        "shippingIncluded": false
      }
    },
    {
      "modelId": "123457",
      "identityType": "shopee_model",
      "name": "White",
      "availability": "unknown",
      "stockQuantity": null,
      "priceObservation": {
        "status": "not_observed",
        "reason": "variation_response_missing"
      }
    }
  ]
}
```

Important invariants:

- VND amounts are positive safe integers.
- `shippingIncluded` is always false for an observed MVP price.
- `not_observed` cannot contain price fields.
- `stockQuantity` is null or a non-negative safe integer. Zero agrees with
  `sold_out`; a positive value agrees with `available`.
- Explicit Shopee variants use stable numeric model IDs.
- `default` is valid only for one positively verified variantless product.
- Expected, observed, and priced counts must agree with the variant array and
  coverage claim.

The complete accepted regression fixture is
`tests/fixtures/valid-product-snapshot.json`.

## Shopee endpoint adapter

The adapter recognises only:

```text
/api/v4/pdp/get_pc
/api/v4/pdp/cart_panel/select_variation_pc
/api/v4/pdp/cart_panel/select_variant_pc
```

`get_pc` supplies product identity and the catalogue. A selected-variation
response supplies targeted price and stock evidence for one exact
`selected_tiers` key. The response's
`price_model.price_single_model_id` must match the requested catalogue model
before its price or stock belongs to that variant.

The page interceptor wraps `fetch` and `XMLHttpRequest`, clones responses, and
never changes the original request. The sanitizer retains only allowlisted
public product, model, selected-tier, stock, and pricing fields. Cookies,
headers, signatures, authentication data, addresses, and raw response bodies do
not cross the page boundary.

Endpoint constants live in
`packages/shared/constants/shopeeEndpoints.js`. Capture sanitisation lives in
`packages/shared/shopee/shopeeCaptureSanitizer.js`. Catalogue assembly and
normalisation live in `packages/shared/shopee/shopeeSnapshotNormalizer.js`.

## Raw-price conversion

Shopee's verified Vietnam payloads encode price amounts with a scale of
`100000`:

```text
19900000000 / 100000 = 199000 VND
```

Conversion accepts only numeric raw values that produce a positive safe integer
within the configured range. A range, zero, negative value, fraction,
unrecognised container, or mismatched model is rejected. Do not silently fall
back to `price_min`, `price_max`, a crossed-out original amount, another model's
price, or a previous check.

The verified scale is owned by the Shopee normaliser. Changing it requires new
sanitised live evidence and focused conversion tests.

## Pricing contexts

The supported source/context pairs are:

| Source       | Pricing context | Use                                              |
| ------------ | --------------- | ------------------------------------------------ |
| `extension`  | `user_session`  | Production price from the current Chrome profile |
| `playwright` | `anonymous`     | Historical/import compatibility only             |

Every current stream has a `pricingContextKey`. The extension generates an
opaque stable local installation key; it is not a Shopee account identifier.
Prices from different context types or keys are separate series and are never
compared directly.

`unknown` is reserved for explicitly designed legacy or diagnostic persistence
records and is rejected for new product snapshots.

## Price comparison and notifications

The immediately previous successful available observation is comparable only
when these fields match:

- internal variant ID;
- currency;
- price definition;
- price type;
- pricing context;
- pricing-context key; and
- price source.

The drop is:

```text
((oldPrice - newPrice) / oldPrice) * 100
```

A notification candidate requires a lower price at or above the product's
threshold. Initial observations, unavailable prices, unchanged prices,
increases, below-threshold drops, reactivation baselines, and already delivered
transitions are suppressed.

History commits before Telegram delivery. A successful `notification_events`
row is inserted only after Telegram confirms the send, and its unique transition
dimensions prevent duplicates.

## Variant lifecycle and price gaps

Variant presence and price observation are independent:

- A present variant with no exact price remains present and creates a
  `not_observed` result, not a price row.
- Partial, unknown, failed, replayed, and suspicious catalogue evidence is
  neutral for omitted variants.
- Only `complete` plus `verified` coverage can increment a miss counter.
- The default third eligible miss changes a variant to `inactive`.
- A disappearance ratio above 50 percent is quarantined until the same observed
  set appears in two verified catalogues. The confirming check becomes miss one.
- Reappearance resets lifecycle state. Its first subsequent valid price is a new
  baseline and cannot alert.
- Sold-out is availability, not lifecycle inactivity.

`variant_check_results` stores present/absent/unknown and
observed/not-observed outcomes. `price_logs` stores only real positive amounts.
The history service aligns those tables and emits `y: null` for known gaps;
Chart.js keeps `spanGaps: false`.

See [variant-lifecycle.md](variant-lifecycle.md) for the full algorithm.

## Persistence and transactions

One synchronous SQLite transaction contains product upsert, grouped check,
variant upserts, per-variant results, real prices, lifecycle changes, and
mass-disappearance state. Network work and Telegram delivery stay outside it.

Snapshot hashes are product-scoped idempotency keys. Replaying an exact snapshot
returns the existing check without adding history or lifecycle misses.

Ordered migration files under `apps/server/src/db/migrations` are immutable once
applied. Add the next `NNN-description.sql` file for every change and cover both
fresh migration and upgrade behavior.

## Fixture sanitisation workflow

When Shopee changes a private response:

1. Choose a disposable public product that demonstrates one specific behavior.
2. Open Chrome DevTools **Network** on the public product page and locate only
   the recognised product-detail or selected-variation response.
3. Do not export a HAR or copy request headers. Manually construct the smallest
   JSON fixture that represents the required response shape.
4. Inspect the JSON manually. It may contain public product IDs, canonical URL,
   title/image identifiers, model IDs/names, tier selections, stock/status
   evidence, and allowlisted pricing blocks.
5. Remove or reject any cookie, header, token, request signature, account ID,
   address, raw response, or unrelated nested field.
6. Record provenance and whether the shape is live, derived, or mocked next to
   the focused test that consumes it.
7. Add focused sanitizer, normaliser, and schema tests before changing adapter
   behavior.
8. Run the focused adapter test and `npm.cmd test`.

Do not repeatedly hit Shopee to manufacture rate limits or authentication
failures, and do not bypass platform controls.

## Adding another marketplace

Amazon, Taobao, or another platform requires a new adapter, not Shopee conditionals
spread through services.

1. Define canonical URL and identity schemas in `packages/shared`.
2. Add marketplace endpoint matching and a strict capture sanitizer.
3. Normalise marketplace evidence into the shared product snapshot or introduce
   a versioned compatible contract change.
4. Define a stable variant identity and a verified catalogue-coverage rule.
5. Define and name the marketplace's price semantics, currency handling,
   shipping boundary, voucher/promotion provenance, and raw scale.
6. Add extension host permissions only for the required origins.
7. Add an extractor/collector adapter without changing tracking,
   comparison, lifecycle, repository, or notification policy.
8. Add sanitised fixtures and contract, adapter, persistence, API, and browser
   tests.
9. Keep pricing contexts separate unless comparability is explicitly proven.
10. Update privacy disclosures and repeat live acceptance without exporting
    marketplace credentials.

The service layer should receive a validated normalized snapshot and should not
know which private response fields produced it.

## Verification strategy

Use the narrowest relevant command while developing, then run:

```powershell
npm.cmd test
npm.cmd run release:prepare
```

The automated gate validates deterministic fixtures and local browser
integrations. It cannot prove the installed extension's current Shopee session,
current private API shape, voucher eligibility, or real Telegram delivery; keep
those live gates explicit in release evidence.
