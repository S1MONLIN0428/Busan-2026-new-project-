'use strict';

// POST /api/ledger — create a ledger, optionally seeded from the caller's
// local book so turning a private ledger into a shared one loses nothing.

const { newGroupId, json, readBody, rateLimited, handler } = require('../_lib');

module.exports = handler(async (req, res, db) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' });
  if (rateLimited(req, 10, 60000)) return json(res, 429, { error: 'slow-down' });

  const body = await readBody(req);
  const out = await db.createLedger(newGroupId(), body && body.seed);
  return json(res, 200, out);
});
