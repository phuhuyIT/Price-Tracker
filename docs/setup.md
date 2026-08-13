# Setup guide

This guide installs Shopee Price Tracker v1.0.0 on one local computer. The
backend, database, dashboard, and unpacked Chrome extension stay on that
computer.

## 1. Install prerequisites

Install:

- Node.js 20 or newer;
- npm;
- Google Chrome 116 or newer; and
- Git if the repository was not supplied as a source archive.

Confirm the runtime:

```powershell
node --version
npm.cmd --version
```

The Node.js version must satisfy the root package's `>=20` engine.

## 2. Install dependencies

From the repository root:

```powershell
npm.cmd ci
```

Use `npm.cmd ci` for a reproducible installation from `package-lock.json`.
`better-sqlite3` uses a native binary; if npm cannot obtain a compatible
prebuild, install the compiler prerequisites reported by npm and retry with a
supported Node.js release.

## 3. Create private configuration

```powershell
Copy-Item .env.example .env
```

Do not commit `.env`. For the first manual collection, these values are safe:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=./data/shopee-tracker.db
AUTH_ENABLED=false
AUTH_ALLOW_REGISTRATION=false
CRON_ENABLED=false
EXTENSION_ALLOWED_ORIGIN=
```

The rest of `.env.example` may stay at its defaults. `CRON_ENABLED=false` is an
installation convenience; enable the intended schedule after a manual check
passes.

## 4. Prepare the database

```powershell
npm.cmd run db:migrate
```

This creates the configured directory and database, enables foreign keys and
WAL mode, and applies every ordered migration. Startup also runs migrations, so
the explicit command is a preflight rather than a separate schema source.

Never edit an already-applied migration. Add a new numbered migration for future
changes.

## 5. Install Playwright Chromium

Normal collection uses Chrome and the MVP extension. Install Playwright
Chromium for the full verification suite and retained anonymous tooling:

```powershell
npm.cmd run playwright:install
```

Playwright must not load the user's Chrome profile or persist a Shopee login.

## 6. Build and load the MVP extension

```powershell
npm.cmd run extension:build
```

Then:

1. Open `chrome://extensions` in the Chrome profile used for Shopee.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the generated `dist/extension` directory.
5. Confirm the extension is named **Shopee Price Tracker** and its version is
   `1.0.0`.
6. Copy the extension ID from its card.

Do not load `apps/extension` directly. It contains unbundled module sources.
Do not load `chrome-extension` for the MVP workflow; that directory is retained
legacy discovery tooling with a separate version.

## 7. Allow the exact extension origin

Update `.env` with the ID copied from Chrome:

```dotenv
EXTENSION_ALLOWED_ORIGIN=chrome-extension://your-extension-id
```

Replace the placeholder with the ID shown by that Chrome installation. Do not
include a trailing slash or path.

## 8. Start the backend and dashboard

```powershell
npm.cmd start
```

Expected endpoints:

```text
http://127.0.0.1:3000/api/health
http://127.0.0.1:3000
```

The first URL returns the standard success envelope. The second opens the
dashboard. Keep the terminal open while using the application.

## 9. Configure the extension

1. Open the extension's **Options** page from `chrome://extensions`.
2. Set **Backend URL** to `http://127.0.0.1:3000`.
3. Leave **Submit valid captures automatically** off for the first check.
4. Leave **Allow background price checks** off for the first check.
5. Leave sanitised debug summaries off unless diagnosing capture behavior.
6. Save and confirm **Backend connected** and **Settings saved**.

The options page must be opened as an extension page. Do not copy its HTML URL
into an ordinary website frame.

## 10. Perform the first collection

1. Sign in to `shopee.vn` in the same Chrome profile.
2. Open a Shopee product URL containing `-i.<shop-id>.<item-id>`.
3. Wait for the product page to finish its initial requests.
4. Open the extension popup and confirm the product title and current selected
   variant appear.
5. From the dashboard, add the product URL, or click **Track & collect available
   prices** in the popup.
6. If the job waits in the dashboard queue, click **Collect next price check**
   in the popup or **Check now** in Options.
7. Confirm the temporary product tab remains inactive and closes after the job.
8. Confirm both **Price checks** and **Snapshot uploads** return to empty.
9. Reload the dashboard and inspect the product, variants, positive integer VND
   prices, stock when known, and history.

A successful catalogue with no exact prices is not equivalent to a priced
success. The UI reports priced coverage and stores gaps truthfully.

## 11. Enable scheduled collection

After the manual check succeeds:

1. Set `CRON_ENABLED=true` and the desired `CRON_SCHEDULE` in `.env`.
2. Restart the backend.
3. Enable **Allow background price checks** in extension Options.
4. Keep Chrome running with a normal window available and the bound profile
   signed in to Shopee.

The default schedule is every 12 hours. The backend dispatches jobs; the
extension performs the actual collection.

## 12. Optional Telegram setup

1. Create a bot with BotFather.
2. Start a private chat with it, or add it to the intended group/channel.
3. Put both credentials in `.env`:

   ```dotenv
   TELEGRAM_BOT_TOKEN=your-private-token
   TELEGRAM_CHAT_ID=your-private-destination
   ```

4. Restart the backend.
5. Verify the configuration without sending a message:

   ```powershell
   npm.cmd run telegram:test
   ```

The first stored price is a baseline and never sends a price-drop alert.

## 13. Optional application authentication

Shopee sign-in and price-tracker authentication are separate.

To enable price-tracker accounts:

1. Set `AUTH_ENABLED=true` and temporarily set
   `AUTH_ALLOW_REGISTRATION=true`.
2. Restart the backend and register through the dashboard.
3. Sign in through extension Options using the same account.
4. Set `AUTH_ALLOW_REGISTRATION=false` and restart when registration should
   close.

Dashboard and extension sessions are separate and independently revocable by
signing out from each client. Enabling authentication does not transfer data
from the reserved local owner.

## 14. Verify the installation

Run the complete automated gate:

```powershell
npm.cmd run test:phase12
```

Then run the release exporter:

```powershell
npm.cmd run release:prepare
```

The release command must report v1.0.0, schema v4, and a versioned directory
under `dist/releases`.

If any step fails, continue with [troubleshooting.md](troubleshooting.md).
