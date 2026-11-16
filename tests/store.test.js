import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { Integrations } from '../server/integrations.js';
import { makeApp } from '../server/index.js';
import { hmac,checkPassword } from '../server/security.js';

const customer={name:'Test Customer',phone:'9876543210',email:'test@example.com',line1:'42 Sample Street',line2:'Apartment 3',city:'Kochi',state:'Kerala',pincode:'682001',notes:'Test only'};
const input=(overrides={})=>({customer,items:[{id:'p-mug',quantity:1}],paymentMethod:'cod',consent:true,...overrides});
function fixture(t,extra={}){const directory=mkdtempSync(join(tmpdir(),'tscart-test-'));const env={STORE_MODE:'demo',...extra};const store=new Store(directory,env);t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});return {store,env,directory};}
test('COD checkout uses server prices, snapshots customer, reserves stock and saves the admin order',t=>{const {store}=fixture(t);const order=store.createOrder(input({total:1,items:[{id:'p-mug',quantity:2,price:1}]}),randomUUID());assert.equal(order.total,109800);assert.equal(order.shipping,0);assert.equal(order.status,'confirmed');assert.equal(order.paymentStatus,'cod_due');assert.equal(store.product('p-mug').stock,38);assert.equal(store.orders().length,1);});
test('same idempotency key returns one order and stock deduction',t=>{const {store}=fixture(t);const key=randomUUID();const a=store.createOrder(input(),key);const b=store.createOrder(input(),key);assert.equal(a.id,b.id);assert.equal(store.product('p-mug').stock,39);assert.equal(store.orders().length,1);assert.throws(()=>store.createOrder(input({items:[{id:'p-mug',quantity:2}]}),key),/already used/);});
test('duplicate product lines are merged and quantity limit enforced',t=>{const {store}=fixture(t);const a=store.createOrder(input({items:[{id:'p-mug',quantity:2},{id:'p-mug',quantity:3}]}),randomUUID());assert.equal(a.items.length,1);assert.equal(a.items[0].quantity,5);assert.throws(()=>store.createOrder(input({items:[{id:'p-mug',quantity:6},{id:'p-mug',quantity:6}]}),randomUUID()),/Quantity/);});
test('multi-item failure does not deduct any stock or create an order',t=>{const {store}=fixture(t);assert.throws(()=>store.createOrder(input({items:[{id:'p-mug',quantity:3},{id:'missing',quantity:1}]}),randomUUID()));assert.equal(store.product('p-mug').stock,40);assert.equal(store.orders().length,0);});
test('last-item competing checkout cannot oversell',async t=>{const {store}=fixture(t);store.db.prepare('UPDATE products SET stock=1 WHERE id=?').run('p-mug');const results=await Promise.allSettled(Array.from({length:8},()=>Promise.resolve().then(()=>store.createOrder(input(),randomUUID()))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(store.product('p-mug').stock,0);});
test('stale admin save cannot overwrite stock changed by checkout',t=>{const {store}=fixture(t);const old=store.product('p-mug');store.createOrder(input(),randomUUID());assert.throws(()=>store.saveProduct({...old,expectedStock:old.stock,stock:50}),/Stock changed/);assert.equal(store.product('p-mug').stock,39);const current=store.product('p-mug');store.saveProduct({...current,expectedStock:current.stock,stock:50});assert.equal(store.product('p-mug').stock,50);});
test('private order access requires unguessable token',t=>{const {store}=fixture(t);const o=store.createOrder(input(),randomUUID());assert.throws(()=>store.authorizeOrder(o.id,'bad'),/invalid/);store.authorizeOrder(o.id,store.token(o.id));});
test('COD cancellation restocks exactly once',t=>{const {store}=fixture(t);const o=store.createOrder(input(),randomUUID());store.updateOrder(o.id,{status:'cancelled'});store.updateOrder(o.id,{status:'cancelled'});assert.equal(store.product('p-mug').stock,40);assert.equal(store.order(o.id).reserved,false);});
test('online payment confirmation validates capture, amount, currency and order',t=>{const {store}=fixture(t);const o=store.createOrder(input({paymentMethod:'razorpay'}),randomUUID());store.attachGateway(o.id,{id:'order_test1',amount:o.total,receipt:o.id,currency:'INR'});const payment={id:'pay_test1',amount:o.total,currency:'INR',status:'captured',order_id:'order_test1'};for(const delta of [{amount:1},{currency:'USD'},{status:'authorized'},{order_id:'order_other'}])assert.throws(()=>store.confirmPayment(o.id,{...payment,...delta}));assert.equal(store.order(o.id).paymentStatus,'pending');store.confirmPayment(o.id,payment);store.confirmPayment(o.id,payment);assert.equal(store.order(o.id).paymentStatus,'paid');assert.equal(store.orders().length,1);});
test('late payment after cancellation needs manual review and does not dispatch',t=>{const {store}=fixture(t);const o=store.createOrder(input({paymentMethod:'razorpay'}),randomUUID());store.attachGateway(o.id,{id:'order_late',amount:o.total,receipt:o.id,currency:'INR'});store.updateOrder(o.id,{status:'cancelled',gatewayChecked:true});store.confirmPayment(o.id,{id:'pay_late',order_id:'order_late',amount:o.total,currency:'INR',status:'captured'});assert.equal(store.order(o.id).status,'needs_review');assert.equal(store.order(o.id).paymentStatus,'paid');assert.equal(store.product('p-mug').stock,40);assert.equal(store.order(o.id).reserved,false);});
test('COD only marks collected after delivery',t=>{const {store}=fixture(t);const o=store.createOrder(input(),randomUUID());assert.throws(()=>store.updateOrder(o.id,{codCollected:true}));store.updateOrder(o.id,{status:'processing'});store.updateOrder(o.id,{status:'shipped'});store.updateOrder(o.id,{status:'delivered',codCollected:true});assert.equal(store.order(o.id).paymentStatus,'cod_collected');});
test('validation rejects malformed address, missing notice and invalid stock',t=>{const {store}=fixture(t);for(const payload of [input({consent:false}),input({customer:{...customer,pincode:'000000'}}),input({customer:{...customer,phone:'123'}}),input({items:[{id:'p-mug',quantity:-1}]}),input({items:[]})])assert.throws(()=>store.createOrder(payload,randomUUID()));assert.throws(()=>store.saveProduct({...store.product('p-mug'),stock:-1}));});
test('unavailable postcode rejected and archived products cannot be ordered',t=>{const {store}=fixture(t,{SERVICEABLE_PINCODES:'682002'});assert.throws(()=>store.createOrder(input(),randomUUID()),/not currently available/);store.env.SERVICEABLE_PINCODES='';store.db.prepare('UPDATE products SET active=0 WHERE id=?').run('p-mug');assert.throws(()=>store.createOrder(input(),randomUUID()),/no longer available/);});
test('gateway creation is coalesced and uses server-calculated total',async t=>{const {store,env}=fixture(t,{RAZORPAY_KEY_ID:'rzp_test_fake',RAZORPAY_KEY_SECRET:'secret',RAZORPAY_WEBHOOK_SECRET:'webhook'});const o=store.createOrder(input({paymentMethod:'razorpay'}),randomUUID());let count=0;const i=new Integrations(store,env,async(url,opts)=>{count++;const body=JSON.parse(opts.body);assert.equal(body.amount,o.total);return new Response(JSON.stringify({id:'order_once',...body}));});const result=await Promise.all([i.preparePayment(o.id),i.preparePayment(o.id)]);assert.deepEqual(result,['order_once','order_once']);assert.equal(count,1);});
test('uncertain gateway creation cannot silently create another order',async t=>{const {store,env}=fixture(t,{RAZORPAY_KEY_ID:'rzp_test_fake',RAZORPAY_KEY_SECRET:'secret',RAZORPAY_WEBHOOK_SECRET:'webhook'});const o=store.createOrder(input({paymentMethod:'razorpay'}),randomUUID());let count=0;const i=new Integrations(store,env,async()=>{count++;throw Error('timeout');});await assert.rejects(i.preparePayment(o.id));await assert.rejects(i.preparePayment(o.id),/needs review/);assert.equal(count,1);});
test('database persists products, sessions, settings and order token across restart',t=>{const directory=mkdtempSync(join(tmpdir(),'tscart-persist-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));let s=new Store(directory);const o=s.createOrder(input(),randomUUID()),token=s.token(o.id);s.updateSettings({businessName:'Persistent Store'});s.close();s=new Store(directory);assert.equal(s.settings().businessName,'Persistent Store');assert.equal(s.product('p-mug').stock,39);assert.equal(s.token(o.id),token);assert.equal(s.orders().length,1);s.close();});
test('permanent product deletions survive restart, block stale IDs, and remove rows restored beside old audit history',t=>{
  const directory=mkdtempSync(join(tmpdir(),'tscart-deleted-persist-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  let store=new Store(directory);const deleted=store.product('p-mug');
  store.deleteProduct(deleted.id);
  // Simulate an older database snapshot restoring the product row but not the new tombstone table.
  store.db.exec('DROP TRIGGER prevent_deleted_product_recreation; DELETE FROM deleted_products;');
  store.db.prepare('INSERT INTO products VALUES(?,?,?,?,?)').run(deleted.id,deleted.slug,JSON.stringify(deleted),deleted.stock,1);
  store.db.prepare('DELETE FROM settings WHERE id=1').run();
  store.close();store=new Store(directory);
  assert.equal(store.product(deleted.id),null,'an audit record of permanent deletion must defeat a restored stale row');
  assert.ok(store.db.prepare('SELECT id FROM deleted_products WHERE id=?').get(deleted.id));
  for(const product of store.products(true))store.deleteProduct(product.id);
  store.db.prepare('DELETE FROM settings WHERE id=1').run();
  store.close();store=new Store(directory);
  assert.equal(store.products(true).length,0,'a restart must not repopulate a deliberately emptied catalogue');
  assert.throws(()=>store.saveProduct({...deleted,expectedStock:deleted.stock}),/permanently deleted/,'a stale editor must not recreate a permanently deleted ID');
  store.close();
});

async function httpFixture(t,envExtra={},fetcher){const directory=mkdtempSync(join(tmpdir(),'tscart-http-'));const env={STORE_MODE:'demo',RAZORPAY_WEBHOOK_SECRET:'webhook-test',...envExtra};const app=makeApp({dataDir:directory,env,fetcher});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;t.after(async()=>{await new Promise(r=>app.server.close(r));app.store.close();rmSync(directory,{recursive:true,force:true});});const request=(path,method='GET',data,headers={})=>fetch(base+path,{method,headers:{...(method==='GET'?{}:{'X-Requested-With':'tscart','Content-Type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});return {...app,request,base};}
test('HTTP admin auth, protected CRUD, login, CSRF, password hashing and logout',async t=>{const {request,store}=await httpFixture(t);assert.equal((await request('/api/admin/products')).status,401);assert.equal((await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'incorrect'})).status,401);const login=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));assert.equal((await request('/api/admin/products','GET',undefined,{Cookie:cookie})).status,200);assert.equal((await request('/api/admin/settings','POST',{businessName:'evil'},{Cookie:cookie,Origin:'https://evil.example'})).status,403);assert.notEqual(store.db.prepare('SELECT password FROM admin').get().password,'TSCART123');assert.ok(checkPassword('TSCART123',store.db.prepare('SELECT password FROM admin').get().password));await request('/api/admin/logout','POST',{}, {Cookie:cookie});assert.equal((await request('/api/admin/products','GET',undefined,{Cookie:cookie})).status,401);});
test('HTTP verified webhook is idempotent, invalid signature rejected, late event cannot downgrade paid',async t=>{const {request,store}=await httpFixture(t);const o=store.createOrder(input({paymentMethod:'razorpay'}),randomUUID());store.attachGateway(o.id,{id:'order_hook',receipt:o.id,amount:o.total,currency:'INR'});const event={event:'payment.captured',payload:{payment:{entity:{id:'pay_hook',order_id:'order_hook',amount:o.total,currency:'INR',status:'captured'}}}};assert.equal((await request('/api/webhooks/razorpay','POST',event,{'X-Razorpay-Signature':'bad'})).status,401);const signature=hmac('webhook-test',JSON.stringify(event));for(let i=0;i<2;i++)assert.equal((await request('/api/webhooks/razorpay','POST',event,{'X-Razorpay-Signature':signature,'X-Razorpay-Event-Id':'evt_1'})).status,200);assert.equal(store.order(o.id).paymentStatus,'paid');assert.equal(store.orders().length,1);const failed={...event,event:'payment.failed'};await request('/api/webhooks/razorpay','POST',failed,{'X-Razorpay-Signature':hmac('webhook-test',JSON.stringify(failed)),'X-Razorpay-Event-Id':'evt_2'});assert.equal(store.order(o.id).paymentStatus,'paid');});
test('HTTP checkout protects private receipts, verifies totals and refuses unconfigured Razorpay',async t=>{const {request}=await httpFixture(t);const r=await request('/api/orders','POST',input(),{'Idempotency-Key':randomUUID()});assert.equal(r.status,201);const {order,token}=await r.json();assert.equal((await request('/api/orders/'+order.id)).status,403);assert.equal((await request('/api/orders/'+order.id,'GET',undefined,{'X-Order-Token':token})).status,200);assert.equal((await request('/api/orders','POST',input({paymentMethod:'razorpay'}),{'Idempotency-Key':randomUUID()})).status,503);});
test('HTTP live checkout blocked until default password and business details are replaced',async t=>{const {request}=await httpFixture(t,{STORE_MODE:'live'});assert.equal((await request('/api/orders','POST',input(),{'Idempotency-Key':randomUUID()})).status,503);});
test('HTTP safe image upload rejects SVG and executable bytes',async t=>{const {request,base}=await httpFixture(t);const login=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'});const cookie=login.headers.get('set-cookie').split(';')[0];const r=await fetch(base+'/api/admin/upload',{method:'POST',headers:{'X-Requested-With':'tscart',Cookie:cookie,'Content-Type':'image/svg+xml'},body:'<svg onload="alert(1)"></svg>'});assert.equal(r.status,400);});
test('HTTP authenticated admin can create, update and archive a product',async t=>{const {request}=await httpFixture(t);const login=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'});const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};const input={name:'Test Ceramic Bowl',slug:'test-ceramic-bowl',category:'Kitchen',price:50000,stock:5,images:['/assets/mug.jpg'],description:'A test product created by the administrator.',active:true};const r=await request('/api/admin/products','POST',input,headers);assert.equal(r.status,201);const {product}=await r.json();assert.ok((await (await request('/api/products')).json()).products.some(p=>p.id===product.id));const updated=await request('/api/admin/products','POST',{...product,price:65000,expectedStock:5},headers);assert.equal(updated.status,201);assert.equal((await updated.json()).product.price,65000);assert.equal((await request('/api/admin/products/'+product.id,'DELETE',{},headers)).status,200);assert.equal((await (await request('/api/products')).json()).products.some(p=>p.id===product.id),false);});
test('HTTP password change invalidates old sessions and starter password',async t=>{const {request}=await httpFixture(t);const login=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'});const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};assert.equal((await request('/api/admin/password','POST',{currentPassword:'TSCART123',password:'New-Testing-Password-42'},headers)).status,200);assert.equal((await request('/api/admin/session','GET',undefined,headers)).status,401);assert.equal((await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'})).status,401);const next=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'New-Testing-Password-42'});assert.equal(next.status,200);assert.equal((await next.json()).mustChange,false);});
test('HTTP image upload is saved and retrievable and secrets are absent from public config',async t=>{const {request,base}=await httpFixture(t,{RAZORPAY_KEY_SECRET:'never-expose-this'});const login=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'});const cookie=login.headers.get('set-cookie').split(';')[0];const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=','base64');const r=await fetch(base+'/api/admin/upload',{method:'POST',headers:{'X-Requested-With':'tscart',Cookie:cookie,'Content-Type':'image/png'},body:bytes});assert.equal(r.status,201);const {url}=await r.json();const saved=await fetch(base+url);assert.equal(saved.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await saved.arrayBuffer()),bytes);assert.equal((await (await request('/api/config')).text()).includes('never-expose-this'),false);});

test('HTTP permanent deletion requires admin and request protection, removes published and archived products',async t=>{
  const {request,store,base}=await httpFixture(t);
  const path='/api/admin/products/p-mug/permanent';
  assert.equal((await request(path,'DELETE',{})).status,401);
  const login=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'});
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  assert.equal((await request(path,'DELETE',{}, {...headers,Origin:'https://untrusted.example'})).status,403);
  assert.equal((await fetch(base+path,{method:'DELETE',headers})).status,403);
  assert.ok(store.product('p-mug'));
  const archived=store.products().find(p=>p.id!=='p-mug');
  assert.equal((await request('/api/admin/products/'+archived.id,'DELETE',{},headers)).status,200);
  assert.equal(store.product(archived.id).active,false,'Legacy DELETE must remain reversible archive');
  for(const id of ['p-mug',archived.id]){
    const endpoint='/api/admin/products/'+id+'/permanent';
    assert.equal((await request(endpoint,'DELETE',{},headers)).status,200);
    assert.equal(store.product(id),null);
    assert.equal((await (await request('/api/products')).json()).products.some(p=>p.id===id),false);
    assert.equal((await (await request('/api/admin/products','GET',undefined,headers)).json()).products.some(p=>p.id===id),false);
    assert.equal((await request(endpoint,'DELETE',{},headers)).status,404);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='product_deleted' AND entity=?").get(id).n,1);
  }
});

test('deleting an ordered product preserves receipts and images; cancellation only restocks surviving products',async t=>{
  const {request,base,store}=await httpFixture(t);
  const login=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'});
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=','base64');
  const uploaded=await fetch(base+'/api/admin/upload',{method:'POST',headers:{...headers,'X-Requested-With':'tscart','Content-Type':'image/png'},body:bytes});
  const {url}=await uploaded.json();
  const mug=store.product('p-mug');
  store.saveProduct({...mug,images:[url],expectedStock:mug.stock});
  const other=store.products().find(p=>p.id!=='p-mug');
  const order=store.createOrder(input({items:[{id:mug.id,quantity:2},{id:other.id,quantity:1}]}),randomUUID());
  assert.equal((await request('/api/admin/products/'+mug.id+'/permanent','DELETE',{},headers)).status,200);
  assert.deepEqual(store.order(order.id),order);
  const receipt=await request('/api/orders/'+order.id,'GET',undefined,{'X-Order-Token':store.token(order.id)});
  assert.equal(receipt.status,200);
  const saved=(await receipt.json()).order;
  assert.deepEqual(saved.items,order.items);
  assert.deepEqual(saved.customer,order.customer);
  assert.equal(saved.total,order.total);
  assert.deepEqual(Buffer.from(await (await fetch(base+url)).arrayBuffer()),bytes);
  assert.ok(store.orders().some(o=>o.id===order.id));
  const stock=store.product(other.id).stock;
  assert.throws(()=>store.createOrder(input({items:[{id:other.id,quantity:1},{id:mug.id,quantity:1}]}),randomUUID()),/no longer available/);
  assert.equal(store.product(other.id).stock,stock);
  assert.equal(store.orders().length,1);
  store.updateOrder(order.id,{status:'cancelled'});
  store.updateOrder(order.id,{status:'cancelled'});
  assert.equal(store.product(mug.id),null);
  assert.equal(store.product(other.id).stock,other.stock);
  assert.deepEqual(store.order(order.id).items,order.items);
});

test('HTTP stale admin edit cannot recreate a permanently deleted product',async t=>{
  const {request,store}=await httpFixture(t);
  const login=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'});
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  const old=store.product('p-mug');
  await request('/api/admin/products/'+old.id+'/permanent','DELETE',{},headers);
  const save=await request('/api/admin/products','POST',{...old,expectedStock:old.stock},headers);
  assert.equal(save.status,404);
  assert.equal(store.product(old.id),null);
  const {id,...fresh}=old;
  const created=await request('/api/admin/products','POST',fresh,headers);
  assert.equal(created.status,201,'The deleted slug can be reused for a new product');
  assert.notEqual((await created.json()).product.id,id);
});

test('an empty deleted catalogue stays empty after restart without losing orders or settings',t=>{
  const directory=mkdtempSync(join(tmpdir(),'tscart-deletion-persist-'));
  let store=new Store(directory,{STORE_MODE:'demo'});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const order=store.createOrder(input(),randomUUID());
  const token=store.token(order.id);
  store.updateSettings({businessName:'My Existing Store'});
  for(const product of store.products(true))store.deleteProduct(product.id);
  store.close();
  store=new Store(directory,{STORE_MODE:'demo'});
  assert.deepEqual(store.products(true),[]);
  assert.deepEqual(store.order(order.id),order);
  assert.equal(store.token(order.id),token);
  assert.equal(store.settings().businessName,'My Existing Store');
});

test('captured payment after product deletion still confirms the reserved order and preserves its items',t=>{
  const {store}=fixture(t);
  const order=store.createOrder(input({paymentMethod:'razorpay'}),randomUUID());
  store.attachGateway(order.id,{id:'order_deleted_product',receipt:order.id,amount:order.total,currency:'INR'});
  store.deleteProduct('p-mug');
  store.confirmPayment(order.id,{id:'pay_deleted_product',order_id:'order_deleted_product',amount:order.total,currency:'INR',status:'captured'});
  const confirmed=store.order(order.id);
  assert.equal(confirmed.status,'confirmed');
  assert.equal(confirmed.paymentStatus,'paid');
  assert.deepEqual(confirmed.items,order.items);
  assert.equal(confirmed.total,order.total);
  assert.ok(store.orders().some(o=>o.id===order.id));
  assert.equal(store.product('p-mug'),null);
});

function readyForTestSale(store) {
  store.db.prepare('UPDATE admin SET must_change=0 WHERE id=1').run();
  store.updateSettings({businessAddress:'42 Test Street, Kochi',supportEmail:'test@example.com'});
}

test('HTTP live COD saves complete customer and item details for admin without external requests',async t=>{
  const external=[];
  const {request,store}=await httpFixture(t,{
    STORE_MODE:'live',WHATSAPP_ACCESS_TOKEN:'unused-old-token',WHATSAPP_PHONE_NUMBER_ID:'123',
    WHATSAPP_GRAPH_VERSION:'v24.0',WHATSAPP_TEMPLATE_NAME:'old_order_template',WHATSAPP_TO:'919876543210'
  },async url=>{external.push(url);throw Error('COD must not contact an external provider');});
  readyForTestSale(store);
  const products=store.products().slice(0,2);
  const checkout=input({items:products.map((p,i)=>({id:p.id,quantity:i+1}))});
  const created=await request('/api/orders','POST',checkout,{'Idempotency-Key':randomUUID()});
  assert.equal(created.status,201);
  const {order}=await created.json();
  assert.equal((await request('/api/admin/orders')).status,401);
  assert.equal((await request('/api/orders/'+order.id)).status,403);
  const login=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'});
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  const listed=await request('/api/admin/orders','GET',undefined,headers);
  assert.equal(listed.status,200);
  const {orders}=await listed.json();
  assert.equal(orders.length,1);
  assert.deepEqual(orders[0].customer,customer);
  assert.deepEqual(orders[0].items,products.map((p,i)=>({id:p.id,name:p.name,quantity:i+1,price:p.price,image:p.image})));
  assert.equal(orders[0].subtotal,products.reduce((total,p,i)=>total+p.price*(i+1),0));
  assert.equal(orders[0].total,orders[0].subtotal+orders[0].shipping);
  assert.equal(orders[0].status,'confirmed');
  assert.equal(orders[0].paymentMethod,'cod');
  assert.equal(orders[0].paymentStatus,'cod_due');
  assert.equal(orders[0].demo,false);
  assert.equal('notification' in orders[0],false);
  assert.equal((await request('/api/admin/orders/'+order.id+'/retry','POST',{},headers)).status,404);
  const settings=await (await request('/api/admin/settings','GET',undefined,headers)).json();
  assert.deepEqual(settings.integrations,{razorpay:false,razorpayMode:'test'});
  assert.deepEqual(external,[]);
});

test('HTTP online checkout remains visible in admin before payment and updates after verified capture',async t=>{
  const external=[];
  let amount;
  const {request,store}=await httpFixture(t,{STORE_MODE:'live',RAZORPAY_KEY_ID:'rzp_test_example',RAZORPAY_KEY_SECRET:'test-secret'},async(url,options)=>{
    external.push(url);
    if(url==='https://api.razorpay.com/v1/orders'){
      const data=JSON.parse(options.body);amount=data.amount;
      return new Response(JSON.stringify({id:'order_adminTest1',...data}));
    }
    if(url==='https://api.razorpay.com/v1/payments/pay_adminTest1')
      return new Response(JSON.stringify({id:'pay_adminTest1',order_id:'order_adminTest1',amount,currency:'INR',status:'captured'}));
    throw Error('Unexpected provider request');
  });
  readyForTestSale(store);
  const created=await request('/api/orders','POST',input({paymentMethod:'razorpay'}),{'Idempotency-Key':randomUUID()});
  assert.equal(created.status,201);
  const {order,token}=await created.json();
  const login=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'});
  const adminHeaders={Cookie:login.headers.get('set-cookie').split(';')[0]};
  const before=(await (await request('/api/admin/orders','GET',undefined,adminHeaders)).json()).orders[0];
  assert.deepEqual(before.customer,customer);
  assert.equal(before.status,'awaiting_payment');
  assert.equal(before.paymentStatus,'pending');
  const headers={'X-Order-Token':token};
  assert.equal((await request('/api/orders/'+order.id+'/payment','POST',{},headers)).status,200);
  const verified=await request('/api/orders/'+order.id+'/verify','POST',{
    razorpay_order_id:'order_adminTest1',razorpay_payment_id:'pay_adminTest1',
    razorpay_signature:hmac('test-secret','order_adminTest1|pay_adminTest1')
  },headers);
  assert.equal(verified.status,200);
  const after=(await (await request('/api/admin/orders','GET',undefined,adminHeaders)).json()).orders[0];
  assert.equal(after.status,'confirmed');
  assert.equal(after.paymentStatus,'paid');
  assert.equal(after.paymentMethod,'razorpay');
  assert.deepEqual(after.customer,customer);
  assert.deepEqual(after.items,before.items);
  assert.equal(after.total,before.total);
  assert.equal('notification' in after,false);
  assert.deepEqual(external,['https://api.razorpay.com/v1/orders','https://api.razorpay.com/v1/payments/pay_adminTest1']);
});

test('upgrading a database with an old message queue preserves store data and never queues new orders',t=>{
  const directory=mkdtempSync(join(tmpdir(),'tscart-admin-orders-'));
  let store=new Store(directory,{STORE_MODE:'live'});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const existing=store.createOrder(input(),randomUUID());
  const data=JSON.parse(store.db.prepare('SELECT data FROM orders WHERE id=?').get(existing.id).data);
  data.consentVersion='2026-11-12';
  store.db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(data),existing.id);
  const order=store.order(existing.id),token=store.token(existing.id);
  store.updateSettings({businessName:'Existing Owner Store'});
  store.db.prepare('INSERT INTO sessions VALUES(?,?)').run('existing-session',Date.now()+3600000);
  const admin=store.db.prepare('SELECT * FROM admin').get();
  const products=store.products(true),settings=store.settings();
  const sessions=store.db.prepare('SELECT * FROM sessions').all();
  // Reproduce the legacy table without adding a sender to this release.
  store.db.exec("CREATE TABLE outbox(order_id TEXT PRIMARY KEY REFERENCES orders(id),state TEXT DEFAULT 'queued',attempts INTEGER DEFAULT 0,next_at INTEGER DEFAULT 0,message_id TEXT,error TEXT)");
  store.db.prepare("INSERT INTO outbox(order_id,state) VALUES(?,'sending')").run(order.id);
  const legacy=store.db.prepare('SELECT * FROM outbox').all();
  store.close();
  store=new Store(directory,{STORE_MODE:'live'});
  assert.deepEqual(store.orders(),[order]);
  assert.equal(store.token(order.id),token);
  assert.deepEqual(store.products(true),products);
  assert.deepEqual(store.settings(),settings);
  assert.deepEqual(store.db.prepare('SELECT * FROM admin').get(),admin);
  assert.deepEqual(store.db.prepare('SELECT * FROM sessions').all(),sessions);
  store.createOrder(input(),randomUUID());
  assert.equal(store.orders().length,2);
  assert.deepEqual(store.db.prepare('SELECT * FROM outbox').all(),legacy,'Obsolete records remain untouched and are never resumed');
});
