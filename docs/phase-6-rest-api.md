# Phase 6 Backend REST API

Status: complete and verified on 2026-08-01.

## Boundary

Phase 6 exposes the Phase 5 services through Express without moving SQL,
lifecycle, comparison, or password rules into controllers. Controllers receive
the trusted owner from middleware; request bodies, parameters, and query
strings cannot select an owner.

The anonymous Playwright collector remains Phase 8 work. The track and refresh
contracts accept an injected collector, but the production application
currently returns `COLLECTOR_UNAVAILABLE` for a new URL or manual refresh.
Tracking an existing URL still returns its stored product without collection.

## Endpoints

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Registers when auth and registration are enabled |
| `POST` | `/api/auth/login` | Creates a dashboard cookie or extension bearer session |
| `POST` | `/api/auth/logout` | Revokes the presented session |
| `GET` | `/api/auth/me` | Returns the current user and non-secret session summary |
| `POST` | `/api/products/track` | Returns an existing URL or invokes the injected anonymous collector |
| `POST` | `/api/products/snapshot` | Validates and transactionally stores one normalised snapshot |
| `GET` | `/api/products` | Lists one owner page with context-safe prices |
| `GET` | `/api/products/:productId` | Returns complete owner-scoped product details |
| `GET` | `/api/products/:productId/history` | Returns filtered Chart.js-ready history |
| `POST` | `/api/products/:productId/refresh` | Runs one non-overlapping injected anonymous refresh |
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

Phase 8 should pass its anonymous collector as `collectProduct` when composing
the app. The collection service verifies that the returned snapshot:

1. Is a Playwright snapshot.
2. Uses the anonymous pricing context.
3. Matches the requested shop and item IDs.

Manual refreshes are locked per owner/product pair and return
`REFRESH_IN_PROGRESS` when a second refresh overlaps. Browser management,
extraction errors, and failed-check persistence remain with Phases 8 and 9.

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
