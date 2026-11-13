import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeApp } from '../server/index.js';

async function fixture(t,extra={}) {
  const directory=mkdtempSync(join(tmpdir(),'tscart-origin-'));
  const app=makeApp({dataDir:directory,env:{STORE_MODE:'demo',NODE_ENV:'production',APP_URL:'https://store.example',...extra}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));app.store.close();rmSync(directory,{recursive:true,force:true});});
  const request=(path,method='GET',data,headers={})=>fetch(base+path,{method,headers:{'X-Requested-With':'tscart','Content-Type':'application/json',...headers},body:data===undefined?undefined:JSON.stringify(data)});
  const login=await request('/api/admin/login','POST',{email:'tscart@gmai.com',password:'TSCART123'},{Origin:'https://store.example'});
  assert.equal(login.status,200);
  return {request,base,store:app.store,cookie:login.headers.get('set-cookie').split(';')[0]};
}

test('admin can add and permanently delete on the current HTTPS host when APP_URL names another alias',async t=>{
  const {request,cookie,base}=await fixture(t);
  const headers={Cookie:cookie,Origin:base.replace('http:','https:'),'Sec-Fetch-Site':'same-origin'};
  const created=await request('/api/admin/products','POST',{name:'Origin Test Bowl',slug:'origin-test-bowl',category:'Kitchen',description:'A temporary product for testing current-host admin requests.',price:45000,stock:4,images:['/assets/mug.jpg'],active:true},headers);
  assert.equal(created.status,201,await created.clone().text());
  const {product}=await created.json();
  assert.ok((await (await request('/api/products')).json()).products.some(p=>p.id===product.id));
  const deleted=await request('/api/admin/products/'+product.id+'/permanent','DELETE',{},headers);
  assert.equal(deleted.status,200,await deleted.clone().text());
  assert.equal((await (await request('/api/admin/products','GET',undefined,{Cookie:cookie})).json()).products.some(p=>p.id===product.id),false);
});

test('same-site admin writes still reject foreign origins, cross-site metadata and insecure production origins',async t=>{
  const {request,cookie,store}=await fixture(t);
  for(const headers of [
    {Host:'store.example',Origin:'https://evil.example','Sec-Fetch-Site':'same-origin'},
    {Host:'store.example',Origin:'https://store.example','Sec-Fetch-Site':'cross-site'},
    {Host:'store.example',Origin:'http://store.example'},
    {Host:'internal.example',Origin:'https://spoof.example','X-Forwarded-Host':'spoof.example','X-Forwarded-Proto':'https'}
  ]) {
    const response=await request('/api/admin/products/p-mug/permanent','DELETE',{}, {Cookie:cookie,...headers});
    assert.equal(response.status,403);
    assert.ok(store.product('p-mug'));
  }
});

test('trusted reverse proxies can preserve the current HTTPS origin without disabling cross-origin checks',async t=>{
  const {request,cookie}=await fixture(t,{TRUST_PROXY:'true'});
  const response=await request('/api/admin/settings','POST',{announcement:'Trusted proxy test'}, {Cookie:cookie,Host:'internal.example',Origin:'https://shop.example','X-Forwarded-Host':'shop.example','X-Forwarded-Proto':'https'});
  assert.equal(response.status,200,await response.clone().text());
  const foreign=await request('/api/admin/settings','POST',{announcement:'Rejected'}, {Cookie:cookie,Host:'internal.example',Origin:'https://foreign.example','X-Forwarded-Host':'shop.example','X-Forwarded-Proto':'https'});
  assert.equal(foreign.status,403);
});
