import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';
import { put } from '@vercel/blob';
import { readFile, access } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureTursoSchema } from '../server/turso-store.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = resolve(root, process.env.DATA_DIR || 'data');
const sqlitePath = join(dataDir, 'tscart.sqlite');
const secretPath = join(dataDir, 'order-secret');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Connect Turso and Vercel Blob, then run vercel env pull .env.local.`);
  return value;
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function tableRows(db, name) {
  if (!tableExists(db, name)) return [];
  return db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all();
}

function collectLocalUploads(value, output = new Set()) {
  if (typeof value === 'string') {
    const match = /^\/uploads\/([a-zA-Z0-9-]+\.(?:jpg|jpeg|png|webp|gif|mp4|webm|mp3|wav))$/i.exec(value);
    if (match) output.add(match[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) collectLocalUploads(item, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectLocalUploads(item, output);
  }
  return output;
}

function rewriteUploads(value, urlMap) {
  if (typeof value === 'string') {
    const match = /^\/uploads\/([a-zA-Z0-9-]+\.(?:jpg|jpeg|png|webp|gif|mp4|webm|mp3|wav))$/i.exec(value);
    return match ? urlMap.get(match[1]) || value : value;
  }
  if (Array.isArray(value)) return value.map(item => rewriteUploads(item, urlMap));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteUploads(item, urlMap)]));
  }
  return value;
}

function contentType(filename) {
  return ({
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
  })[extname(filename).toLowerCase()] || 'application/octet-stream';
}

async function migrate() {
  if (!existsSync(sqlitePath)) throw new Error(`Local database not found: ${sqlitePath}`);
  if (!existsSync(secretPath)) throw new Error(`Order-link secret not found: ${secretPath}. Restore your original data/order-secret before migrating.`);

  const url = required('TURSO_DATABASE_URL');
  const authToken = required('TURSO_AUTH_TOKEN');
  const blobToken = required('BLOB_READ_WRITE_TOKEN');
  const orderSecret = (await readFile(secretPath, 'utf8')).trim();
  if (orderSecret.length < 32) throw new Error('The existing data/order-secret is invalid; refusing to change private order links.');

  const source = new DatabaseSync(sqlitePath);
  const target = createClient({ url, authToken, intMode: 'number' });

  try {
    await ensureTursoSchema(target);
    const existing = {};
    for (const table of ['admin', 'settings', 'products', 'orders', 'reviews', 'events', 'sessions', 'limits', 'deleted_products', 'audit', 'outbox']) {
      const result = await target.execute(`SELECT COUNT(*) AS total FROM ${table}`);
      existing[table] = Number(result.rows[0].total);
    }
    if (Object.values(existing).some(count => count > 0)) {
      throw new Error('The connected Turso database is not empty. Migration stopped without changing its records. Use a new empty Turso database or back it up and clear it intentionally first.');
    }

    const refs = new Set();
    for (const table of ['products', 'orders']) {
      for (const row of tableRows(source, table)) {
        try { collectLocalUploads(JSON.parse(row.data), refs); } catch {}
      }
    }

    const urlMap = new Map();
    const uploadDir = join(dataDir, 'uploads');
    for (const filename of refs) {
      const localPath = join(uploadDir, filename);
      try { await access(localPath); }
      catch { throw new Error(`The database references /uploads/${filename}, but that file is missing from data/uploads. Migration stopped before importing database rows.`); }
      const data = await readFile(localPath);
      const blob = await put(`tscart-migrated/${randomUUID()}-${basename(filename)}`, data, {
        access: 'public',
        addRandomSuffix: true,
        token: blobToken,
        contentType: contentType(filename),
        cacheControlMaxAge: 31536000
      });
      urlMap.set(filename, blob.url);
      console.log(`Uploaded legacy media: ${filename}`);
    }

    const deleted = new Map();
    if (tableExists(source, 'audit')) {
      const entries = source.prepare("SELECT entity,MAX(created) AS deleted_at FROM audit WHERE action='product_deleted' AND entity IS NOT NULL AND entity<>'' GROUP BY entity").all();
      for (const entry of entries) deleted.set(entry.entity, Number(entry.deleted_at) || Date.now());
    }
    if (tableExists(source, 'deleted_products')) {
      for (const entry of tableRows(source, 'deleted_products')) deleted.set(entry.id, Number(entry.deleted_at) || Date.now());
    }

    const tx = await target.transaction('write');
    let imported = {};
    try {
      for (const [id, deletedAt] of deleted) {
        await tx.execute({ sql: 'INSERT OR IGNORE INTO deleted_products(id,slug,deleted_at) VALUES(?,?,?)', args: [id, '', deletedAt] });
      }

      const importTables = ['settings', 'admin', 'orders', 'products', 'reviews', 'events', 'audit', 'outbox'];
      for (const table of importTables) {
        if (!tableExists(source, table)) continue;
        const columns = source.prepare(`PRAGMA table_info("${table}")`).all().map(column => column.name);
        if (!columns.length) continue;
        const rows = tableRows(source, table);
        let count = 0;
        for (const original of rows) {
          if (table === 'products' && deleted.has(original.id)) continue;
          if (table === 'reviews' && deleted.has(original.product_id)) continue;
          const row = { ...original };
          if (['products', 'orders'].includes(table) && typeof row.data === 'string') {
            row.data = JSON.stringify(rewriteUploads(JSON.parse(row.data), urlMap));
          }
          const values = columns.map(column => row[column] ?? null);
          const statement = `INSERT OR IGNORE INTO "${table}" (${columns.map(column => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
          await tx.execute({ sql: statement, args: values });
          count++;
        }
        imported[table] = count;
      }
      await tx.commit();
    } catch (error) {
      try { await tx.rollback(); } catch {}
      throw error;
    }

    const checks = {};
    for (const table of ['admin', 'settings', 'products', 'orders', 'reviews', 'deleted_products', 'audit', 'outbox']) {
      const result = await target.execute(`SELECT COUNT(*) AS total FROM ${table}`);
      checks[table] = Number(result.rows[0].total);
    }
    const expectedProducts = (tableRows(source, 'products')).filter(row => !deleted.has(row.id)).length;
    if (checks.products !== expectedProducts) throw new Error(`Post-migration product count mismatch: expected ${expectedProducts}, found ${checks.products}. Do not deploy until this is investigated.`);

    const envOutput = `ORDER_SECRET=${orderSecret}\n`;
    writeFileSync(join(root, '.vercel-migration.env'), envOutput, { mode: 0o600 });
    console.log('\nTSCART data migration completed.');
    console.log('Imported rows:', JSON.stringify(imported));
    console.log('Remote verification:', JSON.stringify(checks));
    console.log('Old admin sessions and rate-limit counters were intentionally not migrated. Sign in again after deploying.');
    console.log('Your existing order-link signing secret was saved privately to .vercel-migration.env. Add it to Vercel as ORDER_SECRET; do not commit or share that file.');
    console.log('Your local SQLite database was not modified.');
  } finally {
    source.close();
    await target.close();
  }
}

migrate().catch(error => {
  console.error('Migration stopped:', error.message);
  process.exitCode = 1;
});
