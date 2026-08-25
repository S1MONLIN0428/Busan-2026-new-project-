# Deploying to Koyeb

This turns the itinerary into a small web service so the 分帳 tab can be edited
by several people at once. Written assuming you have not used Neon or Koyeb
before — every step is spelled out.

Total cost: nothing. Both free tiers are enough for a six-person trip ledger.

---

## What you are setting up

```
GitHub  ──push──▶  Koyeb  ──SQL──▶  Neon
 (code)            (runs it)        (stores the ledger)
```

Three separate things, and it matters that they are separate:

- **GitHub** holds the code. Pushing here is what triggers a redeploy.
- **Koyeb** runs `server.js`, serves the page, and talks to the database.
- **Neon** is the Postgres database where the ledger actually lives.

The database has to be its own service because Koyeb's container has no durable
disk: its free instance sleeps after an hour of no traffic and starts again from
the image, so anything the server wrote to a file would be gone. Writes never
travel back to GitHub either. Neon is the only part of this that remembers.

---

## Step 1 — Push the code to GitHub

From the repo:

```bash
git add -A
git commit -m "Add server and shared split-check ledger"
git push -u origin main
```

---

## Step 2 — Create the Neon database

1. Go to <https://neon.com> and sign up (GitHub login works; no card needed).
2. Click **Create project**. Any name is fine — e.g. `busan`. Pick the region
   closest to you; `AWS ap-southeast-1 (Singapore)` is the nearest to Taiwan.
3. When the project opens you land on a **Connect** panel with a connection
   string. Click the copy button. It looks like:

   ```
   postgresql://neondb_owner:npg_AbCd1234@ep-cool-name-a1b2c3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

   If you closed the panel: **Dashboard → Connect** re-opens it.

4. Keep that string somewhere for the next step. **Treat it as a password** —
   it grants full access to the database. Do not commit it or paste it into a
   chat. It is not in this repo and must not be added to it.

> There is nothing to create inside the database. The server creates its own
> `ledgers` table on first start.

---

## Step 3 — Create the Koyeb service

1. Go to <https://app.koyeb.com> and sign up.
2. **Create Service → GitHub**, authorise Koyeb, and pick this repository.
   Branch `main`.
3. Koyeb detects Node automatically and will run `npm start`. Leave the builder
   as **Buildpack**; you do not need the Dockerfile option.
4. **Instance type**: `Free`.
5. **Environment variables** — click *Add variable*:

   | Name           | Type   | Value                                  |
   | -------------- | ------ | -------------------------------------- |
   | `DATABASE_URL` | Secret | the Neon string you copied in step 2   |

   Choose the **Secret** type, not Plain, so the value is not shown in logs or
   the build output.

   Do **not** set `PORT`. Koyeb provides it and the server reads it.

6. **Health check**: set the HTTP path to `/healthz`. (Optional but useful —
   it reports whether the database actually connected.)
7. Click **Deploy** and wait for the build to go green.

---

## Step 4 — Check it worked

Open `https://<your-app>.koyeb.app/healthz`. You want:

```json
{"ok":true,"db":true}
```

- `"db":true` — connected to Neon, sharing works.
- `"db":false` — `DATABASE_URL` is missing or wrong. The itinerary still serves
  and the 分帳 tab still works locally, but the 建立共用帳本 button will report
  that sharing is unavailable. Check the service logs and the variable.

---

## Step 5 — Start a shared ledger

1. Open the site, go to the **分帳** tab.
2. Tap **建立共用帳本**. The page moves to a URL like
   `https://<your-app>.koyeb.app/g/V1okENA99cYCgMf-dLHwLw`, carrying over
   whatever was already in your local book.
3. Tap **複製連結** and send that link to the others. Anyone who opens it is
   editing the same ledger.

Changes show up on other phones within a few seconds. The status line under the
rate reads 共用中 · 同步於 HH:MM when synced.

---

## How the sharing behaves

**Access.** The link is the only key — 128 bits of randomness, not guessable —
so anyone holding it can read and edit the ledger, and anyone without it cannot
find it. Treat the link like the ledger itself. There is no separate password,
which was the deliberate choice: it matches how Lightsplit group links work.

**Concurrent edits.** Each phone sends only the entries it changed itself, so
two people adding different expenses at the same moment both land. If two people
edit *the same* expense, the later save wins — the server decides the order, so
a phone with a wrong clock cannot reorder anything.

**Offline.** Edits made with no signal are kept on the phone and pushed
automatically when the connection returns; the status line says
離線 · 已存本機，恢復後自動同步 meanwhile. Nothing is lost and nothing blocks.

**Typing.** An update arriving from someone else never steals the field you are
typing in — the refresh is held until you leave it.

**Without a share link**, the tab behaves exactly as it always did: the book
lives in that one browser only. Opening `index.html` straight off disk still
works completely offline.

---

## First load is slow, and that's expected

Both free tiers sleep when idle:

- Koyeb's free instance sleeps after **1 hour** without traffic; the next
  request cold-starts in 1–5 seconds.
- Neon's free compute sleeps after **5 minutes** idle and wakes on the next
  query.

So the first open after a quiet spell can take a few seconds. Everything after
that is fast. Neither can be disabled on the free plans.

---

## Redeploying

Push to `main`. Koyeb rebuilds automatically. The ledger is untouched by
deploys — it is in Neon, not in the container.

---

## Running it locally

```bash
npm install
DATABASE_URL='postgresql://...' PORT=8000 npm start
# then open http://localhost:8000
```

Without `DATABASE_URL` the server still starts and serves the itinerary; only
sharing is switched off.

---

## Limits worth knowing

| Thing | Limit | Why |
| --- | --- | --- |
| Members per ledger | 24 | |
| Expenses per ledger | 500 | |
| Name / title length | 60 characters | truncated, not rejected |
| Request body | 512 KB | |
| Ledger reads | 400/min per IP | a leaked link cannot hammer the database |
| Ledger writes | 200/min per IP | |
| New ledgers | 10/min per IP | |

Rate-limited requests make the page show 離線 briefly; it retries on its own.

---

## Note on the `project/vercel/` folder

That folder is an **older copy of the page from before the 分帳 tab existed**,
left over from an earlier deployment plan. Koyeb serves
`project/uploads/index.html` directly, so `project/vercel/` is not used by any
of this and is now misleading. Delete it when you are sure you don't want it.
