import { insist, HttpError } from './security.js';

export class TursoIntegrations {
  constructor(store, env = process.env, fetcher = fetch) {
    this.store = store;
    this.env = env;
    this.fetch = fetcher;
    this.creating = new Map();
  }

  status() {
    const env = this.env;
    const razorpay = !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET);
    return { razorpay, razorpayMode: env.RAZORPAY_KEY_ID?.startsWith('rzp_live_') ? 'live' : 'test' };
  }

  async razorpay(path, method = 'GET', body) {
    insist(this.status().razorpay, 'Online payments are not configured yet.', 503);
    let response;
    try {
      response = await this.fetch('https://api.razorpay.com/v1/' + path, {
        method,
        headers: {
          Authorization: 'Basic ' + Buffer.from(this.env.RAZORPAY_KEY_ID + ':' + this.env.RAZORPAY_KEY_SECRET).toString('base64'),
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw new HttpError(502, 'Payment provider did not respond. Check this order before trying again.');
    }
    if (!response.ok) throw new HttpError(502, 'Razorpay rejected the request. Check account settings and the order in your dashboard.');
    return response.json();
  }

  async preparePayment(id) {
    if (this.creating.has(id)) return this.creating.get(id);
    const task = this._preparePayment(id);
    this.creating.set(id, task);
    try { return await task; }
    finally { this.creating.delete(id); }
  }

  async _preparePayment(id) {
    const order = await this.store.order(id);
    insist(order && order.paymentMethod === 'razorpay' && order.status === 'awaiting_payment', 'This order is not awaiting an online payment.', 409);
    if (order.gatewayId) return order.gatewayId;

    const claimed = await this.store.claimGatewayCreation(id);
    if (!claimed) {
      const fresh = await this.store.order(id);
      insist(fresh?.gatewayId, 'Payment setup is already in progress. Please retry shortly.', 409);
      return fresh.gatewayId;
    }

    try {
      const gateway = await this.razorpay('orders', 'POST', {
        amount: order.total,
        currency: 'INR',
        receipt: id,
        partial_payment: false,
        notes: { store_order: id }
      });
      await this.store.attachGateway(id, gateway);
      return gateway.id;
    } catch (error) {
      await this.store.setGatewayState(id, 'needs_review');
      throw error;
    }
  }

  async verifyPayment(id, paymentId) {
    insist(/^pay_[a-zA-Z0-9]+$/.test(paymentId), 'Invalid payment reference.');
    const payment = await this.razorpay('payments/' + paymentId);
    return this.store.confirmPayment(id, payment);
  }

  async reconcile(id, gatewayId) {
    const order = await this.store.order(id);
    insist(order?.paymentMethod === 'razorpay', 'This is not an online payment order.');
    const idToCheck = order.gatewayId || gatewayId;
    insist(/^order_[a-zA-Z0-9]+$/.test(idToCheck || ''), 'Enter the Razorpay order ID from the dashboard.');
    const gateway = await this.razorpay('orders/' + idToCheck);
    await this.store.attachGateway(id, gateway);
    const payments = await this.razorpay('orders/' + idToCheck + '/payments');
    const captured = payments.items?.find(payment => payment.status === 'captured');
    if (captured) return this.store.confirmPayment(id, captured);
    return this.store.order(id);
  }
}
