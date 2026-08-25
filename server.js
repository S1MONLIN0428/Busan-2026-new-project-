'use strict';

// Serves the itinerary and the shared-ledger API.
//
// The static side is a deliberate whitelist rather than a directory mount:
// project/uploads/ also holds spreadsheets and a 17MB scratch copy of the page,
// and none of that should be reachable over HTTP.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PORT = Number(process.env.PORT) || 8000;
const ROOT = path.join(__dirname, 'project', 'uploads');
const PAGE = path.join(ROOT, 'index.html');
const FONT_DIR = path.join(ROOT, 'fonts');
const MAX_BODY = 512 * 1024;

let dbReady = false;

// ---- helpers --------------------------------------------------------------

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }, headers || {}));
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function newGroupId() {
  // 16 bytes of randomness, url-safe. Unguessable is the only access control,
  // so this must come from a CSPRNG, never Math.random().
  return crypto.randomBytes(16).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function validGroupId(id) {
  return /^[A-Za-z0-9_-]{16,40}$/.test(id);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// A small fixed-window limiter. The link is unguessable, so this is only here so
// that a link which does leak cannot be used to hammer the free Neon compute.
const hits = new Map();
function rateLimited(req, limit, windowMs) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const slot = hits.get(ip);
  if (!slot || now - slot.start > windowMs) {
    hits.set(ip, { start: now, n: 1 });
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    }
    return false;
  }
  slot.n += 1;
  return slot.n > limit;
}

// ---- static ---------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

function serveFile(res, file, cache) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    send(res, 200, buf, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': cache || 'no-store',
    });
  });
}

// ---- api ------------------------------------------------------------------

async function handleApi(req, res, url) {
  if (!dbReady) {
    return sendJson(res, 503, { error: 'no-store', message: 'The server has no database configured.' });
  }

  // POST /api/ledger  -> create, optionally seeding from the caller's local book
  if (req.method === 'POST' && url.pathname === '/api/ledger') {
    if (rateLimited(req, 10, 60000)) return sendJson(res, 429, { error: 'slow-down' });
    const body = await readBody(req);
    const id = newGroupId();
    const out = await db.createLedger(id, body && body.seed);
    return sendJson(res, 200, out);
  }

  const m = url.pathname.match(/^\/api\/ledger\/([^/]+)$/);
  if (!m) return sendJson(res, 404, { error: 'not-found' });

  const id = decodeURIComponent(m[1]);
  if (!validGroupId(id)) return sendJson(res, 400, { error: 'bad-id' });

  if (req.method === 'GET') {
    if (rateLimited(req, 400, 60000)) return sendJson(res, 429, { error: 'slow-down' });
    const out = await db.getLedger(id);
    if (!out) return sendJson(res, 404, { error: 'not-found' });
    return sendJson(res, 200, out);
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    if (rateLimited(req, 200, 60000)) return sendJson(res, 429, { error: 'slow-down' });
    const body = await readBody(req);
    const out = await db.applyDelta(id, body || {});
    if (!out) return sendJson(res, 404, { error: 'not-found' });
    return sendJson(res, 200, out);
  }

  return sendJson(res, 405, { error: 'method-not-allowed' });
}

// ---- router ---------------------------------------------------------------

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch (e) {
    return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  if (url.pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, db: dbReady });
  }

  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, res, url).catch((err) => {
      const status = err.status || 500;
      if (status >= 500) console.error('[api]', err.message);
      sendJson(res, status, { error: status >= 500 ? 'server-error' : 'bad-request', message: err.message });
    });
  }

  // Fonts are content-addressed by name and never change, so they can be cached
  // hard; the page itself must not be, or a redeploy would not reach anyone.
  //
  // The page asks for them relatively ("fonts/x.woff2") so that it still works
  // opened straight off the filesystem. A share link at /g/<id> has no trailing
  // slash, so the browser drops the last segment and asks for /g/fonts/x.woff2;
  // with a trailing slash it would ask for /g/<id>/fonts/x.woff2. Both are
  // answered here rather than rewriting the page to absolute paths, which would
  // break the file:// case.
  const font = url.pathname.match(/^(?:\/g(?:\/[A-Za-z0-9_-]{1,40})?)?\/fonts\/([A-Za-z0-9._-]+\.woff2)$/);
  if (font) {
    const file = path.join(FONT_DIR, font[1]);
    if (!file.startsWith(FONT_DIR + path.sep)) return send(res, 400, 'Bad path');
    return serveFile(res, file, 'public, max-age=31536000, immutable');
  }

  const png = url.pathname.match(/^(?:\/g(?:\/[A-Za-z0-9_-]{1,40})?)?\/plane\.png$/);
  if (png) {
    return serveFile(res, path.join(ROOT, 'plane.png'), 'public, max-age=86400');
  }

  // The page itself answers for "/" and for every /g/<id> share link; the group
  // id is read from the URL by the client, so no server-side templating.
  if (url.pathname === '/' || /^\/g\/[A-Za-z0-9_-]{1,40}$/.test(url.pathname)) {
    return serveFile(res, PAGE);
  }

  return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
});

db.init()
  .then((ok) => {
    dbReady = !!ok;
    if (!ok) {
      console.warn('[db] DATABASE_URL is not set — the page will serve, but sharing a ledger is disabled.');
    } else {
      console.log('[db] connected, ledgers table ready');
    }
  })
  .catch((err) => {
    dbReady = false;
    console.error('[db] init failed:', err.message);
  })
  .finally(() => {
    server.listen(PORT, '0.0.0.0', () => console.log('listening on :' + PORT));
  });
