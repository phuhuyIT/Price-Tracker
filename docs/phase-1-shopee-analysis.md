# Phase 1 Shopee extraction analysis

## Status

Phase 1 is complete as of 2026-07-28. Six sanitised live fixtures prove the current
multi-variant public-promotion flow, the platform-voucher flow, and the
important case where a complete catalogue contains many variants whose prices
cannot be collected. The variantless fixture proves Shopee's implicit-model
representation for a product with no visible variant choices, and the
shop-voucher fixture distinguishes seller-funded vouchers from platform
vouchers. An active flash-sale capture identifies promotion type `302` and
demonstrates safe exact-model product-detail fallback. Sold-out and future
malformed live response shapes remain optional hardening evidence.

## Evidence sources

The analysis separates three kinds of evidence:

1. **Live capture**: sanitised data captured from Shopee in the user's current
   Chrome profile.
2. **Demo behavior**: behavior implemented by the working collector.
3. **Mocked tests**: useful compatibility cases, but not proof that Shopee
   currently emits that shape.

The current live fixture is:

```text
tests/fixtures/shopee-multi-variant-user-session.json
```

It was captured on 2026-07-26 from a product with three models and a 41 percent
public promotion. All query parameters were removed from its saved source URL.
The fixture contains only allowlisted product, model, selected-tier, and
pricing fields.

### Fixture inventory

| Fixture                                                | Provenance                     | Purpose                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `shopee-multi-variant-user-session.json`               | Sanitised live capture         | Complete three-model catalogue and three observed prices                                                                                  |
| `shopee-boxer-user-session.json`                       | Sanitised live capture         | Complete 93-model catalogue, two selected platform-voucher prices, one exact product-detail fallback, and 90 unpriced models              |
| `shopee-boxer-targeted-availability-user-session.json` | Compact sanitised live capture | Complete 93-model catalogue with 12 targeted observed prices, 21 targeted unavailable combinations, and 60 deliberately untargeted models |
| `shopee-variantless-user-session.json`                 | Sanitised live capture         | One implicit Shopee model with empty tier labels and one verified product-detail fallback price                                           |
| `shopee-shop-voucher-user-session.json`                | Sanitised live capture         | Complete 40-model catalogue with 40 exact shop-voucher prices                                                                             |
| `shopee-flash-sale-user-session.json`                  | Sanitised live capture         | Complete six-model catalogue with one exact product-detail flash-sale fallback and five unpriced variants                                 |
| `shopee-variant-price-failure.derived.json`            | Derived from live capture      | Complete catalogue remains present when one price request fails                                                                           |
| `shopee-partial-selected-variation.derived.json`       | Derived from live capture      | Selected response alone is partial and lifecycle-neutral                                                                                  |
| `shopee-suspicious-empty-catalogue.derived.json`       | Derived from live capture      | Empty catalogue after three known models is suspicious, not mass removal                                                                  |
| `shopee-api-failure.derived.json`                      | Derived from live capture      | Failed product-detail request has unknown coverage                                                                                        |
| `shopee-unrecognised-price-shape.derived.json`         | Derived from live capture      | Catalogue remains complete while an unknown price shape becomes `not_observed`                                                            |

Derived fixtures intentionally contain only the minimum fields needed for
their boundary case. They are deterministic test inputs, not claims that
Shopee emitted those exact error payloads.

## Endpoint list

### Product detail and catalogue

```text
GET /api/v4/pdp/get_pc
```

Confirmed live behavior:

- `response.data.item` contains the product identity and product fields.
- `response.data.item.models` contained all three models shown by the product.
- Each model contained a public model ID and its `extinfo.tier_index`.
- `response.data.product_price` contained the initial product pricing block.

This endpoint is the Shopee adapter's candidate for complete catalogue
coverage. The adapter may call it `complete` and `verified` only after schema
validation, matching the response product IDs to the requested URL, validating
the non-empty model catalogue, and checking that the response is plausible.
An empty or malformed `models` array is not verified removal evidence.

### Selected-variant price

```text
POST /api/v4/pdp/cart_panel/select_variation_pc
POST /api/v4/pdp/cart_panel/select_variant_pc
```

Shopee currently uses both endpoint spellings. They share the same selected-tier
capture contract.

Confirmed live request fields:

```text
item_id
shop_id
quantity
selected_tiers
```

Confirmed live behavior:

- One response is correlated to one exact `selected_tiers` selection.
- A successful response's `data.stock` is the selected variant's current stock:
  positive means available, zero means sold out, and negative or malformed stock
  remains unknown.
- The selected model is identified by
  `response.data.product_price.price_model.price_single_model_id`.
- The displayed price is at
  `response.data.product_price.price.single_value`.
- The original crossed-out price is at
  `response.data.product_price.price_before_discount.single_value`.
- The response describes the selected variant's price. By itself it is
  `partial` catalogue evidence and cannot make omitted variants missing.

The working demo also recognises these unverified compatibility paths:

```text
response.data.price_breakdown.price.singlevalue
response.data.price_breakdown.price.single_value
response.data.product_price.price.singlevalue
response.price_breakdown.price.singlevalue
response.price_breakdown.price.single_value
```

Those paths are covered by mocked tests or defensive code, not by the current
live fixture. They must remain isolated in the Shopee adapter.

## Verified field mapping

| Normalised meaning               | Captured Shopee field                                           | Evidence                   |
| -------------------------------- | --------------------------------------------------------------- | -------------------------- |
| Shop ID                          | `response.data.item.shop_id`                                    | Live                       |
| Item ID                          | `response.data.item.item_id`                                    | Live                       |
| Product title                    | `response.data.item.title`                                      | Live                       |
| Product image identifier         | `response.data.item.image`                                      | Live                       |
| Currency                         | `response.data.item.currency`                                   | Live                       |
| Variant catalogue                | `response.data.item.models`                                     | Live                       |
| Variant ID                       | `response.data.item.models[].model_id`                          | Live                       |
| Variant name                     | `response.data.item.models[].name`                              | Live                       |
| Variant tier selection           | `response.data.item.models[].extinfo.tier_index`                | Live                       |
| Base promotional price           | `response.data.item.models[].price`                             | Live                       |
| Original crossed-out price       | `response.data.item.models[].price_before_discount`             | Live                       |
| Selected model ID                | `response.data.product_price.price_model.price_single_model_id` | Live                       |
| Displayed selected-variant price | `response.data.product_price.price.single_value`                | Live                       |
| Public discount percent          | `response.data.product_price.discount`                          | Live                       |
| Applied final-price vouchers     | `response.data.product_price.final_price_vouchers`              | Live, null in this capture |

The saved fixture preserves the response wrapper beneath
`endpointEvidence`. It does not contain raw HTTP headers or the rest of the raw
Shopee payload.

## Price ownership and scaling

The product detail fields `price_min` and `price_max` describe the product
range. They are not substitutes for an individual variant observation.

The selected-variation response belongs to the exact selected variant because:

1. The request contains that model's `selected_tiers`.
2. The response's `price_single_model_id` matches that model.
3. The collector waits for the matching response before selecting the next
   variant.

Shopee prices in the capture use a scale of `100000`:

```text
15125000000 / 100000 = 151250 VND
25500000000 / 100000 = 255000 VND
```

Conversion accepts only positive safe integers and must produce a positive
safe integer VND amount. Missing, malformed, fractional, and zero results are
rejected.

## Discounts, vouchers, and shipping

The live fixture proves a public product promotion:

```text
discount = 41
price = 15125000000
price_before_discount = 25500000000
has_final_price = true
final_price_vouchers = null
```

Therefore this fixture is classified as a public discount with no applied
final-price voucher. It does not prove the representation of shop vouchers or
platform vouchers.

The second live fixture proves an applied platform voucher. Both successful
selected-variation responses contain:

```text
price_breakdown.discount_breakdown[].price_source =
  "Platform Voucher Discount"
price_breakdown.discount_breakdown[].platform_voucher.discount_value =
  1500000000
product_price.final_price_vouchers[].voucher_type = 2
product_price.final_price_info.hint_text = "After Voucher"
product_price.final_price_info.final_price_vouchers.platform_voucher =
  <present>
product_price.final_price_info.final_price_vouchers.shop_voucher =
  null
```

The product price was `24800000000`, the voucher discount was `1500000000`,
and the final displayed price was `23300000000`, or 233,000 VND after applying
the `100000` scale. Voucher codes and promotion IDs are pricing metadata, not
credentials, but the normalised snapshot needs only the voucher status and
price provenance.

The second fixture also proves the no-public-discount case:

```text
item.models[].price = 24800000000
item.models[].price_before_discount = 0
```

The product had no crossed-out public promotional price. The selected response
used 248,000 VND as the pre-voucher amount and 233,000 VND as the post-platform
voucher amount. A raw zero `price_before_discount` means that this optional
comparison price is absent; it is not a valid zero-VND price observation.

The shop-voucher fixture proves a distinct applied-voucher source across all
40 exact model responses:

```text
price_breakdown.discount_breakdown[].price_source =
  "Shop Voucher Discount"
price_breakdown.discount_breakdown[].shop_voucher.discount_value =
  14000000000
price_breakdown.discount_breakdown[].platform_voucher = null
product_price.final_price_vouchers[].voucher_type = 1
product_price.final_price_info.hint_text = "After Voucher"
product_price.final_price_info.final_price_vouchers.shop_voucher =
  <present>
product_price.final_price_info.final_price_vouchers.platform_voucher =
  null
```

The shop voucher subtracts 140,000 VND after applying the `100000` price scale.
Depending on the selected model, the captured final displayed price was
113,819–119,000 VND. This distinguishes shop voucher type `1` from the
previously captured platform voucher type `2`.

The active flash-sale fixture proves this product-detail pricing shape:

```text
product_price.discount = 33
product_price.price.single_value = 14674000000
product_price.price_before_discount.single_value = 21780000000
product_price.final_price_vouchers = null
product_price.price_model.price_single_model_id = 227853273170
product_price.price_promotion.price_single_promotion_type = 302
```

The page was displaying an active flash sale at capture time. Its promotion
type `302` is therefore recorded as a live Shopee mapping, isolated in the
Shopee adapter because marketplace promotion enums may change.

The page's variation controls did not match the demo's current button selector,
so no selected-variation responses were captured. The normaliser uses the
146,740 VND product-detail price only for model `227853273170`, whose ID matches
`price_single_model_id`. The other five catalogue variants remain present with
`priceObservation.status = not_observed`; their shared catalogue price is not
copied into price history.

No shipping or delivery-price field appears in the allowlisted product pricing
block. The demo does not collect shipping, and the normalised observation
explicitly marks the selected product price as shipping-excluded. Checkout
totals and shipping endpoints must never be used as substitutes.

## Availability

In this capture, product and model `stock` and `normal_stock` values are null.
Although `status = 1` and `item_status = normal` were present, Phase 1 does not
yet have enough evidence to map those fields to the complete availability
enum.

The offline normaliser therefore uses `availability = unknown` for these
models. It does not guess `available`, and it keeps availability separate from
variant catalogue presence and price-observation success.

## Products without visible variants

The variantless live fixture proves that Shopee may still return one internal
model when the product page has no selectable variant controls:

```text
item.models.length = 1
item.models[0].model_id = 80061566833
item.models[0].name = ""
item.models[0].extinfo.tier_index = [0]
item.tier_variations[0].name = ""
item.tier_variations[0].options = [""]
```

The model price, product price, minimum price, and maximum price all matched
`2560000000`, or 25,600 VND after applying the verified `100000` scale. The
normaliser treats this empty single-model and empty-tier structure as positive
evidence of a product without explicit variants. It emits one shared
`modelId = default`, `name = Default` variant and records the valid displayed
price with `priceSource = product_detail_fallback`.

An arbitrary empty or malformed `models` array remains suspicious and does not
qualify for this rule.

## Missing-price behavior

The full `get_pc` model catalogue is processed independently from selected
variation prices. If one model remains in `item.models` but its selected-price
response is absent or lacks a valid price:

- the model remains present in the normalised snapshot;
- `priceObservation.status` is `not_observed`;
- the reason records whether the response or display-price field was missing;
- no zero, null, base, or previous price is substituted.

An offline test removes one selected-variation response from the live fixture
and verifies that all three variant identities remain while only two prices
are observed.

The second live fixture provides the real version of this case:

- `get_pc` contained 93 stable model identities.
- Two exact selections returned an observed final price.
- The other 91 attempts reported a disabled variation button.
- Stock fields remained null.

A disabled button can result from the current multi-tier selection state. It
does not prove that the model was removed or sold out. All 93 identities remain
present with complete catalogue coverage. The product-detail payload also
contains a valid 233,000 VND post-voucher price tied to one exact model ID, so
that model uses `priceSource = product_detail_fallback`. The remaining 90
failed prices use `priceObservation.status = not_observed` and
`reason = variation_option_disabled`. Their availability remains `unknown`;
no price log, zero price, or missing-variant miss is created for them.

A follow-up targeted capture first cleared all selected tier buttons before
testing each combination. It selected the two user-confirmed M and L models and
all 31 XL models. Twelve responses returned a valid displayed price whose
`price_single_model_id` matched the requested catalogue model, while 21 target
combinations remained disabled after the reset and were classified as
`variation_combination_unavailable`. The other 60 catalogue models were
deliberately not requested and remain `unknown`, not unavailable. This compact
fixture excludes the DOM diagnostics used during debugging.

## Fixture sanitisation

The capture path accepts only:

- public product IDs and canonical product URL;
- product title and image identifier;
- product and variant price fields;
- public model identities and tier selections;
- stock/status fields needed for availability research;
- selected-variation request bodies;
- allowlisted pricing response blocks and error fields.

It never accepts or stores browser request headers, cookies, Shopee
authentication data, delivery addresses, or account information. Suspicious
nested keys are removed before JSON is written.

Capture another fixture with:

```powershell
npm.cmd start -- "<Shopee URL>" --fixture "tests/fixtures/<name>.json"
```

The destination is created without overwriting an existing fixture.

## Optional future evidence gaps

Additional live evidence would improve future mappings for:

- a sold-out variant distinct from the now-verified unavailable-combination
  case;
- a real request failure;
- a real changed or unrecognised response structure.

Partial-response, failure, empty-catalogue, and malformed-shape fixtures have
been derived from the sanitised live capture and are explicitly labelled.
Sold-out mappings must not be invented; they require suitable live evidence.
Public discounts, shop and platform vouchers, flash sales, variantless
products, and unavailable combinations now have sanitised live evidence.
