# Verification report

Verified on 12 November 2026 with Node.js 24.22.1.

## Automated checks

`npm test`: **35 passed, 0 failed**.

Coverage includes server-derived prices; shipping totals; stock reservations; competing last-item checkouts; multi-item rollback; duplicate checkout requests; duplicate product rows; stale admin stock edits; address/PIN validation; consent requirement; archive visibility; private receipt access; cancellation/restock idempotency; COD collection state; captured-payment amount/currency/order checks; late captures after cancellation; duplicate signed webhooks; out-of-order failed payment events; coalesced gateway creation; uncertain provider timeouts; persisted data across restart; demo notification suppression; missing WhatsApp configuration; successful template payloads; retries; admin authentication; cross-origin request rejection; password hashing/rotation/session invalidation; product create/update/archive; image upload validation/persistence; and absence of secrets from public configuration.

Payment and WhatsApp provider requests use controlled test responses. No real payment or outbound WhatsApp notification was made during verification.

JavaScript syntax checks passed for the browser application, server, integrations and setup/backup scripts. The backup script was also run against a temporary database; its saved database contents and order-secret file were verified.

## Browser checks

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
- Actual Meta account permissions, approved template, billing, recipient setup and received WhatsApp message.
- Owner's hosting, HTTPS reverse proxy, backups, account activation and domain setup.
- Supplier product accuracy, stock, fulfilment, shipping serviceability and refund process.
- Native Windows and macOS launcher execution, Docker image build and real mobile Safari/Android device checks were not run in this Linux environment.

The ZIP is integration-ready source, not a deployed or credential-connected live shop. Sample products and the initial admin login are clearly documented. No generated database, preview order, live secret or test wrapper is included in the deliverable.

## Windows asset-loading correction (v1.0.3)

The original release compared filesystem paths against a prefix ending in a hard-coded `/`. On Windows the resolved paths use backslashes, so the homepage was served while CSS, JavaScript, fonts and images were incorrectly rejected. This produced an unstyled loading screen.

The corrected server uses a platform-aware relative-path containment check. Seven regression checks cover Windows and POSIX asset paths, SPA routes, traversal protection and actual HTTP responses for the assets referenced by index.html, including query strings and MIME types. Windows path semantics were tested with Node’s win32 path implementation on Linux; native Windows execution has not been performed here.

To update an existing installation: stop the server, copy the corrected ZIP’s tscart contents over the existing tscart folder and allow file replacements, retain data/ and .env, restart START-WINDOWS.bat, and press Ctrl+F5 in the browser.
