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

No API credentials, sessions, test orders or generated database are distributed in this ZIP. Demo catalogue data lives in `server/seed.js` and is seeded once, on first launch. All sample imagery is illustrative, not evidence of specific product stock.

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
