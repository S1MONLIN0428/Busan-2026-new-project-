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
The 分帳 tab runs in one of three modes, decided by the URL:

- plain URL over http(s) — the default shared book (`DEFAULT_LEDGER_ID` in
  `db.js`, mirrored as `SP_DEFAULT` in the page; the two must match). Shared
  from first paint, with no create step, because that is what people expect
  from a link someone sent them.
- `/g/<id>` — a separate shared book, reachable only by its unguessable link
- `file://` — no origin to talk to, so local `localStorage` book as before

The default ledger is created on first touch, on both the read and the write
path (a client can push before its first read lands). Every other id must
already exist, so nobody can fill the table by requesting random ids.

Amount fields must never use `inputmode="none"` — that is only correct for the
`data-fx` fields in 換算, which are `readonly` and driven by the page's own
keypad. Anywhere else it leaves a phone with no keyboard at all.

Production is Vercel: the `api/` functions at the repo root handle the ledger,
and `build.js` copies this page plus its fonts into a gitignored `public/`.
`server.js` is the same thing as a single always-on Node process — useful
locally and on any non-serverless host. Both go through `db.js`, so they behave
identically. Storage is Postgres (Neon) — see `DEPLOY.md` at the repo root.

Because assets are referenced relatively, a share link needs three route
rewrites, not one: `/g/<id>` serves the page, and both `/g/fonts/*` (no
trailing slash on the link) and `/g/<id>/fonts/*` (trailing slash) must map
back to the real fonts. These live in `vercel.json`, mirrored in `server.js`.

Polling rate is deliberate, not arbitrary: each check is a billed Vercel
invocation, so `spPollPeriod()` backs off from 4s to 30s as the book goes quiet
and `spTick()` stops altogether when the tab is hidden. `spTouch()` resets it —
call it from anything that should make sync responsive again.

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
