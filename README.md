# Shopee Price Tracker

> The repository is being evolved from this working collector demo into the
> Shopee Price Tracker MVP described in [Task_list.md](Task_list.md). The Phase
> 0 product decisions are recorded in
> [docs/phase-0-mvp-definition.md](docs/phase-0-mvp-definition.md), and the
> Phase 1 evidence is recorded in
> [docs/phase-1-shopee-analysis.md](docs/phase-1-shopee-analysis.md). The target
> system design is in [docs/architecture.md](docs/architecture.md), and the new
> project foundation is documented in
> [docs/phase-2-project-foundation.md](docs/phase-2-project-foundation.md), and
> the shared validation contract is documented in
> [docs/phase-3-shared-contracts.md](docs/phase-3-shared-contracts.md).
> The SQLite schema, migrations, repository contracts, and persistence
> safeguards are documented in
> [docs/phase-4-database-layer.md](docs/phase-4-database-layer.md).
> The current-session MV3 collector is documented in
> [docs/phase-7-chrome-extension.md](docs/phase-7-chrome-extension.md).
> Logged-in background collection is documented in
> [docs/phase-8-chrome-session-collector.md](docs/phase-8-chrome-session-collector.md).
> Scheduled dispatch, retries, and terminal failure semantics are documented in
> [docs/phase-9-scheduled-checks.md](docs/phase-9-scheduled-checks.md).
> Telegram price-drop delivery and duplicate prevention are documented in
> [docs/phase-10-telegram-notifications.md](docs/phase-10-telegram-notifications.md).
> The responsive dashboard and its context-safe history chart are documented in
> [docs/phase-11-web-dashboard.md](docs/phase-11-web-dashboard.md).
> Existing collector behavior is intentionally preserved as legacy discovery
> tooling.
> The persistent-profile Playwright mode described below is legacy discovery
> behavior. Production collection uses the installed extension and the exact
> Chrome profile in which the user is already signed in to Shopee.

## Phase 2 foundation

The new application is organised as npm workspaces:

```text
apps/server       ESM Node.js/Express application
apps/extension    loadable Manifest V3 extension source
packages/shared   ESM package for contracts introduced in Phase 3
tests/unit        Vitest unit tests
tests/integration Vitest integration tests
```

Requirements:

- Node.js 20 or newer
- npm
- Playwright Chromium for the preserved browser integration tests

Install and prepare local configuration:

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run playwright:install
```

Foundation commands:

```powershell
npm.cmd run dev
npm.cmd start
npm.cmd test
npm.cmd run test:watch
npm.cmd run lint
npm.cmd run format
npm.cmd run db:migrate
npm.cmd run extension:build
```

The server binds to `127.0.0.1:3000` by default. With `AUTH_ENABLED=false`, the
configuration validator rejects non-loopback binding. After running
`npm.cmd run extension:build`, load `dist/extension` as an unpacked extension
from `chrome://extensions`.

For the preserved anonymous Playwright connectivity check:

```powershell
npm.cmd run legacy:anonymous-connectivity -- "https://shopee.vn/product-i.shop.item"
```

This legacy command opens a fresh anonymous browser context and verifies page
navigation only. It is not used by production tracking or refresh jobs.

## Phase 3 shared contracts

The `@shopee-price-tracker/shared` workspace now owns strict Zod contracts for
Shopee URLs, product snapshots, variants, observed and missing prices,
catalogue coverage, API boundaries, and price-tracker authentication.

Run only the shared-contract tests with:

```powershell
npm.cmd run test:phase3
```

An example accepted payload is available at
`packages/shared/examples/valid-product-snapshot.json`. New snapshots must use
either `extension` + `user_session` or `playwright` + `anonymous`; an unknown
pricing context is rejected.

## Phase 4 database layer

The server now uses one shared `better-sqlite3` connection with foreign keys
and WAL mode. Ordered, checksummed migrations run automatically before the
server listens and are also available through:

```powershell
npm.cmd run db:migrate
```

The initial schema stores owner-scoped products, stable variants and lifecycle
state, grouped checks, per-variant gaps, real positive-integer VND prices,
successful notification transitions, users, and revocable hashed sessions.
No Shopee credentials, cookies, headers, or null/zero price placeholders are
stored.

Run only the Phase 4 persistence tests with:

```powershell
npm.cmd run test:phase4
```

## Phase 5 core backend services

The server now has HTTP-independent services for transactional snapshot
tracking, comparable-price evaluation, owner-scoped product queries, and
price-tracker authentication. Exact snapshot replays are idempotent; partial or
suspicious catalogues cannot incorrectly deactivate variants; and chart gaps
come from check results without storing null or zero prices.

Current product prices remain separated by pricing context and context key.
Production checks remain bound to one extension installation so Shopee account,
voucher, and session contexts are never silently mixed.

Authentication still defaults to disabled local mode. When enabled, passwords
use a local offline denylist and versioned asynchronous scrypt hashes, while
SQLite stores only hashes of random opaque session tokens.

Run only the Phase 5 service tests with:

```powershell
npm.cmd run test:phase5
```

See `docs/phase-5-core-services.md` for the service and security boundaries.

## Phase 6 REST API

The Express server now exposes the complete authentication and product API at
`/api`. Product routes transparently use the reserved local owner while
`AUTH_ENABLED=false`; when authentication is enabled they require either the
dashboard's HTTP-only cookie or the extension's bearer session.

HTTP protections include a 64 KiB JSON limit, Helmet security headers and CSP,
exact-origin CORS, request IDs, structured request logs, stricter authentication
throttling, and rate limiting for every product mutation. Snapshot requests are
strictly validated and reject raw responses, cookies, headers, and
authentication data.

The required `POST /api/products/track` and manual-refresh contracts are
asynchronous. A new URL or refresh creates a persistent collection job and
returns `202 Accepted`; an existing tracked URL still returns its stored summary
immediately.

Run only the Phase 6 API tests with:

```powershell
npm.cmd run test:phase6
```

See `docs/phase-6-rest-api.md` for endpoint behavior, authentication transports,
and the collector handoff.

## Phase 7 Chrome extension collector

Build and verify the price-tracker extension:

```powershell
npm.cmd run test:phase7
```

Load `dist/extension` from `chrome://extensions`. This is the new MVP collector;
the separate `chrome-extension` folder below remains legacy exact-profile
discovery tooling.

After loading the MVP extension, copy its ID and restart the backend with:

```powershell
$env:EXTENSION_ALLOWED_ORIGIN = "chrome-extension://<extension-id>"
npm.cmd start
```

The extension popup also keeps a five-product quick watch: locally pinned
products appear first, recent tracked products fill empty positions, and the
owner-scoped watchlist search allows fast pinning. The extension previews valid
captures in the same popup. Automatic passive
submission is off by default; click **Track & collect available prices** to
queue the exact product, open an inactive collection tab, and attempt every
selectable variant. The popup reports checked and priced coverage instead of
treating a catalogue-only snapshot as full price success. The options page
configures the backend, debug summaries, the generated local pricing-context
key, queue retry, and optional price-tracker sign-in. It never captures or sends
Shopee cookies, headers, or authentication data.

For a product with no visible variants, the collector first accepts only an
exact, model-matched product-detail price. It supports Shopee's observed
`data.pricing.data.product_price` and `data.product_price` response layouts,
reading `price.single_value` only when `price_model.price_single_model_id`
matches the catalogue model. When Shopee also returns a weaker or uncorrelated
`price_breakdown`, the collector ranks all allowlisted price containers instead
of letting that object hide the exact `product_price`. If the response has no
trustworthy price, it briefly waits and may use Shopee's single hidden option to
trigger the correlated response. An available product that still has no exact price fails with a
retryable `PRICE_SELECTOR_TIMEOUT`; an explicitly unavailable product may
complete without a price. Price ranges, zero values, and another model's price
are never stored as the Default variant price.

Shopee can keep displaying an amount after a product sells out. The collector
therefore reads model stock first and falls back to product-level stock for a
single-model product. When Shopee redacts both stock fields, a product with one
synthetic `Default` variant may also use an exact visible **Đã bán hết** / **Sold
out** label from the main product-detail region. This DOM fallback never applies
to explicit variants or generic recommendation-card text. The popup shows
**Sold out** instead of presenting the amount as a current purchasable price.
The backend keeps tracking enabled so a later check can detect a restock; API
`trackingStatus` and `availability` are separate fields, and
`currentLowestPrice` excludes sold-out or unavailable observations.

Shopee may emit several `get_pc` responses during one page load. A later
catalogue-only response cannot erase an earlier exact model-matched price for
the same product. A later exact response can replace it, and compatible
selected-variation captures remain available while duplicate product details
arrive.

The full manual procedure, including variant, voucher, quantity, offline queue,
browser restart, and enabled/disabled authentication cases, is in
`docs/phase-7-chrome-extension.md`.

## Phase 8 logged-in Chrome session collector

Background price checks are disabled by default. Enable **Allow background
price checks** in extension options to let the extension poll the backend. The
default interval is 30 minutes. **Check now** in the popup and options page can
run one explicit check while periodic polling remains disabled.

The popup's first tracking action also runs explicitly while periodic polling
is disabled. Manual requests are persisted and target their returned job ID, so
they are not replaced by an older queued product when the extension claims
work.

If a background poll claims that job at the same moment as the manual action,
the extension reconciles its local queue with the backend job status. Completed
or failed IDs are removed, retry-wait jobs retain their scheduled alarm, and a
manual job left by an obsolete extension context can move to the current profile
only after the user explicitly clicks the collection action. A concurrent poll
also schedules a prompt follow-up instead of leaving the manual request dormant.

When work is queued, the extension uses its stable local pricing-context key to
claim the job, opens the product in the last-focused normal Chrome window with
`active: false`, captures sanitised Shopee product and variation responses, and
closes the temporary tab after success or failure. The tab never receives focus,
although Chrome may show it briefly in the tab strip.

The first local extension that opts in or explicitly checks for work may claim a
new unbound product. That profile binding is retained for retries and future
refreshes. A different Chrome profile cannot silently collect the job, which
prevents comparisons across different Shopee accounts or voucher contexts.
An explicit manual collection may reassign an unclaimed pending, retry-wait, or
authentication-wait job after an extension reinstall; a live claimed lease is
never reassigned.

If the bound Chrome profile is signed out of Shopee, no snapshot or zero price
is stored. The job moves to `waiting_auth`, the extension displays a Chrome
notification and badge, and the popup/options page asks the user to sign in to
Shopee in that same profile. Authentication does not consume the remaining
retry attempts and does not create a failed price check. After signing in, click
**Check now** to resume that profile-bound job.

Run the focused automated checks:

```powershell
npm.cmd run test:phase8
```

See `docs/phase-8-chrome-session-collector.md` for the API, privacy boundaries,
failure behavior, and manual verification checklist.

## Phase 9 scheduled price checks

The server now uses `node-cron` to dispatch refresh jobs for active products.
The dispatcher does not open Playwright or wait for Chrome: it queues
profile-bound extension jobs sequentially, adds a configurable delay and
jitter between products, prevents overlapping runs, and writes structured run
summaries. The extension performs the asynchronous collection and can drain the
queue while background checks are enabled.

Collection failures follow one shared policy. The default is four total
attempts. Transport, timeout, rate-limit, Shopee 5xx, and premature-tab-close
errors use capped exponential backoff with additive jitter. Invalid URLs,
unavailable products, suspended shops, invalid payloads, and schema changes fail
without retry. Only a terminal failure creates one failed `price_checks` row;
retry waits and authentication waits create no checks and never create price
logs.

The relevant settings are:

| Variable                           |        Default | Purpose                                                 |
| ---------------------------------- | -------------: | ------------------------------------------------------- |
| `CRON_ENABLED`                     |         `true` | Enable scheduled dispatch                               |
| `CRON_SCHEDULE`                    | `0 */12 * * *` | Cron expression for dispatch runs                       |
| `COLLECTION_JOB_LEASE_MS`          |       `300000` | Claimed-job lease duration for large variant catalogues |
| `COLLECTION_MAX_ATTEMPTS`          |            `4` | Total claims, including the first attempt               |
| `COLLECTION_RETRY_BASE_DELAY_MS`   |         `5000` | Exponential retry base                                  |
| `COLLECTION_RETRY_MAX_DELAY_MS`    |       `300000` | Backoff-plus-jitter cap                                 |
| `COLLECTION_DISPATCH_DELAY_MIN_MS` |         `5000` | Minimum delay between queued products                   |
| `COLLECTION_DISPATCH_DELAY_MAX_MS` |        `10000` | Maximum delay between queued products                   |

Run the focused automated checks with `npm.cmd run test:phase9`. See
`docs/phase-9-scheduled-checks.md` for the state machine, error taxonomy,
shutdown behavior, and live verification checklist. The older `SCRAPE_*`
settings remain for retained Playwright tooling and do not control the Phase 9
production scheduler.

## Phase 10 Telegram notifications

Telegram notifications are optional. Tracking continues normally when either
`TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is absent. With both configured, a
qualifying context-safe price drop sends one HTML-safe alert after the price
history transaction commits. The alert includes the product, variant, old and
new VND prices, one-decimal reduction, price definition, pricing context, and
Shopee URL.

Temporary Telegram failures use a short bounded retry; permanent failures are
not retried indefinitely. A successful notification event is written only
after Telegram confirms delivery. The exact variant, price transition,
definition, type, context, and context key prevent repeat alerts. Telegram
failure never deletes or rolls back the stored price check.

Verify the configured bot token and destination without sending a message:

```powershell
npm.cmd run telegram:test
```

Run the focused automated coverage with `npm.cmd run test:phase10`. See
`docs/phase-10-telegram-notifications.md` for configuration, retry policy,
security details, and the live delivery checklist.

## Phase 11 web dashboard

Phase 11 is available at `http://127.0.0.1:3000` after starting the backend:

```powershell
npm.cmd start
```

The same-origin dashboard supports tracking, paginated product cards,
watchlist-wide product/variant/ID search, tracking-status and availability
filters, manual refresh, pause/resume, confirmed deletion, authentication when
enabled, and a filterable locally bundled Chart.js history view. Current and
retained prices show pricing context, voucher state, source, availability, and
variant lifecycle warnings. Missing observations create chart gaps and are
never stored or displayed as zero prices.

Tracking and refresh queue extension jobs asynchronously. If background checks
are disabled, click **Check now** in the extension after a dashboard action.
Phase 10 Telegram notifications run independently after a qualifying stored
price transition and do not change dashboard behavior.

Run the focused dashboard verification, including its local headless-Chrome
interaction check:

```powershell
npm.cmd run test:phase11
```

See `docs/phase-11-web-dashboard.md` for the UI contracts, security boundary,
warning policy, history semantics, and manual checklist.

This project has two browser modes:

- `npm.cmd run legacy:current` (also available as `npm.cmd run current`) uses the exact
  Chrome profile/window in which you click the extension icon. This is the
  default and is the right mode for your currently logged-in Shopee session.
- `npm.cmd run legacy:playwright` (also available as `npm.cmd run playwright`)
  uses Playwright attachment or a separate persistent
  automation profile.

Both modes now collect two kinds of prices:

- `get_pc` supplies each SKU's base promotional price and original price.
- The script maps every valid `item.models[*].extinfo.tier_index` to its
  on-page option buttons. It selects those options and captures Shopee's
  resulting `pdp/cart_panel/select_variation_pc` response, including the
  voucher-adjusted final display price.

The clicks are dispatched as browser input in the product tab, allowing
Shopee's own frontend to generate the current per-request security headers.
Directly replaying a `get_pc` signature for another endpoint can return HTTP 403. A failed variant remains visible with an error note; its base price is
never reported as its final display price.

After updating this project, click **Reload** for the unpacked extension on
`chrome://extensions`. Confirm that its version is **1.2.0**.

If a variant still prints `Final display: N/A`, inspect the extension service
worker from `chrome://extensions`. An HTTP 200 response without a recognized
price now logs its exact `selected_tiers` key and raw payload. The terminal
also reports the response's root/data keys, which distinguishes an
unrecognized response shape from a request that Shopee never issued.

## Mode 1: exact current Chrome profile

### Install the extension once

Install it in every Chrome profile that you may want to use:

1. Open `chrome://extensions` in that profile.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

```text
E:\NĂM 2026\huấn luyện\giáo án 2026\Phú Huy\Projects\shopee price\chrome-extension
```

5. Pin **Shopee Price - Current Profile** to the Chrome toolbar.

Chrome requests the `debugger` permission because the extension must inspect
the Shopee network response containing the product data. It only attaches to
the temporary product tab that it creates.

### Run with the current profile

Start the legacy local bridge:

```powershell
npm.cmd run legacy:current
```

Or provide another Shopee URL:

```powershell
npm.cmd run legacy:current -- "https://shopee.vn/your-product-i.123.456"
```

Then:

1. Focus the Chrome profile/window containing the Shopee login you want.
2. Click the **Shopee Price - Current Profile** extension icon in that window.

The extension opens a new tab in exactly that window and profile, so the tab
inherits its existing Shopee session. It closes only the temporary tab after
returning the product data to the terminal.

If several profiles are open, clicking the icon selects the profile
unambiguously because every profile has its own extension instance.

## Mode 2: Playwright or persistent automation profile

Run:

```powershell
npm.cmd run playwright
```

If there is no debuggable Chrome at `http://127.0.0.1:9222`, the script opens
Google Chrome with a persistent automation profile stored here:

```text
C:\Users\<your-user>\.shopee-price\chrome-profile
```

Log in to Shopee once in that window. The profile keeps its cookies, so later
runs remain logged in.

### Attach to an already-open debug-enabled Chrome

Playwright cannot attach to a Chrome window that was started normally. Start a
Chrome window with remote debugging and the same dedicated profile:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-address=127.0.0.1 `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:USERPROFILE\.shopee-price\chrome-profile"
```

Leave that Chrome window open, then run:

```powershell
npm.cmd run playwright
```

The script connects to it, creates a new tab in the existing context, extracts
the product data, closes only the tab it created, and disconnects. It does not
close your Chrome window.

For another debugging port:

```powershell
$env:CHROME_CDP_URL = "http://127.0.0.1:9223"
npm.cmd run playwright
```

If the connected browser exposes multiple contexts, the script prefers one
with an open Shopee tab, then one with a Shopee login cookie. To select a
specific zero-based context:

```powershell
$env:CHROME_CONTEXT_INDEX = "1"
npm.cmd run playwright
```

To store the persistent profile elsewhere:

```powershell
$env:CHROME_PROFILE_DIR = "D:\Browser Profiles\Shopee"
npm.cmd run playwright
```

## Code structure

- `product.js` parses product URLs and formats terminal output.
- `demo.js` is the small Playwright command entry point.
- `playwright-browser.js` owns Chrome connection and profile selection.
- `variant-pricing.js` adapts Playwright events and clicks to the shared flow.
- `current-profile.js` runs the local bridge used by the extension.
- `chrome-extension/background.js` contains only Chrome extension and CDP
  integration.
- `chrome-extension/shared/` is the single source of truth for pricing rules,
  variation-button selection, retries, and response ordering. It is used by
  both browser modes.

Keep Shopee response-shape changes in
`chrome-extension/shared/variant-core.js`; do not add separate price parsing
rules to the Playwright and extension adapters.

## Development

Run all checks:

```powershell
npm.cmd test
```

Run only the fast unit test:

```powershell
npm.cmd run test:variant
```
