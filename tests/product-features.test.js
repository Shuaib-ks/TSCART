import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { makeApp } from '../server/index.js';
import { descriptionMedia,uploadedMedia } from '../server/media.js';
import { checkoutItems,freeDeliveryTotals,ratingMarkup,reviewCards,descriptionMarkup } from '../public/js/product-extras.js';

const customer={name:'Feature Test',phone:'9876543210',email:'',line1:'42 Test Road',line2:'',city:'Kochi',state:'Kerala',pincode:'682001',notes:''};
const orderInput=(paymentMethod='cod')=>({customer,paymentMethod,consent:true,items:[{id:'p-mug',quantity:1}]});
const review=(rating=5)=>({name:'Test Customer',rating,body:'A useful addition to my home.'});
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'tscart-features-'));const store=new Store(directory,{STORE_MODE:'demo'});t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});return {store,directory};}
async function http(t){
  const directory=mkdtempSync(join(tmpdir(),'tscart-features-http-')),app=makeApp({dataDir:directory,env:{STORE_MODE:'demo'}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));app.store.close();rmSync(directory,{recursive:true,force:true});});
  const request=(path,method='GET',data,headers={})=>fetch(base+path,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json','X-Requested-With':'tscart'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
  const login=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'});
  return {...app,base,request,headers:{Cookie:login.headers.get('set-cookie').split(';')[0]}};
}

test('Buy Now checks out only the selected quantity and preserves the existing bag',()=>{
  const products=[{id:'one',name:'One',price:12300},{id:'two',name:'Two',price:45000}];
  const bag=[{id:'two',quantity:3}],copy=structuredClone(bag);
  const direct=checkoutItems(products,bag,{id:'one',quantity:2});
  assert.deepEqual(direct,[{...products[0],quantity:2}]);assert.deepEqual(bag,copy);
  assert.deepEqual(freeDeliveryTotals(direct),{subtotal:24600,shipping:0,total:24600});
  assert.deepEqual(checkoutItems(products,bag),[{...products[1],quantity:3}]);
  assert.deepEqual(checkoutItems(products,bag,{id:'missing',quantity:1}),[]);
});

test('all new COD and Razorpay orders have zero delivery despite old or submitted settings',t=>{
  const {store}=fixture(t);
  store.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify({...store.settings(),shippingFee:99000,freeShippingAt:99999999}));
  assert.equal(store.settings().shippingFee,0);
  store.updateSettings({shippingFee:55000,freeShippingAt:99999999});assert.equal(store.settings().shippingFee,0);
  for(const method of ['cod','razorpay']){
    const order=store.createOrder({...orderInput(method),shipping:99000,total:1},randomUUID());
    assert.equal(order.shipping,0);assert.equal(order.total,store.product('p-mug').price);assert.equal(order.total,order.subtotal);
  }
});

test('historical delivery charges and totals are not rewritten',t=>{
  const {store}=fixture(t),order=store.createOrder(orderInput(),randomUUID());
  const old=JSON.parse(store.db.prepare('SELECT data FROM orders WHERE id=?').get(order.id).data);
  old.shipping=7900;old.total=old.subtotal+7900;store.db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(old),order.id);
  store.updateSettings({shippingFee:0});store.updateOrder(order.id,{status:'processing'});
  assert.equal(store.order(order.id).shipping,7900);assert.equal(store.order(order.id).total,old.total);
});

test('ratings are calculated from real reviews with validation and idempotent submissions',t=>{
  const {store}=fixture(t);assert.equal(store.product('p-mug').reviewCount,0);assert.equal(store.product('p-mug').ratingAverage,0);
  for(const rating of [0,6,2.5,'5',null])assert.throws(()=>store.createReview('p-mug',review(rating),randomUUID()),/Rating/);
  assert.throws(()=>store.createReview('p-mug',{...review(),body:'short'},randomUUID()),/Review/);
  const key=randomUUID(),first=store.createReview('p-mug',review(5),key);
  assert.deepEqual(store.createReview('p-mug',review(5),key),first);
  assert.throws(()=>store.createReview('p-mug',review(1),key),/already used/);
  store.createReview('p-mug',review(3),randomUUID());
  const product=store.products().find(p=>p.id==='p-mug');assert.equal(product.ratingAverage,4);assert.equal(product.reviewCount,2);
  assert.equal(store.reviews('p-mug').total,2);
  assert.deepEqual(Object.keys(store.reviews('p-mug').reviews[0]).sort(),['body','created','id','name','rating']);
  store.deleteReview(first.id);assert.equal(store.product('p-mug').ratingAverage,3);assert.equal(store.product('p-mug').reviewCount,1);
});

test('reviews paginate without duplicates and follow product archive and deletion',t=>{
  const {store}=fixture(t);
  for(let n=0;n<25;n++)store.createReview('p-mug',{...review(),name:'Customer '+n},randomUUID());
  const one=store.reviews('p-mug'),two=store.reviews('p-mug',one.nextOffset);
  assert.equal(one.reviews.length,20);assert.equal(two.reviews.length,5);assert.equal(two.nextOffset,null);
  assert.equal(new Set([...one.reviews,...two.reviews].map(r=>r.id)).size,25);
  assert.throws(()=>store.reviews('p-mug',-1),/offset/);
  const mug=store.product('p-mug');store.saveProduct({...mug,active:false,expectedStock:mug.stock});
  assert.throws(()=>store.reviews('p-mug'),/not found/);assert.throws(()=>store.createReview('p-mug',review(),randomUUID()),/not found/);
  assert.equal(store.reviews('p-mug',0,true).total,25);
  store.deleteProduct('p-mug');assert.equal(store.db.prepare('SELECT COUNT(*) n FROM reviews').get().n,0);
});

test('reviews and description media persist across restart',t=>{
  const directory=mkdtempSync(join(tmpdir(),'tscart-feature-persist-'));let store=new Store(directory);
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const mug=store.product('p-mug'),media=[{type:'image',url:'/assets/mug.jpg',caption:'The glaze'},{type:'video',url:'https://example.com/demo.mp4',caption:'A closer look'}];
  store.saveProduct({...mug,descriptionMedia:media,expectedStock:mug.stock});store.createReview(mug.id,review(4),randomUUID());
  store.close();store=new Store(directory);assert.deepEqual(store.product(mug.id).descriptionMedia,media);assert.equal(store.product(mug.id).ratingAverage,4);
  const current=store.product(mug.id);delete current.descriptionMedia;store.saveProduct({...current,expectedStock:current.stock});assert.deepEqual(store.product(mug.id).descriptionMedia,media);
});

test('review content and media captions are escaped instead of becoming executable markup',()=>{
  const text='<img src=x onerror=alert(1)>';
  const html=reviewCards([{id:'r-test',name:text,rating:5,body:text,created:Date.now()}]);
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
  const media=descriptionMarkup([{type:'image',url:'/assets/mug.jpg',caption:text}]);
  assert.ok(media.includes('&lt;img'));assert.ok(!media.includes('<img src=x'));
  assert.match(ratingMarkup({reviewCount:0,ratingAverage:0}),/No reviews yet/);
});

test('description media rejects executable schemes, local HTML/SVG and unsupported content',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,test','http://example.com/a.png','/uploads/test.svg','/uploads/test.html','https://user:pass@example.com/a.png'])
    assert.throws(()=>descriptionMedia([{type:'image',url}]),/HTTPS/);
  assert.throws(()=>descriptionMedia([{type:'iframe',url:'https://example.com'}]),/Choose/);
  assert.throws(()=>descriptionMedia(Array.from({length:11},()=>({type:'image',url:'/assets/mug.jpg'}))),/10/);
  assert.throws(()=>uploadedMedia(Buffer.from('<svg onload="alert(1)"></svg>')),/Upload/);
  assert.throws(()=>uploadedMedia(Buffer.from('<html><script>alert(1)</script>')),/Upload/);
  const big=Buffer.alloc(5*1024*1024+1);Buffer.from([255,216,255]).copy(big);assert.throws(()=>uploadedMedia(big),/5 MB/);
});

test('HTTP reviews are public, rate limited, protected against cross-origin submissions and removable in admin',async t=>{
  const {request,headers}=await http(t),path='/api/products/p-mug/reviews';
  assert.equal((await request(path)).status,200);
  assert.equal((await request(path,'POST',review(),{Origin:'https://untrusted.example','Idempotency-Key':randomUUID()})).status,403);
  const created=await request(path,'POST',review(),{'Idempotency-Key':randomUUID()});assert.equal(created.status,201);const {review:saved}=await created.json();
  assert.equal((await request('/api/admin/reviews/'+saved.id,'DELETE',{})).status,401);
  for(let n=0;n<4;n++)assert.equal((await request(path,'POST',review(),{'Idempotency-Key':randomUUID()})).status,201);
  assert.equal((await request(path,'POST',review(),{'Idempotency-Key':randomUUID()})).status,429);
  assert.equal((await request('/api/admin/reviews/'+saved.id,'DELETE',{},headers)).status,200);
  const listed=await (await request(path)).json();assert.equal(listed.total,4);
});

test('HTTP description upload persists image/video/audio and supports video ranges with safe MIME types',async t=>{
  const {request,base,headers,store}=await http(t);
  assert.equal((await request('/api/admin/description-media','POST',{})).status,401);
  const samples=[
    {type:'image',mime:'image/png',data:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=','base64')},
    {type:'video',mime:'video/mp4',data:Buffer.from([0,0,0,24,...Buffer.from('ftypmp42'),0,0,0,0,...Buffer.from('mp42isom')])},
    {type:'audio',mime:'audio/wav',data:Buffer.from('RIFF0000WAVEfmt data sample')}
  ];const media=[];
  for(const sample of samples){
    const uploaded=await fetch(base+'/api/admin/description-media',{method:'POST',headers:{...headers,'X-Requested-With':'tscart','Content-Type':sample.mime},body:sample.data});
    assert.equal(uploaded.status,201);const value=await uploaded.json();assert.equal(value.type,sample.type);media.push({...value,caption:'A detail'});
    const response=await fetch(base+value.url);assert.equal(response.headers.get('content-type'),sample.mime);assert.deepEqual(Buffer.from(await response.arrayBuffer()),sample.data);
    if(sample.type==='video'){
      const partial=await fetch(base+value.url,{headers:{Range:'bytes=4-11'}});assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),'bytes 4-11/24');assert.deepEqual(Buffer.from(await partial.arrayBuffer()),sample.data.subarray(4,12));
      assert.equal((await fetch(base+value.url,{headers:{Range:'bytes=1000-2000'}})).status,416);
    }
  }
  const bad=await fetch(base+'/api/admin/description-media',{method:'POST',headers:{...headers,'X-Requested-With':'tscart','Content-Type':'image/png'},body:'<script>alert(1)</script>'});assert.equal(bad.status,400);
  const product=store.product('p-mug');const saved=await request('/api/admin/products','POST',{...product,expectedStock:product.stock,descriptionMedia:media},headers);assert.equal(saved.status,201);
  const published=(await (await request('/api/products')).json()).products.find(p=>p.id===product.id);assert.deepEqual(published.descriptionMedia,media);
  const page=await fetch(base+'/product/slow-morning-mug');assert.match(page.headers.get('content-security-policy'),/media-src 'self' https:/);
});
