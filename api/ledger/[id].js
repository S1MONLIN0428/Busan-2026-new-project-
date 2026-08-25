'use strict';

// GET  /api/ledger/:id — the whole ledger
// POST /api/ledger/:id — apply one client's delta, returns the merged ledger
//
// The default ledger is created on first touch rather than requiring anyone to
// make it, so opening the site is all it takes to start sharing. Every other id
// must already exist — otherwise a stranger could fill the table by asking for
// ids at random.

const { validGroupId, json, readBody, rateLimited, handler } = require('../_lib');

module.exports = handler(async (req, res, db) => {
  const id = String((req.query && req.query.id) || '');
  if (!validGroupId(id)) return json(res, 400, { error: 'bad-id' });
  const isDefault = id === db.DEFAULT_LEDGER_ID;

  if (req.method === 'GET') {
    if (rateLimited(req, 400, 60000)) return json(res, 429, { error: 'slow-down' });
    let out = await db.getLedger(id);
    if (!out && isDefault) out = await db.ensureLedger(id);
    if (!out) return json(res, 404, { error: 'not-found' });
    return json(res, 200, out);
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    if (rateLimited(req, 200, 60000)) return json(res, 429, { error: 'slow-down' });
    const body = (await readBody(req)) || {};
    let out = await db.applyDelta(id, body);
    // A client can push before its first read has landed, so the default ledger
    // has to be creatable from this direction too.
    if (!out && isDefault) {
      await db.ensureLedger(id);
      out = await db.applyDelta(id, body);
    }
    if (!out) return json(res, 404, { error: 'not-found' });
    return json(res, 200, out);
  }

  return json(res, 405, { error: 'method-not-allowed' });
});
