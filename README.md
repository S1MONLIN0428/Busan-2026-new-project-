# 釜山 · 2026

A single-page trip itinerary for Busan, plus a split-check ledger (分帳) that
several people can edit at the same time.

## Layout

```
api/                    Vercel functions — what runs in production
  ledger/index.js         POST /api/ledger        create a ledger
  ledger/[id].js          GET|POST /api/ledger/:id  read / apply a delta
  healthz.js              GET /healthz            is the database reachable
  _lib.js                 shared HTTP helpers
db.js                   Postgres storage and the concurrent-edit merge
server.js               plain Node server — local dev, or any always-on host
build.js                copies the page + fonts into public/ for Vercel
vercel.json             build settings and the /g/<id> rewrites
project/uploads/
  index.html            the itinerary — the only page, hand-written
  fonts/                self-hosted Noto Serif (Latin / TC / KR)
DEPLOY.md               step-by-step Neon + Vercel setup
```

`project/uploads/index.html` is canonical. `build.js` copies it into `public/`
at deploy time, and `public/` is gitignored — so there is never a second copy of
the page to drift out of sync. Both `server.js` and the `api/` functions call
into the same `db.js`, so the sync behaviour is identical either way.

## Running locally

```bash
npm install
DATABASE_URL='postgresql://...' npm start   # http://localhost:8000
```

`DATABASE_URL` is optional. Without it the itinerary still serves and the 分帳
tab works as a local, single-browser book; only sharing is switched off.

`project/uploads/index.html` also opens straight off the filesystem with no
server at all — asset paths are relative so that this keeps working.

## The 分帳 tab

Served over http(s) the tab is shared from the moment it opens — no button, no
link to generate. Everyone who reaches the site is editing the same book.

- **the site itself** — the default shared ledger, created on first use
- **`/g/<id>`** — a separate shared ledger, reachable only by its unguessable
  link (`POST /api/ledger` returns a new one)
- **`file://`** — no server to talk to, so the book stays in that one browser
  (`localStorage`), exactly as it always did

Each client pushes only the records it changed itself, so two people adding
different expenses at the same moment both survive; only edits to the same
expense resolve last-write-wins, ordered by the server rather than by client
clocks. Edits made offline are kept and pushed on reconnect, and an update
arriving from someone else never steals the field you are typing in.

For the default book the site's address is the key; for a `/g/<id>` book the
link is. Neither has a separate password.

## Deploying

See [DEPLOY.md](DEPLOY.md). Runs on Vercel's free Hobby plan with a free Neon
Postgres database. The database is separate because Vercel's functions are
stateless — nothing they write survives the request.

To keep within the free invocation budget the page varies its sync rate: every
4s while someone is entering a bill, backing off to 30s once the book has been
still, and stopping entirely when the tab is hidden.
