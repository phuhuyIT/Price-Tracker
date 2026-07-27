# Variant Lifecycle and Missing-Price Policy

Status: accepted MVP design, 2026-07-26.

## Purpose

The system must distinguish these two facts:

1. A Shopee variant still exists.
2. A valid price was collected for that variant during this check.

A failed price request does not prove that the variant disappeared. Missing,
malformed, null, or zero prices never deactivate a variant and never create a
price record.

## Snapshot coverage

Each normalised snapshot includes:

```json
{
  "variantCoverage": "complete",
  "coverageConfidence": "verified",
  "expectedVariantCount": 6,
  "observedVariantCount": 6,
  "pricedVariantCount": 5
}
```

`variantCoverage` values:

- `complete`: the marketplace adapter validated a full variant catalogue.
- `partial`: the response describes only one variant or a subset.
- `unknown`: the adapter cannot prove the catalogue coverage.

`coverageConfidence` values:

- `verified`
- `likely_complete`
- `partial`
- `unknown`

Only `variantCoverage = complete` together with
`coverageConfidence = verified` may change the missing lifecycle of an
unobserved variant.

For the Shopee MVP, a successfully validated `/api/v4/pdp/get_pc` response with
matching product IDs and a valid `item.models` catalogue is the normal source
of verified complete coverage. A
`/api/v4/pdp/cart_panel/select_variation_pc` response is partial catalogue
evidence by itself. A composite snapshot may still be complete when its
catalogue came from verified `get_pc` data and variation responses only
supplemented its prices.

An empty or malformed models array does not prove that every known variant was
removed. A genuinely variantless product is normalised to one `default`
variant only after the adapter positively validates that the product has no
explicit variants.

## Variant and price contract

Every variant identity seen in the catalogue remains in the snapshot even when
its price was not collected:

```json
{
  "modelId": "123456",
  "name": "200g - Pha May",
  "availability": "available",
  "priceObservation": {
    "status": "observed",
    "priceAmount": 199000,
    "priceType": "listed"
  }
}
```

A present variant whose price request failed uses a discriminated
`not_observed` result:

```json
{
  "modelId": "789012",
  "name": "500g - Pha Phin",
  "availability": "unknown",
  "priceObservation": {
    "status": "not_observed",
    "reason": "variation_response_missing"
  }
}
```

Only `priceObservation.status = observed` with a validated positive safe
integer VND amount creates a `price_logs` row. `not_observed` is state metadata,
not a null-price record.

## Persistence

`product_variants` stores the current lifecycle:

```text
lifecycle_status: active | suspected_missing | inactive
last_seen_at
consecutive_complete_misses
missing_since
inactive_reason
current_availability
availability_updated_at
```

Availability remains separate from lifecycle:

```text
available | sold_out | unavailable | unknown
```

The initial schema should use `lifecycle_status` as the single lifecycle source
of truth rather than keeping a second `is_active` flag.

Each `price_checks` record also stores coverage, confidence, expected,
observed, and priced counts, plus whether the check was quarantined as
suspicious.

A `variant_check_results` record stores the result for each known variant
during a check:

```text
check_id
variant_id
presence: present | absent | unknown
price_status: observed | not_observed
availability
reason_code
lifecycle_eligible
```

This table records gaps and reasons without polluting `price_logs`. All product,
variant, check-result, price-log, and lifecycle changes run in one database
transaction.

Lifecycle timestamps use the server's persisted check time. The client
`capturedAt` remains provenance but cannot control lifecycle time.

## Lifecycle algorithm

### Variant positively present

For every variant identity contained in any valid snapshot:

```text
lifecycle_status = active
consecutive_complete_misses = 0
missing_since = null
inactive_reason = null
last_seen_at = server check time
```

Positive presence may reactivate a suspected or inactive variant even when the
snapshot coverage is partial. If no valid price was observed, no price log is
created.

The first valid price after a variant returns from `suspected_missing` or
`inactive` is a new comparison baseline and does not send a price-drop alert.

### Variant unmentioned in partial or unknown coverage

Do not change its lifecycle, miss counter, last-seen time, or availability.
Record its per-check presence as `unknown` when a check-result row is needed
for history.

Partial, unknown, and failed checks neither increment nor reset a missing
counter. They are not evidence about an unmentioned variant.

### Variant absent from verified complete coverage

For each previously known, non-inactive variant absent from a lifecycle-eligible
snapshot:

1. Increase `consecutive_complete_misses`.
2. Set `missing_since` on the first eligible miss.
3. Use `suspected_missing` below the configured threshold.
4. Use `inactive` at or above the threshold.
5. Set `inactive_reason = missing_from_verified_complete_snapshots` only when
   it becomes inactive.
6. Create no price log and no price-drop comparison.

Default:

```text
VARIANT_MISSING_THRESHOLD=3
```

Inactive variants remain stored with all historical prices. They are deleted
only when their parent product is explicitly deleted.

## Suspicious mass disappearance

Before applying individual miss counters, calculate:

```text
missingRatio =
  missingKnownNonInactiveVariantCount /
  max(knownNonInactiveVariantCount, 1)
```

Default:

```text
MAX_VARIANT_MISSING_RATIO=0.5
VARIANT_MASS_MISSING_CONFIRMATIONS=2
```

When the ratio is greater than the configured maximum:

1. Mark the check suspicious.
2. Hash the sorted observed variant-ID set.
3. Do not change normal lifecycle miss counters on the first occurrence.
4. Advance the mass-disappearance confirmation only when the next verified
   complete snapshot has the same set hash.
5. Once the confirmation threshold is reached, treat that confirming snapshot
   as miss number one.
6. Continue normal missing counting on later matching verified complete
   snapshots.
7. Reset the pending mass-disappearance state when variants reappear or a
   different verified complete set is observed.

With the defaults, a mass disappearance requires two matching observations to
clear the safeguard and two further eligible misses before becoming inactive.
The defaults are configurable and should be revisited using real sanitised
fixtures.

Every lifecycle evaluation is tied to one distinct persisted price check.
Duplicate or replayed extension submissions must not increment counters more
than once.

## Sold-out variants

A variant present in the catalogue remains `active` when it is sold out. Its
availability becomes `sold_out`.

A valid displayed price may be stored with `availability = sold_out`, but it
is not eligible for a price-drop notification. An unmentioned variant's
availability never changes because of a partial or unknown snapshot.

## Charts and dashboard

Price charts use only real `price_logs` amounts. Check-result rows let the
history API align each dataset with check timestamps and return `null` for a
known gap. Chart.js uses `spanGaps: false` so the UI does not draw an invented
continuous price through missing observations.

The dashboard shows lifecycle independently from the chart:

- `Active`
- `Price not collected in latest check`
- `Suspected missing since <time>`
- `Inactive; last seen <time>`
- `Sold out`

For suspected or inactive variants, the most recent valid price may be shown
only as `Last known price`. It is not copied forward as a new observation.

## Required tests

- Complete catalogue contains a variant but its price is not observed.
- Partial response omits known variants.
- First and second eligible misses produce `suspected_missing`.
- Third eligible miss produces `inactive`.
- Inactive variant reappears and becomes active.
- First price after reactivation creates no alert.
- Sold-out variant remains active.
- Duplicate snapshot does not increment misses twice.
- Suspicious mass disappearance is quarantined.
- Two matching mass-disappearance snapshots start miss counting at one.
- Price chart emits a gap without storing a zero or null price log.
- Transaction failure rolls back check results and lifecycle changes.
