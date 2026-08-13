# Troubleshooting guide

Start with the current v1.0.0 build and configuration:

```powershell
npm.cmd run extension:build
npm.cmd run db:migrate
npm.cmd start
```

Reload `dist/extension` from `chrome://extensions` after every extension source
change. Do not diagnose an older loaded build as though it were current source.

## Backend unavailable

Symptoms:

- extension shows **Backend unavailable**;
- snapshot uploads remain queued; or
- the dashboard does not open.

Checks:

1. Open `http://127.0.0.1:3000/api/health`.
2. Confirm the server terminal is still running.
3. Confirm extension Options uses exactly `http://127.0.0.1:3000` unless the
   configured port changed.
4. Confirm `.env` has a valid `PORT`, `HOST`, and `DATABASE_PATH`.
5. If another process owns the port, stop that process or choose another port
   and update extension Options.

Queued retryable snapshots are deliberately retained while the backend is
offline. Restart the backend and choose **Retry queue** if the alarm has not
already drained them.

## CORS_ORIGIN_DENIED or “request origin is not allowed”

The backend accepts only the exact configured extension origin.

1. Copy the ID of the loaded **Shopee Price Tracker** extension.
2. Set `.env` without a trailing slash:

   ```dotenv
   EXTENSION_ALLOWED_ORIGIN=chrome-extension://your-extension-id
   ```

3. Restart the backend; environment changes are not applied to an already
   running process.
4. Save extension Options again.

An old permanent 403 queue record will not retry automatically. Inspect that it
predates the corrected origin, then use **Clear failed snapshots**. Clearing is
permanent and should be limited to understood dead-letter records.

## “This action is restricted to extension pages”

This normally means Chrome is running an outdated build or the action originated
from a Shopee content script instead of the popup/options page.

1. Run `npm.cmd run extension:build`.
2. Click **Reload** for the unpacked extension.
3. Close old popup/options tabs.
4. Reopen Options from the extension card or toolbar menu and save again.

## Dashboard says queued but the extension sees no remaining job

The dashboard and extension have separate queues:

- **Price checks** are persistent backend collection jobs.
- **Snapshot uploads** are local extension submissions waiting for the API.

When periodic background collection is disabled, one explicit click claims one
backend job. Use **Collect next price check** in the popup or **Check now** in
Options. Reopen the popup to refresh its queue summary.

If the dashboard shows a terminal completed/failed job but the popup retained a
manual ID, click the explicit collection action once; the extension reconciles
that ID against the backend state.

## Job remains collecting

A claimed job uses a lease. Check:

- the temporary Shopee tab is still open and the page is responding;
- Chrome has a normal window available;
- the bound profile is signed in to Shopee;
- the extension was not reloaded while the job was running; and
- `COLLECTION_JOB_LEASE_MS` is longer than the extension's page work.

If Chrome or the backend stopped, do not modify the database manually. Restart
both and wait for lease expiry; the backend will recover the job to retry or a
terminal failure according to its attempt count.

## Waiting for Shopee sign-in

`AUTHENTICATION_REQUIRED` moves the job to `waiting_auth`. It creates no price
check or price log and does not consume automatic retries.

1. Sign in to `shopee.vn` in the same Chrome profile that owns the extension.
2. Keep a normal Chrome window open.
3. Choose **Check now**.

A different Chrome profile cannot silently collect a bound job because its
prices may use different account or voucher context.

## Product or variant price is not observed

HTTP success alone is insufficient. The collector requires the response to
correlate to the exact `selected_tiers` key and model ID. Shopee may omit the
selected-variation response or expose no exact price.

Expected safe behavior:

- catalogue identity remains present;
- `priceObservation` is `not_observed`;
- no zero, range, stale, or other-variant amount is stored;
- history shows a gap; and
- an available variantless product may retry with `PRICE_SELECTOR_TIMEOUT`.

Enable sanitised debug summaries temporarily only when needed. Do not log or
copy raw network payloads. If the response shape changed, follow the fixture
workflow in [developer-guide.md](developer-guide.md).

## Availability or stock is unknown

Known stock comes from exact correlated API evidence. Positive `data.stock`
means available and zero means sold out. Missing, redacted, negative, malformed,
failed, or mismatched stock remains unknown.

Do not infer availability from generic page text, recommendation cards,
quantity controls, or the presence of an Add to Cart button. A conservative DOM
sold-out fallback exists only for positively identified products without visible
variants when all API stock is redacted.

## Popup shows the wrong selected variant

Confirm the extension manifest shows v1.0.0. Rebuild and reload if needed. The
popup's current variant, price, stock, availability, and voucher come from the
latest current-page capture. Full-catalogue minimums belong only to collection
coverage/status.

If the variant changed before Shopee emitted a matching response, wait briefly
or trigger the selection once more. Another variant's price must not appear as a
fallback.

## History chart is empty, lower than expected, or has gaps

- Choose the correct variant and date range.
- Each variant and pricing-context key is a separate dataset.
- Sold-out/unavailable observations are not current purchasable minimums.
- A known failed price observation is a deliberate null gap.
- The displayed product minimum is not copied into every variant series.

Reload the dashboard after a collection finishes. If the API history is correct
but the dialog is stale, close and reopen it; the dashboard destroys the previous
Chart.js instance before rendering the next one.

## Telegram is disabled or no alert arrives

Both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` must be present in the backend
environment. Restart after editing `.env`, then run:

```powershell
npm.cmd run telegram:test
```

This verifies the bot and destination without sending. Also confirm:

- the new price is lower than the immediately previous comparable observation;
- the percentage meets the product threshold;
- both prices share variant, definition, type, context, key, and source;
- the current observation is available;
- it is not the initial or a reactivation baseline; and
- the exact transition was not already delivered.

Telegram failure does not remove the saved price history. Tokens and chat IDs
must never be pasted into issue reports or logs.

## Scheduler does not collect products

The scheduler only dispatches jobs. Verify:

- `CRON_ENABLED=true` and `CRON_SCHEDULE` is valid;
- the product is active rather than paused;
- no earlier active job already exists for that product;
- the extension has **Allow background price checks** enabled;
- Chrome is running with a normal window; and
- the bound profile is signed in to Shopee.

The extension's poll interval is independent of the cron expression. Use one
manual **Check now** to distinguish dispatch problems from polling delay.

## Database migration or checksum failure

Do not edit a migration that has already been applied. Restore the original
migration from the matching release, or restore a consistent database backup.
Future schema changes require a new numbered migration.

Before replacing a database:

1. stop the server cleanly;
2. preserve the current file as a private backup;
3. restore a database created by the same or an older compatible release; and
4. run `npm.cmd run db:migrate` before starting normally.

Never delete an unknown `.db-wal` or `.db-shm` file while the server is running.

## Tests or extension build fail with spawn EPERM

On restricted Windows shells, Vitest, Playwright, or esbuild may be prevented
from spawning a worker. This is an environment permission failure rather than a
test assertion. Run the same command in a normal local PowerShell with access to
the repository and Node.js child processes.

If the failure persists outside a restricted shell, confirm antivirus policy,
Node.js compatibility, dependency installation, and write access to `dist` and
the operating-system temporary directory.

## Release preparation fails

`npm.cmd run release:prepare` requires:

- application, server, shared package, and MVP extension versions to match;
- a successful fresh extension build;
- every ordered database migration; and
- the release documentation files.

The exporter only removes its exact versioned directory under `dist/releases`.
It then writes an unpacked extension, empty schema backup, raw migrations,
release manifest, and checksums. Generated release files are intentionally
ignored by Git.
