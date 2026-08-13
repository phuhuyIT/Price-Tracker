# Shopee Price Tracker

Shopee Price Tracker v1.0.0 is a local-first Shopee Vietnam price-history
application. A Chrome Manifest V3 extension observes the prices exposed to the
user's current Shopee session, a Node.js backend stores variants and history in
SQLite, a responsive dashboard manages the watchlist, and optional Telegram
alerts report genuine price reductions.

This release is designed for one local computer. The backend binds to loopback,
the database remains on that computer, and the extension is loaded unpacked.
Public hosting, Chrome Web Store distribution, and multi-device sync are outside
the v1.0.0 boundary.

## Price definition

The tracked price is:

> The price displayed by Shopee to the observing browser session after applicable
> product discounts and vouchers, excluding shipping fees.

Its stable identifier is `displayed_post_voucher_excluding_shipping`. Every
stored amount is a positive integer number of VND. A missing, malformed,
unavailable, uncorrelated, or zero price is never substituted with another
variant's price and never creates a price log. Known missing observations become
gaps in history.

Voucher eligibility, account state, quantity, time, and Shopee experiments can
change the displayed amount. The tracker records an observation, not a guaranteed
checkout total.

## Architecture

```text
Shopee product page
  -> MAIN-world response interceptor
  -> isolated extension bridge and shared normaliser
  -> persistent extension upload queue
  -> Express API
  -> services and repositories
  -> SQLite history
  -> optional Telegram alert

node-cron -> persistent collection jobs -> signed-in Chrome extension
Express -> same-origin dashboard -> product and history APIs
```

Production manual and scheduled checks are performed by `apps/extension` in the
Chrome profile already signed in to Shopee. Playwright remains anonymous
discovery and integration-test tooling; it does not receive or persist the
user's Shopee profile.

The detailed boundaries are documented in
[docs/architecture.md](docs/architecture.md) and
[docs/developer-guide.md](docs/developer-guide.md).

## Prerequisites

- Windows, macOS, or Linux capable of running Node.js 20 or newer
- npm and the checked-in `package-lock.json`
- Google Chrome 116 or newer
- a normal Chrome profile signed in to Shopee Vietnam for reliable collection
- optional Telegram bot and destination chat

Playwright Chromium is required for the complete test suite and retained
anonymous tooling, but not for normal extension-based production collection.

## Quick start

Run these commands from the repository root. Windows PowerShell examples use
`npm.cmd`; use `npm` on platforms where that is the normal executable.

1. Install the locked dependencies and create private configuration:

   ```powershell
   npm.cmd ci
   Copy-Item .env.example .env
   ```

2. Run the database migrations and build the MVP extension:

   ```powershell
   npm.cmd run db:migrate
   npm.cmd run extension:build
   ```

3. Open `chrome://extensions`, enable **Developer mode**, choose **Load
   unpacked**, and select `dist/extension`.

4. Copy the extension ID shown by Chrome. Set its exact origin in `.env`:

   ```dotenv
   EXTENSION_ALLOWED_ORIGIN=chrome-extension://your-extension-id
   ```

5. Start the backend:

   ```powershell
   npm.cmd start
   ```

6. Open the extension's **Options** page. Keep the backend URL at
   `http://127.0.0.1:3000`, save, and confirm **Backend connected**. Background
   collection and automatic capture are intentionally disabled by default in
   the extension.

7. Open `http://127.0.0.1:3000`, add a valid Shopee Vietnam product URL, then
   use **Collect next price check** or **Check now** in the extension if
   background collection remains disabled.

The full first-install procedure and validation checklist are in
[docs/setup.md](docs/setup.md).

## Normal workflow

- Add a Shopee URL from the dashboard or track the product currently shown in
  the extension popup.
- Watch the dashboard's **Price check queue** for pending, collecting,
  retry-waiting, or Shopee-sign-in-waiting jobs.
- Use the extension popup to inspect the current selected variant, displayed
  price, availability, stock quantity when exposed, and collection coverage.
- Open dashboard history to compare separate variant and pricing-context series.
- Enable **Allow background price checks** only after one manual collection
  succeeds in the intended Chrome profile.
- Pause products that should not receive scheduled jobs; delete only disposable
  products after confirming the cascade warning.

## Configuration

Startup validates every environment value. Invalid configuration fails with a
clear error before the server begins listening.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, or `production` behavior |
| `HOST` | `127.0.0.1` | HTTP bind host; must be loopback when authentication is disabled |
| `PORT` | `3000` | Backend and dashboard port |
| `DATABASE_PATH` | `./data/shopee-tracker.db` | Persistent SQLite file |
| `AUTH_ENABLED` | `false` | Require price-tracker application sessions |
| `AUTH_ALLOW_REGISTRATION` | `false` | Expose account creation when authentication is enabled |
| `AUTH_SESSION_TTL_HOURS` | `720` | Application session lifetime |
| `COLLECTION_JOB_LEASE_MS` | `300000` | Claimed extension-job lease |
| `COLLECTION_MAX_ATTEMPTS` | `4` | Total retry-budget claims |
| `COLLECTION_RETRY_BASE_DELAY_MS` | `5000` | Collection retry base delay |
| `COLLECTION_RETRY_MAX_DELAY_MS` | `300000` | Collection retry delay cap |
| `COLLECTION_DISPATCH_DELAY_MIN_MS` | `5000` | Minimum delay between scheduled products |
| `COLLECTION_DISPATCH_DELAY_MAX_MS` | `10000` | Maximum delay between scheduled products |
| `CRON_ENABLED` | `true` | Enable scheduled job dispatch |
| `CRON_SCHEDULE` | `0 */12 * * *` | node-cron dispatch expression |
| `SHOPEE_HEADLESS` | `true` | Retained anonymous Playwright mode |
| `SHOPEE_PRICE_SCALE` | `100000` | Verified raw Shopee price divisor |
| `SCRAPE_TIMEOUT_MS` | `45000` | Retained Playwright timeout |
| `SCRAPE_DELAY_MIN_MS` | `5000` | Retained Playwright minimum delay |
| `SCRAPE_DELAY_MAX_MS` | `10000` | Retained Playwright maximum delay |
| `SCRAPE_MAX_RETRIES` | `2` | Retained Playwright retry limit |
| `PRICE_DROP_THRESHOLD_PERCENT` | `1` | Default product alert threshold |
| `VARIANT_MISSING_THRESHOLD` | `3` | Verified complete misses before inactivity |
| `MAX_VARIANT_MISSING_RATIO` | `0.5` | Mass-disappearance quarantine threshold |
| `VARIANT_MASS_MISSING_CONFIRMATIONS` | `2` | Matching suspicious catalogues required |
| `TELEGRAM_BOT_TOKEN` | empty | Optional Telegram Bot API token |
| `TELEGRAM_CHAT_ID` | empty | Optional Telegram destination |
| `TELEGRAM_REQUEST_TIMEOUT_MS` | `3000` | Telegram request timeout |
| `TELEGRAM_MAX_ATTEMPTS` | `2` | Total Telegram delivery attempts |
| `TELEGRAM_RETRY_BASE_DELAY_MS` | `500` | Telegram retry base delay |
| `TELEGRAM_RETRY_MAX_DELAY_MS` | `2000` | Telegram retry delay cap |
| `EXTENSION_ALLOWED_ORIGIN` | empty | Exact allowed MVP extension origin |
| `API_RATE_LIMIT_WINDOW_MS` | `60000` | API rate-limit window |
| `API_RATE_LIMIT_MAX` | `60` | Product mutations allowed per window |
| `LOG_LEVEL` | `info` | Pino log level, including `silent` |

The `SCRAPE_*`, `SHOPEE_HEADLESS`, and anonymous Playwright settings do not
control production scheduled collection. The scheduler creates persistent jobs;
the installed extension performs them.

## Authentication modes

### Disabled local mode

`AUTH_ENABLED=false` is the v1.0.0 default. Product routes transparently use one
reserved passwordless local owner. Authentication endpoints return
`AUTH_DISABLED`, account controls remain hidden, and startup rejects a
non-loopback `HOST`.

### Enabled account mode

Set both values while creating the first account:

```dotenv
AUTH_ENABLED=true
AUTH_ALLOW_REGISTRATION=true
```

Restart the backend, register through the dashboard, then sign in separately in
the extension Options page so it receives its bearer session. Set
`AUTH_ALLOW_REGISTRATION=false` and restart after the required accounts exist.

Dashboard sessions use an HTTP-only cookie. Extension sessions use an opaque
bearer token stored in trusted extension storage. SQLite stores only token
hashes. Signing out calls `/api/auth/logout`, revokes the presented server-side
session, and removes the client copy. Sessions also expire after
`AUTH_SESSION_TTL_HOURS`.

The reserved local owner's products are not transferred automatically to a
registered user when authentication is enabled.

## Database

The backend uses one `better-sqlite3` connection with foreign keys, WAL mode,
and ordered checksummed migrations. Migrations run automatically at startup and
can be applied explicitly:

```powershell
npm.cmd run db:migrate
```

To back up live data, stop the server cleanly and copy the configured database
file. Keep backups private because product history and application account data
belong to the local user. Do not copy an actively changing `.db`, `.db-wal`, and
`.db-shm` set independently.

The release bundle contains an empty current schema snapshot plus all source
migrations. It contains no user data.

## Extension installation and configuration

Always load `dist/extension`, not `apps/extension` and not the legacy
`chrome-extension` discovery tool. After source updates:

```powershell
npm.cmd run extension:build
```

Then click **Reload** on the unpacked extension card. For v1.0.0, its manifest
version must show `1.0.0`. If Chrome assigns a different extension ID after
reinstallation, update `EXTENSION_ALLOWED_ORIGIN`, restart the backend, and save
extension options again.

The extension never sends Shopee cookies, request headers, tokens, account IDs,
addresses, or raw API responses to the backend.

## Scheduler

The default cron expression dispatches active products every 12 hours. One
process-level lock prevents overlapping runs, and products are queued
sequentially with configured delay and jitter. The Chrome extension must have
**Allow background price checks** enabled to drain jobs automatically.

For an initial installation, it is reasonable to keep `CRON_ENABLED=false`
until manual collection succeeds. Restore the intended schedule afterward.

## Telegram

Leave either Telegram credential empty to disable notifications without
affecting tracking. To enable them:

1. Create a bot with BotFather and start a chat or add it to the destination.
2. Put `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` only in the ignored `.env`.
3. Verify access without sending a message:

   ```powershell
   npm.cmd run telegram:test
   ```

A notification event is recorded only after Telegram confirms delivery. A
delivery failure never rolls back price history, and the same successful price
transition is not sent twice.

## Retained anonymous Playwright tooling

Install its Chromium binary with:

```powershell
npm.cmd run playwright:install
```

The safe connectivity command uses a fresh anonymous context:

```powershell
npm.cmd run legacy:anonymous-connectivity -- "https://shopee.vn/product-i.shop.item"
```

It does not sign in, load the user's Chrome profile, or perform production
scheduled checks. The older root-level and `chrome-extension` tools remain only
for discovery and regression compatibility.

## Fixture maintenance

When Shopee changes a recognised response, capture a new allowlisted fixture
through the retained current-profile bridge:

```powershell
npm.cmd run legacy:current -- "https://shopee.vn/product-i.shop.item" --fixture "tests/fixtures/new-capture.json"
```

The destination must not already exist. Review the output for only public
product/model, selected-tier, stock, and pricing evidence. Never commit cookies,
headers, request signatures, authentication data, addresses, or a raw response.
See [docs/developer-guide.md](docs/developer-guide.md) for the complete fixture
and adapter workflow.

## Development and tests

```powershell
npm.cmd run dev
npm.cmd run lint
npm.cmd run format:check
npm.cmd run test:foundation
npm.cmd run test:phase7
npm.cmd run test:phase9
npm.cmd run test:phase10
npm.cmd run test:phase11
npm.cmd run test:phase12
```

`npm.cmd run test:phase12` is the complete automated gate: linting, formatting,
all Vitest tests, the deterministic extension build, dashboard Chromium flow,
and retained collector integrations. Automated fixtures do not replace a live
Chrome/Shopee or Telegram acceptance check.

## Release build

Create the ignored local release bundle with:

```powershell
npm.cmd run release:prepare
```

The output is `dist/releases/shopee-price-tracker-v1.0.0` and contains the
loadable unpacked extension, setup documentation, `.env.example`, the empty
current SQLite schema, all migrations, a release manifest, and SHA-256
checksums. See [docs/release.md](docs/release.md).

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md) for installation errors,
extension-origin CORS failures, backend connectivity, queue recovery, Shopee
sign-in waits, missing exact prices, scheduler behavior, Telegram errors, and
database recovery.

## Privacy and security

- The v1.0.0 backend is local-only and unauthenticated mode is loopback-only.
- Shopee credentials remain inside the user's browser page context.
- Captures and fixtures use strict allowlists; raw responses are rejected by the
  backend.
- Application session tokens and collection lease tokens are stored only as
  hashes in SQLite.
- Telegram credentials, chat IDs, passwords, tokens, request bodies, and message
  text are redacted from structured logs.
- Environment files, databases, logs, browser profiles, generated builds, and
  debug fixtures are ignored by Git and checked by automated privacy tests.
- The project does not bypass CAPTCHA, authentication, rate limits, or anti-bot
  protections.

## Known limitations

- Shopee Vietnam and Chrome are the only production platform/browser pair.
- Shopee endpoints are private and may change without notice.
- A signed-in browser does not guarantee that Shopee emits every exact variant
  price on every attempt; safe gaps may remain.
- The tracker cannot guarantee voucher eligibility or the final checkout total.
- Shipping is deliberately excluded.
- Background jobs require the bound Chrome profile and installed extension.
- Telegram depends on the external Bot API.
- The local SQLite design supports one backend process, not a hosted cluster.
- Chrome Web Store distribution, hosted HTTPS operation, mandatory multi-user
  authentication, and multi-device sync require a separate deployment and
  security phase.

Historical phase evidence remains under `docs/phase-*.md`. The current release
instructions in this README, [docs/setup.md](docs/setup.md), and
[docs/troubleshooting.md](docs/troubleshooting.md) take precedence when an older
phase record describes a superseded implementation plan.
