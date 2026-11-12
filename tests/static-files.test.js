import test from 'node:test';
import assert from 'node:assert/strict';
import { posix, win32, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolvePublicFile } from '../server/static-files.js';
import { makeApp } from '../server/index.js';

for (const [platform, paths, base] of [
  ['Windows', win32, 'C:\\Users\\Shuaib K S\\Downloads\\TSCART-Store\\tscart\\public'],
  ['Linux/macOS', posix, '/home/shuaib/TSCART Store/public'],
]) {
  test(`${platform}: CSS, JavaScript, images and fonts resolve inside public`, () => {
    for (const asset of ['styles.css', 'js/app.js', 'assets/hero.jpg', 'assets/serif.ttf', 'assets/mark.svg']) {
      const pathname = new URL('http://localhost:3000/' + asset + '?v=1.0.3').pathname;
      assert.equal(resolvePublicFile(base, pathname, paths), paths.join(base, asset));
    }
  });
  test(`${platform}: storefront and nested app routes resolve to index.html`, () => {
    for (const pathname of ['/', '/admin', '/admin/products', '/product/slow-morning-mug']) {
      assert.equal(resolvePublicFile(base, pathname, paths), paths.join(base, 'index.html'));
    }
  });
  test(`${platform}: traversal, sibling directories and Windows special paths are rejected`, () => {
    for (const pathname of ['/../.env', '/../../secret.txt', '/../public-other/private.txt', '/..\\data\\order-secret', '/styles.css::$DATA', '/assets/\0secret']) {
      assert.throws(() => resolvePublicFile(base, pathname, paths), error => error.status === 404);
    }
  });
}

test('HTTP assets referenced by index.html return valid content types, including version queries', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tscart-assets-'));
  const app = makeApp({dataDir: directory, env: {STORE_MODE:'demo'}});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => app.server.close(resolve));
    app.store.close();
    rmSync(directory, {recursive:true, force:true});
  });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const response = await fetch(base + '/');
  assert.equal(response.status, 200);
  const html = await response.text();
  const css = html.match(/rel="stylesheet" href="([^"]+)"/)[1];
  const script = html.match(/<script src="([^"]+)"/)[1];
  for (const [url, type, marker] of [[css,'text/css',':root'],[script,'text/javascript','async function boot'],['/assets/mark.svg','image/svg+xml','<svg']]) {
    const r = await fetch(base + url);
    assert.equal(r.status, 200, url);
    assert.ok(r.headers.get('content-type').startsWith(type), url);
    assert.ok((await r.text()).includes(marker), url);
  }
  for (const url of ['/shop','/admin','/product/slow-morning-mug']) {
    const r = await fetch(base + url);
    assert.equal(r.status, 200, url);
    assert.ok(r.headers.get('content-type').startsWith('text/html'));
  }
  assert.equal((await fetch(base + '/assets/hero.jpg')).status, 200);
  assert.equal((await fetch(base + '/assets/serif.ttf')).status, 200);
  assert.equal((await fetch(base + '/assets/missing.jpg')).status, 404);
});
