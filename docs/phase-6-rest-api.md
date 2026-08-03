# Phase 6 Backend REST API

Status: complete and verified on 2026-08-01.

## Boundary

Phase 6 exposes the Phase 5 services through Express without moving SQL,
lifecycle, comparison, or password rules into controllers. Controllers receive
the trusted owner from middleware; request bodies, parameters, and query
strings cannot select an owner.

Phase 8 replaces the old anonymous-collector handoff with persistent extension
collection jobs. New tracking and refresh requests return `202 Accepted` while
the installed extension completes work in the user's logged-in Chrome profile.
Tracking an existing URL still returns its stored product without queueing work.

## Endpoints

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Registers when auth and registration are enabled |
| `POST` | `/api/auth/login` | Creates a dashboard cookie or extension bearer session |
| `POST` | `/api/auth/logout` | Revokes the presented session |
| `GET` | `/api/auth/me` | Returns the current user and non-secret session summary |
| `POST` | `/api/products/track` | Returns an existing URL or queues an extension collection job |
| `POST` | `/api/products/snapshot` | Validates and transactionally stores one normalised snapshot |
| `GET` | `/api/products` | Lists one owner page with context-safe prices |
| `GET` | `/api/products/:productId` | Returns complete owner-scoped product details |
| `GET` | `/api/products/:productId/history` | Returns filtered Chart.js-ready history |
| `POST` | `/api/products/:productId/refresh` | Queues one profile-bound extension refresh |
| `POST` | `/api/collection-jobs/claim` | Atomically leases the next compatible job to an extension installation |
| `POST` | `/api/collection-jobs/:jobId/complete` | Validates and stores the leased user-session snapshot |
| `POST` | `/api/collection-jobs/:jobId/fail` | Records a typed leased collection failure |
| `GET` | `/api/collection-jobs/:jobId` | Returns owner-scoped job state |
| `PATCH` | `/api/products/:productId` | Changes active/paused state or alert threshold |
| `DELETE` | `/api/products/:productId` | Deletes the product through foreign-key cascades |
| `GET` | `/api/health` | Returns process health |

`GET /health` remains as a compatibility alias.

Every response uses the shared success or error envelope. Product lists return
items in `data` and pagination under `meta.pagination`. Snapshot, track, and
refresh responses return creation state plus the stored product summary.

## Authentication transports

With `AUTH_ENABLED=false`, product ownership middleware creates or resolves the
reserved local user. Authentication endpoints return `AUTH_DISABLED`, and the
configuration layer prevents binding outside loopback.

With `AUTH_ENABLED=true`:

* Dashboard sessions use `price_tracker_session` with `HttpOnly`,
  `SameSite=Strict`, and `/api` scope. Production cookies also use `Secure`.
* Dashboard response bodies never contain the plaintext token.
* Extension registration or login returns the token once under the bearer
  session response and later requires `Authorization: Bearer <token>`.
* A bearer token cannot be reused as a dashboard cookie, and requests carrying
  ambiguous transports are rejected.
* Logout revokes the stored token hash and expires a dashboard cookie.

Registration and login use a maximum of ten attempts per configured rate-limit
window. Product mutations use `API_RATE_LIMIT_MAX` and
`API_RATE_LIMIT_WINDOW_MS`.

## HTTP and privacy controls

The application applies:

* A 64 KiB JSON request limit.
* Helmet headers and a restrictive same-origin content security policy.
* Exact same-origin dashboard CORS plus the single optional
  `EXTENSION_ALLOWED_ORIGIN`.
* Generated or validated `X-Request-ID` values.
* Structured completion and rejection logs without request bodies.
* Strict shared Zod validation for route bodies, parameters, and queries.
* Explicit rejection of snapshot raw responses, cookies, request headers,
  response headers, and authentication tokens.

Snapshot persistence still delegates to Phase 5. Therefore partial or unknown
coverage is lifecycle-neutral, only verified complete evidence can create
eligible misses, and malformed or zero prices never become price logs.

## Collector handoff

Collection jobs store only the public product identity, canonical URL, opaque
extension context key, job state, and a hash of the short-lived lease token.
They never store Shopee cookies, headers, tokens, or account identifiers.

An unbound new-product job is claimed by the first local extension that opts in
or explicitly checks for work.
Claiming binds the product identity to that extension context for retries.
Refresh jobs use the latest successful `extension` + `user_session` context key.
Completion requires the same lease, context key, product identity, and snapshot
provenance. Duplicate pending or claimed work returns the existing job.

## Verification

Run the focused API suite:

```powershell
npm.cmd run test:phase6
```

It contains 15 integration assertions covering health, security headers, CORS,
local ownership, cookie and bearer sessions, revocation, owner isolation,
snapshot validation, duplicate tracking, pagination, history filtering,
product mutations, body limits, rate limits, and the collector injection
boundary.
