# Deploying to Vercel

This puts the itinerary online so the 分帳 tab can be edited by several people
at once. Written assuming you have not used Neon or Vercel before.

Cost: nothing. Vercel's Hobby plan is free with **no credit card**, and Neon's
free tier covers a ledger this size many times over.

---

## What you are setting up

```
GitHub  ──push──▶  Vercel  ──SQL──▶  Neon
 (code)            (runs it)         (stores the ledger)
```

- **GitHub** holds the code. Pushing is what triggers a redeploy.
- **Vercel** serves the page from its CDN and runs the three small functions in
  `api/` that read and write the ledger.
- **Neon** is the Postgres database where the ledger actually lives.

The database is a separate service because Vercel functions are stateless —
they start, answer one request, and vanish. Nothing written to their filesystem
survives, and nothing ever travels back to GitHub. Neon is the only part that
remembers.

---

## Step 1 — The code is already on GitHub

Nothing to do if you pushed already. Otherwise:

```bash
git add -A
git commit -m "Vercel deploy"
git push -u origin main
```

---

## Step 2 — Create the Neon database

1. Go to <https://neon.com> and sign up (GitHub login works, no card needed).
2. **Create project**. Any name — e.g. `busan`.

   **Match the region to Vercel, not to yourself.** Every query is a
   server-to-server hop from Vercel's function, so the database belongs next to
   Vercel. Your own distance costs one request per page load, which barely
   matters by comparison. Vercel's default function region is
   **Washington, D.C. (iad1)**, so unless you change it in step 3:

   | Vercel function region | Neon region |
   | --- | --- |
   | Washington, D.C. `iad1` (default) | `AWS us-east-1` |
   | Frankfurt `fra1` | `AWS eu-central-1` |
   | Singapore `sin1` | `AWS ap-southeast-1` |

   A Neon project's region cannot be changed later. If you already made one in
   the wrong region, create a second and delete the first — there is nothing in
   it yet.

3. On the **Connect** panel, copy the connection string. Use the **pooled** one
   — the hostname contains `-pooler`. That matters here: it routes through
   Neon's PgBouncer, which is what lets many short-lived serverless functions
   share a small set of real Postgres connections instead of exhausting them.

   ```
   postgresql://neondb_owner:npg_xxxx@ep-cool-name-a1b2c3-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

4. **Treat that string as a password.** It grants full access to the database.
   Do not commit it, and do not paste it into a chat. It is not in this repo and
   must not be added to it.

> There is nothing to create inside the database. The first request creates the
> `ledgers` table itself.

---

## Step 3 — Create the Vercel project

1. Go to <https://vercel.com> and sign up with GitHub.
2. **Add New → Project**, then import `Busan-2026-new-project-`.
3. Framework preset: **Other**. Leave the build settings alone — `vercel.json`
   already specifies the build command and output directory.
4. Expand **Environment Variables** and add:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | the pooled Neon string from step 2 |

   Leave it applied to all three environments. Do **not** add a `PORT`.

5. **Deploy.**

That's it — there is no instance to size, no region to pick for the site
itself, and nothing that sleeps.

> If you would rather not manage the connection string by hand, Vercel can
> create and wire up a Neon database for you: project → **Storage** → **Neon**.
> It sets `DATABASE_URL` automatically. Use either approach, not both.

### Changing the function region (optional)

Project → **Settings** → **Functions** → **Function Region**. Only worth doing
if you put Neon somewhere other than `us-east-1`; they should match.

---

## Step 4 — Check it worked

Open `https://<your-project>.vercel.app/healthz`:

```json
{"ok":true,"db":true}
```

- `"db":true` — connected to Neon. Sharing works.
- `"db":false` — the response includes a `reason`. The itinerary still serves
  and the 分帳 tab still works as a local book; only sharing is off. Usually the
  `DATABASE_URL` is missing, or was pasted with a stray space or quote.

---

## Step 5 — Use it

There is no setup step. Open the site, go to the **分帳** tab, and you are
already in the shared book. Send anyone the site address and they are editing
the same one — no link to generate, nothing to press first.

Changes appear on other phones within a few seconds.

**複製連結** is there only to save you typing the address out.

---

## How the sharing behaves

**Access.** For the shared book everyone lands on, the site's own address is the
key: anyone who can reach the site can read and edit it. That is the trade for
having it work with no setup, and for a private trip ledger among friends it is
usually the right trade — but it does mean the address is worth keeping to the
group rather than posting publicly.

If you ever want a book that is *not* reachable that way, `/g/<id>` links still
work and are separate ledgers with their own contents. One can be created with:

```bash
curl -X POST https://<your-project>.vercel.app/api/ledger
```

which returns an `id`; open `/g/<that-id>`. Those ids are 128 bits of
randomness, so the link itself is the key and cannot be guessed.

**Concurrent edits.** Each phone sends only the entries it changed itself, so
two people adding different expenses at the same moment both land. If two people
edit *the same* expense, the later save wins — the server decides the order, so
a phone with a wrong clock cannot reorder anything.

**Offline.** Edits made with no signal are kept and pushed automatically when
the connection returns; the status line reads 離線 · 已存本機，恢復後自動同步
meanwhile. Nothing is lost and nothing blocks.

**Typing.** An update arriving from someone else never steals the field you are
typing in — the refresh waits until you leave it.

**Without a share link**, the tab behaves as it always did: the book lives in
that one browser. Opening `project/uploads/index.html` straight off disk still
works with no server at all.

---

## Usage, and why the page does not poll constantly

Hobby gives 1,000,000 function invocations a month. Each sync check is one
invocation, so the page varies its rate by what is actually happening:

| Situation | Rate | Per open tab |
| --- | --- | --- |
| 分帳 in front, just edited | every 4s | ~960/hour |
| 分帳 in front, quiet 2–10 min | every 10s | ~360/hour |
| 分帳 in front, quiet >10 min | every 30s | ~120/hour |
| Another tab in front | every 30s | ~120/hour |
| Tab hidden or phone locked | stopped | 0 |

Six people settling up for an hour is under 6,000 invocations. Even a tab left
open and forgotten settles to ~2,900/day. You are unlikely to get close to the
limit.

Hobby is for non-commercial personal use, which a private trip itinerary is.

---

## Redeploying

Push to `main`. Vercel rebuilds automatically. The ledger is untouched by
deploys — it lives in Neon, not in the deployment.

---

## Running it locally

```bash
npm install
DATABASE_URL='postgresql://...' npm start   # http://localhost:8000
```

`server.js` is a plain Node server that serves the same page and the same API.
It is what the project used before Vercel, it is handy for local work, and it
will run on any host that can keep a Node process alive. Vercel does not use it
— there the `api/` functions do the same job.

Without `DATABASE_URL` the server still starts and serves the itinerary; only
sharing is switched off.

---

## Limits worth knowing

| Thing | Limit |
| --- | --- |
| Members per ledger | 24 |
| Expenses per ledger | 500 |
| Name / title length | 60 characters (truncated, not rejected) |
| Request body | 512 KB |

Ledger reads and writes are also rate limited per IP, but on Vercel that is
best-effort only: each function instance counts separately, so it catches a
burst rather than enforcing a global ceiling. The unguessable link and Vercel's
own DDoS protection are what actually stand in front of the API.
