import { handleUpload } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import { TursoStore } from './turso-store.js';
import { TursoIntegrations } from './turso-integrations.js';
import { randomToken, sha, checkPassword, hashPassword, hmac, equalHex, HttpError, insist, str, acceptsRequestOrigin } from './security.js';

const COOKIE_NAME = 'tscart_session=';
const MAX_JSON_BYTES = 100_000;

function cookieToken(req) {
  return (req.headers.cookie || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(COOKIE_NAME))?.slice(COOKIE_NAME.length) || '';
}

function readBody(req, max = MAX_JSON_BYTES, raw = false) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      length += chunk.length;
      if (length > max) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new HttpError(413, 'Request is too large.'));
      const data = Buffer.concat(chunks);
      if (raw) return resolve(data);
      if (!(req.headers['content-type'] || '').includes('application/json')) return reject(new HttpError(415, 'Send JSON data.'));
      try { resolve(JSON.parse(data.toString() || '{}')); }
      catch { reject(new HttpError(400, 'Invalid JSON request.')); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new HttpError(400, 'Request was interrupted.')));
  });
}

function publicOrder(order) {
  return { ...order, consentAt: undefined, consentVersion: undefined, gatewayState: undefined };
}

function imageOrDescriptionKind(clientPayload) {
  let value;
  try { value = JSON.parse(clientPayload || '{}'); } catch { value = null; }
  insist(value && ['product-image', 'description-media'].includes(value.kind), 'Invalid upload type.', 400);
  return value.kind;
}

function uploadRules(kind) {
  if (kind === 'product-image') {
    return { allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'], maximumSizeInBytes: 5 * 1024 * 1024 };
  }
  return {
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/x-wav'],
    maximumSizeInBytes: 20 * 1024 * 1024
  };
}

function inferMediaType(contentType) {
  if (contentType?.startsWith('image/')) return 'image';
  if (contentType?.startsWith('video/')) return 'video';
  if (contentType?.startsWith('audio/')) return 'audio';
  return null;
}

export async function makeVercelHandler({ env = process.env, fetcher = fetch } = {}) {
  const store = await TursoStore.create(env);
  const integrations = new TursoIntegrations(store, env, fetcher);
  const production = env.NODE_ENV === 'production';
  if (production) insist(/^https:\/\//.test(env.APP_URL || ''), 'Production requires an HTTPS APP_URL.', 500);
  insist(env.BLOB_READ_WRITE_TOKEN, 'Connect a public Vercel Blob store and add its read-write token before starting TSCART.', 503);

  const cookie = (token, age = 28800) => `tscart_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${production ? '; Secure' : ''}`;

  async function getAdmin(req) {
    return store.authenticateAdmin(cookieToken(req));
  }

  async function blobUpload(req, res, json) {
    const payload = await readBody(req, 100_000);
    const result = await handleUpload({
      body: payload,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        insist(req.headers.origin, 'Upload origin is required.', 403);
        insist(acceptsRequestOrigin(req, env), 'Cross-origin request blocked.', 403);
        insist(req.headers['sec-fetch-site'] !== 'cross-site', 'Cross-site request blocked.', 403);
        await getAdmin(req);
        const kind = imageOrDescriptionKind(clientPayload);
        return { ...uploadRules(kind), addRandomSuffix: true, tokenPayload: JSON.stringify({ kind }) };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let kind;
        try { kind = JSON.parse(tokenPayload || '{}').kind; } catch {}
        const mediaType = inferMediaType(blob.contentType);
        const validKind = kind === 'product-image'
          ? ['image/jpeg', 'image/png', 'image/webp'].includes(blob.contentType) && Number(blob.size) <= 5 * 1024 * 1024
          : kind === 'description-media' && !!mediaType && uploadRules(kind).allowedContentTypes.includes(blob.contentType) && Number(blob.size) <= 20 * 1024 * 1024;
        if (!validKind) {
          try { await del(blob.url); } catch {}
          throw new Error('The uploaded file type or size is not allowed.');
        }
      }
    });
    return json(result);
  }

  return async function vercelRequestHandler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://checkout.razorpay.com https://connect.facebook.net; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https:; font-src 'self'; connect-src 'self' https://*.razorpay.com https://*.razorpay.in https://vercel.com https://*.blob.vercel-storage.com https://www.facebook.com; frame-src https://*.razorpay.com https://*.razorpay.in; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const json = (data, status = 200) => {
      if (res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };

    try {
      const url = new URL(req.url, 'https://vercel.invalid');
      let path = url.pathname;
      // Non-Next.js Vercel Functions only match one dynamic path segment.
      // vercel.json rewrites deeper /api/* requests to /api?__path=... so this
      // shared handler can dispatch the original route consistently.
      if (url.pathname === '/api' && url.searchParams.has('__path')) {
        const routedSegments = String(url.searchParams.get('__path') || '').split('/');
        insist(routedSegments.length >= 1 && routedSegments.length <= 5 &&
          routedSegments.every(segment => /^[a-zA-Z0-9_-]+$/.test(segment)),
          'Invalid API path.', 400);
        path = '/api/' + routedSegments.join('/');
      }
      const method = req.method;
      const forwarded = req.headers['x-forwarded-for'];
      const ip = (env.VERCEL === '1' || env.TRUST_PROXY === 'true') && typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : req.socket?.remoteAddress || 'unknown';

      // The Blob SDK validates signed completion callbacks itself. User token requests
      // are authenticated in onBeforeGenerateToken above, before a client token exists.
      if (path === '/api/admin/blob-upload' && method === 'POST') return await blobUpload(req, res, json);

      if (path === '/api/webhooks/razorpay' && method === 'POST') {
        insist(env.RAZORPAY_WEBHOOK_SECRET, 'Webhook is not configured.', 503);
        const raw = await readBody(req, 200_000, true);
        insist(equalHex(hmac(env.RAZORPAY_WEBHOOK_SECRET, raw), req.headers['x-razorpay-signature']), 'Invalid webhook signature.', 401);
        const event = JSON.parse(raw.toString());
        const eventId = String(req.headers['x-razorpay-event-id'] || sha(raw));
        if (await store.eventExists(eventId)) return json({ ok: true });
        if (['payment.captured', 'order.paid'].includes(event.event)) {
          const payment = event.payload?.payment?.entity;
          if (payment?.order_id) {
            const row = await store.orderIdForGateway(payment.order_id);
            if (row) await store.confirmPayment(row.id, payment);
          }
        }
        await store.addEvent(eventId);
        return json({ ok: true });
      }


      if (path.startsWith('/api/') && method !== 'GET' && method !== 'HEAD') {
        insist(acceptsRequestOrigin(req, env), 'Cross-origin request blocked. Open the admin panel on the store’s own address.', 403);
        insist(req.headers['sec-fetch-site'] !== 'cross-site', 'Cross-site request blocked.', 403);
        insist(req.headers['x-requested-with'] === 'tscart', 'Missing request protection header.', 403);
      }

      if (path === '/api/health' && method === 'GET') return json({ ok: true, database: 'connected' });
      if (path === '/api/config' && method === 'GET') {
        const status = integrations.status();
        return json({
          settings: await store.settings(),
          mode: env.STORE_MODE === 'live' ? 'live' : 'demo',
          onlinePayments: env.STORE_MODE === 'live' && status.razorpay && (!(env.REQUIRE_LIVE_KEYS === 'true') || status.razorpayMode === 'live'),
          testPayments: status.razorpayMode === 'test',
          blobUploads: true
        });
      }
      if (path === '/api/products' && method === 'GET') return json({ products: await store.products() });

      const reviewMatch = path.match(/^\/api\/products\/([a-zA-Z0-9_-]+)\/reviews$/);
      if (reviewMatch && method === 'GET') return json(await store.reviews(reviewMatch[1], Number(url.searchParams.get('offset') || 0)));
      if (reviewMatch && method === 'POST') {
        await store.limit('review:' + ip, 5, 3600000);
        return json({ review: await store.createReview(reviewMatch[1], await readBody(req, 10_000), req.headers['idempotency-key']) }, 201);
      }

      if (path === '/api/admin/login' && method === 'POST') {
        await store.limit('login:' + ip, 10, 15 * 60000);
        const input = await readBody(req);
        const admin = await store.getAdmin();
        insist(admin && checkPassword(input.password, admin.password) && String(input.email).trim().toLowerCase() === admin.email,
          'Email or password is incorrect.', 401);
        const token = randomToken();
        await store.createSession(token, Date.now() + 8 * 3600000);
        res.setHeader('Set-Cookie', cookie(token));
        return json({ email: admin.email, mustChange: !!admin.must_change });
      }

      if (path.startsWith('/api/admin/')) {
        const admin = await getAdmin(req);
        if (path === '/api/admin/session' && method === 'GET') return json({ email: admin.email, mustChange: !!admin.must_change });
        if (path === '/api/admin/logout' && method === 'POST') {
          await store.deleteSession(cookieToken(req));
          res.setHeader('Set-Cookie', cookie('', 0));
          return json({ ok: true });
        }
        if (path === '/api/admin/password' && method === 'POST') {
          await store.limit('password:' + ip, 8, 15 * 60000);
          const input = await readBody(req);
          const account = await store.getAdmin();
          insist(account && checkPassword(input.currentPassword, account.password), 'Current password is incorrect.', 401);
          const password = str(input.password, 'New password', 12, 200);
          insist(password !== 'TSCART123' && !checkPassword(password, account.password), 'Choose a different password.');
          await store.changePassword(hashPassword(password));
          res.setHeader('Set-Cookie', cookie('', 0));
          return json({ ok: true });
        }
        if (path === '/api/admin/products' && method === 'GET') return json({ products: await store.products(true) });
        const adminReviews = path.match(/^\/api\/admin\/products\/([a-zA-Z0-9_-]+)\/reviews$/);
        if (adminReviews && method === 'GET') return json(await store.reviews(adminReviews[1], Number(url.searchParams.get('offset') || 0), true));
        const deleteReview = path.match(/^\/api\/admin\/reviews\/(r-[a-zA-Z0-9-]+)$/);
        if (deleteReview && method === 'DELETE') {
          await store.deleteReview(deleteReview[1]);
          return json({ ok: true });
        }
        if (path === '/api/admin/products' && method === 'POST') {
          const input = await readBody(req);
          if (input.id) insist(await store.product(input.id), 'Product not found. It may have been deleted. Reload the product list.', 404);
          return json({ product: await store.saveProduct(input) }, 201);
        }
        const permanentMatch = path.match(/^\/api\/admin\/products\/([a-zA-Z0-9_-]+)\/permanent$/);
        if (permanentMatch && method === 'DELETE') {
          await store.deleteProduct(permanentMatch[1]);
          // Read-after-write check uses the shared Turso database. A mismatch is treated
          // as an error, so the client is never told a deletion succeeded prematurely.
          insist(!(await store.product(permanentMatch[1])), 'Deletion did not persist in the shared database. Please retry.', 503);
          const remainingProducts = await store.products(true);
          insist(!remainingProducts.some(product => product.id === permanentMatch[1]),
            'Deleted product is still visible in the shared catalogue. Please contact support.', 503);
          return json({ ok: true });
        }
        const archiveMatch = path.match(/^\/api\/admin\/products\/([a-zA-Z0-9_-]+)$/);
        if (archiveMatch && method === 'DELETE') {
          await store.archiveProduct(archiveMatch[1]);
          return json({ ok: true });
        }
        if (path === '/api/admin/orders' && method === 'GET') return json({ orders: await store.orders() });
        const orderMatch = path.match(/^\/api\/admin\/orders\/(TS-[A-Z0-9]+)(?:\/(reconcile))?$/);
        if (orderMatch && method === 'POST') {
          const id = orderMatch[1];
          insist(await store.order(id), 'Order not found.', 404);
          if (orderMatch[2] === 'reconcile') return json({ order: await integrations.reconcile(id, (await readBody(req)).gatewayId) });
          return json({ order: await store.updateOrder(id, await readBody(req)) });
        }
        if (path === '/api/admin/settings' && method === 'GET') {
          return json({ settings: await store.settings(), integrations: integrations.status(), mode: env.STORE_MODE === 'live' ? 'live' : 'demo', webhookUrl: (env.APP_URL || 'https://localhost') + '/api/webhooks/razorpay' });
        }
        if (path === '/api/admin/settings' && method === 'POST') return json({ settings: await store.updateSettings(await readBody(req)) });
      }


      if (path === '/api/orders' && method === 'POST') {
        await store.limit('checkout:' + ip, 25, 3600000);
        const input = await readBody(req);
        const order = await store.createOrder(input, req.headers['idempotency-key']);
        return json({ order: publicOrder(order), token: store.token(order.id) }, 201);
      }
      const orderMatch = path.match(/^\/api\/orders\/(TS-[A-Z0-9]+)(?:\/(payment|verify))?$/);
      if (orderMatch) {
        const id = orderMatch[1];
        store.authorizeOrder(id, req.headers['x-order-token']);
        const order = await store.order(id);
        insist(order, 'Order not found.', 404);
        if (method === 'GET' && !orderMatch[2]) return json({ order: publicOrder(order) });
        if (method === 'POST' && orderMatch[2] === 'payment') {
          await store.limit('payment:' + ip, 30, 3600000);
          const gatewayId = await integrations.preparePayment(id);
          return json({ key: env.RAZORPAY_KEY_ID, orderId: gatewayId, amount: order.total, currency: 'INR' });
        }
        if (method === 'POST' && orderMatch[2] === 'verify') {
          await store.limit('verify:' + ip, 60, 3600000);
          const input = await readBody(req);
          insist(order.gatewayId && input.razorpay_order_id === order.gatewayId && /^pay_[a-zA-Z0-9]+$/.test(input.razorpay_payment_id || ''), 'Invalid payment reference.', 400);
          insist(equalHex(hmac(env.RAZORPAY_KEY_SECRET || '', order.gatewayId + '|' + input.razorpay_payment_id), input.razorpay_signature), 'Payment signature is invalid.', 400);
          return json({ order: publicOrder(await integrations.verifyPayment(id, input.razorpay_payment_id)) });
        }
      }

      throw new HttpError(404, 'Endpoint not found.');
    } catch (error) {
      if (!res.headersSent && !res.writableEnded) {
        const status = Number(error.status) || 500;
        if (status >= 500) console.error('TSCART Vercel API error:', error.name, error.message);
        json({ error: status === 500 ? 'Something went wrong. Please try again or contact the store.' : error.message }, status);
      } else if (!res.writableEnded) res.end();
    }
  };
}
