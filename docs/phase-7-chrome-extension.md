# Phase 7 — Chrome Extension Collector

Status: **implemented and automatically verified on 2026-08-01; live Chrome checklist pending**

## Boundary

The loadable extension is generated in `dist/extension`. It captures only the
two configured Shopee product endpoints in the active page session and never
reads or forwards cookies, request headers, response headers, Shopee tokens, or
raw responses.

The source extension under `apps/extension` and the preserved discovery tool
under `chrome-extension` are separate:

- `apps/extension` is the Phase 7 price-tracker extension.
- `chrome-extension` is the legacy exact-current-profile bridge used by
  `npm.cmd run legacy:current`.

Do not load both folders expecting them to provide the same workflow.

## Capture pipeline

1. `content/page-interceptor.js` runs in `MAIN` at `document_start`, wraps both
   `fetch` and `XMLHttpRequest`, clones matching responses, and posts an
   allowlisted evidence object.
2. `content/content-bridge.js` runs in the isolated extension world. It checks
   the message source, page origin, Shopee hostname, protocol version, and the
   strict capture schema.
3. The bridge assembles the verified `get_pc` model catalogue with exactly
   correlated `select_variation_pc` or `select_variant_pc` evidence. A variation
   response alone never claims complete catalogue coverage.
4. The shared normaliser emits the Phase 3 snapshot contract. Model presence
   remains independent from price success, so a present model with a missing or
   malformed price becomes `not_observed`, never zero or absent. Exact
   non-negative selected-variant stock is retained as `stockQuantity`; redacted,
   negative, failed, or uncorrelated stock becomes `null`.
5. The service worker validates the snapshot again and keeps the latest capture
   for the popup. Because automatic capture defaults to off, submission begins
   only when the user clicks **Track Product**.

If purchase quantity changes, or the same selected tier returns changed price,
voucher, availability, or stock evidence, previously assembled variation
captures are cleared before the new context is used. This avoids combining
stale evidence from different displayed states in one snapshot.

## Settings and local identity

The options page configures:

- backend origin, defaulting to `http://127.0.0.1:3000`
- automatic capture, defaulting to off
- sanitised debug summaries, defaulting to off
- a random per-installation pricing-context key

Plain HTTP is accepted only for loopback backends. Remote backends must use
HTTPS and Chrome asks for that exact optional origin when settings are saved.
The generated context key contains no Shopee account identifier and is read-only
except for an explicit regenerate action.

## Popup quick watch

The popup shows up to five compact tracked-product rows. Products pinned by the
user are ordered first; any unfilled positions use the backend's most recently
updated tracked products. Each row shows the product name, current lowest price
or explicit availability state, and whether it is pinned or recent.

The popup search uses the existing owner-scoped `GET /api/products` search, so
it searches the complete watchlist by product title, variant name, shop ID, or
item ID rather than filtering only the five visible rows. Pinning is capped at
five products. Pin IDs are kept in trusted `chrome.storage.local`, scoped by
backend origin and price-tracker user, and are never sent to Shopee. A pin for a
product that has since been deleted is removed the next time the shortlist is
loaded.

## Persistent queue

`chrome.storage.local` contains at most 50 exact snapshots. Content-script
access to extension storage is restricted where the Chrome version supports
`TRUSTED_CONTEXTS`.

- Network errors, timeouts, HTTP 408/425/429, and server errors use bounded
  exponential retries.
- Five failed attempts stop automatic retry but retain the snapshot for an
  explicit retry.
- Validation and other permanent failures are retained as failed records and
  are not retried automatically.
- HTTP 401 and revoked/expired price-tracker sessions retain records as
  `blocked_auth`. Successful sign-in releases them.
- Successful records are removed. Exact records already in the queue are not
  added twice.
- When the 50-item bound is reached, the extension rejects the new item and
  reports `QUEUE_FULL` instead of silently deleting older data.

`chrome.alarms` wakes bounded retries after the MV3 service worker stops. Queue
writes and submissions are serialised inside the worker.

## Application authentication

The options page probes `/api/auth/me`:

- `AUTH_DISABLED` hides all account controls and no bearer token is attached.
- An enabled backend shows sign-in/sign-out controls.
- Extension login requests `clientType = extension` and stores the returned
  opaque price-tracker token in trusted extension storage.
- The token is attached only while the probed mode is enabled. It is never sent
  to Shopee and is never included in a captured snapshot.

The server must allow the exact extension origin:

```powershell
$env:EXTENSION_ALLOWED_ORIGIN = "chrome-extension://<extension-id>"
```

## Build and automated verification

The build bundles all JavaScript locally with esbuild, generates deterministic
PNG icons, rejects remote executable imports, and verifies every manifest file
reference.

Run:

```powershell
npm.cmd run test:phase7
```

The focused suite covers:

- complete and partial-price catalogue assembly
- exact variation correlation and synthetic-default handling
- capture privacy allowlisting
- fetch cloning and unrelated-response filtering
- queue classification, bounds, deduplication, and retry policy
- persistent service-worker success, temporary, authentication, permanent, and
  retry-exhaustion transitions
- extension-origin CORS and grouped backend persistence from the new normaliser
- backend URL, automatic-capture, and context-key settings
- the final loadable MV3 build

## Manual test setup

1. Start from a separate manual database:

   ```powershell
   $env:DATABASE_PATH = ".\data\manual-phase7.db"
   $env:AUTH_ENABLED = "false"
   $env:CRON_ENABLED = "false"
   npm.cmd start
   ```

2. Build the extension:

   ```powershell
   npm.cmd run test:phase7
   ```

3. Open `chrome://extensions`, enable **Developer mode**, choose **Load
   unpacked**, and select `dist/extension`.
4. Copy the generated extension ID from its card.
5. Stop the backend, add its exact origin, and start it again:

   ```powershell
   $env:EXTENSION_ALLOWED_ORIGIN = "chrome-extension://<extension-id>"
   npm.cmd start
   ```

6. Open the extension Options page. Keep **automatic capture off**, confirm the
   backend is connected, and confirm account controls are hidden.

## Manual test checklist

Use a Shopee Vietnam product URL containing `-i.<shop-id>.<item-id>`.

- [ ] Initial load: reload the product page, open the popup, and confirm title,
      displayed price, selected variant, and voucher status appear.
- [ ] Manual track: click **Track Product** and confirm the popup reports
      success. `GET /api/products` should include the product.
- [ ] Duplicate response: click **Track Product** again without a new capture.
      The backend should return an idempotent replay and history should not gain
      a second check.
- [ ] Variant change: select another variant and confirm the popup updates to
      the exact selected variant and price.
- [ ] Voucher change: apply/remove an eligible voucher and confirm price and
      voucher status update without exposing voucher contents.
- [ ] Quantity change: change quantity and confirm stale prices from the prior
      quantity are not combined into the new snapshot.
- [ ] Dynamic refresh: wait for or trigger a Shopee price refresh and confirm
      Shopee's page request still completes normally.
- [ ] Privacy: inspect the extension service-worker POST body. It may contain
      the normalised snapshot and, only in enabled app-auth mode, a price-tracker
      bearer header. It must not contain Shopee cookies, headers, tokens, raw
      responses, account IDs, addresses, or voucher contents.
- [ ] Backend unavailable: stop the backend, create a new capture, click Track,
      and confirm the popup shows a queued retry.
- [ ] Browser restart: with the backend still stopped, restart Chrome and
      confirm the queued count remains in Options.
- [ ] Queue drain: restart the backend and click **Retry queue** (or wait for the
      alarm). Confirm the queue empties after success.
- [ ] Unsupported page: open a non-product or non-Shopee page and confirm Track
      is disabled.
- [ ] Quick watch fallback: with fewer than five pins, confirm pinned products
      appear first and recent tracked products fill the remaining positions.
- [ ] Quick pin search: search by a product or variant name, pin a result, close
      and reopen the popup, and confirm the pin persists. Confirm a sixth pin is
      blocked until another product is unpinned.
- [ ] Automatic capture: enable it temporarily, cause one semantic price
      change, and confirm it submits once. Restore it to off afterward.

## Authentication-enabled checks

Restart the backend with `AUTH_ENABLED=true`. If needed, temporarily enable
registration and create an account through `POST /api/auth/register` using
`clientType: "extension"`; then sign in through Options.

- [ ] Account controls appear only when authentication is enabled.
- [ ] A valid sign-in allows queued snapshots to submit with the app bearer
      token.
- [ ] Sign out, capture another product state, and confirm it remains
      `blocked_auth` rather than being discarded.
- [ ] Sign in again and confirm blocked records drain.
- [ ] Revoke a stored session on the backend while leaving it in extension
      storage, then submit. Confirm `SESSION_REVOKED` clears local account state
      and retains the snapshot as `blocked_auth`.

The Phase 11 dashboard is now served from the configured backend root, so
**Open dashboard** opens the product-management and history interface directly.
