import { makeVercelHandler } from '../server/vercel-app.js';

let handlerPromise;

export default async function handler(req, res) {
  try {
    handlerPromise ||= makeVercelHandler();
    const app = await handlerPromise;
    return await app(req, res);
  } catch (error) {
    console.error('TSCART startup failed:', error.name, error.message);
    if (!res.headersSent) {
      res.writeHead(Number(error.status) || 503, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(JSON.stringify({ error: Number(error.status) ? error.message : 'TSCART storage is not configured. Check Turso and Vercel Blob environment variables.' }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

export const config = { api: { bodyParser: false } };
