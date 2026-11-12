# Automatic WhatsApp order alerts

The backend is configured to send fulfilment alerts to **+91 77366 81091** (`917736681091` in the API). Customers do not open WhatsApp, redirect to wa.me or send a message. They see a checkout disclosure about the use of their details for fulfilment.

The normal WhatsApp/WhatsApp Business phone app cannot provide this backend automation by itself. Use **Meta WhatsApp Business Platform Cloud API**. This package does not use unofficial WhatsApp Web bots or QR-session automation.

## Get these from the account owner or API administrator

| Environment setting | Required value |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | System-user access token with WhatsApp messaging permission |
| `WHATSAPP_PHONE_NUMBER_ID` | API sender's Phone Number ID (not its visible phone number and not WABA ID) |
| `WHATSAPP_GRAPH_VERSION` | A supported Graph API version selected in the Meta app, such as the version shown in API Setup |
| `WHATSAPP_TEMPLATE_NAME` | Approved template name; default `tscart_order_alert` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Exact approved language code; default `en` |
| `WHATSAPP_TO` | `917736681091` |

Use an API sender distinct from the receiving phone. The recipient must agree to receive operational order alerts. With Meta's test sender, add and verify the receiving number as an allowed test recipient. For live use, complete Meta's business/sender setup and any billing requirements. Test tokens may expire quickly; use a suitable system-user token and monitor expiry/revocation.

## Create the template

Create this as a **text body only**, with **10 positional text variables**. The order must match below. Request an appropriate utility/operational category, subject to Meta's approval; approval is not guaranteed. Do not add required header or button variables without also updating `server/integrations.js`.

Name: `tscart_order_alert`  
Language: English (`en`), or change the environment to the exact language Meta approves.

```text
TSCART fulfilment alert
Order reference: {{1}}
Customer name: {{2}}
Customer mobile: {{3}}
Customer email: {{4}}
Delivery address: {{5}}
Order items: {{6}}
Additional items: {{7}}
Order totals: {{8}}
Payment method and status: {{9}}
Delivery notes: {{10}}
Please review this order in the TSCART admin panel before fulfilment.
```

Use fictional examples when submitting template samples, for example a test customer, 42 Sample Street, Kochi and an example order reference. The two item fields allow long baskets to fit the template. The second shows “No additional items” when unused. Maximum 12 different products per checkout and 10 units per product.

## Connect and verify

1. Create/prepare the Meta business app and add WhatsApp. Obtain the sender ID and token from the business's setup process.
2. Submit the template above and wait for approval. Approval, access to recipient numbers and provider billing are outside this ZIP.
3. Enter all environment values. Restart the app. Keep tokens server-side.
4. Switch a staging store to `STORE_MODE=live`, with appropriate owner test details. Place a COD order with the intended test customer's agreement. The backend queues the alert and sends it within roughly 15 seconds when the server is running.
5. Verify the **actual received message** on the owner’s phone, including the complete address and items. Admin → Orders shows queue state, attempts and API errors. “Sent” means Meta accepted the request and returned an ID; it is not a delivered/read receipt.

## Failure handling

- No credentials: the order remains saved; notification waits in `waiting_setup`.
- Provider failure: retry with exponential backoff, up to eight attempts, then `failed`. Correct the issue and use Retry notification in the order screen.
- Server restart: the persistent queue resumes. An interrupted sending job is retried.
- Uncertain timeout: Meta may have accepted the message before the connection failed. A retry can create a duplicate WhatsApp alert; use the TSCART order number to deduplicate fulfilment. The database remains the order source of truth.
- Cancelled order: unsent alerts are cancelled. An alert already accepted by Meta cannot be recalled. Always check current admin status before fulfilment.
- Demo orders: no message is sent, even when API credentials exist.

Do not use the owner's delivery alert as customer marketing consent. Customer data and recipient access should be limited to people who need them for fulfilment.

## Official references

- [Meta's WhatsApp Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api)
- [Meta template-message request](https://www.postman.com/meta/whatsapp-business-platform/request/o65u5m5/send-message-template-text)
- [Meta-hosted template message example](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/)
- [WhatsApp Business template guidance](https://whatsappbusiness.com/blog/manage-message-templates-whatsapp-business-api/)

The app calls the current Cloud API HTTP endpoint directly; it does not depend on the older Node SDK linked for the template payload example. Set a supported API version from your own Meta app, rather than assuming an old tutorial's version is current.
