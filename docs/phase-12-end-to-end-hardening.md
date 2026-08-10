# Phase 12 end-to-end testing and hardening

## Status

Automated hardening is implemented and verified as of 2026-08-10. The live
Chrome/Shopee and Telegram checklist remains open because deterministic fixtures
cannot prove the installed extension's current session, Shopee's current private
API shape, voucher eligibility, or delivery through the user's real bot and
destination chat.

Phase 12 is not complete until those live checks pass or every failed check is
recorded as an accepted limitation.

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

Verified result on 2026-08-10:

- ESLint, Prettier, and legacy syntax checks passed;
- 45 Vitest files and 274 tests passed;
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

No reproducible automated defect remains after the final gate. Live-only failures
must be added here with reproduction steps before Phase 12 can be closed.

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

The live session must verify these groups in order:

1. Track a disposable product from the dashboard and extension; change a
   variant and voucher; confirm exact positive integer VND prices, shipping
   exclusion, persistence after restart, and the dashboard history.
2. Run a manual profile-bound refresh, then enable a disposable short schedule
   and verify sequential scheduled dispatch, queue visibility, inactive tab
   cleanup, and grouped successful checks. Restore the normal schedule afterward.
3. With the backend stopped, submit one safe capture and confirm the bounded
   extension queue survives a browser restart and drains after reconnection.
4. Exercise a disposable unavailable/invalid response case without repeatedly
   hitting Shopee or attempting to bypass its controls. Confirm no zero-price
   record is created.
5. With real Telegram credentials kept only in the ignored `.env`, create one
   controlled qualifying transition, confirm one correct alert, repeat the exact
   observation, and confirm no duplicate event or alert.
6. Confirm the fixture-backed lifecycle cases in the manual database: present but
   unpriced, partial omission neutrality, three eligible misses, mass-disappearance
   quarantine and confirmation, and reactivation without an immediate alert.
7. Delete the disposable product and confirm product, variants, checks, prices,
   history, jobs, and notification events are removed through cascades.

These steps require user-visible Chrome interaction and real external state. They
must not be marked passed from mocked tests alone.

## Acceptance report

Automated acceptance currently passes for persistence, integer price safety,
context-safe comparison, lifecycle handling, chart gaps, notification policy,
authentication, privacy, queue bounds, scheduler locking, cleanup, API behavior,
dashboard behavior, and extension build integrity.

The remaining acceptance gates are:

- live installed-extension capture against Shopee's current response shape;
- live manual and scheduled profile-bound collection;
- live queue persistence across backend/browser restart;
- one real Telegram price-drop delivery and duplicate check; and
- Phase 13 installation/release documentation and Phase 14 deployment checks.

Until those items are completed, Phase 12 remains **automated complete, manual
pending**.
