# Verification report

## Current update: v1.0.7

Three new origin/CRUD regression tests pass. Full suite: **48 passed, 4 pre-existing failures**. Browser UI-fixture checks verified creation, editing, error recovery, cancellation and deletion; the actual storefront verified announcement scrolling and pause controls. Real backend authentication and product writes were checked through HTTP tests. No live hosted store or provider transaction was exercised. See `../UPDATE-NOTES.md` for exact scope and retained limitations.

## Previous update: v1.0.6 based on your edited archive

**45 tests pass; 4 pre-existing tests fail.** The ten new feature tests all pass. The same four failures were reproduced on the supplied source before changes and stem from its disabled session/checkout safeguards, preserved as requested. See `../UPDATE-NOTES.md` for current checks, limitations and data-preservation instructions. Unlike the original clean release below, this archive includes your uploaded private configuration and database snapshot, with no data created by our preview testing.

## Historical reports from earlier releases

Verified on 12 November 2026 with Node.js 24.22.1.

## Automated checks

`npm test`: **39 passed, 0 failed**.

Coverage includes server-derived prices; shipping totals; stock reservations; competing last-item checkouts; multi-item rollback; duplicate checkout requests; duplicate product rows; stale admin stock edits; address/PIN validation; consent requirement; archive visibility; private receipt access; cancellation/restock idempotency; COD collection state; captured-payment amount/currency/order checks; late captures after cancellation; duplicate signed webhooks; out-of-order failed payment events; coalesced gateway creation; uncertain provider timeouts; persisted data across restart; admin authentication; cross-origin request rejection; password hashing/rotation/session invalidation; product create/update/archive; image upload validation/persistence; and absence of secrets from public configuration.

Payment provider requests use controlled test responses. No real payment was made during verification.

JavaScript syntax checks passed for the browser application, server, integrations and setup/backup scripts. The backup script was also run against a temporary database; its saved database contents and order-secret file were verified.

## Earlier-release browser checks (layout retained)

- Desktop storefront visual review.
- Added a sample mug to the shopping bag and completed a demo COD checkout; private receipt displayed the correct item, address, quantity, shipping and total.
- Responsive layout tested in a 390-pixel frame (375-pixel content area with browser scrollbar).
- Mobile product browsing, live search, product details, quantity changes, free-shipping threshold, cart and a second demo COD checkout verified.
- Mobile homepage and checkout had no horizontal document overflow after a layout correction.
- Consent checkbox was operable by keyboard. In the embedded test frame, automatic pointer scrolling placed it under the sticky header; a scroll-margin improvement was added afterward.
- Admin sign-in page was visually loaded. Authenticated administration was verified through HTTP tests; an authenticated admin browser session was not exercised.

The mobile test wrapper and its temporary same-origin framing settings were removed. The delivered server uses `X-Frame-Options: DENY` and `frame-ancestors 'none'`.

## Remaining launch verification

- Actual Razorpay test/live account integration, provider checkout UI, capture configuration and public webhook delivery.
- Owner's hosting, HTTPS reverse proxy, backups, account activation and domain setup.
- Supplier product accuracy, stock, fulfilment, shipping serviceability and refund process.
- Native Windows and macOS launcher execution, Docker image build and real mobile Safari/Android device checks were not run in this Linux environment.

The ZIP is integration-ready source, not a deployed or credential-connected live shop. Sample products and the initial admin login are clearly documented. No generated database, preview order, live secret or test wrapper is included in the deliverable.

## Windows asset-loading correction (v1.0.3)

The original release compared filesystem paths against a prefix ending in a hard-coded `/`. On Windows the resolved paths use backslashes, so the homepage was served while CSS, JavaScript, fonts and images were incorrectly rejected. This produced an unstyled loading screen.

The corrected server uses a platform-aware relative-path containment check. Seven regression checks cover Windows and POSIX asset paths, SPA routes, traversal protection and actual HTTP responses for the assets referenced by index.html, including query strings and MIME types. Windows path semantics were tested with Node’s win32 path implementation on Linux; native Windows execution has not been performed here.

To update an existing installation: stop the server, copy the corrected ZIP’s tscart contents over the existing tscart folder and allow file replacements, retain data/ and .env, restart START-WINDOWS.bat, and press Ctrl+F5 in the browser.


## Admin product deletion (v1.0.4)

Added Delete controls in the product list and editor, with a named-product confirmation. Archive remains available. Permanent deletion uses a separate endpoint so an older admin page's Archive button cannot accidentally perform a permanent delete.

Five additional regression tests passed: authenticated permanent deletion and request protection; preservation of order snapshots and uploaded images; rejection of stale edits after deletion; an empty catalogue remaining empty after restart; and successful capture of an already-reserved online order after its product is deleted. These also check repeated deletion, archived-product deletion, stale checkout rollback, cancellation/restock behaviour and reuse of a deleted URL slug for a new product.

Browser application and changed server modules passed syntax checks. The updated storefront and admin sign-in page loaded in the browser. Authenticated deletion was tested through the HTTP API; the admin confirmation dialog was not exercised in a signed-in browser session. The prior Windows asset-path fix remains included.


## Orders managed in admin (v1.0.5)

Removed the messaging sender, background queue worker, retry endpoint, integration settings, environment-variable examples and obsolete setup guide. Checkout and privacy wording now describe use of order details for fulfilment without an external messaging service. The existing Admin → Orders screens retain full customer/contact/address details, delivery notes, item snapshots, quantities, totals, payment state and fulfilment controls.

The current suite has 39 passing tests. Four retired messaging tests were removed and three regression scenarios were added: complete live COD details reaching the authenticated admin with zero external requests even when old messaging environment values remain; online checkout appearing in admin before payment and updating after verified Razorpay capture; and an existing database reopening without losing orders, products, settings, sessions or private order links. Obsolete message records in existing databases are left untouched and are never read, resumed or appended by the application.

Razorpay request/verification/reconciliation methods, product deletion, the Windows asset-path fix, CSS, images and fonts were preserved. JavaScript syntax checks passed. This update was verified through HTTP/database tests; no new signed-in browser session or live-provider transaction was performed.
