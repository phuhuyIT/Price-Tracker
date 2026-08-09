# Phase 10 Telegram notifications

## Status

The Telegram formatter, bounded Bot API client, post-commit delivery service,
successful-transition persistence, connection-test command, and automated
coverage are implemented. Live verification with the user's bot and destination
chat remains a manual gate because tests do not use real Telegram credentials.

## Delivery boundary

Telegram is contacted only after the snapshot or leased collection-job
transaction commits. A delivery failure therefore cannot roll back the product,
grouped price check, variant results, lifecycle changes, or positive-integer
price logs.

The tracking service continues to own comparison policy. A notification
candidate exists only when the current and immediately previous observations
match on:

- internal variant ID;
- currency;
- price definition and type;
- pricing context and context key; and
- price source.

The current observation must be available, lower than its baseline, and at or
above the product's alert threshold. Initial observations, reactivation
baselines, unavailable prices, unchanged prices, increases, below-threshold
drops, and already-recorded transitions never reach Telegram.

## Message contract

Each alert includes:

- product and variant names;
- previous and new integer VND prices;
- the reduction rounded to one decimal place for display;
- the human-readable price definition;
- the pricing context; and
- the canonical Shopee product URL.

Messages use Telegram's HTML parse mode. Product titles, variant names, labels,
and URLs escape `&`, `<`, `>`, and `"` before delivery. Only fixed application
markup is emitted. Link previews are disabled.

## Configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `TELEGRAM_BOT_TOKEN` | empty | BotFather token; never logged |
| `TELEGRAM_CHAT_ID` | empty | Destination private chat, group, supergroup, or channel |
| `TELEGRAM_REQUEST_TIMEOUT_MS` | `3000` | Per-request timeout |
| `TELEGRAM_MAX_ATTEMPTS` | `2` | Total attempts, including the first request |
| `TELEGRAM_RETRY_BASE_DELAY_MS` | `500` | Exponential retry base |
| `TELEGRAM_RETRY_MAX_DELAY_MS` | `2000` | Maximum retry delay |

Notifications are disabled when either credential is absent. The server still
starts, price tracking continues normally, and no Telegram request is made.

The Bot API client uses HTTPS JSON requests. Network errors, timeouts, HTTP
408/425/429 responses, and server errors are temporary. Other Telegram errors
are permanent and are not retried. Telegram's `retry_after` value is used for
flood control but remains capped by the configured maximum delay. Exhausted or
permanent failures return `TELEGRAM_ERROR` internally and are logged without
the token, message text, product title, or destination chat ID.

## Duplicate prevention

The notification service serialises delivery in the single-process MVP and
rechecks `notification_events` immediately before every send. This prevents two
concurrent candidates in the process from sending the same known transition.

After Telegram confirms success, the existing owner-scoped repository inserts
the event using the exact variant, old and new amounts, price definition, price
type, pricing context, and context key. The database unique constraint is the
final duplicate guard. Failed deliveries create no notification event, so a
later genuine occurrence of that transition remains eligible.

## Connection test

After setting both credentials, run:

```powershell
npm.cmd run telegram:test
```

The command calls Telegram `getMe` to verify the bot token and `getChat` to
verify the configured destination. It does not send a test message and does not
print the token or chat ID.

## Automated verification

Run:

```powershell
npm.cmd run test:phase10
```

Coverage includes disabled configuration, invalid retry settings, HTML
escaping, complete message fields, connection checks, successful sending,
temporary retry with `retry_after`, permanent failure, concurrent duplicate
suppression, below-threshold suppression, direct snapshot delivery, leased
refresh delivery, successful-event persistence, and price-history survival
after delivery failure.

The complete regression command remains:

```powershell
npm.cmd test
```

## Manual live checklist

1. Create or select a Telegram bot through BotFather and keep its token outside
   the repository.
2. Start a private chat with the bot, or add it to the destination group or
   channel with permission to send messages.
3. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the local environment.
4. Run `npm.cmd run telegram:test` and confirm the bot and destination are
   reachable.
5. Start the backend with a separate manual database and create a controlled
   qualifying price transition through the normal extension snapshot flow.
6. Confirm one alert contains the correct product, variant, old/new prices,
   percentage, definition, context, and link.
7. Recreate the same old-to-new transition and confirm no second alert or
   notification-event row is created.
8. Temporarily use an invalid destination in a disposable test environment.
   Confirm price history commits, no notification event is stored, and the
   token never appears in logs. Restore the valid destination afterward.

Do not commit, paste into logs, or expose the real bot token in screenshots.
