import { insist, HttpError } from './security.js';

export class Integrations {
  constructor(store, env=process.env, fetcher=fetch) {this.store=store;this.env=env;this.fetch=fetcher;this.creating=new Map();}
  status() {
    const e=this.env;
    const razorpay=!!(e.RAZORPAY_KEY_ID&&e.RAZORPAY_KEY_SECRET&&e.RAZORPAY_WEBHOOK_SECRET);
    return {razorpay,razorpayMode:e.RAZORPAY_KEY_ID?.startsWith('rzp_live_')?'live':'test'};
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
}
