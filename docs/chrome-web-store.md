# Chrome Web Store release guide

This guide prepares the local-only extension for Chrome Web Store review. Publication does not
convert the companion backend into a hosted service: the backend, SQLite database, dashboard, and
optional Telegram credentials stay on the user's computer.

## Submission boundary

The Store extension has one purpose: observe displayed product-price evidence on Shopee Vietnam
pages and send user-requested or scheduled snapshots to the user's local Shopee Price Tracker.

It supports only loopback backend origins. Do not add remote backend access to a Store release
without a separate security, hosting, privacy, and account-isolation design.

## Before packaging

1. Confirm every release version is synchronized.
2. Run `npm.cmd test`.
3. Run `npm.cmd run store:prepare`.
4. Inspect the generated ZIP and SHA-256 checksum under `dist/chrome-web-store`.
5. Confirm `manifest.json` is at the ZIP root.
6. Load `dist/extension` in a clean Chrome profile and repeat the live collection smoke test.
7. Review [PRIVACY.md](../PRIVACY.md) against the current implementation.
8. Capture current Store screenshots according to
   [the asset checklist](../store/chrome-web-store/assets/README.md).

## Developer Dashboard fields

Use the reviewed text in:

- [listing.md](../store/chrome-web-store/listing.md);
- [privacy-practices.md](../store/chrome-web-store/privacy-practices.md); and
- [reviewer-instructions.md](../store/chrome-web-store/reviewer-instructions.md).

Set the privacy policy URL to:

```text
https://github.com/phuhuyIT/Price-Tracker/blob/main/PRIVACY.md
```

The URL must be publicly accessible and must show the same policy as the submitted source tag.

## Manual publisher requirements

The repository cannot perform these account-owned actions:

- register or pay for the Chrome Web Store developer account;
- enable and retain two-step verification on the publisher account;
- accept publisher agreements;
- upload screenshots and the release ZIP;
- choose public, unlisted, or private distribution;
- submit the item for review; or
- respond to reviewer questions.

Use private visibility for the first Store review and installation test when practical. All
visibility modes remain subject to Chrome Web Store policy review.

## Submission readiness

The package is ready to submit after:

- automated tests and Store packaging pass;
- the three real screenshots are reviewed;
- the privacy policy URL is publicly accessible from the tagged source;
- the unpacked extension completes a live Shopee capture and local-backend upload;
- a manually queued price check opens an inactive tab and completes; and
- the Store listing accurately describes the local companion-backend requirement.

## Post-approval acceptance

After Chrome Web Store review succeeds:

1. Install the reviewed item through the selected test distribution mode.
2. Confirm it connects to the local backend.
3. Repeat one live Shopee snapshot upload.
4. Repeat one queued manual price check and confirm its inactive tab closes after completion.

Post-approval acceptance validates Store delivery and updates. It does not block the source tag or
the initial Store submission.
