# Storefront visual refresh

This refresh updates the shop's appearance using the original TSCART branding, catalog, photography and licensed fonts. The standalone application runs with Node.js 24.x using the existing `START-HERE.md` instructions.

## What stays the same

The catalog, product prices, storefront pages, shopping bag, customer checkout, COD and Razorpay integrations, product reviews, admin, order records, server endpoints and names of all variables in `.env.example` are preserved.

## Your existing store data

For safety, this ZIP contains source, sample products and store images, but excludes your private `.env`, SQLite database and sidecar files, order secret, customer uploads and nested backup archive. Keep your existing `.env` and `data/` folder unchanged. Extract this ZIP into a separate folder; a new copy starts with demo catalogue content and does not affect your existing records.

## Important

This package was not connected to your live account, domain, database or payments. Node.js 24.x is required by the original project. The original full test suite reported 51 passed and 4 failures in admin session/password invalidation and checkout readiness/payment configuration tests. The original admin and payment safeguards remain as supplied and were not security-reviewed in this visual refresh. Review them before exposing any fresh copy publicly or enabling real orders.
