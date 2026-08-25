'use strict';

// GET  /api/ledger/:id — the whole ledger
// POST /api/ledger/:id — apply one client's delta, returns the merged ledger

const { validGroupId, json, readBody, rateLimited, handler } = require('../_lib');

module.exports = handler(async (req, res, db) => {
  const id = req.query && req.query.id;
  if (!validGroupId(String(id || ''))) return json(res, 400, { error: 'bad-id' });

  if (req.method === 'GET') {
    if (rateLimited(req, 400, 60000)) return json(res, 429, { error: 'slow-down' });
    const out = await db.getLedger(id);
    if (!out) return json(res, 404, { error: 'not-found' });
    return json(res, 200, out);
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    if (rateLimited(req, 200, 60000)) return json(res, 429, { error: 'slow-down' });
    const out = await db.applyDelta(id, (await readBody(req)) || {});
    if (!out) return json(res, 404, { error: 'not-found' });
    return json(res, 200, out);
  }

  return json(res, 405, { error: 'method-not-allowed' });
});
