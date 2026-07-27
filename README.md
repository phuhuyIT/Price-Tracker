# Shopee Variant Price Collector

> The repository is being evolved from this working collector demo into the
> Shopee Price Tracker MVP described in [Task_list.md](Task_list.md). The Phase
> 0 product decisions are recorded in
> [docs/phase-0-mvp-definition.md](docs/phase-0-mvp-definition.md), and the
> target system design is in [docs/architecture.md](docs/architecture.md).
> Existing collector behavior is intentionally preserved for Phase 1 analysis.
> The persistent-profile Playwright mode described below is legacy discovery
> behavior; the target MVP uses anonymous Playwright contexts and relies on the
> extension for prices from the user's current Shopee session.

This project has two browser modes:

- `npm.cmd start` (also available as `npm.cmd run current`) uses the exact
  Chrome profile/window in which you click the extension icon. This is the
  default and is the right mode for your currently logged-in Shopee session.
- `npm.cmd run playwright` uses Playwright attachment or a separate persistent
  automation profile.

Both modes now collect two kinds of prices:

- `get_pc` supplies each SKU's base promotional price and original price.
- The script maps every valid `item.models[*].extinfo.tier_index` to its
  on-page option buttons. It selects those options and captures Shopee's
  resulting `pdp/cart_panel/select_variation_pc` response, including the
  voucher-adjusted final display price.

The clicks are dispatched as browser input in the product tab, allowing
Shopee's own frontend to generate the current per-request security headers.
Directly replaying a `get_pc` signature for another endpoint can return HTTP
403. A failed variant remains visible with an error note; its base price is
never reported as its final display price.

After updating this project, click **Reload** for the unpacked extension on
`chrome://extensions`. Confirm that its version is **1.2.0**.

If a variant still prints `Final display: N/A`, inspect the extension service
worker from `chrome://extensions`. An HTTP 200 response without a recognized
price now logs its exact `selected_tiers` key and raw payload. The terminal
also reports the response's root/data keys, which distinguishes an
unrecognized response shape from a request that Shopee never issued.

## Mode 1: exact current Chrome profile

### Install the extension once

Install it in every Chrome profile that you may want to use:

1. Open `chrome://extensions` in that profile.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

```text
E:\NĂM 2026\huấn luyện\giáo án 2026\Phú Huy\Projects\shopee price\chrome-extension
```

5. Pin **Shopee Price - Current Profile** to the Chrome toolbar.

Chrome requests the `debugger` permission because the extension must inspect
the Shopee network response containing the product data. It only attaches to
the temporary product tab that it creates.

### Run with the current profile

Start the local bridge:

```powershell
npm.cmd start
```

Or provide another Shopee URL:

```powershell
npm.cmd start -- "https://shopee.vn/your-product-i.123.456"
```

Then:

1. Focus the Chrome profile/window containing the Shopee login you want.
2. Click the **Shopee Price - Current Profile** extension icon in that window.

The extension opens a new tab in exactly that window and profile, so the tab
inherits its existing Shopee session. It closes only the temporary tab after
returning the product data to the terminal.

If several profiles are open, clicking the icon selects the profile
unambiguously because every profile has its own extension instance.

## Mode 2: Playwright or persistent automation profile

Run:

```powershell
npm.cmd run playwright
```

If there is no debuggable Chrome at `http://127.0.0.1:9222`, the script opens
Google Chrome with a persistent automation profile stored here:

```text
C:\Users\<your-user>\.shopee-price\chrome-profile
```

Log in to Shopee once in that window. The profile keeps its cookies, so later
runs remain logged in.

### Attach to an already-open debug-enabled Chrome

Playwright cannot attach to a Chrome window that was started normally. Start a
Chrome window with remote debugging and the same dedicated profile:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-address=127.0.0.1 `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:USERPROFILE\.shopee-price\chrome-profile"
```

Leave that Chrome window open, then run:

```powershell
npm.cmd run playwright
```

The script connects to it, creates a new tab in the existing context, extracts
the product data, closes only the tab it created, and disconnects. It does not
close your Chrome window.

For another debugging port:

```powershell
$env:CHROME_CDP_URL = "http://127.0.0.1:9223"
npm.cmd run playwright
```

If the connected browser exposes multiple contexts, the script prefers one
with an open Shopee tab, then one with a Shopee login cookie. To select a
specific zero-based context:

```powershell
$env:CHROME_CONTEXT_INDEX = "1"
npm.cmd run playwright
```

To store the persistent profile elsewhere:

```powershell
$env:CHROME_PROFILE_DIR = "D:\Browser Profiles\Shopee"
npm.cmd run playwright
```

## Code structure

- `product.js` parses product URLs and formats terminal output.
- `demo.js` is the small Playwright command entry point.
- `playwright-browser.js` owns Chrome connection and profile selection.
- `variant-pricing.js` adapts Playwright events and clicks to the shared flow.
- `current-profile.js` runs the local bridge used by the extension.
- `chrome-extension/background.js` contains only Chrome extension and CDP
  integration.
- `chrome-extension/shared/` is the single source of truth for pricing rules,
  variation-button selection, retries, and response ordering. It is used by
  both browser modes.

Keep Shopee response-shape changes in
`chrome-extension/shared/variant-core.js`; do not add separate price parsing
rules to the Playwright and extension adapters.

## Development

Run all checks:

```powershell
npm.cmd test
```

Run only the fast unit test:

```powershell
npm.cmd run test:variant
```
