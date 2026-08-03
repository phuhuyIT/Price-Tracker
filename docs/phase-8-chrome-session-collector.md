
# Phase 8 Logged-in Chrome Session Collector

Status: implemented and automatically verified; live extension-profile verification remains pending.

## Why Phase 8 uses the extension

Shopee can reject fresh anonymous browser contexts even for public product
pages. Production collection therefore uses the installed Manifest V3
extension in the Chrome profile where the user is already signed in. Playwright
remains legacy discovery and integration-test tooling only.

The backend never opens, copies, or receives a Chrome profile. The extension is
already scoped to one Chrome profile and its stable opaque
`pricingContextKey`; Shopee cookies and authentication data remain inside
Chrome.

## Opt-in and polling

Background collection is disabled by default. The user must enable **Allow
background price checks** in extension options. The default poll interval is 30
minutes and can be changed from 1 to 1,440 minutes. The popup and options page
also provide **Check now** for an explicit one-time check even while periodic
polling remains disabled.

The extension polls once on Chrome startup after opt-in. It will not claim a job
unless an existing normal Chrome window is available, so collection never opens
a new browser window or takes over the screen.

## Job lifecycle and profile binding

1. `POST /api/products/track` or `POST /api/products/:productId/refresh`
   creates a persistent owner-scoped job and returns `202 Accepted`.
2. The extension calls `POST /api/collection-jobs/claim` with its opaque context
   key.
3. SQLite atomically leases one compatible job. The API returns the plaintext
   lease once and stores only its SHA-256 hash.
4. An unbound product identity becomes bound to the first claiming extension.
   Failed retries and future refreshes retain that binding.
5. The extension opens the canonical product URL in the last-focused normal
   window with `active: false`.
6. The existing page interceptor sanitises configured Shopee responses before
   the isolated content bridge sees them. The bridge selects verified catalogue
   variants sequentially and correlates variation responses by
   `selected_tiers`.
7. Completion requires the same owner, live lease, product identity,
   `pricingContextKey`, and `extension` + `user_session` snapshot provenance.
8. The backend transactionally stores the snapshot and marks the job complete.
9. The extension closes the temporary tab in success, error, and timeout paths.

Only one pending or claimed job may exist for one owner and Shopee product
identity. Lease expiry requeues the same bound job so another Chrome profile
cannot take it.

## Tab visibility

The temporary tab never receives focus and does not replace the user's active
page. Chrome may still display it briefly in the tab strip. Standard extension
APIs cannot load an authenticated external Shopee page in a fully invisible
offscreen document.

## Authentication-required behavior

The MAIN-world interceptor converts only safe response status into the isolated
extension protocol. Shopee error `90309999`, HTTP 401, and HTTP 403 become
`AUTHENTICATION_REQUIRED`; raw response bodies are never forwarded.

On authentication failure the extension:

* sends the typed job failure to the backend;
* stores no snapshot, price check, or zero price;
* closes the temporary tab;
* shows a Chrome notification;
* sets an extension `!` badge; and
* shows the error in popup and options status.

The user signs in to Shopee in the same Chrome profile and queues or retries the
job. Email notification is outside Phase 8.

## Configuration

Backend lease duration:

```text
COLLECTION_JOB_LEASE_MS=120000
```

Extension defaults:

```text
backgroundCollectionEnabled=false
collectionPollIntervalMinutes=30
```

## Automated verification

```powershell
npm.cmd run test:phase8
npm.cmd test
```

Automated coverage includes disabled defaults, 30-minute polling, canonical URL
handling, migration, lease hashing, atomic profile claims, retained retry
binding, wrong-profile rejection, inactive-tab creation, successful completion,
authentication notification, timeout closure, API validation, extension build,
and the preserved legacy integrations.

## Manual verification checklist

1. Load `dist/extension` in the Chrome profile that is signed in to Shopee.
2. Start the local backend and enable **Allow background price checks**.
3. Queue a new supported Shopee URL through `POST /api/products/track`.
4. Click **Check now** in the extension.
5. Confirm a temporary tab appears without becoming active.
6. Confirm every expected variant is present and every stored price is a
   positive integer VND amount.
7. Confirm the tab closes and the job becomes `completed`.
8. Queue a refresh and confirm it can be claimed only by the same extension
   context key.
9. Sign out of Shopee in that profile and repeat.
10. Confirm the job becomes `failed` with `AUTHENTICATION_REQUIRED`, no price
    check is stored, the tab closes, and Chrome shows the notification and
    badge.

The Phase 8 exit condition remains open until these live Chrome-profile steps
are completed with a real Shopee response.
