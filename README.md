# 釜山 · 2026

A single-page trip itinerary for Busan, plus a split-check ledger (分帳) that
several people can edit at the same time.

Live at <https://new-test-project-s1monlin0428.vercel.app/> — opening it is
enough to be in the shared ledger, so that address is the key to it.

> The `-s1monlin0428` suffix is the Vercel scope slug, added because the project
> name alone was already claimed. `.vercel.app` subdomains are globally unique,
> so renaming the project to something distinctive is what drops the suffix.

## Layout

```
server.js               the whole server: serves the page and the ledger API
                        POST /api/ledger          create a ledger
                        GET|POST /api/ledger/:id  read / apply a delta
                        GET /healthz              is the database reachable
db.js                   Postgres storage and the concurrent-edit merge
build.js                copies the page + fonts into public/ for Vercel
vercel.json             build settings and the /g/<id> rewrites
project/uploads/
  index.html            the itinerary — the only page, hand-written
  fonts/                self-hosted Noto Serif (Latin / TC / KR)
```

`server.js` is the deployment's entrypoint, not a dev convenience: Vercel looks
for a server file in the project root and runs it as a live HTTP server. Renaming
or removing it breaks the build with `No entrypoint found`, and `package.json`'s
`"main"` must keep pointing at it.

`project/uploads/index.html` is canonical. `build.js` copies it into `public/`
at deploy time, and `public/` is gitignored — so there is never a second copy of
the page to drift out of sync.

`project/uploads/index.html` also opens straight off the filesystem with no
server at all — asset paths are relative so that this keeps working. That is the
only way to run it locally; there is no local server in the repo.

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

Vercel's free Hobby plan, building from GitHub on every push to `main`, with a
free Neon Postgres database. The database is separate because Vercel's functions
are stateless — nothing they write survives the request.

One environment variable is required: `DATABASE_URL`, set on the Vercel project
to Neon's **pooled** connection string (the hostname containing `-pooler`).
Without it the itinerary still serves and 分帳 falls back to a local
single-browser book; `/healthz` reports `{"ok":true,"db":false}` with a reason.
Put Neon in the same region as Vercel's functions — every query is a
server-to-server hop, so a mismatch costs far more than your own distance does.

To keep within the free invocation budget the page varies its sync rate: every
4s while someone is entering a bill, backing off to 30s once the book has been
still, and stopping entirely when the tab is hidden.
