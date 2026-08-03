# Phase 0 — MVP Definition

Status: **complete — confirmed 2026-07-25**

This document is the requirements baseline for the Shopee Price Tracker MVP. It
turns Phase 0 of `Task_list.md` into explicit product and technical decisions.
Implementation phases must not weaken the privacy, price-comparability, or
resource-cleanup rules recorded here.

The product owner confirmed these release decisions:

1. The MVP is local-only.
2. The extension observes Shopee through the user's current browser session.
3. Preserved Playwright discovery tooling remains anonymous and must not reuse
   or authenticate a persistent Shopee profile; production jobs use the logged-in
   extension profile defined by Phase 8.
4. The MVP includes price-tracker accounts and sessions, but authentication
   enforcement is disabled by default for local testing.
5. Authentication is only for the price-tracker system, never for Shopee
   accounts.
6. Chrome Web Store distribution and authenticated multi-device sync are
   planned after the local MVP.

## Product scope

### Included in the MVP

- Shopee Vietnam (`shopee.vn`) is the only marketplace.
- Products are tracked by Shopee shop ID and item ID.
- Prices are tracked per Shopee variant.
- Products without explicit variants receive one synthetic `default` variant.
- Each successful observation creates a historical price record grouped under
  one price check.
- The Chrome Manifest V3 extension is the preferred collector for the price
  displayed in a user's active Shopee session.
- Anonymous Playwright collection supports manual refreshes and scheduled
  backend checks.
- A responsive dashboard supports tracking, listing, pausing, resuming,
  refreshing, deleting, and viewing price history.
- Telegram is the only notification channel in the MVP.
- Qualifying price drops produce at most one notification for the same
  transition.
- Price-tracker user, login, logout, session-revocation, and current-user
  operations are implemented and tested.
- Products are owner-scoped in storage from the first migration, even while
  authentication enforcement is disabled.

### Final price definition

The tracked price is:

> The price displayed by Shopee to the observing pricing context after
> applicable product discounts and vouchers, excluding shipping fees.

The stable identifier for this definition is:

```text
displayed_post_voucher_excluding_shipping
```

Rules:

- Store every accepted price as a positive safe integer number of VND.
- Never convert a missing, malformed, unavailable, or failed price to zero.
- A price observation must state its pricing context, context key, price
  source, voucher status, availability, currency, and price-definition ID.
- Shipping must not be included in the stored price. An observation that is
  known to include shipping is invalid.
- The amount represents an observed Shopee display, not a guaranteed checkout
  total. Eligibility, quantity, voucher limits, account state, and time can
  change the price.
- Base, original, range, crossed-out, and shipping-inclusive prices are not
  substitutes for the defined tracked price.
- A documented fallback may be stored only with its actual price source and
  uncertainty visible. It must not be mislabeled as a verified post-voucher
  price.

### Variant rules

- Use Shopee's stable model ID as the external variant identity when present.
- Use `default` only when the product genuinely has no explicit models.
- Variant display names may change without changing historical identity.
- New variants are inserted.
- Variant presence and successful price collection are separate facts. A
  present variant remains active when its price cannot be collected, and no
  price log is created for that failed observation.
- Only a verified complete variant catalogue may count an unobserved variant
  as missing. Partial, unknown, failed, and suspicious snapshots do not change
  missing counters.
- Missing variants pass through `suspected_missing` and become `inactive` only
  after the configured number of eligible misses. The MVP default is three.
- A mass disappearance above 50 percent is quarantined until the same verified
  variant set is observed twice. The confirming snapshot becomes miss one.
- Reappearing variants are reactivated automatically; their first valid price
  after reactivation becomes a new baseline and cannot send an alert.
- Historical variants and their observations are not deleted automatically.
- Availability such as `sold_out` is separate from lifecycle status.
- Price comparison uses the internal database variant ID after external IDs
  have been reconciled.

The complete contract, persistence rules, chart-gap behavior, and test cases
are defined in [variant-lifecycle.md](variant-lifecycle.md).

## Pricing contexts

The shared contract recognises these contexts:

| Context          | Meaning                                                                       | Context-key rule                                                               | MVP collection status                                                                          |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `user_session` | Price observed in the user's active Chrome session by the extension           | Stable random local installation/profile identifier; never a Shopee account ID | Included                                                                                       |
| `anonymous`    | Price observed by preserved fresh-context Playwright tooling                  | Stable anonymous collector identifier or explicit default anonymous key        | Contract-compatible legacy evidence; not used by production collection                         |
| `unknown`      | Legacy or incomplete provenance                                               | No assumed compatibility                                                       | Accepted only where a schema explicitly permits legacy/diagnostic data; never alert-comparable |

Prices from different pricing contexts are never compared directly. Context
keys prevent two different user sessions within the same context type from
being treated as equivalent.

Phase 8 supersedes the original anonymous scheduling plan: production manual
and scheduled jobs are completed by the explicitly enabled extension in the
user's logged-in Chrome profile and remain `user_session` observations.

`dedicated_profile` is not an MVP pricing context. Playwright must not load the
user's Chrome profile, persist Shopee cookies, or authenticate a Shopee
account. The existing root-level demo's persistent-profile mode is discovery
code only and will not be carried into the production collector.

The extension must not transmit Shopee cookies, Shopee request headers, Shopee
authentication tokens, request signatures, Shopee account IDs, addresses, or
raw Shopee responses. When application authentication is later enabled, its
separate price-tracker session may authorise backend requests. The context key
is application-generated and contains no Shopee identity.

## Price comparison and notification rules

An observation is comparable only when all of the following match:

- Internal variant ID.
- Currency.
- Price-definition ID.
- Price type.
- Pricing context.
- Pricing-context key when that context uses one.
- Price source, unless a future documented compatibility rule explicitly
  declares two sources equivalent.

Both observations must be valid and available. The immediately previous
successful comparable observation is the baseline.

```text
dropPercentage = ((oldPrice - newPrice) / oldPrice) * 100
```

Notify only when:

- This is not the initial comparable observation.
- `newPrice < oldPrice`.
- The drop percentage is at least the configured threshold.
- The exact transition has not already produced a successful notification.

The default threshold is 1 percent. Display percentages are rounded to one
decimal place. Notification deduplication includes the variant, old amount, new
amount, price definition, pricing context, and context key. A notification
event is saved only after Telegram confirms successful delivery. Notification
failure never rolls back price history.

## Technical decisions

| Area               | Decision                                                           | Rationale                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime            | Node.js 20 or newer                                                | Required baseline with maintained modern platform APIs                                                                                                     |
| Language           | JavaScript using ES modules for the MVP application                | Matches the required`.js` repository layout and keeps browser/server shared modules simple; the CommonJS demo remains isolated until Phase 1 is complete |
| Package manager    | npm with one root lockfile                                         | The repository already uses npm and has`package-lock.json`                                                                                               |
| HTTP server        | Express                                                            | Required lightweight REST and static-dashboard host                                                                                                        |
| Database           | SQLite through`better-sqlite3`                                   | Synchronous transactional API suits a single-process local MVP                                                                                             |
| Validation         | Zod                                                                | One shared contract can validate extension, collector, API, and configuration data                                                                         |
| Testing            | Vitest                                                             | Supports fast ESM unit and integration tests                                                                                                               |
| Logging            | Pino                                                               | Structured JSON logging with safe redaction                                                                                                                |
| Authentication     | Email/password accounts with revocable opaque server-side sessions | Supports future device revocation without coupling application identity to Shopee                                                                          |
| Browser automation | Playwright Chromium                                                | Supports response capture and deterministic cleanup                                                                                                        |
| Scheduling         | `node-cron`                                                      | Sufficient for a single-process sequential scheduler                                                                                                       |
| Extension          | Chrome Manifest V3                                                 | Required collection surface                                                                                                                                |
| Dashboard charting | Locally bundled Chart.js                                           | No remotely hosted executable code or CDN dependency                                                                                                       |
| Dashboard styling  | Project-owned responsive CSS                                       | Matches the target static dashboard and avoids an unnecessary frontend build framework                                                                     |
| Deployment         | Local-only, single Node.js process, loopback binding               | Matches the current local Chrome workflow and SQLite's single-instance constraint                                                                          |

The development machine currently runs Node.js 24, but code and CI must remain
compatible with Node.js 20 or newer.

### Application boundaries

- Extractors capture and normalise marketplace data.
- Shared schemas own the boundary contract and enums.
- Repositories alone perform database operations.
- Services own transactions and business rules.
- Controllers translate HTTP requests and responses.
- Jobs orchestrate scheduled work without embedding extraction or repository
  logic.
- Extension scripts capture, sanitise, validate, queue, and transmit snapshots;
  they do not contain backend business logic.
- Marketplace-specific behavior remains behind an adapter boundary so another
  platform can be added without changing Shopee code.

### Security baseline

- The local server binds to `127.0.0.1` by default.
- `AUTH_ENABLED=false` is the local MVP default. In this mode, protected
  application routes resolve to one reserved local user without requiring a
  login.
- `AUTH_ALLOW_REGISTRATION=false` is the default and has no effect unless
  authentication is enabled.
- `AUTH_SESSION_TTL_HOURS` controls the bounded lifetime of application
  sessions and is validated at startup.
- Auth-specific automated tests enable authentication and registration in an
  isolated test environment.
- When `AUTH_ENABLED=true`, protected routes require a valid price-tracker
  session and every data query is scoped to the authenticated owner.
- Startup fails if authentication is disabled while the server is configured
  to bind to a non-loopback interface.
- Passwords are stored only as salted, memory-hard hashes. Plaintext passwords
  and session tokens are never logged.
- Password hashing uses the asynchronous Node.js `crypto.scrypt` API behind one
  versioned password-hasher module so parameters can be upgraded safely.
- Session tokens are generated from cryptographically secure randomness; only
  token hashes are stored in SQLite, and sessions can expire or be revoked.
- When authentication is disabled, auth endpoints return an explicit
  `AUTH_DISABLED` response; only the ownership middleware performs the reserved
  local-user substitution.

The Phase 2 environment template will include:

```text
AUTH_ENABLED=false
AUTH_ALLOW_REGISTRATION=false
AUTH_SESSION_TTL_HOURS=720
```

- Mutation endpoints have body-size limits, validation, and rate limiting.
- Helmet, restrictive CSP, and explicit CORS/origin rules are mandatory.
- Raw collector payloads and sensitive configuration are redacted from logs.
- Telegram secrets are read from environment variables and never logged.
- CAPTCHA, authentication, request signatures, rate limits, and anti-bot
  controls are not bypassed.
- Extension queue records contain only validated normalised snapshots.
- Any future hosted deployment requires HTTPS, API authentication,
  origin restrictions, secret management, persistent storage, backups, and a
  separate security review.

## Accepted MVP limitations

- Shopee Vietnam only.
- Chrome only; no Firefox, Edge-specific, or mobile extension support.
- Authentication enforcement and the login UI are disabled by default. The
  local MVP transparently uses one reserved local price-tracker user.
- One Node.js application instance and one persistent local SQLite database.
- Shopee endpoints and fields are private implementation details that may
  change without notice.
- Anonymous Playwright observations may not receive session-specific vouchers.
- User-session observations exist only while a supported product page is open
  and Shopee emits a recognised response.
- The app records an observed price and does not guarantee voucher eligibility
  or the final checkout amount.
- Shipping is deliberately excluded and is not tracked separately.
- Scheduled collection is sequential and uses bounded retries.
- CAPTCHA, login requirements, rate limiting, and unavailable products cause
  explicit failed checks.
- Telegram delivery depends on the external Telegram Bot API.
- Price history lines and alerts remain separated by pricing context and
  context key; the dashboard may therefore show different current prices for
  the same variant.
- Playwright does not authenticate a Shopee account or reuse a persistent
  browser profile.
- Chrome Web Store installation and multi-device price-tracker account sync are
  not available in the local MVP.

## Postponed features

- Amazon and Taobao adapters.
- Cross-marketplace price comparison.
- Publicly enabling registration and mandatory authentication.
- Hosted multi-device sync.
- Chrome Web Store publication and managed extension updates.
- Email, web push, native mobile, and other notification channels.
- Mobile applications and non-Chrome browser support.
- Product search, recommendations, affiliate features, and price prediction.
- Advanced voucher recommendation or automatic coupon claiming.
- Shipping-price tracking.
- Proxy rotation, fingerprint spoofing, stealth or anti-detection systems, and
  distributed scraping workers.
- PostgreSQL migration and multi-instance deployment.
- Public hosting until authentication, HTTPS, persistent storage, backup, and
  monitoring requirements are designed and implemented.

## Future Chrome Web Store and multi-device direction

Chrome Web Store publication distributes and updates the extension; it does not
by itself synchronise tracked products or price history. The future sync design
will build on the dormant MVP account/session foundation and require a hosted
HTTPS backend with:

- Price-tracker user registration and authentication.
- Per-user authorisation and data isolation.
- Secure extension-to-API sessions.
- Device and session revocation.
- Persistent server-side storage, backups, monitoring, and recovery.

Shopee credentials, cookies, and authentication tokens remain outside this
system. The extension will continue to observe the current Shopee browser
session without exporting its credentials.

`chrome.storage.sync` may later hold small, non-sensitive preferences. It must
not hold price history, pending snapshots, application access tokens, Telegram
secrets, or Shopee session data.

## Phase 0 completion record

Phase 0 is complete because the price definition, supported pricing contexts,
local deployment boundary, system architecture, limitations, and future
account/sync direction are now explicit. Phase 1 may analyse the working demo
without treating its persistent Playwright profile as approved production
behavior.
