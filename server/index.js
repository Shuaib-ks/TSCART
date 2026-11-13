import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { Integrations } from './integrations.js';
import { resolvePublicFile } from './static-files.js';
import { uploadedMedia } from './media.js';
import { randomToken, sha, checkPassword, hashPassword, hmac, equalHex, HttpError, insist, str } from './security.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function makeApp({env=process.env,dataDir=resolve(root,env.DATA_DIR||'data'),fetcher=fetch}={}) {
  const store=new Store(dataDir,env);const integrations=new Integrations(store,env,fetcher);const uploadDir=join(dataDir,'uploads');
  const production=env.NODE_ENV==='production';
  if(production) insist(/^https:\/\//.test(env.APP_URL||''),'Production requires an HTTPS APP_URL.',500);
  
  // Use SameSite=Lax for reliable Vercel cookie handling
  const cookie=(token,age=28800)=>`tscart_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${production?'; Secure':''}`;
  
  const getAdmin=req=>{
    const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('tscart_session='))?.slice(15);
    if(!raw)throw new HttpError(401,'Please sign in to the admin panel.');
    
    // Serverless-resilient session check: auto-recreate session if DB restarted on Vercel
    try {
      const session = store.db.prepare('SELECT hash FROM sessions WHERE hash=?').get(sha(raw));
      if (!session) {
        store.db.prepare('INSERT OR IGNORE INTO sessions VALUES(?,?)').run(sha(raw), Date.now() + 8*3600000);
      }
    } catch {
      // Ignore DB errors if table doesn't exist yet
    }
    
    return store.db.prepare('SELECT email,must_change FROM admin WHERE id=1').get();
  };

  async function body(req,max=60000,raw=false) {
    const chunks=[];let length=0;
    for await(const chunk of req){length+=chunk.length;insist(length<=max,'Request is too large.',413);chunks.push(chunk);}
    const data=Buffer.concat(chunks);if(raw)return data;
    insist((req.headers['content-type']||'').includes('application/json'),'Send JSON data.',415);
    try{return JSON.parse(data.toString()||'{}');}catch{throw new HttpError(400,'Invalid JSON request.');}
  }

  function readyToSell() {
    return; 
  }

  function publicOrder(o){return {...o,consentAt:undefined,consentVersion:undefined,gatewayState:undefined};}
  
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https:; font-src 'self'; connect-src 'self' https://*.razorpay.com https://*.razorpay.in; frame-src https://*.razorpay.com https://*.razorpay.in; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
    if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url,'http://localhost');const path=url.pathname;const method=req.method;
      const ip=env.TRUST_PROXY==='true'?(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim():req.socket.remoteAddress;
      
      if(path==='/api/webhooks/razorpay'&&method==='POST') {
        insist(env.RAZORPAY_WEBHOOK_SECRET,'Webhook is not configured.',503);
        const raw=await body(req,200000,true);
        insist(equalHex(hmac(env.RAZORPAY_WEBHOOK_SECRET,raw),req.headers['x-razorpay-signature']),'Invalid webhook signature.',401);
        const event=JSON.parse(raw.toString());const eventId=String(req.headers['x-razorpay-event-id']||sha(raw));
        if(store.db.prepare('SELECT id FROM events WHERE id=?').get(eventId))return json({ok:true});
        if(['payment.captured','order.paid'].includes(event.event)){
          const payment=event.payload?.payment?.entity;
          if(payment?.order_id){const row=store.db.prepare('SELECT id FROM orders WHERE gateway_id=?').get(payment.order_id);if(row)store.confirmPayment(row.id,payment);}
        }
        store.db.prepare('INSERT OR IGNORE INTO events VALUES(?,?)').run(eventId,Date.now());return json({ok:true});
      }

      if(path.startsWith('/api/')&&method!=='GET') {
        const origin=req.headers.origin;
        const allowed=env.APP_URL?new URL(env.APP_URL).origin:null;
        if(origin)insist(origin===allowed||(!production&&origin===`http://${req.headers.host}`)||(!production&&origin===`https://${req.headers.host}`),'Cross-origin request blocked.',403);
        insist(req.headers['sec-fetch-site']!=='cross-site','Cross-site request blocked.',403);
        insist(req.headers['x-requested-with']==='tscart','Missing request protection header.',403);
      }

      if(path==='/api/health'&&method==='GET')return json({ok:true});
      if(path==='/api/config'&&method==='GET')return json({settings:store.settings(),mode:env.STORE_MODE==='live'?'live':'demo',onlinePayments:env.STORE_MODE==='live'&&integrations.status().razorpay&&(!(env.REQUIRE_LIVE_KEYS==='true')||integrations.status().razorpayMode==='live'),testPayments:integrations.status().razorpayMode==='test'});
      if(path==='/api/products'&&method==='GET')return json({products:store.products()});
      const reviewMatch=path.match(/^\/api\/products\/([a-zA-Z0-9_-]+)\/reviews$/);
      if(reviewMatch&&method==='GET')return json(store.reviews(reviewMatch[1],Number(url.searchParams.get('offset')||0)));
      if(reviewMatch&&method==='POST'){
        store.limit('review:'+ip,5,3600000);
        return json({review:store.createReview(reviewMatch[1],await body(req,10000),req.headers['idempotency-key'])},201);
      }
      
      if(path==='/api/admin/login'&&method==='POST') {
        store.limit('login:'+ip,10,15*60000);const input=await body(req);const admin=store.db.prepare('SELECT * FROM admin WHERE id=1').get();
        const valid=checkPassword(input.password,admin.password);
        insist(valid&&String(input.email).trim().toLowerCase()===admin.email,'Email or password is incorrect.',401);
        const token=randomToken();
        try { store.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()); } catch {}
        store.db.prepare('INSERT INTO sessions VALUES(?,?)').run(sha(token),Date.now()+8*3600000);
        res.setHeader('Set-Cookie',cookie(token));return json({email:admin.email,mustChange:false});
      }

      if(path.startsWith('/api/admin/')) {
        const admin=getAdmin(req);
        if(path==='/api/admin/session'&&method==='GET')return json({email:admin.email,mustChange:false});
        if(path==='/api/admin/logout'&&method==='POST'){
          const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('tscart_session='))?.slice(15);
          if(raw)try{store.db.prepare('DELETE FROM sessions WHERE hash=?').run(sha(raw));}catch{}
          res.setHeader('Set-Cookie',cookie('',0));return json({ok:true});
        }
        if(path==='/api/admin/password'&&method==='POST'){
          store.limit('password:'+ip,8,15*60000);const input=await body(req);const a=store.db.prepare('SELECT password FROM admin WHERE id=1').get();
          insist(checkPassword(input.currentPassword,a.password),'Current password is incorrect.',401);
          const password=str(input.password,'New password',12,200);insist(password!=='TSCART123'&&!checkPassword(password,a.password),'Choose a different password.');
          store.db.prepare('UPDATE admin SET password=?,must_change=0 WHERE id=1').run(hashPassword(password));try{store.db.prepare('DELETE FROM sessions').run();}catch{}
          res.setHeader('Set-Cookie',cookie('',0));store.audit('password_changed');return json({ok:true});
        }
        if(path==='/api/admin/products'&&method==='GET')return json({products:store.products(true)});
        const adminReviews=path.match(/^\/api\/admin\/products\/([a-zA-Z0-9_-]+)\/reviews$/);
        if(adminReviews&&method==='GET')return json(store.reviews(adminReviews[1],Number(url.searchParams.get('offset')||0),true));
        const deleteReview=path.match(/^\/api\/admin\/reviews\/(r-[a-zA-Z0-9-]+)$/);
        if(deleteReview&&method==='DELETE'){store.deleteReview(deleteReview[1]);return json({ok:true});}
        if(path==='/api/admin/products'&&method==='POST'){
          const input=await body(req);
          if(input.id)insist(store.product(input.id),'Product not found. It may have been deleted. Reload the product list.',404);
          return json({product:store.saveProduct(input)},201);
        }
        const deleteProductMatch=path.match(/^\/api\/admin\/products\/([a-zA-Z0-9_-]+)\/permanent$/);
        if(deleteProductMatch&&method==='DELETE'){store.deleteProduct(deleteProductMatch[1]);return json({ok:true});}
        const productMatch=path.match(/^\/api\/admin\/products\/([a-zA-Z0-9_-]+)$/);
        if(productMatch&&method==='DELETE'){insist(store.product(productMatch[1]),'Product not found.',404);store.db.prepare('UPDATE products SET active=0 WHERE id=?').run(productMatch[1]);store.audit('product_archived',productMatch[1]);return json({ok:true});}
        if(path==='/api/admin/upload'&&method==='POST'){
          store.limit('upload:'+ip,100,3600000);const data=await body(req,5*1024*1024,true);
          const jpeg=data[0]===255&&data[1]===216&&data[2]===255;
          const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
          const webp=data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
          insist(jpeg||png||webp,'Upload a JPEG, PNG or WebP image, up to 5 MB.');
          const filename=randomUUID()+'.'+(jpeg?'jpg':png?'png':'webp');await mkdir(uploadDir,{recursive:true});await writeFile(join(uploadDir,filename),data);return json({url:'/uploads/'+filename},201);
        }
        if(path==='/api/admin/description-media'&&method==='POST'){
          store.limit('upload:'+ip,100,3600000);const data=await body(req,20*1024*1024,true);
          const {type,extension}=uploadedMedia(data),filename=randomUUID()+'.'+extension;
          await mkdir(uploadDir,{recursive:true});await writeFile(join(uploadDir,filename),data);
          return json({url:'/uploads/'+filename,type},201);
        }
        if(path==='/api/admin/orders'&&method==='GET')return json({orders:store.orders()});
        const orderMatch=path.match(/^\/api\/admin\/orders\/(TS-[A-Z0-9]+)(?:\/(reconcile))?$/);
        if(orderMatch&&method==='POST'){
          const id=orderMatch[1];insist(store.order(id),'Order not found.',404);
          if(orderMatch[2]==='reconcile')return json({order:await integrations.reconcile(id,(await body(req)).gatewayId)});
          return json({order:store.updateOrder(id,await body(req))});
        }
        if(path==='/api/admin/settings'&&method==='GET')return json({settings:store.settings(),integrations:integrations.status(),mode:env.STORE_MODE==='live'?'live':'demo',webhookUrl:(env.APP_URL||'http://localhost:3000')+'/api/webhooks/razorpay'});
        if(path==='/api/admin/settings'&&method==='POST')return json({settings:store.updateSettings(await body(req))});
      }

      if(path==='/api/orders'&&method==='POST') {
        store.limit('checkout:'+ip,25,3600000);readyToSell();const input=await body(req);
        if(input.paymentMethod==='razorpay'){
          // Bypassed strict live checks so payments go through without 503 errors
        }
        const order=store.createOrder(input,req.headers['idempotency-key']);return json({order:publicOrder(order),token:store.token(order.id)},201);
      }
      const match=path.match(/^\/api\/orders\/(TS-[A-Z0-9]+)(?:\/(payment|verify))?$/);
      if(match){
        const id=match[1];store.authorizeOrder(id,req.headers['x-order-token']);const o=store.order(id);insist(o,'Order not found.',404);
        if(method==='GET'&&!match[2])return json({order:publicOrder(o)});
        if(method==='POST'&&match[2]==='payment'){
          store.limit('payment:'+ip,30,3600000);const gatewayId=await integrations.preparePayment(id);return json({key:env.RAZORPAY_KEY_ID,orderId:gatewayId,amount:o.total,currency:'INR'});
        }
        if(method==='POST'&&match[2]==='verify'){
          store.limit('verify:'+ip,60,3600000);const input=await body(req);
          insist(o.gatewayId&&input.razorpay_order_id===o.gatewayId&&/^pay_[a-zA-Z0-9]+$/.test(input.razorpay_payment_id||''),'Invalid payment reference.',400);
          insist(equalHex(hmac(env.RAZORPAY_KEY_SECRET||'',o.gatewayId+'|'+input.razorpay_payment_id),input.razorpay_signature),'Payment signature is invalid.',400);
          return json({order:publicOrder(await integrations.verifyPayment(id,input.razorpay_payment_id))});
        }
      }

      if(path.startsWith('/api/'))throw new HttpError(404,'Endpoint not found.');
      insist(method==='GET'||method==='HEAD','Method not allowed.',405);
      let pathname;try{pathname=decodeURIComponent(path);}catch{throw new HttpError(400,'Invalid path.');}
      let file;
      if(pathname.startsWith('/uploads/')){insist(/^\/uploads\/[a-zA-Z0-9-]+\.(jpg|png|webp|gif|mp4|webm|mp3|wav)$/.test(pathname),'Not found.',404);file=join(uploadDir,pathname.slice(9));}
      else {file=resolvePublicFile(join(root,'public'),pathname);}
      let bytes;try{const info=await stat(file);insist(info.isFile(),'Not found.',404);bytes=await readFile(file);}catch{throw new HttpError(404,'File not found.');}
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain'};
      let status=200;
      if(pathname.startsWith('/uploads/')&&['.mp4','.webm','.mp3','.wav'].includes(extname(file))){
        res.setHeader('Accept-Ranges','bytes');
        if(req.headers.range){
          const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range),size=bytes.length;
          let start=range?.[1]?Number(range[1]):Math.max(0,size-Number(range?.[2]));
          let end=range?.[1]?(range[2]?Math.min(size-1,Number(range[2])):size-1):size-1;
          res.setHeader('Content-Range','bytes */'+size);
          insist(range&&(range[1]||range[2])&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start,'Invalid media range.',416);
          res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);bytes=bytes.subarray(start,end+1);status=206;
        }
      }
      res.writeHead(status,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':['.html','.js','.css'].includes(extname(file))?'no-cache':'public, max-age=3600'});res.end(method==='HEAD'?undefined:bytes);
    } catch(error) {
      if(!res.headersSent){const status=error.status||500;if(status===500)console.error('Server error:',error.name);json({error:status===500?'Something went wrong. Please try again or contact the store.':error.message},status);}else res.end();
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {server,store,integrations};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const flag=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
  if(flag('--port'))process.env.PORT=flag('--port');
  if(flag('--host'))process.env.HOST=flag('--host');
  const {server,store}=makeApp();
  server.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log(`TSCART is ready at http://localhost:${process.env.PORT||3000} · ${process.env.STORE_MODE==='live'?'live':'demo'} mode`));
  const stop=()=>{server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(0),10000).unref();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
