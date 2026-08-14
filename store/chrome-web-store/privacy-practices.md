# Chrome Web Store privacy practices

Copy these reviewed statements into the Developer Dashboard and re-check them whenever behavior or
permissions change.

## Permission justifications

### `activeTab`

Used only after the user opens the extension popup to determine whether the active tab is a
supported Shopee Vietnam product page and to show the corresponding captured product. This is
narrower than requesting access to every active website.

### `alarms`

Runs the user-enabled local polling schedule that asks the local backend whether a queued price
check is ready. Background polling is disabled by default.

### `notifications`

Shows a local Chrome notification when a background price check cannot continue because the current
Chrome profile must sign in to Shopee. It is not used for advertising.

### `storage`

Stores local settings, the random pricing-context identifier, pinned products, sanitised captures,
pending snapshot uploads, collection state, and an optional local application session token.
Storage access is restricted to trusted extension contexts where supported.

### `https://shopee.vn/*` and `https://*.shopee.vn/*`

Runs the capture bridge only on Shopee Vietnam pages and opens user-requested or scheduled product
checks in the current Chrome profile. The extension observes only allowlisted product-price fields
and never forwards cookies, request headers, or raw responses.

### `http://127.0.0.1/*` and `http://localhost/*`

Communicates with the user's Shopee Price Tracker companion backend on the same computer. Remote
backend origins are rejected by extension settings and are not declared in the manifest.

## Remote code declaration

Select **No, I am not using remote code**. All executable extension code is included in the uploaded
package. Network responses provide data only and are not evaluated as code.

## Data-use declarations

Disclose the following categories because Chrome Web Store disclosure covers local handling as well
as transmission:

- website content and browsing activity: the supported Shopee product URL and allowlisted product
  details required for price tracking;
- authentication information: an opaque local application session token when application
  authentication is enabled; and
- personally identifiable information: the local application account email when application
  authentication is enabled.

The extension does not handle financial or payment information, health information, personal
communications, precise location, or advertising data.

Certify that data use is limited to the extension's stated single purpose, is not sold or used for
advertising or credit decisions, and is not transferred to third parties except for user-directed
local processing described in the privacy policy.
