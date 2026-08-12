# Phase 12 end-to-end testing and hardening

## Status

Phase 12 is complete as of 2026-08-12. Automated hardening and the live
Chrome/Shopee, scheduler, queue-recovery, Telegram, lifecycle, persistence,
history, and cascade-deletion gates all passed. Current Shopee response
availability remains an external limitation, but missing responses are stored as
truthful gaps rather than zero or stale prices.

## Production collection boundary

The original Phase 12 roadmap referred to manual and scheduled Playwright
refreshes. Phases 8 and 9 superseded that production design: manual and scheduled
refreshes now create persistent jobs for the profile-bound extension. Playwright
remains retained discovery and integration-test tooling and never receives the
user's Shopee profile or credentials.

`Task_list.md` now uses the current extension-dispatched terminology. The legacy
Playwright and exact-current-profile integrations still run in the regression
suite so retained tooling cannot silently break.

## Automated test report

Run the complete Phase 12 gate:

```powershell
npm.cmd run test:phase12
```

Verified result on 2026-08-12:

- ESLint, Prettier, and legacy syntax checks passed;
- 47 Vitest files and 288 tests passed;
- the deterministic 15-file Manifest V3 extension build passed;
- the local headless-Chromium dashboard workflow passed; and
- all retained fixture, variation-selection, Playwright, and current-profile
  integrations passed.

The automated suite covers shared schemas, repositories, transactions, API
routes, authentication, collection leases, the scheduler, Telegram behavior,
dashboard rendering, extension capture, extension storage queues, and retained
collector tooling.

## Resolved bug list

1. The retained current-profile Chrome integration queried the temporary tab
   before it finished navigating. An early assertion closed the context and the
   later error was misleadingly reported as `Chrome debugger detached:
target_closed`. The test now waits for the target URL, keeps the service-worker
   job promise alive through cleanup, and handles an early bridge rejection. It
   passed five consecutive isolated runs and the complete Phase 12 gate.
2. The retained Playwright product-response waiter removed its response listener
   on success and timeout but could leave the listener and timer alive when the
   page closed early. Page close now rejects promptly through one shared cleanup
   path. Focused tests cover success, timeout, and page-close cleanup.
3. Logger redaction covered the primary session and Telegram token fields but
   lacked a direct regression test and defense-in-depth coverage for passwords,
   lease tokens, destination chat IDs, and message text. The shared logger factory
   now applies the expanded policy, and a test proves the secret values do not
   appear in serialized output.
4. The extension popup's generic `Queue` indicator represented only pending
   snapshot uploads, while the dashboard represented persistent price-check jobs.
   The popup now reads the owner-scoped `/api/collection-jobs` summary through a
   separately validated service-worker request, labels `Price checks` and
   `Snapshot uploads` independently, shows queued/collecting/retry/auth counts,
   refreshes while jobs remain, and describes manual mode as one job per click.
   Focused presentation and backend-client tests cover waiting, collecting, empty,
   unavailable, and inconsistent-response states.
5. The service worker rejected every privileged message whose sender included a
   Chrome tab. That protected privileged actions from content scripts, but also
   rejected the extension's own options page because Chrome can open it in a tab.
   Privileged UI messages now require both this extension's runtime ID and an exact
   `chrome-extension://<runtime-id>/...` sender URL. Regression tests accept popup
   and tab-hosted options pages while rejecting Shopee content scripts, another
   extension, missing URLs, and malformed URLs.
6. Live inspection showed that Shopee uses
   `/api/v4/pdp/cart_panel/select_variant_pc` for this product and exposes the
   selected tier's stock in `data.stock`. Both selected-variation endpoint
   spellings are now captured. Positive stock marks the exactly correlated
   variant available and zero marks it sold out; failed responses, negative or
   malformed stock, and price-model mismatches cannot override catalogue
   availability. The exact non-negative count flows through the sanitized
   snapshot, per-check result, current variant state, product API/history, web
   dashboard, and extension popup. Unknown stock stays nullable and cannot be
   rendered as zero. The unsuccessful page-text and purchase-control availability
   experiments were removed; only the older conservative sold-out DOM fallback
   remains when API stock is redacted.
7. A completed full-catalogue collection left its aggregate
   `lowestPriceVariant` and `lowestPriceAmount` in collection status. The popup
   incorrectly used those aggregate fields instead of the current page capture,
   so selecting another variant could continue to display the collected minimum
   variant and price. Current selection details and full-catalogue results now
   have an explicit presentation boundary: variant, price, stock, availability,
   and voucher always come from the current page capture, while catalogue totals
   remain in price coverage and collection status. The shared normaliser also no
   longer falls back to another observed variant's price when an explicitly
   selected tier is unpriced. Focused tests cover both boundaries. After the
   rebuilt extension was reloaded on 2026-08-12, the user changed away from
   `Đen 2026` and confirmed that the popup followed the newly selected variant
   and its displayed price.

No reproducible automated or live defect remains after the final gate. Any new
regression must be added here with reproduction steps and reopen the affected
acceptance criterion.

## Security checklist

| Check                                                                                       | Status | Automated evidence                                                                                                                 |
| ------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Shopee cookies and authentication headers never leave the page capture boundary             | Pass   | Strict capture allowlisting and privacy tests reject credentials, headers, raw responses, account data, and voucher contents       |
| Price-tracker session tokens are returned only to the correct client and redacted from logs | Pass   | Cookie/bearer API tests, hashed-session repository tests, and structured logger redaction test                                     |
| Telegram token, chat ID, and message text are not logged or committed                       | Pass   | Logger redaction test and repository token scan                                                                                    |
| Local environment files, databases, logs, and browser profiles are not committed            | Pass   | Repository privacy test plus explicit `.gitignore` rules                                                                           |
| Raw Shopee responses are not accepted or logged by the backend                              | Pass   | Strict snapshot schema, recursive unsafe-key rejection, sanitiser tests, and request logging without bodies                        |
| Request bodies have a bounded size                                                          | Pass   | 64 KiB API limit and oversized-body integration test                                                                               |
| Mutation and authentication endpoints are rate limited                                      | Pass   | Route middleware and mutation-rate-limit integration test                                                                          |
| Malformed input is rejected with typed envelopes                                            | Pass   | Shared schema and API integration suites                                                                                           |
| Client-declared lifecycle coverage cannot bypass normalisation                              | Pass   | The strict capture schema rejects coverage fields; verified coverage and counts are derived from validated product-detail evidence |
| No remotely hosted extension executable code is included                                    | Pass   | Deterministic extension build and manifest-reference verification                                                                  |

## Resource checklist

| Check                                                              | Status | Automated evidence                                                                             |
| ------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------- |
| Temporary extension tabs close on success, failure, and timeout    | Pass   | Background-collection unit tests                                                               |
| Response/debugger listeners and timers are removed                 | Pass   | Page-interceptor behavior, background collector cleanup, and retained Playwright cleanup tests |
| Scheduler runs do not overlap and shutdown interrupts delays       | Pass   | Scheduler unit tests and scheduled-collection integration tests                                |
| Database transactions roll back completely                         | Pass   | Repository and tracking-service rollback tests                                                 |
| Extension queues reject the 51st item without deleting older work  | Pass   | Submission-queue bound and service-worker persistence tests                                    |
| Exact snapshot replay cannot add history or lifecycle misses twice | Pass   | Idempotent tracking, repository, API, and lifecycle tests                                      |
| Browser contexts close after retained Playwright integration       | Pass   | Playwright integration cleanup and complete regression exit                                    |

## Manual end-to-end gate

Use a separate database. Do not point these tests at the normal application
database:

```powershell
$env:DATABASE_PATH = ".\data\manual-phase12.db"
$env:AUTH_ENABLED = "false"
$env:CRON_ENABLED = "false"
npm.cmd start
```

Build and reload `dist/extension`, configure the exact extension origin on the
backend, and use the same Chrome profile that is signed in to Shopee. Keep
background checks disabled until the explicit manual collection succeeds.

### Live checkpoint: 2026-08-10

The first manual dashboard collection reached `completed` in one attempt for
Shopee shop `175753395`, item `16270477304`. It stored one exact positive variant
price of 378,000 VND, and the active backend queue returned to empty. Two further
products also completed in one attempt, covering 48 and 12 variants respectively.

This checkpoint exposed the popup queue-label and visibility defect described in
resolved bug 4. After rebuilding and reloading the extension, a new dashboard
refresh appeared as `1 waiting` in the popup, changed to `collecting` in both the
popup and dashboard, displayed variant progress, and finished with both queues
empty. The product price and last-updated value refreshed, and the temporary
Shopee tab closed automatically. This queue-visibility portion of the live gate
passes.

On 2026-08-11, one disposable `*/1 * * * *` scheduler tick with 1,000-1,500 ms
dispatch delays queued four active products sequentially. Cron was disabled after
that tick to prevent repeated live requests. Saving the background-collection
option exposed resolved bug 5; after rebuilding and reloading the extension, the
options page saved successfully and triggered an automatic drain without using
the manual collection button. All four scheduler jobs completed sequentially on
their first attempt and the active queue returned to empty. Four grouped extension
checks stored 1, 21, 0, and 9 price rows respectively; every stored amount was a
positive integer. The zero-row check preserved all 12 observed variants as
`variation_response_missing`, with lifecycle changes disabled, rather than
manufacturing zero prices. Cron and extension background collection were both
disabled after the batch. The scheduled dispatch, automatic queue drain, grouped
check, price-safety, inactive-tab, and automatic tab-cleanup portions of the live
gate pass.

On 2026-08-12, `telegram:test` confirmed that the configured bot and private
destination were reachable without sending a message. A controlled live test
then used an isolated temporary database to store four extension-source
observations: 250,000 VND, 199,000 VND, 250,000 VND, and 199,000 VND for the
same variant and pricing context. All four snapshot requests succeeded, exactly
one Telegram send was attempted, exactly one `notification_events` row was
created, and the user confirmed receipt of the correct 250,000 to 199,000 VND
alert. Repeating the exact transition sent no duplicate. The temporary database
was removed afterward and the normal tracker database was not changed. The live
Telegram delivery and duplicate-suppression portion of the gate passes.

Also on 2026-08-12, the extension snapshot queue was exercised against a
separate manual database with the backend offline. Seven locally stored records
remained visible after every Chrome window was closed and Chrome was restarted.
After the same backend and allowed extension origin were restored, an explicit
retry drained six current retryable snapshots and stored three products in the
manual database. The only remaining record was an older 2026-08-11 permanent
failure with HTTP 403 `CORS_ORIGIN_DENIED`; its metadata confirmed that it
predated this test and came from the formerly incorrect origin configuration.
The user explicitly cleared that dead-letter record and confirmed the local
queue returned to zero. The live backend/browser restart persistence and
reconnection-drain portion of the gate passes.

The combined product workflow then exposed resolved bug 7. After the rebuilt
extension was reloaded, changing away from `Đen 2026` updated the popup to the
actual current variant and displayed price. A successful partial collection for
the six-variant product stored exact prices of 404,000, 424,000, 464,000, and
464,000 VND with positive stock, voucher status `applied`, the
`displayed_post_voucher_excluding_shipping` definition, and
`shipping_included = 0`. Two later Shopee attempts exposed no selected-variation
responses; each stored six `variation_response_missing` results and no price
logs, preserving the earlier history as real chart gaps rather than zero or
stale prices. After the backend restarted, all three disposable products, six
variants, exact prices, and gaps remained. The user confirmed that the dashboard
history showed dates on the horizontal axis, separate variant series, the exact
prices, and gaps, and that the inactive collection tab closed automatically.
The combined selected-variant, voucher, shipping-exclusion, persistence,
history, truthful-gap, and cleanup portion of the live gate passes. Intermittent
missing Shopee variation responses remain an external limitation; the safe
no-price behavior is verified.

The disposable response and lifecycle cases were then exercised through the
real snapshot API against the same manual database. A valid unavailable
observation was accepted with no price log, while an invalid zero-price body was
rejected with HTTP 422 `INVALID_SHOPEE_PAYLOAD` and created no product or check.
A partial omission left the missing variant active with zero misses. Three
verified complete omissions advanced it through one and two suspected misses to
inactive at the configured third miss, and its later presence without a price
reactivated it without creating a price or notification. A separate four-variant
case confirmed mass-disappearance quarantine: the first 75% disappearance
recorded one confirmation and no misses; the identical second snapshot recorded
the second confirmation and only then advanced the three omitted variants to one
suspected miss. The notification count stayed unchanged throughout. The sole
existing event belongs to the earlier real 424,000 to 404,000 VND product-price
transition. The unavailable, invalid-price, ordinary lifecycle,
mass-disappearance, reactivation, and no-spurious-alert portions of the gate
pass.

Finally, the user deleted the disposable six-variant product through the
dashboard and confirmed its removal. A direct audit of the manual database found
zero remaining rows for product ID 5 / item `27162511840` in `products`,
`product_variants`, `price_checks`, or `collection_jobs`, and its associated
notification event was removed. Global referential checks also found zero
orphaned variants, checks, price logs, variant check results, collection jobs, or
notification events. The dashboard deletion and database-cascade portion of the
gate passes.

The live session must verify these groups in order:

1. **Passed 2026-08-12:** a disposable multi-variant product confirmed current
   selection display, exact positive integer VND prices, voucher state, shipping
   exclusion, persistence after restart, dashboard history dates and variant
   series, and truthful gaps when Shopee later omitted price responses.
2. **Passed 2026-08-11:** a manual profile-bound refresh and disposable short
   schedule confirmed sequential dispatch, queue visibility, grouped checks,
   inactive-tab cleanup, and automatic tab cleanup. The normal disabled schedule
   was restored afterward.
3. **Passed 2026-08-12:** with the backend stopped, locally queued captures
   survived a complete Chrome restart and all current retryable records drained
   after reconnection. One unrelated older permanent CORS failure was inspected
   and explicitly cleared afterward.
4. **Passed 2026-08-12:** a disposable unavailable observation stored no price,
   and an invalid zero-price snapshot was rejected without creating a product or
   check.
5. **Passed 2026-08-12:** with real Telegram credentials kept only in the
   ignored `.env`, one controlled qualifying transition delivered the correct
   alert and repeating the exact transition created no duplicate event or alert.
6. **Passed 2026-08-12:** fixture-backed API submissions confirmed present but
   unpriced handling, partial omission neutrality, inactive status after three
   eligible misses, mass-disappearance quarantine and confirmation, and
   reactivation without a price or alert.
7. **Passed 2026-08-12:** dashboard deletion removed the disposable product and
   database audits confirmed its variants, checks, prices, history, jobs, and
   notification event were removed through cascades with no orphaned rows.

These steps require user-visible Chrome interaction and real external state. They
must not be marked passed from mocked tests alone.

## Acceptance report

Automated and live acceptance pass for persistence, integer price safety,
context-safe comparison, lifecycle handling, chart gaps, notification policy,
authentication, privacy, queue bounds, scheduler locking, cleanup, API behavior,
dashboard behavior, and extension build integrity.

Phase 12 is **complete**. Phase 13 installation/release documentation and Phase
14 deployment remain separate future phases.
