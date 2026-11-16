import assert from 'node:assert/strict';
import { createDecipheriv, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';
import { TursoStore, ensureTursoSchema } from '../server/turso-store.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const migrationKey = process.env.TSCART_MIGRATION_KEY || '';

if (!migrationKey) {
  console.log('TSCART one-time migration key is absent; skipping archive import.');
} else {
  if (process.env.VERCEL !== '1') throw new Error('Refusing to run the migration outside a Vercel build.');
  const key = Buffer.from(migrationKey, 'hex');
  assert.equal(key.length, 32, 'TSCART_MIGRATION_KEY must be a 32-byte hex key.');
  assert.ok(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN, 'Turso database credentials are required.');
  assert.ok(process.env.BLOB_READ_WRITE_TOKEN, 'Vercel Blob token is required.');
  assert.ok(process.env.ORDER_SECRET, 'The existing order-link secret must be configured.');

  const encoded = (await readFile(join(root, 'migration/payload.enc'), 'utf8')).trim();
  const encrypted = Buffer.from(encoded, 'base64');
  assert.ok(encrypted.length > 28, 'Encrypted migration payload is missing or truncated.');

  const iv = encrypted.subarray(0, 12);
  const tag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(12, encrypted.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from('TSCART-migration-v1'));
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const payload = JSON.parse(gunzipSync(compressed).toString('utf8'));

  assert.equal(payload.orderSecret, process.env.ORDER_SECRET,
    'Vercel ORDER_SECRET does not match the uploaded store archive. Refusing to change private order links.');
  assert.ok(typeof payload.databaseBase64 === 'string' && payload.databaseBase64.length > 0,
    'The migration archive does not contain a SQLite snapshot.');

  const workDir = await mkdtemp(join(tmpdir(), 'tscart-shared-migration-'));
  const dataDir = join(workDir, 'data');
  const sqlitePath = join(dataDir, 'tscart.sqlite');
  const migrationSecretOutput = join(root, '.vercel-migration.env');
  let target;
  let verificationClient;

  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(sqlitePath, Buffer.from(payload.databaseBase64, 'base64'), { mode: 0o600 });
    await writeFile(join(dataDir, 'order-secret'), payload.orderSecret + '\n', { mode: 0o600 });

    const source = new DatabaseSync(sqlitePath);
    const hasTable = name => !!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    const sourceProductIds = source.prepare('SELECT id FROM products').all().map(row => String(row.id));
    const deletedIds = new Set();
    if (hasTable('audit')) {
      for (const row of source.prepare("SELECT entity FROM audit WHERE action='product_deleted' AND entity IS NOT NULL AND entity<>''").all()) {
        deletedIds.add(String(row.entity));
      }
    }
    if (hasTable('deleted_products')) {
      for (const row of source.prepare('SELECT id FROM deleted_products').all()) deletedIds.add(String(row.id));
    }
    const expectedProductIds = sourceProductIds.filter(id => !deletedIds.has(id)).sort();
    const expectedDeletedIds = [...deletedIds].sort();
    const expectedOrders = hasTable('orders') ? Number(source.prepare('SELECT COUNT(*) AS n FROM orders').get().n) : 0;
    const expectedAdmin = hasTable('admin') ? Number(source.prepare('SELECT COUNT(*) AS n FROM admin').get().n) : 0;
    const expectedSettings = hasTable('settings') ? Number(source.prepare('SELECT COUNT(*) AS n FROM settings').get().n) : 0;
    const expectedAudit = hasTable('audit') ? Number(source.prepare('SELECT COUNT(*) AS n FROM audit').get().n) : 0;
    const expectedReviews = hasTable('reviews') ? Number(source.prepare('SELECT COUNT(*) AS n FROM reviews').get().n) : 0;
    const expectedOutbox = hasTable('outbox') ? Number(source.prepare('SELECT COUNT(*) AS n FROM outbox').get().n) : 0;
    source.close();

    target = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
      intMode: 'number'
    });
    await ensureTursoSchema(target);

    const count = async table => {
      const result = await target.execute('SELECT COUNT(*) AS n FROM ' + table);
      return Number(result.rows[0].n);
    };
    const currentCounts = {};
    for (const table of ['admin', 'settings', 'products', 'orders', 'reviews', 'deleted_products', 'audit', 'outbox']) {
      currentCounts[table] = await count(table);
    }

    if (Object.values(currentCounts).every(value => value === 0)) {
      console.log('Turso is empty. Importing the encrypted catalogue snapshot.');
      const child = spawnSync(process.execPath, [join(root, 'scripts/migrate-to-vercel.js')], {
        cwd: root,
        env: { ...process.env, DATA_DIR: dataDir },
        stdio: 'inherit'
      });
      if (child.error) throw child.error;
      if (child.status !== 0) throw new Error('TSCART archive migration failed with exit status ' + child.status + '.');
    } else {
      console.log('Turso already has records. Verifying whether this exact archive was imported previously.');
    }

    const verifyCatalogue = async () => {
      const actualProductIds = (await target.execute('SELECT id FROM products')).rows.map(row => String(row.id)).sort();
      const actualDeletedIds = (await target.execute('SELECT id FROM deleted_products')).rows.map(row => String(row.id)).sort();
      assert.deepEqual(actualProductIds, expectedProductIds, 'Turso product IDs do not match the uploaded archive.');
      assert.deepEqual(actualDeletedIds, expectedDeletedIds, 'Turso permanent-deletion records do not match the uploaded archive.');
      assert.equal(await count('orders'), expectedOrders, 'Turso order count does not match the uploaded archive.');
      assert.equal(await count('admin'), expectedAdmin, 'The existing admin account was not migrated.');
      assert.equal(await count('settings'), expectedSettings, 'The existing store settings were not migrated.');
      assert.equal(await count('audit'), expectedAudit, 'Audit history count does not match the uploaded archive.');
      assert.equal(await count('reviews'), expectedReviews, 'Review count does not match the uploaded archive.');
      assert.equal(await count('outbox'), expectedOutbox, 'Order outbox count does not match the uploaded archive.');
    };
    await verifyCatalogue();

    // Exercise the real delete code, then verify it through a separate DB client.
    const testId = 'migration-check-' + randomUUID();
    const testSlug = 'migration-check-' + randomUUID();
    const testProduct = {
      id: testId,
      slug: testSlug,
      name: 'Temporary Migration Check',
      category: 'Test',
      price: 100,
      description: 'Temporary product used to verify shared deletion.',
      details: '',
      material: '',
      badge: '',
      images: ['/assets/placeholder.svg'],
      featured: false,
      stock: 1,
      active: true
    };

    verificationClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
      intMode: 'number'
    });

    try {
      const writer = new TursoStore(target, process.env);
      const reader = new TursoStore(verificationClient, process.env);
      await writer.saveProduct(testProduct);
      await writer.deleteProduct(testId);

      assert.equal(await reader.product(testId), null, 'A fresh Turso client can still read the deleted product.');
      const tombstone = await reader.get('SELECT id FROM deleted_products WHERE id=?', [testId]);
      assert.ok(tombstone, 'The deletion tombstone was not visible to a fresh Turso client.');

      let recreationRejected = false;
      try {
        await reader.saveProduct(testProduct);
      } catch (error) {
        if (error.status === 409) recreationRejected = true;
        else throw error;
      }
      assert.ok(recreationRejected, 'The shared database allowed a permanently deleted product ID to be reused.');
    } finally {
      await verificationClient.execute({ sql: 'DELETE FROM products WHERE id=?', args: [testId] });
      await verificationClient.execute({ sql: 'DELETE FROM deleted_products WHERE id=?', args: [testId] });
      await verificationClient.execute({ sql: 'DELETE FROM audit WHERE entity=?', args: [testId] });
      await verificationClient.close();
      verificationClient = null;
    }

    await verifyCatalogue();
    console.log('TSCART migration verification passed.');
    console.log('Verified active products: ' + expectedProductIds.length + '.');
    console.log('Verified permanent-deletion tombstones: ' + expectedDeletedIds.length + '.');
    console.log('Verified orders, admin account, store settings, and audit history.');
    console.log('Verified deletion/read from separate Turso clients and rejected product-ID recreation.');
  } finally {
    if (verificationClient) {
      try { await verificationClient.close(); } catch {}
    }
    if (target) {
      try { await target.close(); } catch {}
    }
    await rm(workDir, { recursive: true, force: true });
    await unlink(migrationSecretOutput).catch(() => {});
  }
}
