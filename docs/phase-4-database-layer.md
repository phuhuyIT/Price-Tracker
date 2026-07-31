# Phase 4 — Database Layer

Status: **complete — verified 2026-07-31**

Phase 4 adds the durable SQLite boundary beneath the shared Phase 3 contract.
It does not perform extraction, HTTP handling, price-drop decisions, or
Telegram delivery. Those remain service and adapter responsibilities in later
phases.

## Runtime and migration model

The server uses `better-sqlite3` 12.x so the application remains compatible
with the required Node.js 20 baseline. `apps/server/src/db/connection.js` owns
the single process-wide connection and configures:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

`apps/server/src/db/migrations/001-initial.sql` is the executable initial
schema. The migration runner:

- discovers ordered `NNN-name.sql` files;
- rejects duplicate versions and names;
- records version, name, SHA-256 checksum, and application time in
  `schema_migrations`;
- verifies applied checksums before skipping migrations;
- rejects an applied migration that is missing from the repository;
- applies each pending migration in its own SQLite transaction; and
- updates SQLite `user_version`.

Migrations run automatically before the HTTP server listens and can also be
run explicitly:

```powershell
npm.cmd run db:migrate
```

Changing an already-applied migration is deliberately rejected. Future schema
changes must be added as a new numbered migration.

## Persisted model

### Application identity

`users` stores normalised email identities and versioned password-hash strings.
Only one passwordless reserved local user may exist. It is resolved by later
authentication services when `AUTH_ENABLED=false`; it cannot be selected from
request data.

`user_sessions` stores only a one-way token hash, owner ID, client type,
transport, expiry, last-seen time, and revocation time. SQLite enforces the
accepted transport pairs:

| Client | Transport |
| --- | --- |
| `dashboard` | `cookie` |
| `extension` | `bearer` |

Plaintext session tokens and Shopee credentials have no persistence columns.

### Owner-scoped products

Product uniqueness is:

```text
owner_user_id + platform + shop_id + item_id
```

This lets two future price-tracker users track the same Shopee item without
sharing state. Product records also own tracking status, alert threshold, last
check outcome, and pending mass-disappearance confirmation state.

Every product and descendant repository operation requires a trusted owner ID.
Descendant reads and writes join back through `products.owner_user_id`; callers
cannot use another owner's internal product, variant, check, price, or
notification ID.

### Variant identity and lifecycle

`product_variants` keeps stable external model identity separate from its
mutable display name. It stores:

- `active`, `suspected_missing`, or `inactive` lifecycle;
- last-seen time;
- consecutive eligible complete-catalogue misses;
- missing-since time and inactive reason; and
- availability and its update time.

Positive presence resets missing state and may reactivate a variant even when
its price was not observed. Eligible misses are applied through an explicit
repository operation with the configured threshold. Partial and unknown
snapshots remain neutral because the future tracking service does not call
that operation for ineligible evidence.

Products keep the pending observed-variant-set hash and consecutive
confirmation count used by the accepted mass-disappearance safeguard.

### Checks, gaps, and real prices

Each persisted collection attempt creates one `price_checks` row. Successful
checks store snapshot provenance, pricing context, catalogue coverage, counts,
and suspicious-disappearance state. Failed checks store a typed error and
cannot contain an observed price.

`variant_check_results` records presence, price collection status, reason,
availability, and lifecycle for each known variant. This table represents
chart gaps without inserting null or zero amounts.

`price_logs` accepts only positive integer VND amounts with the complete
comparability tuple:

```text
variant
currency
price definition
price type
pricing context
pricing-context key
price source
```

Shipping-inclusive observations are rejected. Latest-price queries require the
exact tuple and only return available observations from successful checks.

### Notification deduplication

`notification_events` is written only after later notification code confirms
delivery. Its unique transition includes the internal variant, old amount, new
amount, price definition, price type, pricing context, and context key. The
referenced price logs must belong to the same owner-scoped variant and use a
compatible price source.

## Repository and transaction boundary

Repository factories prepare synchronous SQL once per connection. The bundle
created by `createRepositories(database)` exposes:

- users;
- sessions;
- products;
- variants;
- checks, per-variant results, and price logs; and
- notification events.

The bundle also exposes a synchronous `transaction(work)` boundary. Phase 5's
tracking service will use it to atomically persist the product update, variant
upserts, grouped check, per-variant results, real price logs, lifecycle
changes, and suspicious-disappearance state. Network work must never run
inside this transaction.

Check idempotency uses a caller-generated key unique within one product. A
duplicate returns the existing check with `created: false`; callers must skip
lifecycle and history mutations for that replay.

## Verification

Run the Phase 4 integration suite:

```powershell
npm.cmd run test:phase4
```

The 22 focused assertions cover:

- migration application, replay safety, duplicate detection, and checksum
  drift;
- foreign keys, WAL, and schema version storage;
- reserved local-user creation and duplicate email rejection;
- session creation, expiry, activity, revocation, and transport constraints;
- owner isolation;
- product and variant upserts, renames, and new variants;
- present variants without observed prices;
- eligible miss counting, inactivity, and reactivation;
- partial-snapshot neutrality;
- suspicious mass-disappearance confirmation state;
- duplicate-check idempotency;
- pricing-context separation and real price history;
- successful-notification deduplication;
- failed checks without price rows;
- complete transaction rollback; and
- cascade deletion.

Phase 5 will add shared-schema validation and business-policy orchestration over
these repository primitives.
