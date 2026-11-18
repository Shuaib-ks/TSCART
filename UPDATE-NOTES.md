# TSCART storefront visual refresh

This release refreshes storefront styling and home-page copy while retaining the original Node server, catalog, shopping bag, checkout, admin, integrations and all environment-variable names.

No backend or checkout code was changed. This clean download excludes the supplied `.env`, database, order secret, customer records and uploaded order data. Keep your existing `.env` and `data/` unchanged on your current store. Use the download as a separate copy unless you deliberately update storefront files after taking a backup. The new stylesheet is linked from the shop page; it does not replace server or admin functionality.

The Lovable preview uses a sample catalog and demo COD checkout. It does not place live orders or connect to your original store. This release did not modify or verify live hosting, credentials or payment providers. Existing server settings and safeguards are unchanged.

## Separate-copy setup

1. Install Node.js 24.x and extract this clean ZIP into its own new folder.
2. Follow [START-HERE.md](START-HERE.md) to launch it in demo mode.
3. Never overwrite your existing `.env` or `data/` folder while updating your original installation.

The downloadable archive does not include original private store settings, the customer database, order secret, customer uploads or the nested backup archive.

## Verification and environment limits

The storefront preview, responsive layout, sample catalog, image rendering, demo COD checkout and session-private test receipt were checked. Eleven route/store tests passed and TypeScript checks passed. The original full application suite under the required Node.js 24 reported **51 passed and 4 failed**: two failures cover supplied admin session/password invalidation behavior, and two cover supplied checkout readiness/payment configuration behavior. No original live site, account, database or payment provider was accessed or changed.
