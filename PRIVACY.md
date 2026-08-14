# Privacy policy

Effective date: August 14, 2026

Shopee Price Tracker is a local-only browser extension and companion application for recording
prices displayed on Shopee Vietnam product pages. The project is independent and is not affiliated
with, endorsed by, or sponsored by Shopee.

## Data handled by the extension

On supported `shopee.vn` product pages, the extension may observe and store the minimum product
information needed for price tracking:

- the product URL, shop ID, item ID, title, and image URL;
- variant identifiers and names;
- displayed prices, price type, availability, and stock quantity when Shopee exposes it;
- the capture time and collection status; and
- a random installation-specific pricing-context identifier that contains no Shopee account ID.

The extension also stores operational information on the user's computer, including its local
backend URL, opt-in collection settings, pinned products, pending snapshot uploads, collection-job
state, and sanitised error summaries.

If the user explicitly enables application authentication in their local backend, the extension
handles the email address entered for that application account and stores the returned opaque
session token in protected extension storage. The password is sent directly to the user's local
backend for sign-in and is not retained by the extension.

## Data the extension does not collect

The extension does not collect or transmit Shopee cookies, Shopee passwords, authentication
headers, payment information, delivery addresses, private messages, form contents, or complete raw
Shopee API responses. It does not monitor websites outside the declared Shopee Vietnam host scope.

## How data is used and shared

Observed product information is used only to provide product tracking, historical prices,
collection status, and user-requested price checks. The extension sends tracked data only to the
companion backend running on a loopback address on the same computer, such as
`http://127.0.0.1:3000` or `http://localhost:3000`.

The extension does not send data to a developer-operated server. It does not sell data, use data
for advertising, share data with data brokers, or allow the developer or other third parties to
read the user's tracked information. Optional Telegram alerts are sent by the user's local backend
using credentials privately configured by that user; the extension does not communicate with
Telegram.

The use of information received through Chrome extension permissions complies with the Chrome Web
Store User Data Policy, including the Limited Use requirements.

## Storage, retention, and deletion

Extension settings, sanitised captures, queues, and an optional local application session are kept
in `chrome.storage.local` until replaced, cleared through the extension controls where available,
or removed when the extension is uninstalled. Tracked products and price history remain in the
user's local SQLite database until the user deletes them or removes that database.

Users can delete individual tracked products from the dashboard, clear failed snapshot uploads in
extension Options, sign out to revoke and remove an application session, or uninstall the extension
and delete the local application data.

## Security

The extension accepts only loopback HTTP backend origins and restricts website access to Shopee
Vietnam. Executable code is bundled inside the extension package; remotely hosted executable code
is not used. Shopee credentials remain in the Shopee page and are not copied into the extension's
backend requests.

## Changes

Material changes to these practices will be disclosed before the changed data handling begins. The
effective date above will be updated when this policy changes.

## Contact

Privacy questions and deletion-support requests can be opened through the project's public issue
tracker: <https://github.com/phuhuyIT/Price-Tracker/issues>.
