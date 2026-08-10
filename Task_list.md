# Shopee Price Tracker MVP

## Phased Development Roadmap

---

# Phase 0 — Confirm MVP Scope and Technical Decisions

## Objective

Define exactly what the MVP will and will not support before implementation begins.

## Tasks

### Product decisions

* Confirm that Shopee Vietnam is the only supported platform in the MVP.
* Confirm that the tracked price is:

> The price displayed to the user after applicable vouchers and discounts, but before shipping fees.

* Confirm that prices are tracked at variant level.
* Confirm that the system stores price history.
* Confirm that the system sends Telegram alerts for qualifying price drops.
* Confirm that the Chrome extension is the preferred collector for prices shown in the user’s active Shopee session.
* Confirm that Playwright is used for scheduled backend checks.
* The confirmed first release is local-only.
* Build price-tracker user accounts and revocable sessions in the MVP, but
  leave authentication enforcement disabled by default for local testing.
* Chrome Web Store publication, mandatory authentication and multi-device sync
  are future phases that require a hosted backend.

### Pricing-context decisions

Define the supported pricing contexts:

* `user_session`
* `anonymous`

Confirm that prices from different contexts will not be directly compared.
`dedicated_profile` is not supported: Playwright must not authenticate a Shopee
account or reuse a persistent browser profile.

### Technical decisions

Select and document:

* Node.js version.
* JavaScript or TypeScript.
* Package manager: npm, pnpm or yarn.
* SQLite library.
* Testing framework.
* Logging library.
* Validation library.
* Deployment method.
* Application authentication mode and local bypass behavior.

Recommended MVP stack:

```text
Node.js 20+
TypeScript
Express
better-sqlite3
Zod
Playwright
Chrome Manifest V3
Chart.js
Tailwind CSS
node-cron
Vitest
Pino
```

## Deliverables

* Final MVP requirements document.
* Final price definition.
* Final repository structure.
* List of accepted limitations.
* List of postponed features.

## Exit condition

Do not begin implementation until the price definition, pricing contexts and system architecture are unambiguous.

---

# Phase 1 — Analyse the Existing Shopee Demo

## Objective

Convert the working demo into documented and testable extraction knowledge.

## Tasks

### Review the existing demo

* Identify which Shopee API responses are currently intercepted.
* Record the exact endpoint paths.
* Identify the field containing the displayed post-voucher price.
* Confirm whether the price belongs to:

  * The base product.
  * The selected variant.
  * A range of variants.
* Confirm the raw price scaling factor.
* Confirm whether shipping is stored separately.
* Confirm how vouchers are represented.
* Confirm how unavailable variants are represented.
* Confirm which response proves the complete variant catalogue.
* Keep catalogue presence separate from successful variant-price collection.
* Treat `select_variation_pc` as partial catalogue evidence by itself.

### Capture sanitised fixtures

Save sanitised examples for:

* Product without variants.
* Product with multiple variants.
* Product with a public discount.
* Product with a shop voucher.
* Product with a platform voucher.
* Product with a flash-sale price.
* Product where no voucher is applied.
* Product with an unavailable variant.
* Product whose complete model catalogue contains a variant whose price request
  fails.
* Partial selected-variation response that omits other known variants.
* Suspicious empty, truncated or mass-disappearance model catalogue.
* Product where the API request fails.
* Product where Shopee changes the response structure.

Remove:

* Cookies.
* Access tokens.
* User IDs.
* Request signatures.
* Authentication headers.
* Delivery addresses.
* Personal account information.

### Document field mappings

Create a mapping document such as:

```text
Product title:
response.data.item.title

Product image:
response.data.item.image

Variant ID:
response.data.item.models[].modelid

Variant name:
response.data.item.models[].name

Displayed post-voucher price:
response.data.price_breakdown.price.singlevalue

Raw-price scale:
100000
```

Do not rely on this example mapping unless it matches the actual captured response.

## Deliverables

* Sanitised JSON fixtures.
* Endpoint list.
* Field-mapping document.
* Raw-price conversion tests.
* Written explanation of voucher and shipping behaviour.

## Implementation status — 2026-07-26

Completed:

* [X] Captured and sanitised one live `user_session` fixture with a verified
  three-model `get_pc` catalogue and three selected-variation prices.
* [X] Documented the two endpoint paths and separated complete catalogue
  evidence from partial selected-variation evidence.
* [X] Verified the live displayed-price path
  `data.product_price.price.single_value`.
* [X] Verified the raw-price scale of `100000`.
* [X] Documented the captured public discount, null applied-voucher field,
  absent shipping field, and unknown availability evidence.
* [X] Added allowlist-based local fixture capture without headers, cookies,
  Shopee authentication data, addresses, or account fields.
* [X] Added derived fixtures for a failed variant price, partial variation
  response, suspicious empty catalogue, API failure, and unrecognised price
  shape.
* [X] Added offline fixture normalisation and raw-price tests.
* [X] Captured a live 93-model catalogue with two selected-variation prices
  and one exact product-detail fallback; retained all identities and classified
  the other 90 disabled selections as `not_observed`, not missing, sold out,
  or zero-priced.
* [X] Verified an applied platform-voucher price and its
  `price_breakdown.discount_breakdown` and `product_price.final_price_info`
  mappings.
* [X] Verified a no-public-discount product where
  `models[].price_before_discount = 0`; zero is treated as an absent optional
  comparison price, never as an observed price.
* [X] Captured a genuinely variantless product represented by one implicit
  Shopee model with empty tier and option labels; normalised it to the shared
  `default` variant with a verified product-detail fallback price.
* [X] Re-ran targeted multi-tier selection after clearing prior UI state;
  verified 12 exact model-price responses and 21 unavailable combinations
  while leaving 60 deliberately untargeted models lifecycle-neutral.
* [X] Captured an applied shop voucher across 40 exact model responses;
  verified `Shop Voucher Discount`, a populated `shop_voucher`, no platform
  voucher, and `voucher_type = 1`.
* [X] Captured an active flash-sale product with promotion type `302`; used the
  product-detail fallback only for the exact matching
  `price_single_model_id`, leaving five variants unpriced when their selection
  controls could not be collected.

All required Phase 1 live evidence is complete. Sold-out state and future real
response-shape changes remain optional hardening evidence.

See `docs/phase-1-shopee-analysis.md` for verified mappings, provenance, and
remaining evidence gaps.

## Exit condition

You must be able to convert a saved Shopee fixture into a normalised product snapshot without opening Shopee or Playwright.

---

# Phase 2 — Create the Project Foundation

Status: **complete — verified 2026-07-28**

## Objective

Set up a maintainable repository before implementing business logic.

## Tasks

### Initialise the repository

* Create the project directory.
* Initialise Git.
* Initialise the package manager.
* Add `.gitignore`.
* Add `.env.example`.
* Add a basic `README.md`.
* Configure development scripts.
* Configure testing.
* Configure linting and formatting.

### Create the monorepo structure

Create:

```text
apps/server
apps/extension
packages/shared
tests/fixtures
tests/unit
tests/integration
```

### Configure shared standards

* Configure ES modules or TypeScript.
* Configure ESLint.
* Configure Prettier.
* Configure Vitest.
* Configure environment validation.
* Configure structured logging.
* Configure `AUTH_ENABLED=false` for the default local workflow.
* Validate `AUTH_ALLOW_REGISTRATION` and `AUTH_SESSION_TTL_HOURS`.
* Reject non-loopback binding while authentication is disabled.
* Validate `VARIANT_MISSING_THRESHOLD`, `MAX_VARIANT_MISSING_RATIO`, and
  `VARIANT_MASS_MISSING_CONFIRMATIONS`.
* Add central error types.
* Add a standard API-response utility.

### Add package scripts

Include scripts for:

* Development server.
* Production server.
* Tests.
* Test watching.
* Database migration.
* Playwright installation.
* Extension build.
* Manual legacy anonymous Playwright connectivity test.

## Deliverables

* Installable project.
* Working development command.
* Working test command.
* Empty but correctly organised directory structure.
* Environment validation.

## Exit condition

The server starts, the test command succeeds and the extension can be built or loaded without implementing product tracking yet.

---

# Phase 3 — Implement Shared Data Contracts

Status: **complete — verified 2026-07-30**

## Objective

Ensure the extension, backend and preserved Playwright tooling use the same data format.

## Tasks

### Define shared schemas

Create schemas for:

* Shopee product URL.
* Product snapshot.
* Product variant.
* Price observation.
* Variant catalogue coverage and confidence.
* Per-variant check result.
* Pricing context.
* Price source.
* Voucher status.
* Availability status.
* API requests.
* API responses.
* Price-tracker registration, login, logout, session and current-user requests
  and responses.

### Define enums

Include:

```text
Pricing context:
user_session
anonymous
unknown

Price source:
variation_price_breakdown
verified_display_field
product_detail_fallback
dom_display_fallback
unknown

Voucher status:
applied
not_applied
unknown
not_available

Availability:
available
sold_out
unavailable
unknown

Variant coverage:
complete
partial
unknown

Coverage confidence:
verified
likely_complete
partial
unknown

Variant lifecycle:
active
suspected_missing
inactive

Variant presence:
present
absent
unknown

Price observation status:
observed
not_observed
```

### Implement validation

Validate:

* Positive integer price.
* Supported currency.
* Valid capture timestamp.
* Valid Shopee IDs.
* No shipping-inclusive observations.
* At least one valid variant identity, including a positively validated
  synthetic `default` variant for products without explicit models.
* Valid price-definition identifier.
* An `observed` price contains a valid positive amount.
* A `not_observed` price contains a reason and cannot contain a price amount.
* Expected, observed and priced variant counts are internally consistent.
* Only verified complete catalogue evidence is lifecycle-eligible.

### Add schema tests

Test:

* Valid snapshots.
* Invalid prices.
* Missing variants.
* Present variant with no observed price.
* Complete, partial and unknown catalogue coverage.
* Inconsistent coverage counts.
* Malformed empty model catalogue.
* Unsupported pricing context.
* Incorrect currency.
* Shipping included.
* Invalid timestamps.
* Missing product identifiers.

## Deliverables

* Shared validation package.
* Shared constants.
* Schema unit tests.
* Example valid snapshot.

## Exit condition

All data entering the backend can be validated using one shared contract.

---

# Phase 4 — Implement the Database Layer

Status: **complete — verified 2026-07-31**

## Objective

Create reliable persistence before implementing extraction workflows.

## Tasks

### Create the database schema

Implement tables for:

* Price-tracker users.
* Revocable application sessions.
* Products.
* Product variants.
* Price checks.
* Per-variant check results.
* Price logs.
* Notification events.

### Configure SQLite

Enable:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
```

### Create migrations

* Create the initial migration.
* Add migration execution on startup or through a command.
* Store schema version information.
* Prevent accidental duplicate migrations.

### Implement repositories

Create repositories for:

* User creation and lookup.
* Hashed session-token creation, lookup, expiry and revocation.
* Product creation and updates.
* Product retrieval.
* Variant upserts.
* Variant activation and deactivation.
* Variant lifecycle and reactivation.
* Per-check variant presence and price-collection results.
* Price-check creation.
* Price-log insertion.
* Latest comparable price queries.
* Historical price queries.
* Notification deduplication.
* Product deletion.
* Owner-scoped queries for every product operation.

### Use transactions

Save the following as one transaction:

1. Product update.
2. Variant updates.
3. Price-check record.
4. Per-variant check results.
5. Price logs.
6. Missing-variant lifecycle state changes.
7. Suspicious mass-disappearance confirmation state.

### Add database tests

Test:

* Local reserved-user creation.
* User insertion and duplicate email rejection.
* Session creation, expiry and revocation.
* Owner isolation.
* Product insertion.
* Duplicate product upsert.
* Variant rename.
* New variant.
* Removed variant.
* Present variant with a missing price.
* Consecutive complete-snapshot miss counting.
* Partial snapshot lifecycle neutrality.
* Variant reactivation.
* Suspicious mass-disappearance quarantine and confirmation.
* Duplicate-check idempotency.
* Price history.
* Transaction rollback.
* Cascade deletion.
* Latest-price query.
* Pricing-context separation.

## Deliverables

* Database migration.
* Database connection module.
* Repository modules.
* Integration tests.

## Implementation status — 2026-07-31

Completed:

* [X] Added the Node.js 20-compatible `better-sqlite3` dependency and one
  shared connection with foreign keys, WAL and a busy timeout.
* [X] Added an ordered initial migration, migration metadata, checksum
  verification, duplicate detection, transactional application and
  `user_version` tracking.
* [X] Added owner-scoped users, revocable hashed sessions, products, variants,
  checks, per-variant results, real price logs and notification events.
* [X] Persisted pricing definition, context, context key, source, voucher,
  shipping exclusion, catalogue evidence and lifecycle state.
* [X] Added explicit variant presence, eligible-miss, reactivation and
  suspicious mass-disappearance persistence operations.
* [X] Added product-scoped check idempotency and exact successful-transition
  notification deduplication.
* [X] Added repository factories and a synchronous atomic transaction boundary
  for the future tracking service.
* [X] Added 22 focused integration assertions covering migration safety, local
  user and sessions, owner isolation, upserts, lifecycle, history, rollback,
  failed checks, deduplication and cascade deletion.

See `docs/phase-4-database-layer.md` for the schema and repository boundary.

## Exit condition

A normalised snapshot can be saved and retrieved correctly without using the extension or Playwright.

---

# Phase 5 — Implement Core Backend Services

Status: **complete — verified 2026-08-01**

## Objective

Create the business-logic layer independently from HTTP routes.

## Tasks

### Tracking service

Implement logic to:

* Validate a product snapshot.
* Upsert the product.
* Upsert variants.
* Create a price check.
* Store a per-check presence and price-collection result for known variants.
* Store only validated observed prices.
* Reset lifecycle state for positively present variants even when their price
  was not observed.
* Ignore absent variants from partial, unknown, failed and suspicious
  snapshots.
* Mark variants `suspected_missing` after eligible misses and `inactive` only
  after the configured threshold.
* Quarantine suspicious mass disappearance until the same verified variant set
  passes the configured confirmation count.
* Reactivate returning variants and treat their first price as a new baseline.
* Return a complete stored product summary.

### Price-comparison service

Implement logic to:

* Find the previous comparable price.
* Require matching variant.
* Require matching currency.
* Require matching price definition.
* Require compatible pricing context.
* Require matching pricing-context key where applicable.
* Reject invalid or unavailable observations.
* Calculate price-drop percentage.
* Apply the configured alert threshold.
* Avoid initial-observation alerts.
* Prevent duplicate transition alerts.

### Product-query service

Implement:

* Product listing.
* Product details.
* Latest prices.
* Lowest active price.
* Variant history.
* Chart-ready data.
* Null chart gaps derived from per-variant check results, without null or zero
  price-log rows.
* Current lifecycle, last-seen, missing-since, availability and last-known-price
  labels.
* Pagination.

### Authentication service

Implement:

* Email/password price-tracker registration.
* Salted memory-hard password hashing.
* Credential verification without timing-sensitive comparisons.
* Cryptographically random opaque sessions.
* Hashed session-token persistence.
* Current-user lookup.
* Logout and session revocation.
* A reserved local user when `AUTH_ENABLED=false`.
* No Shopee credential handling.

### Add service tests

Test:

* Initial observation.
* Normal price reduction.
* Price increase.
* No price change.
* Reduction below threshold.
* Reduction above threshold.
* Different pricing context.
* Different price source.
* Voucher removal.
* Missing price.
* Unavailable variant.
* Sold-out variant.
* Present variant with a failed price observation.
* Partial snapshot omitting known variants.
* Consecutive verified complete misses.
* Mass-disappearance confirmation.
* Reactivation without an immediate price-drop alert.
* Chart gap without a null or zero price log.
* Duplicate observation.
* Registration and login.
* Invalid credentials.
* Expired and revoked sessions.
* Authentication-disabled local-user resolution.

## Deliverables

* Tracking service.
* Price-comparison service.
* Product-query service.
* Authentication service.
* Unit and integration tests.

## Implementation status — 2026-08-01

Completed:

* [X] Added strict shared-snapshot validation before persistence and a
  deterministic SHA-256 idempotency key for exact snapshot replays.
* [X] Added one synchronous tracking transaction for product and variant
  upserts, grouped checks, per-variant results, real prices, lifecycle changes,
  and suspicious mass-disappearance confirmation.
* [X] Added exact comparable-price selection by variant, currency, definition,
  type, pricing context, context key, and price source, including threshold and
  successful-transition deduplication policy.
* [X] Added owner-scoped product summaries, details, pagination, per-context
  latest and lowest prices, user-session display priority, and check-aligned
  Chart.js points with real gaps.
* [X] Added price-tracker registration, login, current-user, logout, revocation,
  expiry, reserved-local-owner resolution, an offline common-password denylist,
  versioned asynchronous scrypt hashes, and opaque hashed sessions.
* [X] Added 25 focused Phase 5 assertions covering service policy, rollback,
  authentication, contexts, lifecycle, comparisons, queries, and chart gaps.

See `docs/phase-5-core-services.md` for service contracts and Phase 6 handoff.

## Exit condition

Business logic works using fixture snapshots without HTTP, Playwright or extension dependencies.

---

# Phase 6 — Build the Backend REST API

Status: **complete — verified 2026-08-01**

## Objective

Expose the application’s core operations through stable endpoints.

## Tasks

### Server setup

* Create the Express server.
* Add JSON body-size limits.
* Add Helmet.
* Add CORS configuration.
* Add request IDs.
* Add request logging.
* Add rate limiting.
* Add disabled-by-default application authentication middleware.
* Require a valid price-tracker session when `AUTH_ENABLED=true`.
* Resolve the reserved local user when `AUTH_ENABLED=false`.
* Fail startup if unauthenticated mode binds outside loopback.
* Add central error handling.
* Add a health endpoint.

### Implement endpoints

Create:

```text
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/products/track
POST   /api/products/snapshot
GET    /api/products
GET    /api/products/:productId
GET    /api/products/:productId/history
POST   /api/products/:productId/refresh
PATCH  /api/products/:productId
DELETE /api/products/:productId
GET    /api/health
```

### Snapshot endpoint

The extension snapshot endpoint must:

* Validate the complete request.
* Reject raw Shopee response payloads.
* Reject Shopee cookies, Shopee authentication data and raw response fields.
* Save the snapshot transactionally.
* Persist catalogue coverage and per-variant check results.
* Never trust a missing variant unless the normalised evidence is verified and
  complete.
* Run price comparison.
* Return the stored product summary.

### Add API tests

Test:

* Valid request.
* Invalid URL.
* Invalid snapshot.
* Duplicate product.
* Product retrieval.
* Pagination.
* History filtering.
* Pause and resume.
* Product deletion.
* Unknown product.
* Oversized request.
* Rate-limit response.
* Registration and login.
* Logout and revoked-session rejection.
* Owner isolation.
* Protected routes with authentication enabled.
* Frictionless product routes with authentication disabled.

## Deliverables

* Working REST API.
* API validation.
* API tests.
* Health-check endpoint.

## Implementation status — 2026-08-01

Completed:

* [X] Added the complete `/api/auth`, `/api/products`, and `/api/health` route
  surface with thin controllers, shared Zod request validation, and standard
  success/error envelopes.
* [X] Added Helmet with a restrictive CSP, a 64 KiB JSON limit, exact-origin
  CORS, request IDs, structured completion logs, mutation throttling, and
  stricter authentication throttling.
* [X] Added disabled-mode reserved-local ownership and enabled-mode dashboard
  cookie or extension bearer authentication without accepting owner IDs from
  clients.
* [X] Kept dashboard tokens out of JSON responses and persisted only token
  hashes; extension tokens are returned once and accepted only through the
  bearer transport.
* [X] Added owner-scoped listing, details, filtered history, pause/resume,
  threshold updates, deletion, transactional snapshots, duplicate URL lookup,
  and refresh coordination.
* [X] Added an explicit future-collector seam. Phase 8 later replaced the
  unavailable response with persistent logged-in extension collection jobs.
* [X] Added 15 focused Phase 6 integration assertions covering the required
  API, authentication, privacy, validation, throttling, and isolation cases.

See `docs/phase-6-rest-api.md` for endpoint behavior and the Phase 7/8 handoff.

## Exit condition

Fixture snapshots can be posted through the API and viewed through the products and history endpoints.

---

# Phase 7 — Build the Chrome Extension Collector

## Objective

Capture the actual price displayed to a user in their active Shopee session.

## Tasks

### Create Manifest V3 configuration

Configure:

* Supported Shopee host permissions.
* Backend permissions.
* Service worker.
* Content scripts.
* Page-world interceptor.
* Popup.
* Options page.
* Extension icons.
* Content Security Policy.

### Implement the page interceptor

* Run at `document_start`.
* Run in the page’s `MAIN` world.
* Wrap `fetch`.
* Wrap `XMLHttpRequest`.
* Preserve original Shopee functionality.
* Inspect only configured endpoints.
* Clone responses before parsing.
* Extract required pricing fields.
* Extract only sanitised catalogue-coverage evidence needed by the normaliser.
* Ignore unrelated API responses.
* Send sanitised messages through `window.postMessage`.

### Implement the content bridge

* Verify `event.source`.
* Verify Shopee hostname.
* Verify protocol version.
* Validate the payload.
* Normalise the response.
* Keep model presence separate from price-observation success.
* Mark `select_variation_pc` as partial coverage unless a verified product
  catalogue is part of the assembled snapshot.
* Deduplicate rapid events.
* Forward snapshots to the service worker.

### Implement service-worker queueing

* Receive normalised snapshots.
* Save pending records to `chrome.storage.local`.
* Send snapshots to the backend.
* Retry temporary failures.
* Stop retrying permanent failures.
* Remove successfully submitted records.
* Track the last submission status.
* Add the price-tracker application session only when authentication is
  enabled.
* Never capture or forward Shopee authentication data.

### Implement popup UI

Display:

* Supported-page state.
* Captured product title.
* Current displayed price.
* Selected variant.
* Voucher status.
* Backend connection status.
* Track button.
* Open-dashboard link.

### Implement options page

Allow configuration of:

* Backend URL.
* Automatic capture setting.
* Debug mode.
* Local pricing-context identifier.
* Price-tracker sign-in, sign-out and account status controls that remain
  hidden while backend authentication is disabled.

### Test manually

Verify:

* Initial page load.
* Variant change.
* Voucher change.
* Quantity change.
* Dynamic price refresh.
* Duplicate-response handling.
* Backend temporarily unavailable.
* Browser restart with queued snapshot.
* Unsupported page.
* Authentication enabled and disabled.
* Revoked price-tracker session.

Implementation status (2026-08-01):

* [X] Added the loadable MV3 manifest, `MAIN` fetch/XHR interceptor, isolated
  validated bridge, shared capture schemas/normaliser, persistent bounded
  service-worker queue, popup, options, local icons, and bundled build.
* [X] Kept automatic capture off by default and generated the opaque local
  pricing-context key per installation.
* [X] Added 22 focused assertions for capture privacy, catalogue/price
  correctness, interceptor preservation, queue policy, and settings, plus the
  manifest-reference and remote-code build validation.
* [ ] Complete the live Chrome scenarios in
  `docs/phase-7-chrome-extension.md` before treating the Phase 7 exit condition
  as manually verified.

## Deliverables

* Loadable Chrome extension.
* Page interceptor.
* Content bridge.
* Persistent submission queue.
* Popup and options page.
* Manual extension test checklist.

See `docs/phase-7-chrome-extension.md` for the implemented boundaries, queue
semantics, authentication behavior, setup, and manual checklist.

## Exit condition

Visiting a supported Shopee product page can create a valid `user_session` price observation in the backend without sending cookies or authentication tokens.

---

# Phase 8 — Implement the Logged-in Chrome Session Collector

## Objective

Provide manual and future scheduled price checks through the user's installed
extension and exact logged-in Chrome profile. Do not use anonymous Playwright
for production collection.

## Tasks

### Implement persistent collection jobs

* Validate and canonicalise Shopee product URLs before queueing work.
* Persist owner-scoped jobs for new-product tracking and product refreshes.
* Return accepted job state without keeping an HTTP request open while Chrome
  is unavailable.
* Prevent duplicate pending or claimed jobs for the same owner and product.
* Claim jobs atomically with a bounded lease.
* Accept completion or failure only from the extension that owns the lease.
* Keep completed and failed job state available for dashboard status.

### Bind collection to one Chrome profile

* Use the extension installation's opaque `pricingContextKey` as the collector
  identity; never store a Shopee account identifier.
* Allow an unbound new-product job to be claimed by the first local extension
  that opts in or explicitly checks for work.
* Bind retries and refresh jobs to the same `pricingContextKey` that previously
  claimed or collected the product.
* Never let another Chrome profile silently claim a bound job.
* Keep submitted snapshots as `extension` + `user_session` observations so
  incompatible Shopee sessions are never compared.

### Poll only after explicit opt-in

* Add an `Allow background price checks` extension setting.
* Keep background collection disabled by default.
* Poll every 30 minutes by default while Chrome is running.
* Poll once when Chrome starts after opt-in; allow an explicit one-time check
  even while periodic polling is disabled.
* Do not create a Chrome window when no normal browser window exists.

### Collect through an inactive user-profile tab

* Open the product in the existing Chrome profile with `active: false`.
* Never focus the temporary tab or take over the user's current page.
* Register capture logic before the product request runs.
* Reuse the extension's sanitised product-detail and variation capture flow.
* Select variants sequentially through the rendered Shopee controls.
* Correlate selected-variation responses by exact `selected_tiers`.
* Preserve verified catalogue identities when an individual price is not
  observed; never create a zero price.
* Close the temporary tab after success, failure or timeout.

The temporary tab may appear briefly in Chrome's tab strip. Chrome extensions
cannot load an authenticated external Shopee page in a fully invisible
offscreen tab.

### Detect login and collection failures

Support invalid URLs, unavailable products, timeouts, invalid payloads, rate
limits, Shopee authentication requirements, and extension unavailability.

When Shopee authentication is required:

* Move the job to `waiting_auth` without storing a price check, consuming a
  retry attempt, or creating a zero price.
* Show a Chrome notification.
* Set an extension badge and popup/options status.
* Ask the user to sign in to Shopee in the same Chrome profile and click
  **Check now** to resume the same job.
* Do not add email notification delivery in Phase 8.

### Add collector tests

Use mocked Chrome APIs and sanitised fixtures. Automated tests must not require
live Shopee access, a real Chrome profile, or Shopee credentials.

Implementation status (2026-08-02):

* [x] Added persistent jobs, duplicate prevention, atomic profile claims, hashed
  lease tokens, expiry recovery, and strict completion/failure validation.
* [x] Bound retries and refreshes to the same opaque extension context key while
  allowing only the first polling extension to claim a new unbound URL.
* [x] Added explicit opt-in background collection, a configurable 30-minute
  default poll, startup/manual polling, and inactive-tab creation in the
  last-focused normal Chrome window.
* [x] Reused the sanitised product/variation capture pipeline, added sequential
  rendered-control selection, and closed temporary tabs after completion,
  failure, or timeout.
* [x] Added safe authentication-status classification, Chrome notification,
  badge and popup/options status, plus fixture-driven API and mocked-Chrome
  tests.
* [x] Optimised first-time tracking into one explicit **Track & collect
  available prices** action with targeted durable jobs, inactive-tab collection,
  variant progress, and truthful complete/partial/no-price coverage.
* [x] Added a dedicated no-visible-variant path: accept only exact model-matched
  evidence, allow explicit unavailable state, and retry available or unknown
  products with `PRICE_SELECTOR_TIMEOUT` instead of completing as 0/1 priced.
* [x] Recognised both observed `get_pc` product-price layouts for the dedicated
  path (`data.pricing.data.product_price` and `data.product_price`) while
  requiring `price_single_model_id` correlation and discarding voucher details.
* [x] Ranked allowlisted price containers so a weaker or uncorrelated
  `price_breakdown` cannot hide an exact model-matched `product_price`.
* [x] Ranked duplicate same-product `get_pc` captures so weaker evidence cannot
  erase an exact model-matched price or compatible selected-variation captures.
* [x] Reconciled targeted manual-job IDs after concurrent polls so terminal jobs
  cannot leave the popup permanently queued, real retry-wait jobs retain their
  alarm, and an explicit request can move an unclaimed job from an obsolete
  extension context without taking over a live lease.
* [ ] Complete the live Chrome-profile checklist in
  `docs/phase-8-chrome-session-collector.md` before marking the exit condition
  complete.

## Deliverables

* Persistent collection-job API.
* Opt-in extension polling.
* Inactive-tab session collector.
* Authentication-required user notification.
* Fixture-driven server and extension tests.
* Manual live-test checklist.

## Exit condition

With background collection enabled and Shopee signed in in that Chrome profile,
a queued manual refresh can retrieve and store a valid `user_session` price
without focusing the temporary tab, leaking Shopee credentials or leaving the
temporary tab open.

---

# Phase 9 — Implement Scheduled Price Checks

Status: **implementation complete — live Chrome verification pending 2026-08-07**

## Objective

Automatically refresh tracked products without overlapping jobs or corrupting price history.

## Tasks

### Configure the scheduler

* Read the cron schedule from the environment.
* Allow the scheduler to be disabled.
* Prevent overlapping scheduler runs.
* Generate a job-run ID.
* Retrieve only active products.
* Queue bound extension collection jobs instead of launching anonymous
  Playwright.

### Process products safely

* Process sequentially in the MVP.
* Add random delay between products.
* Apply collection-job timeout and lease expiry.
* Apply bounded retry for temporary failures.
* Continue after an individual product failure.
* Record every successful or terminal failed check. Retry and authentication
  waits do not create check rows.
* Update product check status.

### Handle variant changes

* Add newly discovered variants.
* Update renamed variants.
* Apply the verified-complete, consecutive-miss lifecycle policy.
* Use the default three-miss threshold.
* Quarantine disappearance above the default 50 percent ratio until two
  identical verified catalogues confirm it; count the confirming check as miss
  one.
* Treat partial, unknown, failed and suspicious checks as neutral for
  unmentioned variants.
* Reactivate returning variants automatically.
* Preserve historical data.
* Do not delete historical variants automatically.

### Add graceful shutdown

Handle:

* `SIGINT`
* `SIGTERM`
* Active collection-job cleanup.
* Database closure.
* Scheduler shutdown.

### Add scheduler tests

Test:

* Scheduler disabled.
* Overlapping-run prevention.
* Sequential processing.
* One product failure.
* Retry success.
* Permanent failure.
* Graceful shutdown.
* Final summary logging.

## Implementation status — 2026-08-07

Completed:

* [x] Added validated `node-cron` configuration, disabled mode, one process-level
  run lock, job-run IDs, active-only product selection, sequential dispatch,
  random inter-product delay, and structured final summaries.
* [x] Kept production collection asynchronous and profile-bound: cron queues
  extension refresh jobs and never launches anonymous Playwright or waits for
  Chrome.
* [x] Added `retry_wait` and `waiting_auth` persistent states, four total
  attempts by default, lease-expiry recovery, and capped exponential backoff
  with additive jitter.
* [x] Classified transport, timeout, rate-limit, Shopee 5xx, and premature-tab
  failures as retryable; classified URL, unavailable-product, suspended-shop,
  invalid-payload, and schema failures as terminal.
* [x] Kept `AUTHENTICATION_REQUIRED` out of failed checks and automatic retry:
  the extension alerts the user and resumes only after sign-in and an explicit
  **Check now** action.
* [x] Persisted one idempotent failed check only for a terminal refresh failure,
  updated product error state, and guaranteed that failed paths create no price
  logs or variant-lifecycle misses.
* [x] Added extension queue draining, backend-report retry persistence,
  premature-tab-close detection, and duplicate tab-removal protection.
* [x] Added idempotent `SIGINT`/`SIGTERM` shutdown that stops dispatch, interrupts
  delay, waits for the dispatch loop, destroys cron, closes HTTP, and closes the
  database. Claimed Chrome work remains lease-recoverable.
* [x] Added Phase 9 unit/integration coverage and a focused `test:phase9` script;
  the complete automated and retained legacy suites pass.
* [ ] Complete the live Chrome-profile checklist in
  `docs/phase-9-scheduled-checks.md` before marking the Phase 9 exit condition
  fully verified.

## Deliverables

* Working cron scheduler.
* Run-lock mechanism.
* Error recording.
* Scheduler tests.
* Job summary logs.

## Exit condition

A scheduled run can check multiple active products, record failures correctly and finish without leaving zombie browser processes.

---

# Phase 10 — Implement Telegram Notifications

Status: **implementation complete — live Telegram verification pending 2026-08-09**

## Objective

Send one reliable alert for each qualifying price-drop transition.

## Tasks

### Configure Telegram

* Read bot token from the environment.
* Read chat ID from the environment.
* Disable notifications safely when configuration is absent.
* Add a Telegram connection test command or endpoint.

### Implement message generation

Include:

* Product title.
* Variant name.
* Previous price.
* New price.
* Percentage reduction.
* Price definition.
* Pricing context.
* Product URL.

### Implement safe sending

* Escape user-controlled text.
* Add request timeout.
* Handle HTTP errors.
* Handle Telegram API errors.
* Retry temporary failures only.
* Do not retry permanent failures indefinitely.

### Prevent duplicates

* Check notification history.
* Save an event only after successful sending.
* Use variant, old price, new price and pricing context as deduplication inputs.

### Test notifications

Test:

* Valid price drop.
* Drop below threshold.
* Duplicate transition.
* Telegram disabled.
* Temporary Telegram failure.
* Permanent Telegram failure.
* Unsafe characters in product title.

## Implementation status — 2026-08-09

Completed:

* [x] Added optional paired bot-token/chat configuration, bounded request
  timeout, two-attempt default retry, capped exponential delay, and safe
  disabled mode.
* [x] Added an HTML-safe message formatter with product, variant, old/new VND
  prices, one-decimal reduction, price definition, pricing context, and URL.
* [x] Added an HTTPS Telegram Bot API client with defensive JSON handling,
  `retry_after` support, temporary/permanent classification, and typed
  `TELEGRAM_ERROR` failures without secret logging.
* [x] Added post-commit notification delivery for direct snapshots and leased
  extension refreshes. Delivery failure cannot roll back saved price history.
* [x] Serialised in-process sends, rechecked exact transition history before
  delivery, and persisted an event only after Telegram confirms success.
* [x] Added `npm.cmd run telegram:test` using `getMe` and `getChat` without
  sending a message.
* [x] Added focused unit and integration coverage for the required Phase 10
  cases.
* [ ] Complete the live bot/chat checklist in
  `docs/phase-10-telegram-notifications.md` before marking the exit condition
  fully verified.

## Deliverables

* Notification service.
* Message formatter.
* Deduplication logic.
* Notification tests.

## Exit condition

One qualifying price transition produces no more than one Telegram alert.

---

# Phase 11 — Build the Web Dashboard

## Objective

Allow users to manage tracked products and understand price history.

## Tasks

### Build the main layout

Create:

* Header.
* Price-tracker login and registration view, hidden when authentication is
  disabled.
* Track-product form.
* Product grid.
* Empty state.
* Loading states.
* Error messages.
* Responsive mobile layout.

### Build product cards

Display:

* Product image.
* Product title.
* Current lowest price.
* Last successful check.
* Pricing-context badge.
* Voucher-status badge.
* Price-source badge.
* Product status.
* Variant lifecycle and availability badges.
* Last-known-price label when the latest price was not observed.
* Manual-refresh button.
* Pause or resume button.
* History button.
* Delete button.

### Build history visualisation

* Load historical data from the API.
* Use one Chart.js dataset per variant and pricing context.
* Do not join incompatible contexts into one line.
* Build missing-observation gaps from per-variant check results.
* Use `null` only in the API/chart representation and `spanGaps: false`; never
  persist null or zero as a price.
* Format dates correctly.
* Format VND correctly.
* Destroy the existing chart before creating another.
* Support history filters.

### Build actions

Implement:

* Track product.
* Refresh product.
* Pause tracking.
* Resume tracking.
* View history.
* Delete with confirmation.
* Retry after failure.
* Sign in and sign out when authentication is enabled.

### Improve transparency

Show this explanation:

> Price shown by Shopee after applicable discounts and vouchers, excluding shipping fees.

Show warnings when:

* The price is anonymous.
* The price is a fallback.
* Voucher status is unknown.
* The latest check failed.
* A variant price was not collected in the latest check.
* A variant is suspected missing or inactive, including last-seen and
  missing-since times.
* A variant is sold out.
* The extension price differs from the scheduler price.

## Deliverables

* Responsive dashboard.
* Product-management controls.
* Historical chart.
* Pricing-context labels.
* User-friendly errors.

## Exit condition

A non-technical user can add a product, understand the current price, view its history and manage tracking from the dashboard.

---

# Phase 12 — End-to-End Testing and Hardening

## Objective

Verify that all parts work together under realistic conditions.

## Tasks

### Automated testing

Run:

* Unit tests.
* Repository tests.
* API integration tests.
* Schema tests.
* Price-comparison tests.
* Notification tests.
* Scheduler tests.
* Extension utility tests.

### Manual end-to-end scenarios

Test:

1. Track a new Shopee product from the dashboard.
2. Track the same product from the extension.
3. Select a different variant.
4. Apply or remove a voucher.
5. Restart the backend.
6. Confirm data persists.
7. Run a manual profile-bound extension refresh.
8. Run a scheduled extension-dispatched refresh.
9. Simulate a price drop.
10. Confirm one Telegram notification.
11. Repeat the same observation.
12. Confirm no duplicate notification.
13. Disconnect the backend.
14. Confirm extension queue persistence.
15. Reconnect the backend.
16. Confirm queued data submission.
17. Delete a product.
18. Confirm cascade deletion.
19. Test an unavailable product.
20. Test an invalid Shopee response.
21. Fail one variant-price request while its model remains in the full
    catalogue and confirm that it stays active without a price log.
22. Submit partial snapshots and confirm that omitted variants do not gain
    misses.
23. Submit three eligible complete misses and confirm the
    suspected-to-inactive lifecycle.
24. Simulate a mass disappearance and confirm quarantine, repeated-set
    confirmation, and delayed miss counting.
25. Reactivate a missing variant and confirm that its first price creates no
    alert.

### Security checks

Verify:

* No cookies leave the extension.
* No Shopee authentication headers are stored.
* Price-tracker session tokens are redacted from logs and only persisted by the
  extension when application authentication is enabled.
* No Telegram token appears in logs.
* No browser profile files are committed.
* Raw Shopee responses are not logged in production.
* Request bodies have size limits.
* Mutation endpoints are rate limited.
* Input validation rejects malformed data.
* Client-declared coverage cannot bypass normaliser coverage validation.

### Resource checks

Verify:

* Temporary extension tabs close.
* Response listeners are removed.
* Scheduler runs do not overlap.
* Database transactions roll back correctly.
* Extension queues have size limits.
* Duplicate snapshots cannot increment variant miss counters twice.

## Deliverables

* Test report.
* Bug list.
* Resolved security checklist.
* Resource-leak checklist.
* Final acceptance-criteria report.

## Exit condition

All acceptance criteria pass, or every remaining limitation is explicitly documented.

---

# Phase 13 — Documentation and Release Preparation

## Objective

Make the MVP installable and maintainable.

## Tasks

### Complete the README

Document:

* Product purpose.
* Price definition.
* System architecture.
* Installation.
* Environment variables.
* Disabled and enabled price-tracker authentication modes.
* Reserved local-user behavior.
* Session revocation.
* Database setup.
* Playwright installation.
* Extension installation.
* Extension backend configuration.
* Anonymous collector setup.
* Telegram configuration.
* Running tests.
* Running the scheduler.
* Troubleshooting.
* Known limitations.
* Privacy considerations.

### Add developer documentation

Document:

* Shared snapshot schema.
* Shopee endpoint adapter.
* Raw-price conversion.
* Pricing-context rules.
* Price-comparison rules.
* Variant lifecycle.
* Variant presence, price-observation gaps, and mass-disappearance safeguards.
* Fixture sanitisation.
* Adding future marketplaces.

### Prepare release files

* Finalise `.env.example`.
* Finalise `.gitignore`.
* Remove debug logs.
* Remove test credentials.
* Verify production configuration.
* Create a release tag.
* Export the unpacked extension build.
* Back up the initial database schema.

## Deliverables

* Complete README.
* Setup guide.
* Developer guide.
* Troubleshooting guide.
* Release build.
* Versioned MVP release.

## Exit condition

Another developer can install and run the complete system using only the repository documentation.

---

# Phase 14 — MVP Deployment

## Objective

Run the application reliably in its intended environment.

## Local-only deployment tasks

* Install Node.js.
* Install Chromium for Playwright.
* Configure `.env`.
* Keep `AUTH_ENABLED=false` for the local testing deployment.
* Run migrations.
* Start the backend using a process manager.
* Load the extension.
* Configure database backups.
* Verify scheduler execution.

## Hosted-backend deployment tasks

* Select a server or container platform.
* Configure HTTPS.
* Restrict allowed origins.
* Add API authentication between extension and backend.
* Store secrets securely.
* Configure persistent SQLite storage.
* Configure daily database backups.
* Configure logs and retention.
* Configure health monitoring.
* Test backend restart recovery.

## Important SQLite condition

Use SQLite only when the MVP runs as one application instance with persistent local storage.

Do not deploy SQLite to an environment where:

* The filesystem is temporary.
* Multiple server instances write to separate database copies.
* The platform frequently destroys local files.

## Deliverables

* Running MVP environment.
* HTTPS configuration when hosted.
* Backup procedure.
* Recovery procedure.
* Deployment documentation.

## Exit condition

The application survives server restarts, retains price history and performs scheduled checks successfully.

# Suggested MVP Milestones

## Milestone 1 — Data foundation

Complete:

* Phases 0–4.

Result:

* Shopee fixtures can be converted into validated snapshots and stored in SQLite.

## Milestone 2 — Working backend

Complete:

* Phases 5–6.

Result:

* Products and price history can be managed through the REST API.

## Milestone 3 — User-session collection

Complete:

* Phase 7.

Result:

* The extension captures the actual price displayed in the user’s Shopee session.

## Milestone 4 — Automated collection

Complete:

* Phases 8–9.

Result:

* The backend performs manual and scheduled price checks.

## Milestone 5 — Alerts and dashboard

Complete:

* Phases 10–11.

Result:

* Users can view price history and receive Telegram price-drop alerts.

## Milestone 6 — Release candidate

Complete:

* Phases 12–14.

Result:

* The MVP is tested, documented and deployable.

---

# Tasks That Should Not Block the MVP

Postpone these until after the MVP is stable:

* Amazon support.
* Taobao support.
* Publicly enabling registration and mandatory authentication.
* Hosted authenticated multi-device sync.
* Chrome Web Store publication.
* Email notifications.
* Push notifications.
* Mobile applications.
* Browser support outside Chrome.
* Advanced voucher recommendation.
* Automatic coupon claiming.
* Shipping-price tracking.
* Product search.
* Product recommendations.
* Affiliate integration.
* Proxy rotation.
* Anti-detection browser systems.
* Distributed scraping workers.
* PostgreSQL migration.
* Machine-learning price prediction.
* Native mobile notifications.
* Price-comparison across marketplaces.

---

# Final MVP Completion Checklist

The MVP is complete when:

* [ ] A Shopee URL can be added from the dashboard.
* [ ] A product can be captured from the Chrome extension.
* [ ] The extension captures the displayed post-voucher price.
* [ ] Shipping is excluded.
* [ ] Prices are stored per variant.
* [ ] Prices are stored as integer VND values.
* [ ] Pricing contexts are stored.
* [ ] Incompatible pricing contexts are not compared.
* [ ] Product history survives application restarts.
* [ ] Manual profile-bound extension refresh works.
* [ ] Scheduled extension-dispatched checks work.
* [ ] Failed checks never create zero-price logs.
* [ ] A present variant with a failed price observation stays active and
  creates no price log.
* [ ] Partial and unknown snapshots do not make unmentioned variants missing.
* [ ] Variants can be added, renamed, suspected missing, deactivated or
  reactivated safely.
* [ ] Mass variant disappearance is quarantined and confirmed before miss
  counting starts.
* [ ] Charts show real observation gaps without persisted null or zero prices.
* [ ] Historical data renders in the dashboard.
* [ ] A valid price reduction triggers a Telegram alert.
* [ ] Duplicate Telegram alerts are prevented.
* [ ] Browser processes always close.
* [ ] Shopee cookies and Shopee authentication tokens are not transmitted.
* [ ] Price-tracker accounts and revocable sessions are implemented and tested.
* [ ] Authentication-disabled mode is restricted to loopback and uses the
  reserved local user.
* [ ] Automated tests pass.
* [ ] Manual end-to-end tests pass.
* [ ] Installation and deployment are documented.
