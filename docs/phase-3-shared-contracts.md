# Phase 3 — Shared Data Contracts

Status: **complete — verified 2026-07-30**

## Purpose

`@shopee-price-tracker/shared` is the single validation boundary for data
exchanged by the Chrome extension, preserved Playwright tooling and backend.
All schemas are strict Zod schemas: undeclared fields such as raw Shopee
responses, cookies, request headers or debug payloads are rejected.

Import contracts through the package entry point:

```js
import {
  productSnapshotSchema,
  loginRequestSchema,
  trackProductRequestSchema,
} from '@shopee-price-tracker/shared';
```

The documented example is
[`packages/shared/examples/valid-product-snapshot.json`](../packages/shared/examples/valid-product-snapshot.json).

## Snapshot contract

Every accepted product snapshot has `schemaVersion = 1`, Shopee shop/item IDs,
a canonical HTTPS `shopee.vn` product URL, a valid capture timestamp, VND
currency, collection provenance, catalogue evidence and at least one variant.

Collector and pricing context are fixed pairs:

| Snapshot source | Pricing context  | Meaning                                             |
| --------------- | ---------------- | --------------------------------------------------- |
| `extension`   | `user_session` | Price observed in the user's active Chrome session  |
| `playwright`  | `anonymous`    | Price observed in a fresh anonymous browser context |

Each snapshot includes an opaque application-generated `pricingContextKey`.
It must not contain a Shopee account ID or credential. The enum retains
`unknown` for explicitly designed legacy/diagnostic records, but new product
snapshots reject it.

## Price observations

An observed price requires:

- a positive safe-integer VND amount
- `priceType = listed`
- `priceDefinition = displayed_post_voucher_excluding_shipping`
- a known price source
- voucher status
- `shippingIncluded = false`

A `not_observed` result requires a lowercase reason code and cannot contain a
price amount or any other observed-price field. Missing and malformed prices
therefore cannot become zero-price history.

## Variant identity and coverage

Explicit Shopee variants use a positive numeric model ID and
`identityType = shopee_model`. The synthetic `default` identity is accepted
only when all of these are true:

1. It is the only snapshot variant.
2. Its name is `Default`.
3. Its identity type is `synthetic_default`.
4. Catalogue coverage is `complete` and confidence is `verified`.
5. Expected and observed counts both equal one.

Coverage rules:

| Coverage     | Confidence          | Lifecycle eligible |
| ------------ | ------------------- | ------------------ |
| `complete` | `verified`        | yes                |
| `complete` | `likely_complete` | no                 |
| `partial`  | `partial`         | no                 |
| `unknown`  | `unknown`         | no                 |

`observedVariantCount` must equal the number of variants in the snapshot.
`pricedVariantCount` must equal the number of `observed` prices. Complete
coverage also requires equal expected and observed counts.

## Authentication contract

The confirmed password boundary is 15–128 Unicode code points. Spaces and
Vietnamese text are allowed; control characters and all-whitespace values are
rejected. Common/breached-password checks and scrypt hashing belong to the
Phase 5 authentication service.

Authentication supports two clients:

- Dashboard sessions use an HTTP-only cookie. Dashboard response bodies never
  contain the raw token.
- Extension sessions use an opaque bearer token. The token is returned only in
  the extension login/registration session response.

The shared session-request schema validates credentials after middleware
extracts them from the cookie or `Authorization` header. Logout and current-user
request bodies are empty. Token generation, hashing, persistence, expiry and
revocation begin in Phases 4–6.

## API boundary

The package provides strict schemas for:

- standard success and error envelopes
- product tracking and snapshot requests
- product ID parameters
- product pagination and history queries
- pause/resume and alert-threshold updates
- registration, login, session, logout and current-user contracts

Database-backed product response bodies are added after the Phase 4 storage
model fixes their internal representation.

## Verification

Run the focused contract tests:

```powershell
npm.cmd run test:phase3
```

The Phase 3 suite also validates normalised output from the sanitised Phase 1
multi-variant and variantless live fixtures.

Final verification passed:

- 65 focused Phase 3 assertions across five shared-contract test files
- 80 total Vitest assertions across eight files
- all preserved Phase 1 tests, including both browser integrations
- ESLint and Prettier checks
- Manifest V3 extension build
- npm security audit with zero reported vulnerabilities
