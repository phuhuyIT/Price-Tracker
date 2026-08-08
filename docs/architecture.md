# Shopee Price Tracker MVP Architecture

This is the target architecture agreed during Phase 0. The current root-level
collector is a working discovery demo and remains intact until Phase 1 records
its endpoints, field mappings, fixtures, and price behavior.

## System overview

```text
Shopee product page
  |
  +-- Chrome page interceptor (MAIN world)
  |     captures recognised responses without modifying requests
  |       |
  |       v
  |   Content bridge (isolated world)
  |     validates, normalises, deduplicates
  |       |
  |       v
  |   MV3 service worker
  |     persists bounded queue and submits snapshots
  |
  +-- Background collection job
        extension claims work by opaque profile context key
        opens an inactive tab in the existing logged-in Chrome profile

Extension collection
  |
  v
Express API -> controllers -> services -> repositories -> SQLite
                              |
                              +-> price comparison -> Telegram
                              |
                              +-> product/history queries -> dashboard

node-cron -> scheduler job -> collection queue -> extension -> tracking service
```

## Collection boundary

Extension collection produces the same validated normalised snapshot for
visited and background tabs. Raw Shopee
responses are allowed only inside the Shopee adapter long enough to select the
required fields. They are not sent to the backend by the extension, persisted,
or logged in production.

The configured endpoint matcher initially recognises:

```text
/api/v4/pdp/get_pc
/api/v4/pdp/cart_panel/select_variation_pc
```

Endpoint matching, raw-price conversion, voucher interpretation, and response
normalisation stay isolated in the Shopee adapter because Shopee may change
them.

### Extension flow

1. The MAIN-world interceptor wraps `fetch` and `XMLHttpRequest`, preserves
   their original behavior, and inspects clones of recognised responses.
2. It posts a versioned, sanitised message without cookies, headers, tokens, or
   raw response data.
3. The isolated content bridge verifies the event source, message protocol,
   current Shopee hostname, and payload.
4. It normalises and validates a `user_session` snapshot, deduplicates rapid
   repeats, and sends it to the service worker.
5. The service worker persists a bounded queue in `chrome.storage.local`,
   retries temporary failures with bounded backoff, and exposes status to the
   popup.

### Background session flow

1. Parse and canonicalise the product URL before creating a persistent job.
2. Let an explicitly enabled extension claim work with its opaque installation
   context key and a bounded hashed lease.
3. Open the product with `active: false` in the last-focused normal window of
   that same Chrome profile.
4. Capture recognised product and variation responses through the existing
   sanitised extension pipeline.
5. Normalise and validate an `extension` + `user_session` snapshot.
6. Close the temporary tab on completion, failure, or timeout.
7. Return typed failures and notify the user when Shopee sign-in is required.

Playwright remains preserved discovery and integration-test tooling. It is not
the production manual or scheduled collector and never receives the user's
Chrome profile, Shopee cookies, or authenticated session data.

## Backend boundaries

### HTTP layer

- Express owns parsing, request-size limits, security headers, CORS, request
  IDs, rate limiting, static dashboard delivery, and central error handling.
- Authentication middleware has two explicit modes. With
  `AUTH_ENABLED=false`, it supplies the reserved local user. With
  `AUTH_ENABLED=true`, it validates a revocable price-tracker session and
  supplies the authenticated user.
- Controllers validate route-specific input and return the standard response
  envelope.
- Controllers do not perform SQL or extraction logic.

### Service layer

- Tracking service coordinates snapshot validation and transactional storage.
- Price-comparison service selects only comparable historical observations and
  identifies qualifying transitions.
- Notification service formats, escapes, sends, and records successful
  Telegram events independently of the storage transaction.
- Product-query service builds paginated summaries, details, and chart-ready
  history without exposing database rows directly.
- Persistent collection jobs prevent duplicate pending, claimed, retry-waiting,
  or authentication-waiting work and keep refreshes bound to one extension
  context.
- Authentication service registers price-tracker users, verifies credentials,
  creates opaque sessions, returns the current user, and revokes sessions.
- Authentication never accepts or stores Shopee credentials.

### Application authentication modes

The authentication implementation exists in both modes:

```text
AUTH_ENABLED=false (default)
  product request -> ownership middleware -> reserved local user
  auth endpoint   -> AUTH_DISABLED

AUTH_ENABLED=true
  product request -> session middleware -> authenticated owner
  auth endpoint   -> register/login/logout/current-user workflow
```

Rules:

- Registration is additionally gated by `AUTH_ALLOW_REGISTRATION`.
- Registration and login have stricter rate limits than product mutations.
- Email is normalised for identity lookup and stored under a unique constraint.
- Passwords pass through the single versioned asynchronous scrypt module.
- Successful login returns a cryptographically random opaque session token.
- SQLite stores only a one-way token hash, expiry, revocation timestamp, user
  ID, and non-sensitive session metadata.
- Product controllers and services never accept an owner ID from request data;
  they receive it from trusted ownership/authentication middleware.
- The reserved local user cannot log in and cannot be selected by request
  input.
- Enabling authentication does not silently transfer local-user data to a
  registered account.

### Persistence layer

- One shared `better-sqlite3` connection enables foreign keys and WAL mode.
- Repositories contain SQL and map rows to internal records.
- User and session repositories store application identities and hashed opaque
  session tokens. Plaintext session tokens are returned only once at creation.
- Product ownership is represented from the first migration. Product
  uniqueness is scoped by owner as well as platform, shop ID, and item ID.
- A tracking transaction contains the product upsert, variant upserts, price
  check, per-variant check results, price logs, and lifecycle state changes.
- Variant identity presence is independent from price collection. A valid
  catalogue entry can reset missing state even when that check produces no
  price log for the variant.
- Only verified complete catalogues affect variants they do not contain.
  Partial, unknown, failed, duplicate, and suspicious snapshots cannot
  increment lifecycle miss counters.
- Per-variant check results record `present`, `absent`, or `unknown` and
  `observed` or `not_observed`, allowing chart gaps without null or zero rows
  in `price_logs`.
- Notification delivery occurs after the price-history transaction commits.
- Only terminal failed extractions create failed checks, and they never create
  price logs. Retry waits and authentication waits create no check rows.
- Migrations are ordered, versioned, idempotent, and tested.

The baseline SQL in `AGENTS.md` must be extended during the database-design
phase to represent the refined roadmap requirements, including:

- Product alert threshold.
- Price-definition ID.
- Pricing context and context key.
- Price source.
- Voucher status.
- Explicit shipping-excluded provenance.
- Variant-catalogue coverage, confidence, and expected/observed/priced counts.
- Variant lifecycle status, last-seen time, consecutive eligible misses,
  missing-since time, inactive reason, and current availability.
- Per-variant check results for presence, price collection, and chart gaps.
- Suspicious mass-disappearance confirmation state.
- Notification deduplication inputs for price definition and context.
- Price-tracker users and revocable sessions.
- An owner reference on products, with all descendant data reached through
  owner-scoped product queries.

Exact columns and constraints are a Phase 4 deliverable after the Phase 3
shared schema is fixed.

The accepted lifecycle state machine and default safeguards are specified in
[variant-lifecycle.md](variant-lifecycle.md).

## Scheduler boundary

- One process-level run lock prevents overlap.
- The cron run is an asynchronous dispatcher: it queues profile-bound extension
  work and never launches Playwright or waits for Chrome.
- Active products are dispatched sequentially with configured random delay.
- Claimed jobs use leases. Expired claims are recovered into retry wait or a
  terminal failure according to their attempt count.
- Four total attempts are allowed by default. Retryable transport, timeout,
  rate-limit, Shopee 5xx, and premature-tab-close failures use capped
  exponential backoff with additive jitter.
- `AUTHENTICATION_REQUIRED` waits for explicit user sign-in and **Check now**;
  it is neither a retryable failure nor a terminal failed check.
- Terminal data, URL, and product-state failures are recorded once and
  processing continues with other products.
- Structured summary logs include the job-run ID and counts.
- Shutdown stops new dispatch, interrupts inter-product delay, waits for the
  current dispatch loop, stops cron, and closes the database. Chrome owns its
  temporary tabs; any surviving claimed job is recoverable through lease expiry.

## Target repository structure

The root is a single npm-managed project. The current demo files are preserved
through Phase 1 and then either migrated into the target modules or moved under
an explicitly documented legacy/demo directory.

```text
shopee-price-tracker/
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
├── README.md
├── AGENTS.md
├── Task_list.md
│
├── apps/
│   ├── server/
│   │   ├── server.js
│   │   ├── src/
│   │   │   ├── app.js
│   │   │   ├── config/
│   │   │   │   └── index.js
│   │   │   ├── controllers/
│   │   │   │   ├── authController.js
│   │   │   │   └── productController.js
│   │   │   ├── db/
│   │   │   │   ├── connection.js
│   │   │   │   ├── migrate.js
│   │   │   │   ├── migrations/
│   │   │   │   │   └── 001-initial.sql
│   │   │   │   └── schema.sql
│   │   │   ├── errors/
│   │   │   │   └── appError.js
│   │   │   ├── extractors/
│   │   │   │   ├── platformExtractor.js
│   │   │   │   └── shopee/
│   │   │   │       ├── shopeeUrlParser.js
│   │   │   │       ├── shopeePayloadNormalizer.js
│   │   │   │       └── shopeePlaywrightExtractor.js
│   │   │   ├── jobs/
│   │   │   │   └── priceScheduler.js
│   │   │   ├── middleware/
│   │   │   │   ├── authenticate.js
│   │   │   │   ├── errorHandler.js
│   │   │   │   ├── requestId.js
│   │   │   │   └── validateRequest.js
│   │   │   ├── repositories/
│   │   │   │   ├── authRepository.js
│   │   │   │   ├── notificationRepository.js
│   │   │   │   ├── priceRepository.js
│   │   │   │   ├── productRepository.js
│   │   │   │   └── variantRepository.js
│   │   │   ├── routes/
│   │   │   │   ├── authRoutes.js
│   │   │   │   └── productRoutes.js
│   │   │   ├── services/
│   │   │   │   ├── authService.js
│   │   │   │   ├── notificationService.js
│   │   │   │   ├── priceComparisonService.js
│   │   │   │   ├── productQueryService.js
│   │   │   │   └── trackingService.js
│   │   │   └── utils/
│   │   │       ├── apiResponse.js
│   │   │       ├── logger.js
│   │   │       └── passwordHasher.js
│   │   └── public/
│   │       ├── index.html
│   │       ├── css/
│   │       │   └── style.css
│   │       ├── js/
│   │       │   └── app.js
│   │       └── vendor/
│   │           └── chart.umd.js
│   │
│   └── extension/
│       ├── manifest.json
│       ├── service-worker.js
│       ├── content/
│       │   ├── page-interceptor.js
│       │   └── content-bridge.js
│       ├── popup/
│       │   ├── popup.html
│       │   ├── popup.css
│       │   └── popup.js
│       ├── options/
│       │   ├── options.html
│       │   ├── options.css
│       │   └── options.js
│       └── icons/
│
├── packages/
│   └── shared/
│       ├── constants/
│       │   ├── priceDefinitions.js
│       │   └── shopeeEndpoints.js
│       ├── errors/
│       │   └── errorCodes.js
│       └── schemas/
│           ├── apiSchemas.js
│           ├── authSchemas.js
│           ├── productSnapshotSchema.js
│           └── shopeeUrlSchema.js
│
├── docs/
│   ├── architecture.md
│   └── phase-0-mvp-definition.md
│
└── tests/
    ├── fixtures/
    │   └── shopee/
    ├── integration/
    └── unit/
```

## Deployment boundary

The first release is local-only:

- One Node.js process.
- One persistent local SQLite file.
- Server bound to loopback by default.
- Account/session infrastructure is installed, but `AUTH_ENABLED=false`
  resolves requests to the reserved local user for frictionless testing.
- Unpacked extension configured with the loopback backend URL.
- Playwright Chromium installed locally.
- Optional process manager and local database backups.

This deployment must not be exposed to a LAN or the public internet. A hosted
release is a separate scope requiring HTTPS, extension-to-API authentication,
strict origins, secret storage, persistent volumes, backups, monitoring, and
recovery testing.

## Future distribution and synchronisation

The target extension should remain compatible with future Chrome Web Store
publication by using least-privilege permissions, bundled executable code, a
restrictive extension CSP, and clear privacy disclosures. The production MVP
must not inherit the discovery demo's `debugger` permission unless a later
review proves that it is necessary and Chrome Web Store policy-compatible.

Chrome Web Store distribution and multi-device data sync are separate
capabilities:

- The store distributes and updates the extension.
- A future hosted backend synchronises products, history, preferences, and
  notification settings.
- The MVP's dormant user/session foundation becomes mandatory in hosted mode.
- Users authenticate to the price-tracker system, not to Shopee through the
  backend.
- Every hosted API query and mutation is authorised against the authenticated
  price-tracker user.
- Device/session revocation and per-user data isolation are mandatory.
- Shopee cookies, headers, signatures, and account tokens never leave the
  browser page context.
- `chrome.storage.sync` is limited to small non-sensitive preferences; durable
  application data remains server-side.

Until that hosted architecture passes its own security and persistence review,
each device uses its own loopback backend and local SQLite database.
