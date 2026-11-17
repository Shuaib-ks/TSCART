import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TursoStore } from '../server/turso-store.js';
import { seedProducts } from '../server/seed.js';

class SqliteExecutor {
  constructor(db) { this.db = db; }

  async execute(query) {
    const sql = typeof query === 'string' ? query : query.sql;
    const args = typeof query === 'string' ? [] : (query.args || []);
    const statement = this.db.prepare(sql);
    if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)) {
      return { rows: statement.all(...args), rowsAffected: 0 };
    }
    const result = statement.run(...args);
    return { rows: [], rowsAffected: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }
}

class SqliteTursoMock extends SqliteExecutor {
  async transaction() {
    this.db.exec('BEGIN IMMEDIATE');
    const transaction = new SqliteExecutor(this.db);
    transaction.commit = async () => this.db.exec('COMMIT');
    transaction.rollback = async () => this.db.exec('ROLLBACK');
    return transaction;
  }

  async close() { this.db.close(); }
}

function openStore(path, env) {
  return new TursoStore(new SqliteTursoMock(new DatabaseSync(path)), env);
}

test('shared-store deletion commits a tombstone and survives a fresh connection', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tscart-turso-'));
  const database = join(directory, 'shared.sqlite');
  const env = { ORDER_SECRET: 'a'.repeat(64), STORE_MODE: 'demo' };
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const first = openStore(database, env);
  await first.initialize();
  const source = { ...seedProducts[0], id: 'p-turso-test-delete', slug: 'turso-delete-test' };
  await first.saveProduct({ ...source, images: [source.image], stock: 4, active: true });
  assert.equal((await first.product(source.id)).id, source.id);

  await first.deleteProduct(source.id);
  assert.equal(await first.product(source.id), null);
  const tombstone = await first.get('SELECT id FROM deleted_products WHERE id=?', [source.id]);
  assert.equal(tombstone.id, source.id);
  await first.close();

  const second = openStore(database, env);
  await second.initialize();
  assert.equal(await second.product(source.id), null);
  assert.equal((await second.products(true)).some(product => product.id === source.id), false);
  await assert.rejects(
    second.saveProduct({ ...source, images: [source.image], stock: 4, active: true }),
    /permanently deleted/
  );
  await second.close();
});

test('a deliberately empty deleted catalogue is not reseeded on a fresh connection', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tscart-turso-empty-'));
  const database = join(directory, 'shared.sqlite');
  const env = { ORDER_SECRET: 'b'.repeat(64), STORE_MODE: 'demo' };
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const first = openStore(database, env);
  await first.initialize();
  for (const product of await first.products(true)) await first.deleteProduct(product.id);
  assert.equal((await first.products(true)).length, 0);
  await first.close();

  const second = openStore(database, env);
  await second.initialize();
  assert.equal((await second.products(true)).length, 0);
  await second.close();
});

test('a stale independent connection cannot recreate a product after another connection permanently deletes it', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tscart-turso-stale-'));
  const database = join(directory, 'shared.sqlite');
  const env = { ORDER_SECRET: 'c'.repeat(64), STORE_MODE: 'demo' };
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const writer = openStore(database, env);
  await writer.initialize();
  const source = { ...seedProducts[0], id: 'p-turso-stale-delete', slug: 'turso-stale-delete' };
  await writer.saveProduct({ ...source, images: [source.image], stock: 2, active: true });

  // Keep this second connection open and initialized before the deletion. It must
  // consult the shared database rather than relying on a stale in-process catalogue.
  const stale = openStore(database, env);
  await stale.initialize();
  assert.equal((await stale.product(source.id)).id, source.id);

  await writer.deleteProduct(source.id);

  await assert.rejects(
    stale.saveProduct({ ...source, images: [source.image], stock: 2, active: true }),
    /permanently deleted/
  );
  assert.equal(await stale.product(source.id), null);
  assert.ok(await stale.get('SELECT id FROM deleted_products WHERE id=?', [source.id]));

  await stale.close();
  await writer.close();

  const restarted = openStore(database, env);
  await restarted.initialize();
  assert.equal(await restarted.product(source.id), null);
  assert.equal((await restarted.products(true)).some(product => product.id === source.id), false);
  await assert.rejects(
    restarted.saveProduct({ ...source, images: [source.image], stock: 2, active: true }),
    /permanently deleted/
  );
  await restarted.close();
});
