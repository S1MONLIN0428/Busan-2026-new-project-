# Project notes

## Canonical source file
`uploads/index.html` is the only itinerary file. Make all edits there.

It is a hand-written standalone page: 460px design width, all lengths in rem
scaled by `html { font-size: clamp(7px, 3.4783vw, 16px) }`, self-hosted fonts in
`uploads/fonts/`, data in the `DAYS` array inside the inline `<script>`.

The page still opens straight off the filesystem with no server. Everything
except the shared ledger works that way, and it must stay that way — asset paths
are relative for exactly this reason (the server answers the `/g/<id>` variants
rather than the page using absolute paths).

## Shared split-check ledger
The 分帳 tab runs in one of two modes, decided by the URL:

- plain URL or `file://` — local book, `localStorage` only, as before
- `/g/<id>` — shared book on the server, edited by everyone holding the link

Server code lives at the repo root (`server.js`, `db.js`) and serves
`uploads/index.html` directly; there is no build step and no copy of the page.
Storage is Postgres (Neon) — see `DEPLOY.md` at the repo root.

Sync model: a client pushes only the records it changed itself, so concurrent
edits to *different* expenses both survive and only same-record edits resolve
last-write-wins. Ordering is stamped by the server, never the client. The
relevant client functions are `spDiff` / `spApplyDelta` / `spAdopt`; the server
merge is `applyDelta` in `db.js`.

Two invariants worth preserving when editing the split code:
- `spSave()` is what marks the book dirty and schedules a push — mutations that
  skip it will not sync.
- Repaints go through `spRepaintSafe()`, which defers while a field has focus so
  a remote update cannot steal the caret.

## Stale files
`vercel/index.html` predates the 分帳 tab and is not used by the Koyeb
deployment. `uploads/index-e7bb791c.html` is a 17MB scratch copy. Neither is
served.
