import { randomUUID } from 'node:crypto';
import { hashPassword, hmac, equalHex, insist, str, integer, safeImage, sha } from './security.js';
import { seedProducts, initialSettings } from './seed.js';
import { descriptionMedia } from './media.js';

const schema = [
  `CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, data TEXT NOT NULL, stock INTEGER NOT NULL CHECK(stock>=0), active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS deleted_products(id TEXT PRIMARY KEY, slug TEXT NOT NULL, deleted_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,name TEXT NOT NULL,rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),body TEXT NOT NULL,created INTEGER NOT NULL,request_key TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS reviews_product ON reviews(product_id,created DESC,id DESC)`,
  `CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, payment_status TEXT NOT NULL, gateway_id TEXT UNIQUE, payment_id TEXT UNIQUE, gateway_state TEXT DEFAULT 'idle', reserved INTEGER DEFAULT 1, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY CHECK(id=1), email TEXT NOT NULL, password TEXT NOT NULL, must_change INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, action TEXT NOT NULL, entity TEXT, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS outbox(order_id TEXT PRIMARY KEY REFERENCES orders(id), state TEXT DEFAULT 'queued', attempts INTEGER DEFAULT 0, next_at INTEGER DEFAULT 0, message_id TEXT, error TEXT)`,
  `CREATE INDEX IF NOT EXISTS orders_created ON orders(created DESC)`,
  `CREATE TRIGGER IF NOT EXISTS prevent_deleted_product_recreation BEFORE INSERT ON products WHEN EXISTS(SELECT 1 FROM deleted_products WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Product was permanently deleted.'); END`
];

export async function ensureTursoSchema(db) {
  for (const statement of schema) await db.execute(statement);
}

export class TursoStore {
  static async create(env = process.env) {
    insist(env.TURSO_DATABASE_URL && env.TURSO_AUTH_TOKEN, 'Connect a Turso database to this Vercel project before starting TSCART.', 503);
    insist(typeof env.ORDER_SECRET === 'string' && env.ORDER_SECRET.length >= 32, 'Set ORDER_SECRET in Vercel to the existing 32-byte order secret before starting TSCART.', 503);
    const { createClient } = await import('@libsql/client');
    const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN, intMode: 'number' });
    const store = new TursoStore(db, env);
    await store.initialize();
    return store;
  }

  constructor(db, env) {
    this.db = db;
    this.env = env;
    this.secret = env.ORDER_SECRET;
  }

  async get(sql, args = [], executor = this.db) {
    const result = await executor.execute({ sql, args });
    return result.rows[0] ?? null;
  }

  async all(sql, args = [], executor = this.db) {
    const result = await executor.execute({ sql, args });
    return result.rows;
  }

  async run(sql, args = [], executor = this.db) {
    return executor.execute({ sql, args });
  }

  async tx(fn) {
    const transaction = await this.db.transaction('write');
    try {
      const value = await fn(transaction);
      await transaction.commit();
      return value;
    } catch (error) {
      try { await transaction.rollback(); } catch {}
      throw error;
    }
  }

  async initialize() {
    await ensureTursoSchema(this.db);
    await this.db.execute(`
      INSERT OR IGNORE INTO deleted_products(id,slug,deleted_at)
      SELECT entity,'',MAX(created) FROM audit
      WHERE action='product_deleted' AND entity IS NOT NULL AND entity<>'' GROUP BY entity
    `);
    await this.db.execute('DELETE FROM products WHERE id IN (SELECT id FROM deleted_products)');

    // Multiple serverless instances can cold-start at the same time. Make the
    // singleton inserts atomic instead of SELECT-then-INSERT, which races and
    // causes UNIQUE constraint failures for admin.id and settings.id.
    await this.run('INSERT OR IGNORE INTO admin(id,email,password,must_change) VALUES(1,?,?,1)', [
      (this.env.ADMIN_EMAIL || 'tscart@gmai.com').toLowerCase(),
      hashPassword(this.env.ADMIN_INITIAL_PASSWORD || 'TSCART123')
    ]);

    // Only the instance that creates the settings row may seed a genuinely new
    // catalogue. This also prevents concurrent cold starts from seeding twice.
    const settingsInsert = await this.run(
      'INSERT OR IGNORE INTO settings(id,data) VALUES(1,?)',
      [JSON.stringify(initialSettings)]
    );
    const hasProducts = !!(await this.get('SELECT id FROM products LIMIT 1'));
    const hasDeleted = !!(await this.get('SELECT id FROM deleted_products LIMIT 1'));
    if (settingsInsert.rowsAffected === 1 && !hasProducts && !hasDeleted) {
      for (const product of seedProducts) await this.saveProduct({ ...product, images: [product.image], active: true });
    }
  }

  async audit(action, entity = '', executor = this.db) {
    await this.run('INSERT INTO audit(action,entity,created) VALUES(?,?,?)', [action, entity, Date.now()], executor);
  }

  async settings() {
    const row = await this.get('SELECT data FROM settings WHERE id=1');
    insist(row, 'Store settings are not initialized.', 503);
    return { ...JSON.parse(row.data), shippingFee: 0, freeShippingAt: 0 };
  }

  async products(all = false) {
    const rows = await this.all(`SELECT products.*,COUNT(reviews.id) AS review_count,COALESCE(AVG(reviews.rating),0) AS rating_average
      FROM products LEFT JOIN reviews ON reviews.product_id=products.id ${all ? '' : 'WHERE active=1'}
      GROUP BY products.id ORDER BY products.rowid`);
    return rows.map(row => ({ ...JSON.parse(row.data), stock: Number(row.stock), active: !!row.active,
      reviewCount: Number(row.review_count), ratingAverage: Number(row.rating_average) }));
  }

  async product(id, executor = this.db) {
    const row = await this.get('SELECT * FROM products WHERE id=?', [id], executor);
    if (!row) return null;
    const rating = await this.get('SELECT COUNT(*) AS reviewCount,COALESCE(AVG(rating),0) AS ratingAverage FROM reviews WHERE product_id=?', [id], executor);
    return { ...JSON.parse(row.data), stock: Number(row.stock), active: !!row.active,
      reviewCount: Number(rating.reviewCount), ratingAverage: Number(rating.ratingAverage) };
  }

  async saveProduct(input) {
    insist(input && typeof input === 'object' && !Array.isArray(input), 'Enter product details.');
    const id = input.id || 'p-' + randomUUID();
    insist(/^[a-zA-Z0-9_-]{1,70}$/.test(id), 'Invalid product ID.');
    return this.tx(async tx => {
      insist(!(await this.get('SELECT id FROM deleted_products WHERE id=?', [id], tx)), 'This product was permanently deleted. Create it as a new product instead.', 409);
      const existing = await this.product(id, tx);
      if (existing) insist(input.expectedStock === existing.stock, 'Stock changed while you were editing. Reload the product and try again.', 409);
      const images = (Array.isArray(input.images) ? input.images : [input.image]).map(safeImage);
      insist(images.length > 0 && images.length <= 8, 'Add 1–8 product images.');
      const product = {
        id,
        name: str(input.name, 'Product name', 2, 90),
        slug: str(input.slug, 'URL slug', 2, 100),
        category: str(input.category, 'Category', 2, 40),
        price: integer(input.price, 'Price in paise', 100, 100000000),
        description: str(input.description, 'Description', 10, 3000),
        descriptionMedia: descriptionMedia(input.descriptionMedia ?? existing?.descriptionMedia ?? []),
        details: str(input.details || '', 'Product details', 0, 3000),
        material: str(input.material || '', 'Material', 0, 100),
        badge: str(input.badge || '', 'Label', 0, 40),
        images,
        image: images[0],
        featured: !!input.featured
      };
      insist(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug), 'Use lowercase words separated by hyphens for the URL.');
      const stock = integer(input.stock, 'Stock', 0, 1000000);
      const duplicate = await this.get('SELECT id FROM products WHERE slug=? AND id<>?', [product.slug, id], tx);
      insist(!duplicate, 'This URL slug is already in use.');
      await this.run(`INSERT INTO products(id,slug,data,stock,active) VALUES(?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,data=excluded.data,stock=excluded.stock,active=excluded.active`,
        [id, product.slug, JSON.stringify(product), stock, input.active === false ? 0 : 1], tx);
      await this.audit('product_saved', id, tx);
      return this.product(id, tx);
    });
  }

  async deleteProduct(id) {
    return this.tx(async tx => {
      const product = await this.get('SELECT slug FROM products WHERE id=?', [id], tx);
      insist(product, 'Product not found. It may already have been deleted.', 404);
      await this.run('DELETE FROM reviews WHERE product_id=?', [id], tx);
      await this.run('DELETE FROM products WHERE id=?', [id], tx);
      await this.run('INSERT INTO deleted_products(id,slug,deleted_at) VALUES(?,?,?)', [id, product.slug, Date.now()], tx);
      await this.audit('product_deleted', id, tx);
    });
  }

  async archiveProduct(id) {
    return this.tx(async tx => {
      const product = await this.get('SELECT id FROM products WHERE id=?', [id], tx);
      insist(product, 'Product not found.', 404);
      await this.run('UPDATE products SET active=0 WHERE id=?', [id], tx);
      await this.audit('product_archived', id, tx);
    });
  }

  async reviews(productId, offset = 0, all = false) {
    const product = await this.product(productId);
    insist(product && (all || product.active), 'Product not found.', 404);
    integer(offset, 'Review offset', 0, 1000000);
    const reviews = await this.all('SELECT id,name,rating,body,created FROM reviews WHERE product_id=? ORDER BY created DESC,id DESC LIMIT 20 OFFSET ?', [productId, offset]);
    return { reviews, total: product.reviewCount, ratingAverage: product.ratingAverage,
      nextOffset: offset + reviews.length < product.reviewCount ? offset + reviews.length : null };
  }

  async createReview(productId, input, key) {
    insist(input && typeof input === 'object' && !Array.isArray(input), 'Enter your review.');
    insist(typeof key === 'string' && /^[a-zA-Z0-9_-]{20,100}$/.test(key), 'A review request ID is required.');
    const review = { name: str(input.name, 'Display name', 2, 60), rating: integer(input.rating, 'Rating', 1, 5), body: str(input.body, 'Review', 10, 2000) };
    const fingerprint = sha(JSON.stringify({ productId, ...review }));
    return this.tx(async tx => {
      const product = await this.product(productId, tx);
      insist(product && product.active, 'Product not found.', 404);
      const previous = await this.get('SELECT * FROM reviews WHERE request_key=?', [key], tx);
      if (previous) {
        insist(previous.fingerprint === fingerprint, 'This review request was already used.', 409);
        return { id: previous.id, name: previous.name, rating: Number(previous.rating), body: previous.body, created: Number(previous.created) };
      }
      const result = { id: 'r-' + randomUUID(), ...review, created: Date.now() };
      await this.run('INSERT INTO reviews(id,product_id,name,rating,body,created,request_key,fingerprint) VALUES(?,?,?,?,?,?,?,?)',
        [result.id, productId, result.name, result.rating, result.body, result.created, key, fingerprint], tx);
      return result;
    });
  }

  async deleteReview(id) {
    return this.tx(async tx => {
      const result = await this.run('DELETE FROM reviews WHERE id=?', [id], tx);
      insist(result.rowsAffected === 1, 'Review not found.', 404);
      await this.audit('review_deleted', id, tx);
    });
  }

  async updateSettings(input) {
    const settings = { ...(await this.settings()) };
    for (const [key, max] of Object.entries({ tagline: 150, announcement: 180, supportEmail: 150, supportPhone: 25, businessName: 120, businessAddress: 500, deliveryText: 2000, returnsText: 3000 })) {
      if (input[key] !== undefined) settings[key] = str(input[key], key, 0, max);
    }
    insist(!settings.supportEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.supportEmail), 'Enter a valid support email.');
    await this.tx(async tx => {
      await this.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify(settings)], tx);
      await this.audit('settings_saved', '', tx);
    });
    return settings;
  }

  token(id) { return hmac(this.secret, id); }
  authorizeOrder(id, token) { insist(equalHex(this.token(id), token), 'Order link is invalid or expired.', 403); }

  async order(id, executor = this.db) {
    const row = await this.get('SELECT * FROM orders WHERE id=?', [id], executor);
    if (!row) return null;
    return { ...JSON.parse(row.data), status: row.status, paymentStatus: row.payment_status,
      gatewayId: row.gateway_id, paymentId: row.payment_id, gatewayState: row.gateway_state, reserved: !!row.reserved };
  }

  async orders() {
    const rows = await this.all('SELECT id FROM orders ORDER BY created DESC LIMIT 500');
    const orders = [];
    for (const row of rows) orders.push(await this.order(row.id));
    return orders;
  }

  async createOrder(input, idem) {
    insist(typeof idem === 'string' && /^[a-zA-Z0-9_-]{20,100}$/.test(idem), 'A checkout request ID is required.');
    insist(input.consent === true, 'Please accept the checkout privacy notice.');
    const customerInput = input.customer || {};
    const customer = {
      name: str(customerInput.name, 'Full name', 2, 80),
      phone: str(customerInput.phone, 'Phone', 10, 16).replace(/\D/g, ''),
      email: str(customerInput.email || '', 'Email', 0, 150),
      line1: str(customerInput.line1, 'Street address', 5, 180),
      line2: str(customerInput.line2 || '', 'Apartment / landmark', 0, 120),
      city: str(customerInput.city, 'City', 2, 70),
      state: str(customerInput.state, 'State', 2, 70),
      pincode: str(customerInput.pincode, 'PIN code', 6, 6),
      notes: str(customerInput.notes || '', 'Delivery notes', 0, 250)
    };
    if (customer.phone.startsWith('91') && customer.phone.length === 12) customer.phone = customer.phone.slice(2);
    insist(/^[6-9]\d{9}$/.test(customer.phone), 'Enter a valid 10-digit Indian mobile number.');
    insist(/^[1-9]\d{5}$/.test(customer.pincode), 'Enter a valid 6-digit PIN code.');
    insist(!customer.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email), 'Enter a valid email.');
    const pincodes = (this.env.SERVICEABLE_PINCODES || '').split(',').map(value => value.trim()).filter(Boolean);
    insist(!pincodes.length || pincodes.includes(customer.pincode), 'Delivery is not currently available to this PIN code.');
    insist(['cod', 'razorpay'].includes(input.paymentMethod), 'Choose a payment method.');
    insist(Array.isArray(input.items) && input.items.length > 0 && input.items.length <= 12, 'Choose between 1 and 12 items.');
    const quantities = new Map();
    for (const item of input.items) {
      str(item.id, 'Product ID', 1, 70);
      const quantity = integer(item.quantity, 'Quantity', 1, 10);
      quantities.set(item.id, (quantities.get(item.id) || 0) + quantity);
    }
    for (const quantity of quantities.values()) integer(quantity, 'Quantity per product', 1, 10);
    const normalized = { customer, paymentMethod: input.paymentMethod, items: [...quantities].sort(([a], [b]) => a.localeCompare(b)) };
    const fingerprint = sha(JSON.stringify(normalized));
    return this.tx(async tx => {
      const previous = await this.get('SELECT id,fingerprint FROM orders WHERE idem=?', [idem], tx);
      if (previous) {
        insist(previous.fingerprint === fingerprint, 'This checkout request was already used. Start a new checkout.', 409);
        return this.order(previous.id, tx);
      }
      const items = [];
      for (const [id, quantity] of quantities) {
        const product = await this.product(id, tx);
        insist(product && product.active, 'An item is no longer available.', 409);
        insist(product.stock >= quantity, `Only ${product.stock} of ${product.name} remain.`, 409);
        items.push({ id, name: product.name, quantity, price: product.price, image: product.image });
      }
      const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const order = {
        id: 'TS-' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(), customer, items,
        subtotal, shipping: 0, total: subtotal, paymentMethod: input.paymentMethod, created: Date.now(),
        demo: this.env.STORE_MODE !== 'live', consentVersion: '2026-11-12-admin-orders',
        consentAt: new Date().toISOString(), tracking: ''
      };
      for (const item of items) {
        const changed = await this.run('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?', [item.quantity, item.id, item.quantity], tx);
        insist(changed.rowsAffected === 1, 'Stock changed. Please try again.', 409);
      }
      await this.run(`INSERT INTO orders(id,idem,fingerprint,data,status,payment_status,created)
        VALUES(?,?,?,?,?,?,?)`, [order.id, idem, fingerprint, JSON.stringify(order),
        input.paymentMethod === 'cod' ? 'confirmed' : 'awaiting_payment',
        input.paymentMethod === 'cod' ? 'cod_due' : 'pending', order.created], tx);
      await this.audit('order_created', order.id, tx);
      return this.order(order.id, tx);
    });
  }

  async attachGateway(id, gateway) {
    return this.tx(async tx => {
      const order = await this.order(id, tx);
      insist(order && gateway.receipt === id && gateway.amount === order.total && gateway.currency === 'INR', 'Razorpay order does not match this order.', 409);
      insist(!order.gatewayId || order.gatewayId === gateway.id, 'A payment order is already attached.', 409);
      await this.run("UPDATE orders SET gateway_id=?,gateway_state='ready' WHERE id=?", [gateway.id, id], tx);
    });
  }

  async claimGatewayCreation(id) {
    return this.tx(async tx => {
      const order = await this.order(id, tx);
      insist(order && order.paymentMethod === 'razorpay' && order.status === 'awaiting_payment', 'This order is not awaiting an online payment.', 409);
      if (order.gatewayId) return false;
      insist(order.gatewayState === 'idle', 'Payment setup is already in progress or needs review. Please retry or contact the store with your order number.', 409);
      const result = await this.run("UPDATE orders SET gateway_state='creating' WHERE id=? AND gateway_state='idle' AND gateway_id IS NULL", [id], tx);
      insist(result.rowsAffected === 1, 'Payment setup is already in progress. Please retry shortly.', 409);
      return true;
    });
  }

  async setGatewayState(id, state) {
    await this.run('UPDATE orders SET gateway_state=? WHERE id=? AND gateway_id IS NULL', [state, id]);
  }

  async eventExists(id) { return !!(await this.get('SELECT id FROM events WHERE id=?', [id])); }
  async addEvent(id, created = Date.now()) { return this.run('INSERT OR IGNORE INTO events(id,created) VALUES(?,?)', [id, created]); }
  async orderIdForGateway(gatewayId) { return this.get('SELECT id FROM orders WHERE gateway_id=?', [gatewayId]); }

  async confirmPayment(id, payment) {
    return this.tx(async tx => {
      const order = await this.order(id, tx);
      insist(order && order.gatewayId === payment.order_id && order.total === payment.amount && payment.currency === 'INR' && payment.status === 'captured', 'Payment is not captured or does not match the order.', 409);
      if (order.paymentStatus === 'paid') return order;
      const late = !order.reserved || order.status === 'cancelled';
      await this.run('UPDATE orders SET payment_id=?,payment_status=?,status=? WHERE id=?', [payment.id, 'paid', late ? 'needs_review' : 'confirmed', id], tx);
      await this.audit(late ? 'late_payment_review' : 'payment_confirmed', id, tx);
      return this.order(id, tx);
    });
  }

  async updateOrder(id, input) {
    return this.tx(async tx => {
      const order = await this.order(id, tx);
      insist(order, 'Order not found.', 404);
      const next = input.status || order.status;
      const transitions = { awaiting_payment: ['cancelled'], confirmed: ['processing', 'cancelled'], processing: ['shipped', 'cancelled'], shipped: ['delivered'], delivered: [], cancelled: [], needs_review: [] };
      insist(next === order.status || (transitions[order.status] || []).includes(next), 'This order status change is not allowed.', 409);
      if (next === 'cancelled' && next !== order.status) {
        insist(order.paymentMethod === 'cod' || input.gatewayChecked === true, 'Check Razorpay for captured/authorised payments first and confirm the review.', 409);
        if (order.reserved) {
          for (const item of order.items) await this.run('UPDATE products SET stock=stock+? WHERE id=?', [item.quantity, item.id], tx);
        }
        await this.run('UPDATE orders SET reserved=0 WHERE id=?', [id], tx);
      }
      const dataRow = await this.get('SELECT data FROM orders WHERE id=?', [id], tx);
      const data = JSON.parse(dataRow.data);
      data.tracking = str(input.tracking ?? data.tracking ?? '', 'Tracking information', 0, 200);
      await this.run('UPDATE orders SET status=?,data=? WHERE id=?', [next, JSON.stringify(data), id], tx);
      if (input.codCollected === true) {
        insist(order.paymentMethod === 'cod' && next === 'delivered', 'COD can be collected only for delivered COD orders.');
        await this.run("UPDATE orders SET payment_status='cod_collected' WHERE id=?", [id], tx);
      }
      await this.audit('order_updated', id, tx);
      return this.order(id, tx);
    });
  }

  async limit(key, max, windowMs) {
    return this.tx(async tx => {
      const now = Date.now();
      await this.run('DELETE FROM limits WHERE expires<?', [now], tx);
      await this.run('INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', [key, now + windowMs], tx);
      const row = await this.get('SELECT count FROM limits WHERE key=?', [key], tx);
      insist(Number(row.count) <= max, 'Too many attempts. Please try again later.', 429);
    });
  }

  async getAdmin() { return this.get('SELECT email,password,must_change FROM admin WHERE id=1'); }

  async authenticateAdmin(rawToken) {
    insist(typeof rawToken === 'string' && rawToken.length >= 32, 'Please sign in to the admin panel.', 401);
    const session = await this.get('SELECT hash FROM sessions WHERE hash=? AND expires>?', [sha(rawToken), Date.now()]);
    insist(session, 'Your admin session has expired. Please sign in again.', 401);
    const admin = await this.get('SELECT email,must_change FROM admin WHERE id=1');
    insist(admin, 'Admin account is not initialized.', 503);
    return admin;
  }

  async createSession(token, expires) {
    await this.tx(async tx => {
      await this.run('DELETE FROM sessions WHERE expires<?', [Date.now()], tx);
      await this.run('INSERT INTO sessions(hash,expires) VALUES(?,?)', [sha(token), expires], tx);
    });
  }

  async deleteSession(token) { await this.run('DELETE FROM sessions WHERE hash=?', [sha(token)]); }
  async changePassword(passwordHash) {
    await this.tx(async tx => {
      await this.run('UPDATE admin SET password=?,must_change=0 WHERE id=1', [passwordHash], tx);
      await this.run('DELETE FROM sessions', [], tx);
    });
  }

  async close() { await this.db.close(); }
}
