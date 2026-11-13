import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from 'node:crypto';
export const randomToken = () => randomBytes(32).toString('hex');
export const sha = value => createHash('sha256').update(value).digest('hex');
export const hmac = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');
export function equalHex(a, b) {
  return typeof a === 'string' && typeof b === 'string' && /^[0-9a-f]{64}$/i.test(a) && /^[0-9a-f]{64}$/i.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function checkPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const [salt, key] = hash.split(':');
  return timingSafeEqual(Buffer.from(key, 'hex'), scryptSync(password, salt, 64));
}
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function insist(condition, message, status = 400) { if (!condition) throw new HttpError(status, message); }
export function str(value, label, min = 0, max = 200) {
  insist(typeof value === 'string', `${label} is required.`);
  const result = value.trim();
  insist(result.length >= min && result.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(result), `${label} must contain ${min}–${max} characters.`);
  return result;
}
export function integer(value, label, min, max) {
  insist(Number.isSafeInteger(value) && value >= min && value <= max, `${label} must be between ${min} and ${max}.`); return value;
}
export function safeImage(value) {
  const url = str(value, 'Image URL', 1, 1200);
  insist(/^\/(assets|uploads)\/[a-zA-Z0-9._-]+$/.test(url) || /^https:\/\/[^\s<>"']+$/.test(url), 'Use an uploaded image or an HTTPS image URL.');
  return url;
}

export function acceptsRequestOrigin(req,env) {
  const origin=req.headers.origin;
  if(!origin)return true;
  const production=env.NODE_ENV==='production';
  const allowed=new Set();
  if(env.APP_URL)allowed.add(new URL(env.APP_URL).origin);
  const addHost=(host,protocol)=>{
    if(typeof host!=='string'||/[\s,/@?#\\]/.test(host)||!['http','https'].includes(protocol))return;
    if(production&&protocol!=='https')return;
    try{allowed.add(new URL(protocol+'://'+host).origin);}catch{}
  };
  // Host is the address the browser is currently using, including preview aliases.
  addHost(req.headers.host,'https');
  if(!production)addHost(req.headers.host,'http');
  // Only deployments explicitly configured behind a trusted proxy use its headers.
  if(env.TRUST_PROXY==='true'){
    const host=req.headers['x-forwarded-host']?.split(',')[0].trim();
    const protocol=req.headers['x-forwarded-proto']?.split(',')[0].trim()||(production?'https':'http');
    addHost(host,protocol);
  }
  return allowed.has(origin);
}
