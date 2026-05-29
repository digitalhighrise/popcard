// ---------------------------------------------------------------------------
// Popcard local dev server (Windows-friendly alternative to `vercel dev`).
//
// WHY THIS EXISTS:
//   `vercel dev` runs each /api function through @vercel/fun, which spawns a
//   child process per invocation. On Windows + Node 24 that child-process
//   handling trips a fatal libuv assertion:
//     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c
//   …killing the dev server the moment any API route is hit. Static files
//   serve fine, but the dashboard calls /api/me + /api/config immediately, so
//   the whole thing falls over.
//
//   This server runs the SAME handler files IN-PROCESS (a normal dynamic
//   import + function call) so no child process is ever spawned and the
//   assertion never fires. It runs cleanly on Node 24.
//
// WHAT IT REPLICATES from the Vercel runtime:
//   - cleanUrls (/account -> account.html) and the /deck/:id rewrite
//   - req.query (parsed querystring), req.body (parsed JSON / raw string)
//   - res.status(code).json(obj) / res.send(data) helpers
//   - Range requests (206) so <video> mascots stream/seek correctly
//   - .env.local loading happens automatically via api/_lib/env.js on first
//     handler import (we chdir to the project root so it's always found).
//
// It is intentionally NOT a full Vercel emulator — it's a local harness for
// iterating on the static frontend + simple Node API handlers.
// ---------------------------------------------------------------------------

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
process.chdir(ROOT);                       // so api/_lib/env.js finds .env.local
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain; charset=utf-8',
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}

// Add the Vercel-style helpers the handlers expect onto a Node ServerResponse.
function augmentRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (data) => {
    if (data === null || data === undefined) { res.end(); return res; }
    if (Buffer.isBuffer(data) || typeof data === 'string') { res.end(data); return res; }
    if (typeof data === 'object') {
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(data));
      return res;
    }
    res.end(String(data));
    return res;
  };
  return res;
}

// ---- vercel.json rewrites (so local dev matches prod after consolidation) --
// Exact-match /api/* rewrites map a public path to a consolidated function +
// a ?_r= selector, e.g. /api/session -> /api/study?_r=session. We apply them
// here so the in-process dev server resolves the same handler Vercel would.
let API_REWRITES = null;
function loadApiRewrites() {
  if (API_REWRITES) return API_REWRITES;
  API_REWRITES = {};
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    for (const rw of cfg.rewrites || []) {
      if (!rw.source.startsWith('/api/') || rw.source.includes(':')) continue;
      const [destPath, destQs] = rw.destination.split('?');
      API_REWRITES[rw.source] = { path: destPath, query: destQs || '' };
    }
  } catch {}
  return API_REWRITES;
}

// ---- /api/* → run the matching handler file in-process -------------------
async function handleApi(req, res, urlObj) {
  // Apply an exact-match API rewrite if one exists for this path.
  const rw = loadApiRewrites()[urlObj.pathname];
  if (rw) {
    urlObj.pathname = rw.path;
    if (rw.query) new URLSearchParams(rw.query).forEach((v, k) => urlObj.searchParams.set(k, v));
  }
  let rel = urlObj.pathname.replace(/^\/+/, '').replace(/\/+$/, '');   // "api/me"
  // Don't expose helper/disabled dirs as routes.
  if (rel.includes('/_lib/') || rel.includes('/_disabled/')) {
    res.statusCode = 404; res.end('Not found'); return;
  }
  const filePath = path.resolve(ROOT, rel + '.js');
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Function not found: /' + rel }));
    return;
  }

  // req polyfills
  req.query = Object.fromEntries(urlObj.searchParams.entries());
  const raw = await readBody(req);
  const ctype = String(req.headers['content-type'] || '');
  if (raw.length === 0) {
    req.body = undefined;
  } else if (ctype.includes('application/json')) {
    try { req.body = JSON.parse(raw.toString('utf8')); }
    catch { req.body = raw.toString('utf8'); }
  } else {
    req.body = raw.toString('utf8');
  }

  augmentRes(res);

  try {
    // Cache-bust by mtime: unchanged files use the module cache; edited
    // handlers hot-reload without a server restart.
    const mtime = fs.statSync(filePath).mtimeMs;
    const mod = await import(pathToFileURL(filePath).href + '?t=' + mtime);
    const handler = mod.default;
    if (typeof handler !== 'function') {
      res.statusCode = 500;
      res.end('Handler has no default export: /' + rel);
      return;
    }
    await handler(req, res);
    if (!res.writableEnded) res.end();
  } catch (err) {
    console.error('[api] /' + rel + ' threw:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        error: 'Dev server: handler threw',
        detail: String((err && err.message) || err),
      }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

// ---- static files (cleanUrls + /deck/:id rewrite + range support) --------
function resolveStaticPath(pathname) {
  if (pathname === '/' || pathname === '') return path.join(ROOT, 'index.html');
  // /deck/:id  → deck.html (client reads the id from the URL, same as prod)
  if (/^\/deck\/[^/]+\/?$/.test(pathname)) return path.join(ROOT, 'deck.html');

  const rel = decodeURIComponent(pathname).replace(/^\/+/, '').replace(/\/+$/, '');
  const candidate = path.resolve(ROOT, rel);
  if (!candidate.startsWith(ROOT)) return null;                 // path traversal guard

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  if (fs.existsSync(candidate + '.html')) return candidate + '.html';   // cleanUrls
  const idx = path.join(candidate, 'index.html');
  if (fs.existsSync(idx)) return idx;
  return null;
}

function serveStatic(req, res, urlObj) {
  const filePath = resolveStaticPath(urlObj.pathname);
  if (!filePath) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><meta charset="utf-8"><title>404</title>' +
      '<body style="font-family:system-ui;padding:40px"><h1>404</h1><p><code>' +
      urlObj.pathname + '</code> not found on the dev server.</p>' +
      '<p><a href="/">← home</a></p>');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', mime);
  if (ext === '.html') res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  const range = req.headers.range;
  if (range && /^bytes=/.test(range)) {
    const [s, e] = range.replace(/bytes=/, '').split('-');
    let start = parseInt(s, 10);
    let end = e ? parseInt(e, 10) : stat.size - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1;
    if (start > end) { start = 0; end = stat.size - 1; }
    res.statusCode = 206;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(res);
  }
}

// ---- server --------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const started = Date.now();
  res.on('finish', () => {
    console.log(`${res.statusCode}  ${req.method}  ${urlObj.pathname}  ${Date.now() - started}ms`);
  });
  try {
    if (urlObj.pathname.startsWith('/api/')) {
      await handleApi(req, res, urlObj);
    } else {
      serveStatic(req, res, urlObj);
    }
  } catch (err) {
    console.error('[server] unhandled:', err);
    if (!res.headersSent) { res.statusCode = 500; res.end('Internal dev-server error'); }
    else if (!res.writableEnded) { res.end(); }
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Popcard dev server (in-process, no @vercel/fun)');
  console.log('  ▸ http://localhost:' + PORT);
  console.log('  ▸ Static files + /api/* handlers, range support, cleanUrls');
  console.log('');
});
