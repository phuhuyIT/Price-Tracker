# Shopee Variant Price Collector

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
> Existing collector behavior is intentionally preserved as legacy discovery
> tooling.
> The persistent-profile Playwright mode described below is legacy discovery
> behavior; the target MVP uses anonymous Playwright contexts and relies on the
> extension for prices from the user's current Shopee session.

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

For a manual isolated-browser connectivity check:

```powershell
npm.cmd run collector:manual -- "https://shopee.vn/product-i.shop.item"
```

This Phase 2 command opens a fresh anonymous browser context and verifies page
navigation only; Shopee response extraction is implemented in a later phase.

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

Current product prices remain separated by pricing context and context key. If
both contexts exist, summaries prefer the extension's `user_session` price and
retain the anonymous Playwright price with its provenance.

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

The required `POST /api/products/track` and manual-refresh contracts are in
place. Until Phase 8 injects the anonymous Playwright collector, a new URL or
refresh returns the explicit `COLLECTOR_UNAVAILABLE` response. Tracking a URL
that already exists returns its stored summary without invoking a collector.

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

The extension previews valid captures in its popup. Automatic submission is off
by default; click **Track Product** to submit. The options page configures the
backend, debug summaries, the generated local pricing-context key, queue retry,
and optional price-tracker sign-in. It never captures or sends Shopee cookies,
headers, or authentication data.

The full manual procedure, including variant, voucher, quantity, offline queue,
browser restart, and enabled/disabled authentication cases, is in
`docs/phase-7-chrome-extension.md`.

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
Directly replaying a `get_pc` signature for another endpoint can return HTTP
403. A failed variant remains visible with an error note; its base price is
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
