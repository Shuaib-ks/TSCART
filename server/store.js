import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword, randomToken, hmac, equalHex, insist, str, integer, safeImage, sha } from './security.js';
import { seedProducts, initialSettings } from './seed.js';
import { descriptionMedia } from './media.js';

export class Store {
  constructor(directory, env = process.env) {
    mkdirSync(directory,{recursive:true,mode:0o700});
    this.env = env;
    this.db = new DatabaseSync(join(directory,'tscart.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, data TEXT NOT NULL, stock INTEGER NOT NULL CHECK(stock>=0), active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,name TEXT NOT NULL,rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),body TEXT NOT NULL,created INTEGER NOT NULL,request_key TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reviews_product ON reviews(product_id,created DESC,id DESC);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, payment_status TEXT NOT NULL, gateway_id TEXT UNIQUE, payment_id TEXT UNIQUE, gateway_state TEXT DEFAULT 'idle', reserved INTEGER DEFAULT 1, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY CHECK(id=1), email TEXT NOT NULL, password TEXT NOT NULL, must_change INTEGER DEFAULT 1);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, action TEXT NOT NULL, entity TEXT, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS orders_created ON orders(created DESC);`);
    const secretPath = join(directory,'order-secret');
    if(!existsSync(secretPath)) writeFileSync(secretPath,randomToken(),{mode:0o600});
    this.secret=readFileSync(secretPath,'utf8').trim();
    if(!this.db.prepare('SELECT id FROM admin').get()) this.db.prepare('INSERT INTO admin VALUES(1,?,?,1)').run((env.ADMIN_EMAIL||'tscart@gmai.com').toLowerCase(),hashPassword(env.ADMIN_INITIAL_PASSWORD||'TSCART123'));
    if(!this.db.prepare('SELECT id FROM settings').get()) {
      this.db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify(initialSettings));
      for(const p of seedProducts) this.saveProduct({...p,images:[p.image],active:true});
    }
  }
  tx(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result=fn(); this.db.exec('COMMIT'); return result; } catch(e) {this.db.exec('ROLLBACK'); throw e;} }
  audit(action,entity='') {this.db.prepare('INSERT INTO audit(action,entity,created) VALUES(?,?,?)').run(action,entity,Date.now());}
  settings() {return {...JSON.parse(this.db.prepare('SELECT data FROM settings WHERE id=1').get().data),shippingFee:0,freeShippingAt:0};}
  products(all=false) {return this.db.prepare(`SELECT products.*,COUNT(reviews.id) AS review_count,COALESCE(AVG(reviews.rating),0) AS rating_average FROM products LEFT JOIN reviews ON reviews.product_id=products.id ${all?'':'WHERE active=1'} GROUP BY products.id ORDER BY products.rowid`).all().map(r=>({...JSON.parse(r.data),stock:r.stock,active:!!r.active,reviewCount:r.review_count,ratingAverage:r.rating_average}));}
  product(id) {const r=this.db.prepare('SELECT * FROM products WHERE id=?').get(id);if(!r)return null;const rating=this.db.prepare('SELECT COUNT(*) AS reviewCount,COALESCE(AVG(rating),0) AS ratingAverage FROM reviews WHERE product_id=?').get(id);return {...JSON.parse(r.data),stock:r.stock,active:!!r.active,...rating};}
  saveProduct(input) {
    const id=input.id||'p-'+randomUUID();
    insist(/^[a-zA-Z0-9_-]{1,70}$/.test(id),'Invalid product ID.');
    const existing=this.product(id);
    if(existing) insist(input.expectedStock===existing.stock,'Stock changed while you were editing. Reload the product and try again.',409);
    const images=(Array.isArray(input.images)?input.images:[input.image]).map(safeImage);
    insist(images.length>0 && images.length<=8,'Add 1–8 product images.');
    const p={id,name:str(input.name,'Product name',2,90),slug:str(input.slug,'URL slug',2,100),category:str(input.category,'Category',2,40),price:integer(input.price,'Price in paise',100,100000000),description:str(input.description,'Description',10,3000),descriptionMedia:descriptionMedia(input.descriptionMedia??existing?.descriptionMedia??[]),details:str(input.details||'','Product details',0,3000),material:str(input.material||'','Material',0,100),badge:str(input.badge||'','Label',0,40),images,image:images[0],featured:!!input.featured};
    insist(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug),'Use lowercase words separated by hyphens for the URL.');
    const stock=integer(input.stock,'Stock',0,1000000);
    const duplicate=this.db.prepare('SELECT id FROM products WHERE slug=? AND id<>?').get(p.slug,id);
    insist(!duplicate,'This URL slug is already in use.');
    this.db.prepare('INSERT INTO products VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,data=excluded.data,stock=excluded.stock,active=excluded.active').run(id,p.slug,JSON.stringify(p),stock,input.active===false?0:1);
    this.audit('product_saved',id);return this.product(id);
  }
  deleteProduct(id) {
    return this.tx(()=>{
      const result=this.db.prepare('DELETE FROM products WHERE id=?').run(id);
      insist(result.changes===1,'Product not found. It may already have been deleted.',404);
      // Orders contain their own item snapshots. Keep images used by those receipts.
      this.audit('product_deleted',id);
    });
  }
  reviews(productId,offset=0,all=false) {
    const product=this.product(productId);insist(product&&(all||product.active),'Product not found.',404);
    integer(offset,'Review offset',0,1000000);
    const reviews=this.db.prepare('SELECT id,name,rating,body,created FROM reviews WHERE product_id=? ORDER BY created DESC,id DESC LIMIT 20 OFFSET ?').all(productId,offset);
    return {reviews,total:product.reviewCount,ratingAverage:product.ratingAverage,nextOffset:offset+reviews.length<product.reviewCount?offset+reviews.length:null};
  }
  createReview(productId,input,key) {
    insist(input&&typeof input==='object'&&!Array.isArray(input),'Enter your review.');
    insist(typeof key==='string'&&/^[a-zA-Z0-9_-]{20,100}$/.test(key),'A review request ID is required.');
    const review={name:str(input.name,'Display name',2,60),rating:integer(input.rating,'Rating',1,5),body:str(input.body,'Review',10,2000)};
    const fingerprint=sha(JSON.stringify({productId,...review}));
    return this.tx(()=>{
      const product=this.product(productId);insist(product&&product.active,'Product not found.',404);
      const previous=this.db.prepare('SELECT * FROM reviews WHERE request_key=?').get(key);
      if(previous){insist(previous.fingerprint===fingerprint,'This review request was already used.',409);return {id:previous.id,name:previous.name,rating:previous.rating,body:previous.body,created:previous.created};}
      const result={id:'r-'+randomUUID(),...review,created:Date.now()};
      this.db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?)').run(result.id,productId,result.name,result.rating,result.body,result.created,key,fingerprint);
      return result;
    });
  }
  deleteReview(id) {
    return this.tx(()=>{
      const result=this.db.prepare('DELETE FROM reviews WHERE id=?').run(id);
      insist(result.changes===1,'Review not found.',404);this.audit('review_deleted',id);
    });
  }
  updateSettings(input) {
    const s={...this.settings()};
    for(const [key,max] of Object.entries({tagline:150,announcement:180,supportEmail:150,supportPhone:25,businessName:120,businessAddress:500,deliveryText:2000,returnsText:3000})) if(input[key]!==undefined) s[key]=str(input[key],key,0,max);
    insist(!s.supportEmail||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.supportEmail),'Enter a valid support email.');
    this.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify(s));this.audit('settings_saved');return s;
  }
  token(id) {return hmac(this.secret,id);}
  authorizeOrder(id,token) {insist(equalHex(this.token(id),token),'Order link is invalid or expired.',403);}
  order(id) {const r=this.db.prepare('SELECT * FROM orders WHERE id=?').get(id);if(!r)return null;return {...JSON.parse(r.data),status:r.status,paymentStatus:r.payment_status,gatewayId:r.gateway_id,paymentId:r.payment_id,gatewayState:r.gateway_state,reserved:!!r.reserved};}
  orders() {return this.db.prepare('SELECT id FROM orders ORDER BY created DESC LIMIT 500').all().map(r=>this.order(r.id));}
  createOrder(input,idem) {
    insist(typeof idem==='string' && /^[a-zA-Z0-9_-]{20,100}$/.test(idem),'A checkout request ID is required.');
    insist(input.consent===true,'Please accept the checkout privacy notice.');
    const c=input.customer||{};
    const customer={name:str(c.name,'Full name',2,80),phone:str(c.phone,'Phone',10,16).replace(/\D/g,''),email:str(c.email||'','Email',0,150),line1:str(c.line1,'Street address',5,180),line2:str(c.line2||'','Apartment / landmark',0,120),city:str(c.city,'City',2,70),state:str(c.state,'State',2,70),pincode:str(c.pincode,'PIN code',6,6),notes:str(c.notes||'','Delivery notes',0,250)};
    if(customer.phone.startsWith('91')&&customer.phone.length===12)customer.phone=customer.phone.slice(2);
    insist(/^[6-9]\d{9}$/.test(customer.phone),'Enter a valid 10-digit Indian mobile number.');
    insist(/^[1-9]\d{5}$/.test(customer.pincode),'Enter a valid 6-digit PIN code.');
    insist(!customer.email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email),'Enter a valid email.');
    const pins=(this.env.SERVICEABLE_PINCODES||'').split(',').map(x=>x.trim()).filter(Boolean);
    insist(!pins.length||pins.includes(customer.pincode),'Delivery is not currently available to this PIN code.');
    insist(['cod','razorpay'].includes(input.paymentMethod),'Choose a payment method.');
    insist(Array.isArray(input.items)&&input.items.length>0&&input.items.length<=12,'Choose between 1 and 12 items.');
    const quantities=new Map();for(const item of input.items){str(item.id,'Product ID',1,70);const q=integer(item.quantity,'Quantity',1,10);quantities.set(item.id,(quantities.get(item.id)||0)+q);}
    for(const qty of quantities.values()) integer(qty,'Quantity per product',1,10);
    const normalized={customer,paymentMethod:input.paymentMethod,items:[...quantities].sort(([a],[b])=>a.localeCompare(b))};
    const fingerprint=sha(JSON.stringify(normalized));
    return this.tx(()=>{
      const previous=this.db.prepare('SELECT id,fingerprint FROM orders WHERE idem=?').get(idem);
      if(previous){insist(previous.fingerprint===fingerprint,'This checkout request was already used. Start a new checkout.',409);return this.order(previous.id);}
      const items=[];
      for(const [id,quantity] of quantities){const p=this.product(id);insist(p&&p.active,'An item is no longer available.',409);insist(p.stock>=quantity,`Only ${p.stock} of ${p.name} remain.`,409);items.push({id,name:p.name,quantity,price:p.price,image:p.image});}
      const subtotal=items.reduce((s,p)=>s+p.price*p.quantity,0);const shipping=0;
      const order={id:'TS-'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),customer,items,subtotal,shipping,total:subtotal+shipping,paymentMethod:input.paymentMethod,created:Date.now(),demo:this.env.STORE_MODE!=='live',consentVersion:'2026-11-12-admin-orders',consentAt:new Date().toISOString(),tracking:''};
      for(const item of items) {const changed=this.db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').run(item.quantity,item.id,item.quantity);insist(changed.changes===1,'Stock changed. Please try again.',409);}
      this.db.prepare('INSERT INTO orders(id,idem,fingerprint,data,status,payment_status,created) VALUES(?,?,?,?,?,?,?)').run(order.id,idem,fingerprint,JSON.stringify(order),input.paymentMethod==='cod'?'confirmed':'awaiting_payment',input.paymentMethod==='cod'?'cod_due':'pending',order.created);
      this.audit('order_created',order.id);return this.order(order.id);
    });
  }
  attachGateway(id,gateway) {
    const o=this.order(id);insist(o&&gateway.receipt===id&&gateway.amount===o.total&&gateway.currency==='INR','Razorpay order does not match this order.',409);
    insist(!o.gatewayId||o.gatewayId===gateway.id,'A payment order is already attached.',409);
    this.db.prepare("UPDATE orders SET gateway_id=?,gateway_state='ready' WHERE id=?").run(gateway.id,id);
  }
  confirmPayment(id,payment) {
    return this.tx(()=>{
      const o=this.order(id);insist(o&&o.gatewayId===payment.order_id&&o.total===payment.amount&&payment.currency==='INR'&&payment.status==='captured','Payment is not captured or does not match the order.',409);
      if(o.paymentStatus==='paid')return o;
      const late=!o.reserved||o.status==='cancelled';
      this.db.prepare('UPDATE orders SET payment_id=?,payment_status=?,status=? WHERE id=?').run(payment.id,'paid',late?'needs_review':'confirmed',id);
      this.audit(late?'late_payment_review':'payment_confirmed',id);return this.order(id);
    });
  }
  updateOrder(id,input) {
    return this.tx(()=>{
      const o=this.order(id);insist(o,'Order not found.',404);
      const next=input.status||o.status;
      const transitions={awaiting_payment:['cancelled'],confirmed:['processing','cancelled'],processing:['shipped','cancelled'],shipped:['delivered'],delivered:[],cancelled:[],needs_review:[]};
      insist(next===o.status||(transitions[o.status]||[]).includes(next),'This order status change is not allowed.',409);
      if(next==='cancelled'&&next!==o.status){
        insist(o.paymentMethod==='cod'||input.gatewayChecked===true,'Check Razorpay for captured/authorised payments first and confirm the review.',409);
        if(o.reserved){for(const item of o.items)this.db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(item.quantity,item.id);}
        this.db.prepare('UPDATE orders SET reserved=0 WHERE id=?').run(id);
      }
      const data=JSON.parse(this.db.prepare('SELECT data FROM orders WHERE id=?').get(id).data);
      data.tracking=str(input.tracking??data.tracking??'','Tracking information',0,200);
      this.db.prepare('UPDATE orders SET status=?,data=? WHERE id=?').run(next,JSON.stringify(data),id);
      if(input.codCollected===true){insist(o.paymentMethod==='cod'&&next==='delivered','COD can be collected only for delivered COD orders.');this.db.prepare("UPDATE orders SET payment_status='cod_collected' WHERE id=?").run(id);}
      this.audit('order_updated',id);return this.order(id);
    });
  }
  limit(key,max,windowMs) {
    const now=Date.now();this.db.prepare('DELETE FROM limits WHERE expires<?').run(now);
    this.db.prepare('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+windowMs);
    insist(this.db.prepare('SELECT count FROM limits WHERE key=?').get(key).count<=max,'Too many attempts. Please try again later.',429);
  }
  close() {this.db.close();}
}
