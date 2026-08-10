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
minutes and can be changed from 1 to 1,440 minutes. The popup provides
**Collect next price check**, and the options page provides **Check now**, for an
explicit one-time check even while periodic polling remains disabled. The popup
shows the backend **Price checks** queue independently from its local **Snapshot
uploads** queue.

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

- sends the typed collection result to the backend;
- moves the job to `waiting_auth` without consuming another retry;
- stores no snapshot, price check, or zero price;
- closes the temporary tab;
- shows a Chrome notification;
- sets an extension `!` badge; and
- shows the error in popup and options status.

The user signs in to Shopee in the same Chrome profile and clicks **Check now**.
That explicit action resumes the same bound job. Periodic polling does not keep
reopening authentication-blocked jobs. Email notification is outside Phase 8.

## Configuration

Backend lease duration:

```text
COLLECTION_JOB_LEASE_MS=300000
```

Extension defaults:

```text
backgroundCollectionEnabled=false
collectionPollIntervalMinutes=30
```

An explicit **Track & collect available prices** action runs even when periodic
background collection is disabled. It queues the exact product job, opens an
inactive tab, attempts every selectable catalogue model sequentially, and shows
checked and priced coverage in the popup. The page deadline is derived from the
claimed lease and remains shorter than both the extension timeout and lease.
Targeted manual jobs are reconciled with their backend status when a concurrent
poll already claimed or completed them. Terminal IDs are removed from local
storage and retry-wait jobs schedule their next claim time. If an extension was
reinstalled, the explicit manual action may move an unclaimed active job from
the obsolete context to the current one. Claimed leases cannot move, and normal
background polling never performs this reassignment.

A verified product without visible variants uses a dedicated one-price path.
The collector accepts `price.single_value` from either observed `get_pc` layout:
`data.pricing.data.product_price` or `data.product_price`. In both cases,
`price_model.price_single_model_id` must match the sole catalogue model. All
allowlisted price containers are ranked, so a present but weaker or
uncorrelated `price_breakdown` cannot mask an exact `product_price`. It then waits
for exact model-matched product-detail evidence before trying Shopee's single
hidden option once. If an available or unknown product still exposes no exact
price, collection reports retryable `PRICE_SELECTOR_TIMEOUT` instead of
completing with zero priced variants. Explicitly sold-out or unavailable
products may complete catalogue-only. The collector never substitutes a range,
zero, or unmatched model price, and never forwards voucher details.

For one-model products, model-level stock remains authoritative when present;
otherwise product-level zero stock marks the synthetic `Default` variant as
`sold_out`. Negative stock means hidden stock, not sold out. If both API stock
levels are redacted, only a no-visible-variant product may fall back to an exact,
visible **Đã bán hết** / **Sold out** label co-located with the captured product
title in the main product-detail region. Recommendation-card labels cannot set
product availability. A duplicate response with redacted stock cannot
immediately erase an explicit API signal. Shopee may still display a valid
amount for a sold-out item, so the observation can remain in history while the
popup reports **Sold out** and the API excludes it from `currentLowestPrice`.
Product `status` continues to mean tracking enabled or paused, independently of
availability.

Duplicate same-product `get_pc` captures are quality-ranked. A weaker response
cannot replace exact model-matched evidence, while a later exact response can
replace an earlier exact price. Compatible selected-variation captures are
retained instead of being cleared by duplicate product-detail responses.

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
2. Start the local backend; periodic background price checks may remain off.
3. Open a supported Shopee product page and wait for the popup preview.
4. Click **Track & collect available prices**.
5. Confirm a temporary tab appears without becoming active and the popup shows
   checked-variant progress when reopened.
6. Confirm every expected variant is present, every stored price is a positive
   integer VND amount, and the popup reports priced coverage accurately.
7. Repeat with a product that has no visible variant selector. Confirm the
   Default variant receives one exact price, or the job retries with
   `PRICE_SELECTOR_TIMEOUT`; it must not complete as an available 0/1 result.
8. Confirm the tab closes and the targeted job becomes `completed`.
9. Click **Refresh available prices** and confirm the refresh remains bound to
   the same extension context key.
10. Sign out of Shopee in that profile and repeat the explicit collection.
11. Confirm the job becomes `waiting_auth` with `AUTHENTICATION_REQUIRED`, no
    price check is stored, the tab closes, and Chrome shows the notification and
    badge.
12. Sign in to Shopee in the same profile, click **Check now**, and confirm that
    the same job resumes and can complete.

The Phase 8 exit condition remains open until these live Chrome-profile steps
are completed with a real Shopee response.
