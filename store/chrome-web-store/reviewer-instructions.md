# Chrome Web Store reviewer instructions

Shopee Price Tracker is a local-only extension with a companion Node.js backend. The popup can
preview a supported product capture, while watchlist, history, upload, and scheduled collection
features require the local backend.

No Store reviewer account is required. Application authentication is disabled in the standard
local setup.

## Reproducible setup

1. Download the source associated with the submitted release version from
   `https://github.com/phuhuyIT/Price-Tracker`.
2. Install Node.js 20 or newer.
3. Run `npm.cmd ci` on Windows or `npm ci` on macOS/Linux.
4. Copy `.env.example` to `.env`.
5. Set `CRON_ENABLED=false` for the first manual check.
6. Set `EXTENSION_ALLOWED_ORIGIN` to the exact origin of the Store-installed extension.
7. Run `npm.cmd run db:migrate` and `npm.cmd start`.
8. Open extension Options, keep the backend URL at `http://127.0.0.1:3000`, and save.

## Core review flow

1. Open a public Shopee Vietnam product page with a URL containing
   `-i.<shop-id>.<item-id>`.
2. Wait for the product details to finish loading.
3. Open the extension popup. It should identify the supported page and show the captured title,
   selected variant, price when exact evidence is available, availability, and stock when exposed.
4. Click **Track & collect available prices**.
5. Open `http://127.0.0.1:3000` and confirm the product and price-check queue appear.
6. Queue a refresh from the dashboard, then click **Collect next price check** in the extension.
7. Confirm an inactive Shopee tab opens, the job progresses from queued to collecting, and the tab
   closes after completion.

Shopee can occasionally withhold exact variant prices or require sign-in. The extension reports a
truthful gap or sign-in requirement instead of creating a zero or guessed observation.

## Privacy verification

- Automatic submission and scheduled collection are disabled by default.
- The backend URL accepts only `localhost` or `127.x.x.x` HTTP origins without paths.
- The manifest declares no arbitrary HTTPS backend access.
- The extension transmits sanitised snapshots, not cookies, Shopee credentials, headers, addresses,
  payment details, or raw API responses.
- The extension executes no remotely hosted code.
