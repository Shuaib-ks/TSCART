# TSCART

**Start with [START-HERE.md](START-HERE.md)** for login and one-command launch instructions.

A portable home-essentials storefront and admin with COD, Razorpay and order management. It requires Node.js 24.x and persistent writable storage for its local database and uploads.

```sh
npm run setup
npm start
```

Open http://localhost:3000. Admin: http://localhost:3000/admin.

```sh
npm test
npm run backup
```

This clean download does not include your supplied `.env`, database, order secret, customer uploads or backup archive. Keep your existing store and its data unchanged. See [VISUAL-REFRESH.md](VISUAL-REFRESH.md) before using this separate copy. Example catalogue data is illustrative and is seeded only into a new database.

## Visual refresh

The storefront appearance and home-page presentation have been refreshed. The original standalone server, order handling, admin, checkout features, integrations and environment-variable names remain unchanged. See [Visual Refresh](VISUAL-REFRESH.md).

## Guides

- [Start here](START-HERE.md)
- [Razorpay setup](docs/RAZORPAY.md)
- [Deploy on Vercel with shared storage](docs/VERCEL-DEPLOYMENT.md)
- [Deploy with a persistent Node host or Docker](docs/DEPLOYMENT.md)
- [Daily operation and recovery](docs/OPERATIONS.md)
- [Verification report](docs/VERIFICATION.md)
- [Asset credits](docs/ASSETS.md)

## Structure

The browser storefront uses ES modules and CSS. The Node HTTP server serves assets and same-origin APIs. `Store` owns transactional SQLite operations. `Integrations` calls Razorpay from the server. Orders are stored in SQLite and available in Admin → Orders. Payment amounts are integer paise and calculated from the database. Secrets are read only on the server.

There is no supplier API, courier booking, customer account system, email delivery service, automatic refund engine or tax-invoice generator. The order workflow is designed for the store operator to configure and manage manually.
