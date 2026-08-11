# Phase 5 Core Backend Services

Status: complete and verified on 2026-08-01.

## Boundary

Phase 5 implements business logic without depending on Express routes,
Playwright, Telegram, or extension runtime APIs. Repositories remain the only
modules that execute SQL. Services validate and orchestrate their repository
operations.

Phase 6 may call these services from controllers and authentication middleware;
it must not duplicate their lifecycle, comparison, query, or credential rules.

## Tracking service

`trackingService.saveSnapshot()` validates the complete shared Zod contract
before opening a database transaction. Invalid snapshots produce
`INVALID_SHOPEE_PAYLOAD` without partial persistence.

An exact validated snapshot is deterministically serialised and hashed with
SHA-256. The hash is the product-scoped check idempotency key. Replaying the
same snapshot returns the existing check and product summary without adding
prices or incrementing lifecycle counters.

One synchronous SQLite transaction contains:

1. Product upsert.
2. Price-check creation.
3. Present-variant upserts and reactivation.
4. Per-variant presence and collection results.
5. Valid observed price rows.
6. Eligible missing-variant lifecycle changes.
7. Suspicious mass-disappearance confirmation state.
8. Product success metadata.

The server check timestamp controls lifecycle state. Client `capturedAt` is
retained only as provenance.

### Missing and returning variants

Positive presence resets a variant to `active`, including when its price is
`not_observed`. An omitted known variant is lifecycle-neutral for partial or
unknown coverage. Only verified complete coverage can record an eligible miss.

When the missing ratio exceeds `MAX_VARIANT_MISSING_RATIO`, the service hashes
the sorted observed model-ID set and quarantines the first occurrence. Miss
counting begins only after the same set reaches
`VARIANT_MASS_MISSING_CONFIRMATIONS`.

The first observed price after a variant returns from `suspected_missing` or
`inactive` is stored as a new baseline and cannot create an immediate alert.

## Price-comparison service

The service selects the immediately previous successful available observation
only when all comparison dimensions match:

- Internal variant ID.
- Currency.
- Price definition.
- Price type.
- Pricing context.
- Pricing-context key.
- Price source.

The current observation must also be `available`. Initial baselines, unchanged
prices, increases, reductions below the product threshold, unavailable prices,
and reactivation baselines do not become notification candidates.

A qualifying candidate contains the two real price-log IDs and the exact
transition metadata needed by the later notification service. If the same
transition already has a successful notification event, the candidate is
suppressed. Phase 5 does not send Telegram messages or record an event before
delivery.

## Product-query service

All product queries require a trusted owner ID and never return another owner's
records. The service provides paginated products, complete product details,
variant lifecycle, availability, current and per-check stock quantity, latest
prices, last-known labels, and context-specific lowest prices. Product summaries
include total stock only when every active variant has a known quantity; variant
rows always expose their own nullable quantity.

Prices remain separated by pricing context and key. The confirmed display
priority is:

1. `user_session`, when any active variant has a retained user-session price.
2. `anonymous`, only when no user-session price exists.

Both context values remain in `lowestPricesByContext`; the priority affects only
`currentLowestPrice`. A price whose latest check result was not observed is
labelled `last_known` rather than being copied forward as a new observation.

History is built by joining per-variant check results to optional real price
rows. Chart datasets use `{ x, y }` points, where `y: null` represents a
persisted `not_observed` result. SQLite never stores a null or zero price row.
Datasets are separated by variant, pricing context, and context key.

## Authentication service

Authentication is exclusively for the price-tracker application. No Shopee
credential, cookie, token, profile, or request header enters this service.

With `AUTH_ENABLED=false`, product ownership resolves to the single passwordless
reserved local user. Registration, login, logout, and current-user endpoints
remain disabled in this mode.

With authentication enabled:

- Email and password inputs use the shared strict schemas.
- Registration is independently gated by `AUTH_ALLOW_REGISTRATION`.
- The selected local offline denylist rejects common and repeated passwords
  without sending password-derived data over the network.
- Passwords use asynchronous Node.js `crypto.scrypt` with a unique 16-byte salt,
  `N=2^17`, `r=8`, `p=1`, and a 64-byte derived key.
- The encoded hash stores its version and work parameters for later upgrades.
- Verification compares equal-length derived keys with `timingSafeEqual`.
- Unknown-user login performs a real scrypt operation before returning the same
  generic `INVALID_CREDENTIALS` result.
- Sessions use 32 random bytes encoded as base64url.
- SQLite stores only a SHA-256 token hash, never the plaintext token.
- Dashboard sessions use cookie transport; extension sessions use bearer
  transport.
- Expired and revoked sessions produce distinct typed errors.

The service returns a plaintext token once under the internal `sessionToken`
field. Phase 6 must put dashboard tokens only in an HTTP-only cookie and omit
that internal field from dashboard response bodies.

## Repository additions

Phase 5 adds owner-scoped read operations for:

- Finding a check by product-scoped idempotency key.
- Latest real prices per variant and pricing-context stream.
- Latest per-variant check results per pricing-context stream.
- Check-aligned history timelines with optional real prices.

No schema migration was required because the Phase 4 tables and indexes already
represent these records.

## Verification

Focused verification:

```powershell
npm.cmd run test:phase5
```

This runs 25 Phase 5 unit and integration assertions. The complete project
verification passes 127 Vitest assertions plus all legacy fixture, selection,
Playwright, and current-profile extension integrations.
