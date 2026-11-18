# Your TSCART store

A complete home-essentials store with a refreshed storefront appearance. Your existing server, admin, checkout, integrations and environment-variable names are unchanged.

## Open it in five minutes

1. Install **Node.js 24.x LTS** from https://nodejs.org/.
2. Extract this ZIP into its own new folder. This is a separate, clean copy: do not replace your current store or its `.env`/`data/` folders.
3. On Windows, double-click **START-WINDOWS.bat**. On macOS/Linux, open a terminal here and run `sh start.sh`.
4. Visit **http://localhost:3000**. Keep the terminal open while using the store.
5. Visit **http://localhost:3000/admin** to manage this separate copy.

Alternatively, use `npm run setup` followed by `npm start`. You do **not** need `npm install`.

## First admin login

| Field | Value |
|---|---|
| Email | `tscart@gmai.com` |
| Password | `TSCART123` |

These are the default first-run credentials in `.env.example`. The original admin and payment safeguards were not changed in this visual refresh. Review [UPDATE-NOTES.md](UPDATE-NOTES.md), change the starter password, and verify authentication before exposing any copy publicly.

This clean copy starts in **demo mode**. COD test orders are saved only to this new copy; no real order is dispatched. The example products and photos are sample catalogue content, not confirmation of supplier stock.

## Features in the original application

- Responsive storefront, SVG branding, local product imagery and fonts.
- Product pages, categories, search, sorting, shopping bag and quantity controls.
- Indian-address checkout with COD; Razorpay online checkout and signed webhooks.
- Admin product editing, photos, stock, publishing, permanent deletion, order management and CSV export.
- Product reviews, fulfilment notes and order reconciliation.
- Hashed admin passwords, private order links, server-calculated prices and request protection.

## Before accepting real orders

1. Change the initial admin password and verify access.
2. Replace sample products. Confirm product details, supplier permissions, prices and stock.
3. Enter the real business address, support email and delivery/returns terms. Review all policy pages.
4. Deploy with persistent writable storage and HTTPS; see `docs/DEPLOYMENT.md`.
5. Configure the environment and payment provider, starting with a staging copy. Follow `docs/RAZORPAY.md`.
6. Back up the new copy's `data/` directory and verify it survives a restart.

Your existing store settings and records were not included in this clean download. Keep the original `.env` and entire `data/` folder unchanged. The new stylesheet and home-page presentation can be adopted separately after backing up your store files.

The application is designed for a persistent Node.js 24.x service; it is not a static-only site. SQLite, uploads and backup files require persistent writable storage. No live site, payment provider or account was accessed or modified for this refresh.

## Commands

| Command | Purpose |
|---|---|
| `npm run setup` | Create `.env` without replacing an existing file |
| `npm start` | Start the app |
| `npm test` | Run database, checkout, payment and admin tests |
| `npm run backup` | Snapshot SQLite and copy uploaded images/order secret |

Main folders: `public/` (storefront), `server/` (backend), `scripts/` (setup/backup), `tests/`, and `docs/`. The `data/` folder is created automatically on first launch and must stay private.
