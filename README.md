# 釜山 · 2026

A single-page trip itinerary for Busan, plus a split-check ledger (分帳) that
several people can edit at the same time.

## Layout

```
server.js               HTTP server: serves the page and the ledger API
db.js                   Postgres storage and the concurrent-edit merge
project/uploads/
  index.html            the itinerary — the only page, hand-written
  fonts/                self-hosted Noto Serif (Latin / TC / KR)
DEPLOY.md               step-by-step Neon + Koyeb setup
```

There is no build step. `server.js` serves `project/uploads/index.html`
directly, so the page has exactly one copy.

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

Two modes, decided by the URL:

- **plain URL or `file://`** — the book lives in that one browser
  (`localStorage`), exactly as it always did
- **`/g/<id>`** — the book lives on the server and everyone holding the link
  edits it together

Tap **建立共用帳本** to turn a local book into a shared one; it carries over what
you already had and hands you a link.

Each client pushes only the records it changed itself, so two people adding
different expenses at the same moment both survive; only edits to the same
expense resolve last-write-wins, ordered by the server rather than by client
clocks. Edits made offline are kept and pushed on reconnect, and an update
arriving from someone else never steals the field you are typing in.

Access is by unguessable link alone — treat the link as the ledger itself.

## Deploying

See [DEPLOY.md](DEPLOY.md). Runs on Koyeb's free instance with a free Neon
Postgres database; the database is separate because Koyeb's container has no
durable disk.
