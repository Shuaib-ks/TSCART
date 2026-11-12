import { insist, HttpError } from './security.js';

export class Integrations {
  constructor(store, env=process.env, fetcher=fetch) {this.store=store;this.env=env;this.fetch=fetcher;this.busy=false;this.creating=new Map();}
  status() {
    const e=this.env;
    const razorpay=!!(e.RAZORPAY_KEY_ID&&e.RAZORPAY_KEY_SECRET&&e.RAZORPAY_WEBHOOK_SECRET);
    const whatsapp=!!(e.WHATSAPP_ACCESS_TOKEN&&e.WHATSAPP_PHONE_NUMBER_ID&&/^v\d+\.\d+$/.test(e.WHATSAPP_GRAPH_VERSION||'')&&e.WHATSAPP_TEMPLATE_NAME&&/^\d{10,15}$/.test(e.WHATSAPP_TO||'917736681091'));
    return {razorpay,whatsapp,razorpayMode:e.RAZORPAY_KEY_ID?.startsWith('rzp_live_')?'live':'test',recipient:e.WHATSAPP_TO||'917736681091'};
  }
  async razorpay(path,method='GET',body) {
    insist(this.status().razorpay,'Online payments are not configured yet.',503);
    let r;
    try {r=await this.fetch('https://api.razorpay.com/v1/'+path,{method,headers:{Authorization:'Basic '+Buffer.from(this.env.RAZORPAY_KEY_ID+':'+this.env.RAZORPAY_KEY_SECRET).toString('base64'),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});} catch {throw new HttpError(502,'Payment provider did not respond. Check this order before trying again.');}
    if(!r.ok)throw new HttpError(502,'Razorpay rejected the request. Check account settings and the order in your dashboard.');
    return r.json();
  }
  async preparePayment(id) {
    if(this.creating.has(id))return this.creating.get(id);
    const task=this._preparePayment(id);this.creating.set(id,task);try{return await task;}finally{this.creating.delete(id);}
  }
  async _preparePayment(id) {
    const o=this.store.order(id);
    insist(o&&o.paymentMethod==='razorpay'&&o.status==='awaiting_payment','This order is not awaiting an online payment.',409);
    if(o.gatewayId)return o.gatewayId;
    insist(o.gatewayState==='idle','Payment setup needs review. Please contact the store with your order number.',409);
    this.store.db.prepare("UPDATE orders SET gateway_state='creating' WHERE id=?").run(id);
    try {
      const gateway=await this.razorpay('orders','POST',{amount:o.total,currency:'INR',receipt:id,partial_payment:false,notes:{store_order:id}});
      this.store.attachGateway(id,gateway);return gateway.id;
    } catch(e) {this.store.db.prepare("UPDATE orders SET gateway_state='needs_review' WHERE id=? AND gateway_id IS NULL").run(id);throw e;}
  }
  async verifyPayment(id,paymentId) {
    insist(/^pay_[a-zA-Z0-9]+$/.test(paymentId),'Invalid payment reference.');
    const payment=await this.razorpay('payments/'+paymentId);
    return this.store.confirmPayment(id,payment);
  }
  async reconcile(id,gatewayId) {
    const o=this.store.order(id);insist(o?.paymentMethod==='razorpay','This is not an online payment order.');
    const gid=o.gatewayId||gatewayId;insist(/^order_[a-zA-Z0-9]+$/.test(gid||''),'Enter the Razorpay order ID from the dashboard.');
    const gateway=await this.razorpay('orders/'+gid);this.store.attachGateway(id,gateway);
    const payments=await this.razorpay('orders/'+gid+'/payments');
    const captured=payments.items?.find(p=>p.status==='captured');
    if(captured)return this.store.confirmPayment(id,captured);
    return this.store.order(id);
  }
  async processOutbox() {
    if(this.busy)return;this.busy=true;
    try {
      const rows=this.store.db.prepare("SELECT * FROM outbox WHERE state IN ('queued','retry','waiting_setup') AND next_at<=? LIMIT 10").all(Date.now());
      for(const row of rows){
        const o=this.store.order(row.order_id);
        if(!o||['cancelled','needs_review','awaiting_payment'].includes(o.status))continue;
        if(o.demo){this.store.db.prepare("UPDATE outbox SET state='demo',error='Demo order: no WhatsApp message sent.' WHERE order_id=?").run(o.id);continue;}
        if(!this.status().whatsapp){this.store.db.prepare("UPDATE outbox SET state='waiting_setup',error='WhatsApp credentials or approved template are missing.',next_at=? WHERE order_id=?").run(Date.now()+60000,o.id);continue;}
        this.store.db.prepare("UPDATE outbox SET state='sending',attempts=attempts+1 WHERE order_id=?").run(o.id);
        try {
          const message=await this.sendWhatsApp(o);
          this.store.db.prepare("UPDATE outbox SET state='sent',message_id=?,error=NULL WHERE order_id=?").run(message,o.id);
        } catch(e) {
          const attempts=row.attempts+1;
          this.store.db.prepare('UPDATE outbox SET state=?,error=?,next_at=? WHERE order_id=?').run(attempts>=8?'failed':'retry',e.message.slice(0,250),Date.now()+Math.min(3600000,30000*2**attempts),o.id);
        }
      }
    }finally{this.busy=false;}
  }
  async sendWhatsApp(o) {
    const c=o.customer;
    const money=n=>'INR '+(n/100).toFixed(2);
    const address=[c.line1,c.line2,c.city,c.state,c.pincode,'India'].filter(Boolean).join(', ');
    const items=o.items.map(i=>`${i.name} x${i.quantity} @ ${money(i.price)}`).join('; ');
    // The template supports up to 12 items; split long item text across two parameters.
    const params=[o.id+' · '+new Date(o.created).toISOString(),c.name,'+91'+c.phone,c.email||'Not provided',address,items.slice(0,900),items.slice(900)||'No additional items',`Subtotal ${money(o.subtotal)}; delivery ${money(o.shipping)}; total ${money(o.total)}`,o.paymentMethod==='cod'?'Cash on delivery — payment due':'Razorpay — payment captured',c.notes||'None'];
    insist(items.length<=1800,'Order item summary exceeds the WhatsApp template limit. Review this order in Admin.',500);
    const body={messaging_product:'whatsapp',to:this.env.WHATSAPP_TO||'917736681091',type:'template',template:{name:this.env.WHATSAPP_TEMPLATE_NAME,language:{code:this.env.WHATSAPP_TEMPLATE_LANGUAGE||'en'},components:[{type:'body',parameters:params.map(text=>({type:'text',text:text.replace(/\s+/g,' ').trim()}))}]}};
    let r;
    try {r=await this.fetch(`https://graph.facebook.com/${this.env.WHATSAPP_GRAPH_VERSION}/${this.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:'Bearer '+this.env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{throw new Error('WhatsApp request timed out; a retry may duplicate an accepted message.');}
    if(!r.ok){const error=await r.json().catch(()=>({}));throw new Error(`WhatsApp API error ${error.error?.code||r.status}. Check token, sender, recipient and template in Meta.`);}
    const data=await r.json();insist(data.messages?.[0]?.id,'WhatsApp did not return a message ID.',502);return data.messages[0].id;
  }
}
