'use strict';

// Shared by the Vercel functions under api/. The domain logic all lives in
// db.js, which server.js uses too — these wrappers only deal with HTTP.

const crypto = require('crypto');

function newGroupId() {
  // Unguessable is the only access control, so this must come from a CSPRNG.
  return crypto.randomBytes(16).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function validGroupId(id) {
  return /^[A-Za-z0-9_-]{16,40}$/.test(id);
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(obj));
}

// Vercel parses JSON bodies itself when the content-type says so, but a raw
// body still turns up for some clients, so handle both.
function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body || '{}')); } catch (e) { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 512 * 1024) { req.destroy(); resolve({}); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// Best-effort only. Each warm instance keeps its own counter, so this catches a
// burst hitting one instance but is not a global limit — Vercel's own DDoS
// protection and the unguessable link are what actually stand in front of this.
const hits = new Map();
function rateLimited(req, limit, windowMs) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const slot = hits.get(ip);
  if (!slot || now - slot.start > windowMs) {
    hits.set(ip, { start: now, n: 1 });
    if (hits.size > 2000) {
      for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    }
    return false;
  }
  slot.n += 1;
  return slot.n > limit;
}

// Every function body is wrapped in this: it turns a missing DATABASE_URL into
// a clear 503 rather than a stack trace, and keeps errors off the wire.
function handler(fn) {
  return async (req, res) => {
    const db = require('../db');
    if (!db.isConfigured()) {
      return json(res, 503, { error: 'no-store', message: 'The server has no database configured.' });
    }
    try {
      await db.ensureReady();
      await fn(req, res, db);
    } catch (err) {
      console.error('[api]', err && err.message);
      json(res, 500, { error: 'server-error' });
    }
  };
}

module.exports = { newGroupId, validGroupId, json, readBody, rateLimited, handler };
