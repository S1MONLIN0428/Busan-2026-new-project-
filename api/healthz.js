'use strict';

// Reports whether the database is actually reachable, not merely configured —
// the whole point is to distinguish "deployed but DATABASE_URL is wrong" from
// "working", which is otherwise invisible until someone tries to share a book.

const { json } = require('./_lib');

module.exports = async (req, res) => {
  const db = require('../db');
  if (!db.isConfigured()) return json(res, 200, { ok: true, db: false, reason: 'DATABASE_URL not set' });
  try {
    await db.ensureReady();
    return json(res, 200, { ok: true, db: true });
  } catch (err) {
    return json(res, 200, { ok: true, db: false, reason: String(err && err.message).slice(0, 200) });
  }
};
