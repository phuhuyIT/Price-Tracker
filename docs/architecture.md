# Shopee Price Tracker v1.0.1 Architecture

The released application is a local-first Node.js service, SQLite database,
responsive dashboard, and Chrome Manifest V3 extension. Manual and scheduled
collection always runs in the user's current Chrome profile through the
production extension under `apps/extension`.

## Runtime flow

```text
Shopee product page
  -> MAIN-world response interceptor
  -> isolated content bridge
  -> sanitisation and snapshot normalisation
  -> persistent extension upload queue
  -> Express API
  -> services and repositories
  -> SQLite price history
  -> optional Telegram notification

node-cron
  -> persistent collection job
  -> signed-in Chrome extension
  -> inactive temporary product tab
  -> same sanitised snapshot pipeline
```

## Extension boundary

The page interceptor observes recognised Shopee API responses without changing
the original request. It never forwards cookies, headers, signatures,
authentication data, addresses, or raw responses. The isolated content bridge
accepts only versioned messages from the current page on an approved Shopee
Vietnam hostname.

The extension service worker validates snapshots, stores a bounded retry queue
in `chrome.storage.local`, submits them to the backend, and exposes queue and
collection status to the popup and Options page. Background jobs use the same
Chrome profile and open temporary tabs with `active: false`.

The Shopee adapter owns endpoint matching, response sanitisation, exact
selected-tier correlation, raw-price conversion, stock extraction, and variant
catalogue normalisation. UI scripts do not interpret raw marketplace payloads.

## Backend boundary

Express owns request parsing, size limits, security headers, exact-origin CORS,
request IDs, rate limiting, static dashboard delivery, and central error
handling.

Controllers translate validated HTTP input into service calls. Services own
tracking, lifecycle, collection jobs, authentication, queries, comparison, and
notification policy. Repositories are the only modules that execute SQL.

The application uses one shared `better-sqlite3` connection with foreign keys
and WAL mode enabled. Ordered migrations under
`apps/server/src/db/migrations` are the only schema source of truth.

## Persistence invariants

- One successful snapshot creates one grouped price check.
- Only positive safe-integer VND observations create price logs.
- Missing or malformed prices create gaps, never zero-price rows.
- Variant identity presence is independent from price observation.
- Only verified complete catalogues advance missing-variant lifecycle state.
- Snapshot persistence is synchronous and transactional.
- Telegram delivery occurs after commit and cannot roll back price history.
- Notification events are recorded only after successful delivery.
- Product, job, session, history, and notification access is owner-scoped.

## Authentication modes

With `AUTH_ENABLED=false`, the loopback-only server uses a reserved local owner.
With authentication enabled, dashboard sessions use HTTP-only cookies and
extension sessions use bearer credentials stored in extension storage. SQLite
stores only one-way session-token hashes. Shopee credentials are never accepted
by the backend.

## Scheduler and collection jobs

The scheduler does not scrape Shopee itself. It sequentially creates persistent
jobs for active products with configured delay and jitter. A process-level lock
prevents overlapping scheduler runs.

The extension claims jobs using an opaque installation context key and bounded
lease. Temporary failures retry with bounded backoff; authentication waits are
explicit; terminal failures create failed checks without price logs. Lease
expiry makes abandoned claims recoverable.

## Dashboard and history

The dashboard is served by the backend with locally installed Chart.js. Product
search and filters execute across the complete owner watchlist before
pagination. History returns aligned datasets with explicit null gaps and one
series per variant and pricing context.

## Repository layout

```text
apps/
  extension/        production MV3 source
  server/           Express backend and dashboard
packages/
  shared/           schemas, constants, errors, Shopee adapter
scripts/            extension and release build tooling, Telegram check
tests/
  unit/             active module regressions
  integration/      database, API, scheduler, dashboard, notification tests
  fixtures/         minimal sanitised fixtures consumed by tests
docs/
  setup.md           installation and first-run checklist
  developer-guide.md contracts and maintenance rules
  troubleshooting.md operational recovery
  release.md         reproducible release procedure
  variant-lifecycle.md lifecycle algorithm
```

Generated artifacts live under ignored `dist/`; private databases live under
ignored `data/`. Neither is a source directory.

## Deployment boundary

v1.0.1 supports one local Node.js process, one local SQLite database, one
unpacked extension, and a loopback backend. Public or LAN hosting, Chrome Web
Store publication, hosted persistence, mandatory multi-user operation, and
multi-device sync require a separate security and deployment design.

## Future marketplaces

Additional marketplaces must provide their own URL parser, endpoint matcher,
capture sanitizer, stable variant identity, price definition, and normaliser.
They should emit the shared snapshot contract so persistence, history,
comparison, notification, and dashboard modules remain marketplace-neutral.
