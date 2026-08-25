'use strict';

// Storage for the shared split-check ledgers.
//
// A ledger is one JSONB document per group. Inside it, members and expenses are
// keyed maps rather than arrays, each record carrying a `rev` (the ledger
// version at which it last changed) and a `deleted` tombstone. That shape is
// what makes concurrent editing safe: a client only ever sends the records it
// itself touched, so two people adding different expenses at the same time both
// survive, and only a genuine edit of the *same* record resolves last-write-wins.
//
// `rev` is assigned by the server, never by the client, so client clock skew
// cannot reorder anything.

const { Pool } = require('pg');

const MAX_MEMBERS = 24;
const MAX_EXPENSES = 500;
const MAX_TEXT = 60;
const MAX_WON = 1e12;
const MODES = ['even', 'share', 'exact'];

let pool = null;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  // Neon serves a publicly trusted certificate, so the default verification is
  // both correct and secure here.
  const needsSsl = /sslmode=require|neon\.tech/.test(connectionString);
  pool = new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: true } : false,
    max: 3,
    // Neon's free compute sleeps after ~5 minutes idle; the first query after
    // that pays a wake-up cost, so allow room for it rather than failing.
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message);
  });
  return pool;
}

function isConfigured() {
  return !!process.env.DATABASE_URL;
}

async function init() {
  const p = getPool();
  if (!p) return false;
  await p.query(`
    create table if not exists ledgers (
      id         text primary key,
      version    bigint      not null default 0,
      doc        jsonb       not null default '{"members":{},"expenses":{}}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  return true;
}

// ---- validation -----------------------------------------------------------
// Everything arriving from a client is rebuilt field by field rather than
// stored as sent, so a malformed or oversized payload can never reach the doc.

function cleanText(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_TEXT);
}

function cleanId(v) {
  const s = String(v == null ? '' : v);
  return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : null;
}

function cleanWon(v) {
  const n = Math.round(Number(v));
  if (!isFinite(n) || n < 0 || n > MAX_WON) return 0;
  return n;
}

// id -> null | positive number. Null means "this payer covers an even share of
// whatever the named payers left over", which the client resolves at render time.
function cleanAmountMap(obj, allowNull) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  const keys = Object.keys(obj).slice(0, MAX_MEMBERS);
  for (const k of keys) {
    const id = cleanId(k);
    if (!id) continue;
    const raw = obj[k];
    if (raw == null) {
      if (allowNull) out[id] = null;
      continue;
    }
    const n = Math.round(Number(raw));
    if (!isFinite(n) || n < 0 || n > MAX_WON) continue;
    out[id] = n;
  }
  return out;
}

function cleanMember(m) {
  const id = m && cleanId(m.id);
  if (!id) return null;
  const ord = Number(m.ord);
  return {
    id,
    name: cleanText(m.name),
    ord: isFinite(ord) ? Math.max(0, Math.min(9999, Math.round(ord))) : 0,
  };
}

function cleanExpense(e) {
  const id = e && cleanId(e.id);
  if (!id) return null;
  const ts = Number(e.ts);
  return {
    id,
    title: cleanText(e.title),
    won: cleanWon(e.won),
    payers: cleanAmountMap(e.payers, true),
    mode: MODES.indexOf(e.mode) >= 0 ? e.mode : 'even',
    parts: cleanAmountMap(e.parts, false),
    ts: isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now(),
  };
}

// ---- materialise ----------------------------------------------------------
// The wire shape the client consumes: plain arrays, tombstones dropped.

function materialise(id, version, doc) {
  const members = Object.values(doc.members || {})
    .filter((m) => m && !m.deleted)
    .sort((a, b) => (a.ord - b.ord) || String(a.id).localeCompare(String(b.id)))
    .map((m) => ({ id: m.id, name: m.name }));

  const expenses = Object.values(doc.expenses || {})
    .filter((e) => e && !e.deleted)
    .sort((a, b) => (b.ts - a.ts) || String(b.id).localeCompare(String(a.id)))
    .map((e) => ({
      id: e.id, title: e.title, won: e.won,
      payers: e.payers, mode: e.mode, parts: e.parts, ts: e.ts,
    }));

  return { id, version: Number(version), members, expenses };
}

function emptyDoc() {
  return { members: {}, expenses: {} };
}

// ---- reads and writes -----------------------------------------------------

async function getLedger(id) {
  const p = getPool();
  const r = await p.query('select id, version, doc from ledgers where id = $1', [id]);
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return materialise(row.id, row.version, row.doc || emptyDoc());
}

async function createLedger(id, seed) {
  const p = getPool();
  const doc = emptyDoc();
  let version = 1;

  const members = Array.isArray(seed && seed.members) ? seed.members.slice(0, MAX_MEMBERS) : [];
  members.forEach((raw, i) => {
    const m = cleanMember({ ...raw, ord: i });
    if (m) doc.members[m.id] = { ...m, rev: version, deleted: false };
  });

  const expenses = Array.isArray(seed && seed.expenses) ? seed.expenses.slice(0, MAX_EXPENSES) : [];
  expenses.forEach((raw) => {
    const e = cleanExpense(raw);
    if (e) doc.expenses[e.id] = { ...e, rev: version, deleted: false };
  });

  await p.query(
    'insert into ledgers (id, version, doc) values ($1, $2, $3)',
    [id, version, JSON.stringify(doc)]
  );
  return materialise(id, version, doc);
}

// Applies one client's delta. Runs inside a transaction with the row locked, so
// two simultaneous pushes serialise instead of overwriting each other.
async function applyDelta(id, delta) {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('begin');
    const r = await client.query(
      'select id, version, doc from ledgers where id = $1 for update',
      [id]
    );
    if (!r.rows.length) {
      await client.query('rollback');
      return null;
    }

    const doc = r.rows[0].doc || emptyDoc();
    doc.members = doc.members || {};
    doc.expenses = doc.expenses || {};
    const version = Number(r.rows[0].version) + 1;

    const changed = delta.changed || {};
    const deleted = delta.deleted || {};

    (Array.isArray(changed.members) ? changed.members : []).slice(0, MAX_MEMBERS).forEach((raw) => {
      const m = cleanMember(raw);
      if (!m) return;
      if (!doc.members[m.id] && Object.keys(doc.members).length >= MAX_MEMBERS) return;
      doc.members[m.id] = { ...m, rev: version, deleted: false };
    });

    (Array.isArray(changed.expenses) ? changed.expenses : []).slice(0, MAX_EXPENSES).forEach((raw) => {
      const e = cleanExpense(raw);
      if (!e) return;
      if (!doc.expenses[e.id] && Object.keys(doc.expenses).length >= MAX_EXPENSES) return;
      doc.expenses[e.id] = { ...e, rev: version, deleted: false };
    });

    // Tombstones keep their id so a peer that still has the record learns it is
    // gone; everything else about the record is dropped.
    (Array.isArray(deleted.members) ? deleted.members : []).slice(0, MAX_MEMBERS).forEach((raw) => {
      const mid = cleanId(raw);
      if (mid && doc.members[mid]) doc.members[mid] = { id: mid, name: '', ord: 0, rev: version, deleted: true };
    });

    (Array.isArray(deleted.expenses) ? deleted.expenses : []).slice(0, MAX_EXPENSES).forEach((raw) => {
      const eid = cleanId(raw);
      if (eid && doc.expenses[eid]) doc.expenses[eid] = { id: eid, rev: version, deleted: true };
    });

    await client.query(
      'update ledgers set version = $2, doc = $3, updated_at = now() where id = $1',
      [id, version, JSON.stringify(doc)]
    );
    await client.query('commit');
    return materialise(id, version, doc);
  } catch (err) {
    try { await client.query('rollback'); } catch (_) { /* the connection is already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  init, isConfigured, getLedger, createLedger, applyDelta,
  MAX_MEMBERS, MAX_EXPENSES,
};
