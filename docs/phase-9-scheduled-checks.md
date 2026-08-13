# Phase 9 scheduled price checks

## Status

Phase 9 is complete. The scheduler, persistent retry states, terminal
failed-check behavior, extension queue draining, shutdown handling, automated
coverage, and live Chrome-profile schedule passed by 2026-08-12. The checklist
below remains a repeatable live gate because fixtures cannot prove current
Shopee authentication or response shape.

## Asynchronous boundary

The cron process is a dispatcher, not a browser collector:

1. A cron tick acquires the process-level run lock and creates a job-run ID.
2. Expired claimed jobs are recovered.
3. Only active products are read through the trusted scheduler repository
   method.
4. Refresh jobs are queued sequentially with a random configured delay between
   products.
5. The run logs a structured summary and releases the lock.
6. The bound Chrome extension later claims and collects each job using the
   user's existing Shopee session.

The scheduler never launches anonymous Playwright, never receives Shopee
credentials, and never keeps a request open while waiting for Chrome. Duplicate
active work is reused rather than queued twice.

## Persistent job states

```text
pending -> claimed -> completed
             |
             +-- retryable, attempts remain -> retry_wait -> claimed
             |
             +-- authentication required -> waiting_auth -> claimed
             |
             +-- terminal or attempts exhausted -> failed
```

`pending`, `claimed`, `retry_wait`, and `waiting_auth` all count as active for
duplicate prevention. A job remains bound to its original extension
`pricingContextKey` after the first claim. The only recovery exception is an
explicit manual request that reassigns an unclaimed active job after an
extension context changes; a claimed lease and automatic scheduler polling can
never perform that reassignment.

`attempt_count` counts retry-budget claims, including the first attempt. The
default maximum is four total attempts: one initial attempt and three retries.
An authentication-required transition refunds that claim, so repeated sign-in
prompts cannot exhaust or strand the job. An expired lease consumes the claim
that created it. If attempts remain, expiry recovery moves the job to
`retry_wait`; otherwise it creates the terminal failure.

## Failure policy

### Wait for the user

`AUTHENTICATION_REQUIRED` moves the job to `waiting_auth`. It does not consume
automatic retries, create a failed price check, or schedule repeated browser
tabs. The extension closes the collection tab, shows a notification and `!`
badge, and waits. After signing in to Shopee in that same Chrome profile, the
user clicks **Check now** to resume the same job.

### Retryable failures

These conditions use bounded retry:

- `COLLECTION_TIMEOUT`
- `EXTENSION_UNAVAILABLE`
- `FETCH_FAILED`
- `NETWORK_TIMEOUT`
- `PRICE_SELECTOR_TIMEOUT`
- `RATE_LIMITED`
- `SHOPEE_SERVER_ERROR`
- `TAB_CLOSED_PREMATURELY`

The delay follows:

```text
delay = baseDelay * 2^(attempt - 1) + jitter
```

The exponential component is capped at `COLLECTION_RETRY_MAX_DELAY_MS`. Jitter
is a random non-negative integer no larger than the base delay or remaining room
under the cap. The final delay never exceeds the configured cap.

### Terminal failures

The job fails without retry for known URL, data-contract, or product-state
problems, including:

- `INVALID_PRODUCT_URL`
- `PRODUCT_NOT_FOUND` or `PRODUCT_UNAVAILABLE`, including a positively
  identified removed, hidden, or unavailable listing
- `SHOP_SUSPENDED`
- `SCHEMA_PARSE_ERROR`
- `INVALID_SHOPEE_PAYLOAD`

Unknown accepted collection codes are treated as terminal rather than retried
indefinitely. A schema/DOM change needs adapter investigation; repeatedly
requesting the same incompatible page is not expected to repair it.

## Price-check semantics

- A completed snapshot uses the existing tracking transaction to create one
  successful grouped check, valid price logs, variant results, and lifecycle
  updates.
- `retry_wait` and `waiting_auth` create no `price_checks` row.
- A terminal refresh failure creates one idempotent failed `price_checks` row,
  updates the product's last-check/error state, and creates no price logs.
- Partial, unknown, suspicious, and failed evidence remains lifecycle-neutral
  for missing variants. Successful verified catalogues continue to use the
  established three-miss and mass-disappearance safeguards.

Failed initial tracking jobs have no product row to which a check could be
attached; their terminal error remains on the collection job. Every Phase 9
scheduled job is a refresh of an existing product, so its terminal failure can
always be stored as a failed check.

## Extension behavior

With background collection enabled, a completed or terminal job schedules the
next claim after a random 5–10 second delay. Retry jobs use the backend's
`nextAttemptAt`. Temporary failures while reporting completion or failure to the
backend are retained in extension storage and submitted again without
recollecting the page.

Manual job IDs are durable but reconciled against `GET /api/collection-jobs/:id`
when a targeted claim returns no lease. This closes the race where a concurrent
poll completed the job before the explicit claim: terminal IDs are removed,
retry-wait IDs retain an alarm, and an unclaimed profile-mismatched job can be
moved to the current context by that explicit manual action. Attempts and retry
timing are preserved.

Closing a collection tab before it finishes reports
`TAB_CLOSED_PREMATURELY`. The extension clears its active-tab reference before
closing tabs itself, preventing Chrome's tab-removed event from reporting the
same failure twice.

## Configuration

| Variable                           |        Default | Validation                             |
| ---------------------------------- | -------------: | -------------------------------------- |
| `CRON_ENABLED`                     |         `true` | Boolean string                         |
| `CRON_SCHEDULE`                    | `0 */12 * * *` | Valid node-cron expression             |
| `COLLECTION_JOB_LEASE_MS`          |       `300000` | 30,000–900,000 ms                      |
| `COLLECTION_MAX_ATTEMPTS`          |            `4` | 1–10 total attempts                    |
| `COLLECTION_RETRY_BASE_DELAY_MS`   |         `5000` | 100–300,000 ms                         |
| `COLLECTION_RETRY_MAX_DELAY_MS`    |       `300000` | 100–3,600,000 ms and at least the base |
| `COLLECTION_DISPATCH_DELAY_MIN_MS` |         `5000` | 0–300,000 ms                           |
| `COLLECTION_DISPATCH_DELAY_MAX_MS` |        `10000` | 0–300,000 ms and at least the minimum  |

The retained `SCRAPE_*` values belong to legacy Playwright tooling. They do not
control production Phase 9 extension jobs.

## Shutdown and recovery

`SIGINT` and `SIGTERM` share one idempotent shutdown path. Shutdown rejects new
scheduler runs, aborts an inter-product delay, waits for the current dispatch
loop, stops and destroys the cron task, closes the HTTP server, and then closes
SQLite.

The backend does not own Chrome's browser process or tabs. A claimed job left by
an extension or backend interruption is recovered after its lease expires. This
preserves at-most-one active collector without requiring the server to terminate
the user's browser.

## Automated verification

Run:

```powershell
npm.cmd run test:phase9
```

Coverage includes environment validation, scheduler disabled mode, overlap
prevention, sequential dispatch, per-product continuation, summary logging,
shutdown interruption, migration, active-product selection, authentication
waiting/resume, four-attempt retry exhaustion, terminal failed-check
idempotency, tab closure, extension draining, and the extension build.

The complete regression command remains:

```powershell
npm.cmd test
```

## Repeatable live Chrome-profile checklist

Use a disposable test schedule and restore normal values afterward.

1. Build and reload `dist/extension` in the Chrome profile signed in to Shopee.
2. Start the backend with the real `EXTENSION_ALLOWED_ORIGIN`, a temporary cron
   such as `*/1 * * * *`, and short dispatch delays.
3. Enable **Allow background price checks** in extension options.
4. Ensure at least two tracked products are active and already bound to this
   extension context.
5. Wait for a cron tick. Confirm one structured start log, sequential queued
   jobs, one final summary, and no overlapping run.
6. Confirm the extension drains the jobs, each temporary tab stays inactive and
   closes, and each success creates one grouped check with positive integer VND
   prices only.
7. Pause a product and confirm the next run does not queue it.
8. Sign out of Shopee and queue another refresh. Confirm `waiting_auth`, no
   failed check or price log, one notification, and no automatic tab loop.
9. Sign in in the same profile, click **Check now**, and confirm the same job
   resumes.
10. Exercise one safe retryable failure, such as closing the temporary tab.
    Confirm `retry_wait`, increasing attempt count, and backoff before reclaim.
11. Stop the backend during an inter-product delay. Confirm shutdown completes,
    restart the backend, and confirm any expired claimed job can be recovered.
12. Restore the normal cron and delay configuration.

Do not manufacture rate limits, bypass authentication, or repeatedly hit Shopee
to force failures.
