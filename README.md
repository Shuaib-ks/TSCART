# TSCART

**Start with [START-HERE.md](START-HERE.md)** for the login, one-command launch and integration checklist.

Premium home-essentials storefront and admin with COD, Razorpay and complete order details in the admin panel. Portable Node.js 24 application with no third-party runtime dependencies. Local SQLite and immutable uploaded images require a persistent volume.

```sh
npm run setup
npm start
```

Open http://localhost:3000. Admin: http://localhost:3000/admin.

```sh
npm test
npm run backup
```

This updated ZIP preserves the configuration and database supplied in your edited archive. Treat it as a private store backup. No orders, reviews or uploads created during this update's testing are included. See [UPDATE-NOTES.md](UPDATE-NOTES.md) before replacing an existing installation. Demo catalogue data lives in `server/seed.js` and is seeded only for a new database. All sample imagery is illustrative, not evidence of specific product stock.

## Guides

- [Start here](START-HERE.md)
- [Razorpay setup](docs/RAZORPAY.md)
- [Deploy with persistent storage](docs/DEPLOYMENT.md)
- [Daily operation and recovery](docs/OPERATIONS.md)
- [Verification report](docs/VERIFICATION.md)
- [Asset credits](docs/ASSETS.md)

## Structure

The storefront uses browser ES modules and CSS. The Node HTTP server serves assets and same-origin APIs. `Store` owns transactional SQLite operations. `Integrations` calls Razorpay from the server. Orders are saved directly to SQLite and are available in Admin → Orders. All payment amounts are integer paise and are calculated from the database. Secrets are read only on the server.

There is no supplier API, courier booking, customer account system, email delivery service, automatic refund engine or tax-invoice generator. The provided order workflow and fulfilment alerts are ready for a small store to configure and operate.
