# Coherent Ones University — LOCAL DEMO (isolated, synthetic)

Your **real** University stack, running entirely on this machine against a **throwaway
database**, populated with **15 synthetic members**, plus the **staff member-admin** built
into your team-dashboard. Nothing here touches Neon / production / live Stripe.

> Everything is synthetic: members use `@synthetic.local` emails, the DB is a disposable
> Docker container, Stripe keys are placeholders, the email scheduler is off. Safe to poke,
> break, cancel, or delete. To nuke it all: see **Teardown** below.

---

## 3 things are running

| What | URL | Login |
|---|---|---|
| **Member portal** (what a member sees) | http://localhost:3001/university | Paste a member cookie — see below |
| **Staff dashboard → University admin** | http://localhost:5173/CD/university | None needed (local mode = auto-admin) |
| Backend API (the real monolith) | http://localhost:3100 | — |

### Log into the member portal — ONE CLICK
> ⚠️ The email magic-link does NOT work here — this demo has no mail server (it's fully
> offline) and the real cookie is scoped to a prod domain. Use the page below instead.

**Open → http://localhost:3001/dev-login.html** and click a member:
- **Maya Okafor** (active) — the normal member experience
- **Nadia** (past-due) — see the past-due / billing state
- **Kai Thompson** (cancelled) — the cancelled-member experience

It sets a real session cookie and drops you into the University. Click **Community** to see
the 15 members posting to each other, plus Curriculum, Sessions, Billing. (Use `localhost`,
not `127.0.0.1` — cookies + CORS are set up for `localhost`.) There's a **Sign out** link on
that page to switch members.

### Staff admin (no login)
Just open http://localhost:5173 → click **University** in the left sidebar (under the COMPANY
section). You'll see all 15 members, status filters, search, the recovery pipeline (the 4
at-risk members), and per-member **Cancel / Reactivate / Refund**. A cancel here instantly
removes that member's access in the portal — try it: cancel someone, then refresh their
portal view.

---

## What's where (all throwaway, nothing merged or deployed)

- **Backend + dashboard** worktree: `/Users/exe/Downloads/Claude/_wt/uni-local-demo`
  (branch `demo/uni-local-2026-06-20`, off `feat/university-backend-integration` with
  `feat/university-community-backend` + `feat/university-sessions-backend` merged in).
- **Portal frontend** worktree: `/Users/exe/Downloads/Claude/_wt/uni-portal-demo`
  (branch `demo/uni-portal-local`, off `feat/university-presence-content` with
  `feat/university-community-portal` + `feat/university-sessions-portal` merged in).
- **Database**: Docker container `uni-demo-pg` — `pgvector/pgvector:pg16` on `localhost:5441`,
  DB `uni_demo`, all 128 migrations applied, seeded with 15 synthetic members + 18 community
  posts. Pure throwaway.
- The **only** new application code I wrote is the staff admin
  (`server/src/routes/university-admin.ts`, `ui/src/pages/UniversityAdmin.tsx`,
  `ui/src/api/university-admin.ts`) + 4 small wiring edits (`app.ts`, `App.tsx`, `Sidebar.tsx`,
  `lib/company-routes.ts`). Everything else is your existing branches, assembled.

## Start / stop the servers

```bash
# DB (already running; start if stopped)
docker start uni-demo-pg

# Backend (port 3100)
cd /Users/exe/Downloads/Claude/_wt/uni-local-demo
set -a; . ./.env; set +a
pnpm dev:server

# Staff dashboard UI (port 5173)
cd /Users/exe/Downloads/Claude/_wt/uni-local-demo
pnpm dev:ui

# Member portal (port 3001)
cd /Users/exe/Downloads/Claude/_wt/uni-portal-demo
npm run dev
```

Re-seed the synthetic members anytime:
```bash
cd /Users/exe/Downloads/Claude/_wt/uni-local-demo
node --env-file=.env node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs scripts/seed-synthetic-university.ts
```

## Teardown (remove everything)

```bash
docker rm -f uni-demo-pg                                  # delete the throwaway DB
# stop the 3 dev servers (Ctrl-C or: lsof -ti:3100,3001,5173 | xargs kill)
git -C /Users/exe/Downloads/Claude/team-dashboard worktree remove --force /Users/exe/Downloads/Claude/_wt/uni-local-demo
git -C /Users/exe/Downloads/Claude/app-coherencedaddy-portal worktree remove --force /Users/exe/Downloads/Claude/_wt/uni-portal-demo
git -C /Users/exe/Downloads/Claude/team-dashboard branch -D demo/uni-local-2026-06-20
git -C /Users/exe/Downloads/Claude/app-coherencedaddy-portal branch -D demo/uni-portal-local
```

Your real branches and prod are untouched throughout.

## Notes
- The `PORTAL_SESSION_SECRET` in `.env` is a throwaway local value — do not reuse it anywhere real.
- Refund in the admin is a demo no-op (there's no university payments table to write to) — it
  returns "refund recorded (demo)". Cancel/Reactivate are real DB writes and reflect in the portal.
- To productionize any of this (the staff admin especially), it goes through your normal
  branch → review → deploy flow; this demo is branch-only and was never merged or deployed.
