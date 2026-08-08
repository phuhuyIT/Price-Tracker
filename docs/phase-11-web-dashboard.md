# Phase 11 web dashboard

## Status

The responsive dashboard, product-management controls, context-safe history
chart, authentication views, transparency warnings, and automated browser
coverage are implemented. Phase 10 Telegram delivery remains intentionally out
of scope and is not required by the dashboard.

## Delivery boundary

The dashboard is a static, same-origin application served by Express from
`apps/server/public`. It uses project-owned HTML, CSS, and browser modules. The
Chart.js UMD build is installed through npm and served locally at
`/vendor/chart.umd.min.js`; the dashboard has no CDN or remotely hosted
executable dependency.

Helmet keeps scripts, styles, connections, forms, and frames same-origin. The
image policy additionally permits Shopee and `susercontent.com` product images.
All API-controlled text is escaped before it enters a rendered HTML template.

`GET /api/dashboard-config` exposes only these non-secret switches:

```json
{
  "authentication": {
    "enabled": false,
    "allowRegistration": false
  }
}
```

This avoids guessing the authentication mode from an error. With authentication
disabled, the dashboard opens directly under the reserved local owner. With it
enabled, the dashboard restores the HTTP-only cookie session or shows sign-in.
Registration appears only when it is explicitly enabled. Dashboard JavaScript
never receives the plaintext session token.

## Product management

The main view provides:

- Shopee URL tracking with asynchronous collection-job feedback;
- responsive product cards and a first-product empty state;
- watchlist-wide search by product title, variant name, shop ID, or item ID;
- tracking-status and current-availability filters with accurate pagination;
- paginated list loading, filtered empty states, and explicit retry after API
  failure;
- product image, title, tracking state, availability, latest successful check,
  and active/total variant counts;
- current lowest purchasable price or an honest last-known/unavailable label;
- pricing-context, voucher-status, and price-source badges;
- expandable per-variant lifecycle, availability, latest collection result,
  last-seen time, and missing-since time;
- manual refresh, pause/resume, history, and confirmed deletion actions; and
- reauthentication when an enabled dashboard session expires or is revoked.

Tracking and refresh stay asynchronous. A successful dashboard request means a
persistent extension job was queued, not that Shopee collection already
finished. The UI directs the user to **Check now** in the extension when
background checks are disabled or authentication recovery is required.

## Price transparency

Every dashboard page states the accepted definition:

> Price shown by Shopee after applicable discounts and vouchers, excluding
> shipping fees.

Cards warn when the selected observation is anonymous or a documented fallback,
voucher status is unknown, the latest product check failed, a variant's latest
price was not observed, a variant is suspected missing or inactive, or a
variant is sold out. Product summaries now include `latestResults` per variant,
including variants that have never produced a price log, so this warning does
not depend on a historical price existing.

When retained `user_session` and legacy `anonymous` current prices coexist and
differ, the dashboard warns that the pricing contexts differ. Phase 9 scheduled
checks are collected by the same profile-bound extension and stored in the
same `user_session` stream; there is no separate scheduler-price stream to
compare or label as anonymous. A future collector that creates a distinct
context must remain a separate API/history series.

Sold-out and unavailable observations may remain visible as historical or
last-known evidence, but they are never presented as the current purchasable
lowest price. Product tracking state remains independently active or paused.

## History chart

The history dialog supports variant, start-time, and end-time filters. The API
continues to return one dataset for each variant, pricing context, and context
key. The browser does not merge those datasets.

Real `variant_check_results` with no accepted price become chart points with
`y: null`. Chart.js uses `spanGaps: false`, preserving the missing-observation
break. SQLite still stores no null or zero price in `price_logs`. VND and dates
are formatted for users, and the previous Chart.js instance is destroyed before
filters or another product create a replacement.

## Automated verification

Run the focused suite:

```powershell
npm.cmd run test:phase11
```

It covers formatter and warning policy, HTML escaping, filtered pagination,
query validation, null chart gaps, chart destruction, static assets, CSP,
public authentication switches, per-variant no-price results, existing product
API behavior, and a real local headless-Chrome workflow that searches and
filters two products, clears filters, renders two history datasets, preserves a
missing-price gap, and filters a paused product.

The complete regression command remains:

```powershell
npm.cmd test
```

## Manual verification checklist

1. Start the backend with `npm.cmd start` and open `http://127.0.0.1:3000`.
2. With the default `AUTH_ENABLED=false`, confirm no sign-in view is shown.
3. Paste a new Shopee product URL. Confirm the dashboard reports that collection
   was queued, then use **Check now** in the extension if background collection
   is disabled.
4. Reload after collection. Confirm the current price, variants, context,
   voucher, source, availability, and last-check state match the extension and
   API.
5. Search by a product title, variant name, shop ID, and item ID. Apply tracking
   status and availability filters, then clear them. Confirm the cards and
   result count update across the whole watchlist.
6. Open **History**. Confirm each variant/context is a separate line and a
   known missing observation creates a visible gap rather than a zero.
7. Apply variant and date filters, reopen history, and confirm no stale chart is
   layered underneath the new chart.
8. Queue **Refresh price**, pause and resume the product, and confirm scheduler
   dispatch skips it only while paused.
9. Delete a disposable product. Cancel once, then confirm and verify its card
   and history disappear.
10. Restart with `AUTH_ENABLED=true`. Confirm sign-in appears, registration is
    shown only with `AUTH_ALLOW_REGISTRATION=true`, sign-out returns to sign-in,
    and an expired/revoked session does the same without exposing a token.
11. Repeat at a narrow mobile width and confirm forms, cards, actions, history
    filters, and the dialog remain usable.
