# TSCART on Vercel (shared storage)

TSCART can stay on Vercel, but it must not use the local `data/tscart.sqlite` file as its production database. Vercel Functions may run in separate instances; a local SQLite file is not a shared database. This deployment path uses:

- **Turso (libSQL)** for shared SQLite-compatible product, order, payment, admin and audit data.
- **Vercel Blob (public store)** for newly uploaded product images and product description media.
- **Vercel Functions** for the existing `/api/*` endpoints.
- The existing `public/` storefront, with no visual redesign.

The local and Docker start commands continue to use the existing SQLite store. Only the Vercel API function uses Turso.

## Before changing production

1. Make a private backup of your current project and database.
2. Stop accepting new orders while the one-time database migration and deployment are in progress.
3. Confirm that the SQLite file you intend to migrate is the authoritative current store data. The migration script reads `data/tscart.sqlite` from this project folder. It cannot recover data from separate, temporary Vercel Function instances. If your latest orders or product edits exist only in a running deployment and are not in this file or another backup, **do not run the migration yet**; first obtain the correct production export/backup.
4. Do not delete the original `data/` folder or `data/order-secret` until the new Vercel deployment is verified.

## Create the Vercel storage resources

### 1. Turso database

1. Open the Vercel project that hosts TSCART.
2. Open **Storage** and install/connect **Turso Cloud** from the Vercel Marketplace.
3. Connect it to the TSCART project and enable the Production environment (and Preview if you use previews).
4. The integration supplies `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the connected project.

Use a new, empty Turso database for the first migration. The migration script intentionally refuses to overwrite an existing non-empty target.

### 2. Vercel Blob

1. In the same Vercel project, open **Storage** and create a **Blob** store.
2. Choose **Public** access. TSCART's product images and description media are public storefront assets.
3. Enable **Add a read-write token env var** and use the default variable name `BLOB_READ_WRITE_TOKEN`.
4. Connect the store to Production. Add Development too if you plan to pull the token locally through the Vercel CLI.

The public Blob store is intentional. Never expose `BLOB_READ_WRITE_TOKEN` to browser code or commit it to Git. The application only issues short-lived upload tokens after checking the admin session.

## Prepare environment variables

Set these in the Vercel project's Environment Variables:

- `APP_URL=https://your-production-domain` (no trailing path; use your actual production domain)
- `NODE_ENV=production`
- `STORE_MODE=demo` until Razorpay and real fulfilment are verified; use `live` only when ready to take actual orders
- `ORDER_SECRET` (the existing secret from `data/order-secret`; steps below)
- Existing Razorpay variables, if you use online payments: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- `REQUIRE_LIVE_KEYS=true` when you are ready for live Razorpay keys
- Optional `SERVICEABLE_PINCODES` as before

Turso's `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, plus Blob's `BLOB_READ_WRITE_TOKEN`, should be injected by their Vercel project connections. Verify all three names are available in the Production environment.

Set the Vercel project's Node.js runtime to **24.x**.

## Migrate the local SQLite database

Run these commands from the TSCART project directory using Node 24:

```powershell
# Remove the old dependency-free lockfile from the SQLite-only build, if present.
Remove-Item package-lock.json -ErrorAction SilentlyContinue
npm install
vercel link
vercel env pull .env.local
npm run migrate:vercel
```

The script:

- Creates the shared Turso schema without seeding duplicate sample products.
- Refuses to write if the target Turso database already has business records.
- Imports the source `data/` catalogue, settings, admin credentials, orders, payment references, reviews (if present), event/audit records and the order outbox (if present).
- Reconstructs permanent deletion markers from the audit history before importing products, so previously deleted IDs cannot return.
- Uploads any legacy `/uploads/...` files referenced by products or order snapshots to Blob and rewrites those URLs.
- Deliberately does not migrate admin sessions or rate-limit counters. Sign in again after cutover.
- Keeps the original SQLite database unchanged.

After a successful migration, the script writes `.vercel-migration.env` containing the existing `ORDER_SECRET`. Open that file locally and copy only the value after `ORDER_SECRET=` into the Vercel project's Production environment variable named `ORDER_SECRET`. Do not share the file, commit it, or include it in a project archive. The file is ignored by Git.

The script prints row counts after import and checks the remote product count. Stop if it reports a mismatch. Do not deploy until the database migration is verified.

## Build and deploy

The included `vercel.json` sets:

- Build command: `npm run build`
- Output directory: `public`
- API function: `api/[...path].js`
- Function duration: 30 seconds

The build bundles Vercel's browser upload SDK into `public/js/blob-upload.js`. Deploy by pushing the updated project to the connected Git branch or running:

```powershell
vercel --prod
```

Do not deploy until Turso and Blob are connected and `ORDER_SECRET` is set. The deployment will fail closed with a clear configuration error if required shared-storage settings are missing.

## Post-deploy checks

1. Open `https://your-production-domain/api/health`. Expected: `{"ok":true,"database":"connected"}`.
2. Open the storefront and confirm product images load.
3. Sign into `/admin` again; the previous admin session is intentionally invalidated.
4. Verify the product count against the migration report.
5. Create a draft product, edit it, reload the admin page and confirm it remains.
6. Permanently delete a test product. The API verifies that it is absent from the shared database before returning success. Refresh both the admin catalogue and storefront; it must remain absent.
7. Upload a small product image and a description-media file from the admin editor. Confirm both return public Blob URLs and load in the storefront.
8. Place a demo order and check its details in Admin > Orders. Do not switch to live payments until a test Razorpay payment and webhook have been confirmed.
9. In Razorpay Dashboard, confirm the webhook URL is `https://your-production-domain/api/webhooks/razorpay` and its secret matches `RAZORPAY_WEBHOOK_SECRET`.

## Notes

- `data/` remains the local-development SQLite database. It is not the Vercel production database after this migration.
- Product and order writes are performed against the shared Turso database inside transactions. Product deletion and its permanent tombstone are committed together, and the Vercel API performs a read-after-write check before acknowledging deletion.
- New uploaded media goes directly from the browser to Blob after admin authorization; it does not pass through the Vercel Function request body. The Vercel Blob client-upload flow is required for files larger than the 4.5 MB Function body limit.
- Keep private backups of the SQLite source and `.vercel-migration.env`. They contain sensitive business/order data or secrets.
