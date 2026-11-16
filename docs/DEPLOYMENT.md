# Hosting TSCART

**Keeping TSCART on Vercel?** Use the separate [Vercel deployment guide](VERCEL-DEPLOYMENT.md). It switches production API data to shared Turso storage and uploaded media to Vercel Blob; do not use the local SQLite path below for Vercel Functions.

The supplied application needs **one always-on Node.js 24 process, HTTPS and persistent disk**. It is a complete server application, not a folder of static HTML to upload to generic static hosting. SQLite, images and sessions are stored in `data/`.

Do not deploy this unchanged to ephemeral serverless hosting such as ordinary Vercel Functions. Multiple replicas or deleted ephemeral disks can lose state. To scale horizontally, migrate SQLite to a shared database and uploads to object storage.

## Any compatible Node host

1. Upload the project files or put them in your private Git repository. Exclude `.env`, `data/`, `backups/` and QA artifacts.
2. Select Node **24.x**, one instance, start command **`npm start`**, and no build command.
3. Attach persistent storage and set `DATA_DIR` to its absolute path. Give the application user read/write access.
4. Set `HOST=0.0.0.0`, the host-provided `PORT`, `APP_URL=https://your-domain`, `NODE_ENV=production`, `STORE_MODE=demo` initially and all required integration secrets.
5. Configure HTTPS and your domain. An HTTPS URL is required for production secure admin cookies.
6. Restart the app and verify the health endpoint `/api/health`, storefront and admin sign-in. Change the starter password and enter real business details before switching to live mode.
7. Back up and then restart once more. Confirm that orders, images and admin credentials persist.

Only set `TRUST_PROXY=true` when a trusted reverse proxy overwrites `X-Forwarded-For` and clients cannot directly reach the application port. Otherwise retain `false`. Rate limits use the effective client address; an incorrect proxy setting can either permit spoofing or put multiple customers in one shared bucket.

## Docker on a server

```sh
cp .env.example .env
# Edit .env for your domain, business mode and integrations.
docker compose up -d --build
```

The included compose file uses a persistent named volume and binds port 3000 only on the server's loopback interface. Put your existing HTTPS reverse proxy in front of it. For example, with Caddy installed on the server:

```text
your-domain.example {
    reverse_proxy 127.0.0.1:3000
}
```

Replace the example domain with your real hostname and configure DNS. The Caddy snippet is an example, not an installed/verified deployment. Choose a hosting environment that suits the owner's accounts and budget.

`docker compose restart` does not reread changed environment-file values. Use `docker compose up -d --force-recreate` after editing `.env`. **Never run `docker compose down -v` unless you intend to delete the named volume and all store data.**

## Backups and restore

Run `npm run backup` from the application folder. It creates a consistent SQLite snapshot, then copies the uploaded images and `order-secret` into a dated `backups/` directory. Backups contain customer information and authentication data; restrict access and keep a separate private copy. Retain the order secret so existing private confirmation links remain valid.

For a Docker deployment you can run `docker compose exec tscart node scripts/backup.js`, then copy the resulting directory out of the container before replacing it. The `backups/` directory is not mounted by the default compose file; schedule your own durable off-container backup transfer.

To restore: stop the app; move the current `data/` to a private recovery directory; create an empty `data/`; copy the complete backup into it; confirm ownership/permissions; and restart. Do not mix an old database with leftover SQLite WAL/SHM files. Do not expose backups under `public/`.

## Publish checklist

- Actual products, prices, available stock and supplier-approved photography.
- Real operator address, support contact and reviewed policy text.
- Starter admin password replaced; public access over HTTPS.
- Owner-only access to environment secrets, database and backups.
- Live Razorpay keys/webhook/capture settings verified and `REQUIRE_LIVE_KEYS=true`.
- Real COD order procedure, courier serviceability, supplier fulfilment and refund process ready.
- Restart persistence, backup restore and payment recovery checked.

No production site or cloud account was created by this package. Deployment is left with the owner so their domain, payment account, business details and persistent hosting can be connected correctly.
