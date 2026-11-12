# Connect Razorpay

Use your friend's **merchant Payment Gateway** account. Having the mobile app installed is not sufficient. The account owner should handle account activation and bank settlement details directly with Razorpay.

## The exact values to request

| Value | Where it is used |
|---|---|
| Test Key ID (`rzp_test_...`) | `RAZORPAY_KEY_ID` on staging |
| Test Key Secret | `RAZORPAY_KEY_SECRET` on staging |
| Live Key ID (`rzp_live_...`) | Replace test ID for production |
| Live Key Secret | Replace test secret for production |
| Webhook signing secret | `RAZORPAY_WEBHOOK_SECRET`; choose a separate long random string |
| Website domain | `APP_URL`; register/update website details in the merchant account as required |

Keep secrets in the hosting platform's environment-variable panel or in `.env` on a trusted private server. Never put Key Secret or webhook secret in frontend JavaScript, Git, screenshots or public messages. The public Key ID is returned to checkout; the secrets are not.

## Configure

1. Sign in to the [Razorpay Dashboard](https://dashboard.razorpay.com/), select Test Mode and generate API keys under Account & Settings → API Keys (labels may vary).
2. Enter the following into the staging server environment:

```dotenv
STORE_MODE=live
RAZORPAY_KEY_ID=rzp_test_REPLACE_ME
RAZORPAY_KEY_SECRET=REPLACE_ME
RAZORPAY_WEBHOOK_SECRET=CHOOSE_A_DIFFERENT_LONG_RANDOM_SECRET
REQUIRE_LIVE_KEYS=false
```

`STORE_MODE=live` activates the payment code. With test keys, only simulated transactions occur. Use a separate staging data directory and WhatsApp test configuration or leave WhatsApp unconfigured.

3. Create a webhook in the same Test Mode. URL: `https://YOUR-DOMAIN/api/webhooks/razorpay`. Use exactly the same webhook secret as the environment. Subscribe to **payment.captured** and **order.paid**. The endpoint also safely ignores unrelated events.
4. Enable automatic capture for order payments in the merchant dashboard. An authorised payment is not treated as paid by this app.
5. Restart the server. Admin → Settings should show Razorpay as configured. This checks presence, not credential validity.
6. Test successful, failed and dismissed checkouts. Verify that the order is confirmed only after capture. Repeat/replay a webhook to verify it does not duplicate an order or a queued alert. Close the browser after payment and confirm the webhook still updates the order.
7. For production, complete account activation, generate **live** keys, create the **live-mode** webhook, replace the secrets, and set `REQUIRE_LIVE_KEYS=true`. Restart and perform an owner-authorised small real payment and refund.

## How this implementation works

The server computes prices and creates a Razorpay Order. Checkout receives that order ID. The payment callback is verified with HMAC-SHA256 using the server's stored order ID; the backend then fetches the payment and checks captured status, amount, INR currency and order ID. Webhooks are validated against the original request bytes and processed idempotently. Capture events can confirm an order even if the customer closes the browser.

## When something fails

- **Online choice disabled:** required keys or webhook secret are missing, store is in demo mode, or live-key enforcement rejects test credentials.
- **Signature error:** do not fulfil based on a browser success screen. Check server secrets and mode.
- **Authorised, not captured:** check capture configuration. Reconcile in Admin → Orders after the payment captures.
- **Interrupted order creation:** the app holds the order for review instead of automatically creating another payment order. Find the provider order by the TSCART receipt in Razorpay, then use Admin → order → Payment reconciliation to attach the matching ID and fetch the latest payment status.
- **Cancellation:** it restores reserved stock but does not issue a refund. Review the gateway first and refund in the Razorpay dashboard where appropriate. Late captures are flagged `needs_review`.

## Official references

- [Standard Checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
- [Validate and test webhooks](https://razorpay.com/docs/webhooks/validate-test/)

Documentation checked 12 November 2026. Dashboard layouts and account eligibility may change.
