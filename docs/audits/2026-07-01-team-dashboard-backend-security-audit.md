# Team-Dashboard Backend Security Audit — VPS4 / api.coherencedaddy.com

> **Cluster:** security-audit · **Tags:** backend-audit, team-dashboard, vps4, fail-open-auth, sqli, ssrf, csrf, stripe-webhook, leaked-secrets, deployment-mode · **Related:** [Handoff](../2026-07-01-team-dashboard-security-audit-handoff.md), [Landing audit](../../../coherencedaddy-landing/docs/2026-07-01-security-and-hygiene-audit.md), [Landing remediation log](../../../coherencedaddy-landing/docs/2026-07-01-security-remediation.md), [Remediation log](2026-07-01-team-dashboard-backend-remediation.md)

**Date:** 2026-07-01 · **Audited commit:** `a53f14e0` (`origin/master`, production truth) · **Auditor:** automated multi-agent audit (15 finders × 2 adversarial verifiers) + human hand-verification of all Criticals and the systemic root cause.

---

## Executive summary

team-dashboard is the backend engine on **VPS4** serving `api.coherencedaddy.com`. It runs in production with **`PAPERCLIP_DEPLOYMENT_MODE=authenticated`** and **`PAPERCLIP_DEPLOYMENT_EXPOSURE=public`** (verified live via `docker inspect team-dashboard-server-1`). This posture is the crux of this audit's severity: the API is internet-reachable, and its auth model **fails open** — an anonymous request is assigned `actor.type='none'` and the request proceeds (`server/src/middleware/auth.ts:27,75`). Route protection is therefore **opt-in per route**, and several routes never opted in.

**The single most important structural fact:** the only middleware between `/api` and most route handlers is `boardMutationGuard` (`server/src/middleware/board-mutation-guard.ts:57-60`), which is a **CSRF-origin check for board sessions only** — it passes through (`next()`) any actor whose type is not `board`, including anonymous `none`. It is **not** authentication. Every route that relies on it alone for "protection" is anonymously reachable.

**Verified result:** 45 candidate findings → 3 refuted by adversarial verifiers → **42 confirmed/plausible survivors**: **3 Critical, 11 High, 10 Medium, 14 Low, 4 Info**. All 3 Criticals were hand-verified against the running production configuration.

### The 3 Criticals (all hand-verified, all live-exploitable unauthenticated over the internet)
1. **Unauthenticated destructive DB purge** — `POST /api/maintenance/retention-sweep/run-now` runs `runRetentionSweep(db)` with zero authz, irreversibly hard-deleting `social_posts` + soft-deleted `content_items` and blanking draft bodies. One anonymous, repeatable `curl` = data-loss DoS. (`server/src/routes/maintenance.ts:9`)
2. **Fully unauthenticated, cross-tenant Campaigns API** — all 6 `/api/campaigns` endpoints have no actor check and take `companyId` from client query/body. Anyone can create/list/rewrite/delete campaigns in **any** company. The file header comment falsely says "(authenticated)". (`server/src/routes/campaigns.ts:20`)
3. **Fail-open guard → unauthenticated paid-compute sinks** — because `boardMutationGuard` passes non-board actors, `POST /api/youtube/pipeline/run`, `/youtube/strategies/generate`, `/video-edit/jobs/:id/run`, and `/firecrawl/admin/run/:jobName` are anonymously callable, each driving Anthropic/Grok/ElevenLabs/Firecrawl spend and CPU → financial-DoS. (`server/src/middleware/board-mutation-guard.ts:58`)

### The most operationally-urgent High
- **~15 world-readable secret backups on VPS4** — `/opt/team-dashboard/*.env.production.bak-*` at `0644` (host-verified live; the current `.env.production` is correctly `0600`). Any non-root principal (the real `debian` uid-1000 account exists) can read live `STRIPE_SECRET_KEY`, all `STRIPE_WEBHOOK_SECRET*`, `DATABASE_URL`, `DISCORD_TOKEN`, `GITHUB_TOKEN`, `BETTER_AUTH_SECRET`, `PAPERCLIP_AGENT_JWT_SECRET`, `AFFILIATE_JWT_SECRET` (names verified; values never read). This is a local-read full-secret harvest → requires **chmod + secret rotation**. (finding #14)

### Reassuring results (design is genuinely strong here)
- **Admin impersonation (A.1):** cryptographically sound — board-admin-only minting, atomic single-use nonce burn, 5-min TTL, 256-bit entropy, HMAC-signed cookie with expiry inside the signed payload, read-only enforced on checked mutating routes. Two minor gaps only (nonce in URL, per-route read-only convention).
- **Portal magic-link / session core (A.5):** verified clean — GET is read-only, POST consume is atomically single-use, 15-min token TTL, 256-bit tokens, required ≥32-char signing secret (throws if unset — no hardcoded fallback), `timingSafeEqual`. No forge/replay/session-via-GET.
- **Shop paid-but-unfulfilled (A.3):** not a team-dashboard problem — the merch shop does not transact through this backend's Stripe (it's WooCommerce); there is no reconciler gap here to fix.
- **Git history is clean** — only `.env.example` was ever committed; `.env`/`.env.production` are gitignored. The feared "secrets in git history" leak does **not** exist.

---

## Methodology & honesty notes

- **Scope:** `origin/master` @ `a53f14e0` read in a detached worktree (the local checkout was on a 27-commit-stale branch missing whole subsystems — auditing it would have been auditing non-production code). Plus **read-only** SSH recon on VPS4 (`root@31.220.61.14`): no writes, no restarts, no secret values read.
- **Process:** 15 parallel finder agents by dimension → each finding independently re-checked by **2 adversarial verifiers** (an exploitability lens + a code-correctness lens) tasked to *refute*. Findings refuted by ≥1 correctness/2-refuters were dropped. All Criticals + the fail-open root cause were then **hand-verified by a human against the running prod container config**.
- **Verifier disagreements are preserved** in the findings below (e.g. #4 partner XSS: correctness held High, exploitability argued Medium because the homepage-banner sink isn't reachable from the attacker path).
- **Confidence labelling:** "CONFIRMED" = both verifiers upheld against re-read code; "PLAUSIBLE" = likely real, reachability not fully proven (mostly the two infra/host items and rate-limit-keying items).

---

## Findings — severity-ranked

Legend: **C**onsensus = CONFIRMED / PLAUSIBLE. Line numbers are @ `a53f14e0`.

### CRITICAL

| # | C | Title | Location |
|---|---|-------|----------|
| 1 | CONFIRMED | Unauth destructive DB purge (`retention-sweep/run-now`) | `server/src/routes/maintenance.ts:9` |
| 2 | CONFIRMED | Campaigns API fully unauth + cross-tenant (client `companyId`) | `server/src/routes/campaigns.ts:20` |
| 3 | CONFIRMED | `boardMutationGuard` fails open → unauth LLM/video/scrape sinks | `server/src/middleware/board-mutation-guard.ts:58` |

### HIGH

| # | C | Title | Location |
|---|---|-------|----------|
| 4 | CONFIRMED | Unauth create/update/DELETE of publicly-served partner directory rows | `server/src/routes/partner.ts:299` |
| 5 | CONFIRMED | Portal mutations protected only by `SameSite=Lax` + wildcard cookie `Domain` | `server/src/app.ts:442` |
| 6 | CONFIRMED | Stripe `intel-billing` replay mints NEW API key + re-emails (no idempotency) | `server/src/services/intel-billing.ts:278` |
| 7 | PLAUSIBLE | World-readable secret backups on VPS4 (source-dim view; see #14) | VPS4:`/opt/team-dashboard/` |
| 8 | CONFIRMED | Unauth full-read SSRF via `POST /api/repo-updates/run-audit` | `server/src/routes/repo-updates.ts:159` |
| 9 | CONFIRMED | Public unauth SSRF in `POST /api/public/audit` (weak IP blocklist, no DNS check) | `server/src/routes/audit.ts:134` |
| 10 | CONFIRMED | SQLi via `sql.raw()` in `PATCH /api/knowledge-graph/relationships/:id` | `server/src/routes/knowledge-graph.ts:209` |
| 11 | CONFIRMED | Moltbook admin routes have NO auth (and a whole class of siblings) | `server/src/routes/moltbook.ts:24` |
| 12 | CONFIRMED | Public free-tool rate limiters key on attacker-controlled `X-Forwarded-For` | `server/src/routes/answer-check.ts:47` |
| 13 | CONFIRMED | `multer@2.1.1` DoS via nested multipart field names (CVE-2026-5079) | `server/package.json:75` |
| 14 | CONFIRMED | ~15 world-readable `.env.production.bak*` (host-verified live) | VPS4:`/opt/team-dashboard/.env.production.bak-*` |

### MEDIUM

| # | C | Title | Location |
|---|---|-------|----------|
| 15 | CONFIRMED | Impersonation nonce not identity-bound + delivered in URL query | `server/src/routes/watchtower-admin.ts:371` |
| 16 | CONFIRMED | `POST /api/portal/auth` login / session-fixation CSRF | `server/src/routes/portal.ts:661` |
| 17 | CONFIRMED | (dup of #16 from A.5 dimension) | `server/src/routes/portal.ts:661` |
| 18 | CONFIRMED | Media-drop file endpoint serves objects with no auth | `server/src/routes/media-drop.ts:280` |
| 19 | CONFIRMED | `.gitignore` misses `.env.bak*` / `.env.*` (backup committable) | `.gitignore:1` |
| 20 | CONFIRMED | `docker inspect` exposes full live secret set in container `Env` | `docker-compose.production.yml:6` |
| 21 | CONFIRMED | Prompt-injection: Moltbook posts → LLM → auto-published (no human gate) | `server/src/services/moltbook-engine.ts:494` |
| 22 | PLAUSIBLE | `express-rate-limit` likely mis-keyed (`trust proxy` unset) | `server/src/app.ts:202` |
| 23 | CONFIRMED | Expensive Firecrawl work in unmetered GET stream | `server/src/routes/audit.ts:1243` |
| 24 | PLAUSIBLE | World-readable `.env.frontend` (0644) on VPS4 | VPS4:`/opt/team-dashboard/.env.frontend` |

### LOW / INFO (condensed — full detail in the audit digest)

| # | Sev | Title | Location |
|---|-----|-------|----------|
| 25 | Low | Read-only-under-impersonation is a per-route convention (fail-open on new routes) | `server/src/routes/portal.ts:204` |
| 26 | Low | `logoUrl`/`website` not scheme-validated on partner create/update | `server/src/routes/partner.ts:350` |
| 27 | Low | Unauth `intel_companies` stub creation via public enroll | `server/src/routes/directory-listings.ts:302` |
| 28 | Low | Portal session mutations rely solely on `SameSite=Lax` | `server/src/routes/portal.ts:107` |
| 29 | Low | CORS unanchored `/localhost/` reflects attacker origins | `server/src/app.ts:212` |
| 30 | Low | `requireContentKey` = single shared static env secret | `server/src/routes/media-drop.ts:19` |
| 31 | Low | Raw-body Stripe webhooks mounted before rate limiter | `server/src/app.ts:217` |
| 32 | Low | CreditScore replay re-triggers audit + welcome email | `server/src/services/creditscore.ts:407` |
| 33 | Low | Directory-listings replay re-sends welcome email | `server/src/services/directory-listings.ts:611` |
| 34 | Low | Authenticated stored SSRF via Nitter instance URL | `server/src/services/nitter-health.ts:62` |
| 35 | Low | Firecrawl call uses hardcoded `'Bearer self-hosted'` | `server/src/services/firecrawl-sync.ts:63` |
| 36 | Low | Secret-redaction filter incomplete vs real env key set | `server/src/services/moltbook-engine.ts:26` |
| 37 | Low | `nodemailer@8.0.5` advisory (not reachable) | `package.json:85` |
| 38 | Low | `undici` matches HIGH advisories, low exposure | `pnpm-lock.yaml:7179` |
| 39 | Info | Nonce exchange endpoint intentionally outside board guard (by design) | `server/src/app.ts:442` |
| 40 | Info | Shop fulfillment is outside team-dashboard Stripe (WooCommerce) | `docs/architecture/org-structure.md:153` |
| 41 | Info | Moltbook engine runs in-process with full host env (no sandbox) | `server/src/services/moltbook-engine.ts:11` |
| 42 | Info | `vite@6.4.2` dev-server advisory (dev-only, Windows) | `ui/package.json:72` |

**Dedup:** #7 and #14 are the same VPS4 secret-backup issue (#14 is the host-verified canonical). #16 and #17 are the same portal-auth CSRF finding from two dimensions.

---

## Backend-gated verdicts (closes the landing audit's open items A.1–A.5)

| Item | Verdict | Summary |
|------|---------|---------|
| **A.1** Admin-impersonation nonce discipline | **PARTIAL — safe core, 2 minor gaps** | Mint/exchange is cryptographically sound (board-only, atomic single-use, 5-min TTL, 256-bit, HMAC-signed expiry, read-only enforced). Gaps: nonce carried in URL query + not identity-bound (#15, Med); read-only is a per-route convention (#25, Low). *Blind spot:* the storefront SPA that consumes `?nonce=` was not read (Referer/history leakage unverified). |
| **A.2** Partner/company attacker-submittable + sanitization | **VULNERABLE** | Unauth create/update/DELETE of publicly-served partner rows, no sanitization anywhere in these files, default `status='trial'` makes rows immediately public (#4, High). *Blind spot:* the JSON-LD/HTML/email **sink** is in the storefront repo (out of scope) — fields are confirmed attacker-submittable/unsanitized at the backend, but whether they become executable XSS depends on storefront output encoding (why exploitability downgraded #4 to Medium). |
| **A.3** Shop paid-but-unfulfilled reconciliation | **SAFE within this repo** | Exhaustive grep + trace: the merch shop does not transact through team-dashboard's Stripe; no shop reconciler exists here because there is no shop Stripe flow (merch = WooCommerce). No fix needed here. *Blind spot:* end-to-end WooCommerce behavior confidence is MEDIUM (based on this repo's own doc, not Woo source). |
| **A.4** CSRF on state-changing portal/admin endpoints | **VULNERABLE (portal); board side SAFE** | Board routes are protected by `boardMutationGuard`'s Origin/Referer check. Portal is not: every `cd_portal_session` mutation relies solely on `SameSite=Lax` + wildcard `Domain=.coherencedaddy.com`, no token/Origin/Referer/custom-header (#5, High; #16 Med; #28 Low). Any same-site `*.coherencedaddy.com` foothold → account-takeover CSRF. *Blind spot:* prod `PORTAL_COOKIE_DOMAIN` value not runtime-confirmed. |
| **A.5** Portal magic-link / session flow | **SAFE (token/session core)** | Verified clean: GET is read-only, POST consume is atomically single-use, 15-min TTL, 256-bit token, required ≥32-char signing secret (throws if unset), `timingSafeEqual`, no forge/replay/session-via-GET. Only the CSRF caveats above remain. *Blind spot:* inbound verification of `CREDITSCORE_CALLBACK_KEY`-signed member-login/unsubscribe tokens lives storefront-side (only outbound signing is here, and looks correct). |

---

## Prioritized remediation checklist

**P0 — deploy ASAP (unauth internet-exploitable):**
- [ ] #1 `maintenance.ts` — require instance-admin; attach `logAdminAccess` (mirror `system-crons.ts`).
- [ ] #2 `campaigns.ts` — `assertBoard` + `assertCompanyAccess`; derive `companyId` from actor, not client.
- [ ] #3 + #11 — fail-close the whole unauth route class: `youtube.ts`, `firecrawl-admin.ts`, `video-edit.ts`, `moltbook.ts`, `auto-reply.ts`, `launch-monitor.ts` — router-level auth (instance-admin for POST/mutations).
- [ ] #8 `repo-updates.ts` — add auth + SSRF-harden `auditUrl` (http/https-only, reject private/loopback/link-local/CGNAT, revalidate redirects).
- [ ] #9 `audit.ts /public/audit` — post-DNS-resolution IP validation, block `169.254/16`, `100.64/10`, `0.0.0.0`, IPv4-mapped v6; pin to validated IP; `redirect:manual`.
- [ ] #10 `knowledge-graph.ts` — coerce+bind `confidence`/`verified`, use `db.update().set()` (kill `sql.raw`); fail-**closed** on missing `CONTENT_API_KEY`.

**P0 — VPS4 host (needs SSH write + secret rotation — OWNER CHECKPOINT):**
- [ ] #14/#7 — `chmod 600` all `.env*` backups, `chmod 700` the dir, relocate/prune backups.
- [ ] #14 — **ROTATE** every secret that sat in a `0644` backup: `BETTER_AUTH_SECRET`, `PAPERCLIP_AGENT_JWT_SECRET`, `AFFILIATE_JWT_SECRET`, all `STRIPE_WEBHOOK_SECRET*`, `STRIPE_SECRET_KEY`, `DISCORD_TOKEN`, `GITHUB_TOKEN`, `DATABASE_URL` creds. (High blast radius — coordinate; see remediation log.)

**P1 — high, deploy same cycle:**
- [ ] #4 partner — board/admin guard on writes; scheme-validate `logoUrl`; don't auto-publish self-created rows.
- [ ] #5 portal CSRF — Origin/Referer allowlist (reject Origin ≠ `https://app.coherencedaddy.com`) on unsafe portal methods.
- [ ] #6 intel-billing — idempotency on Stripe `session.id` + a processed-events table (mirror `university-referrals`).
- [ ] #12 rate-limit — stop parsing raw XFF; `app.set('trust proxy', 1)` + `req.ip`.
- [ ] #13 multer — bump override to `>=2.2.0`, re-lock.

**P2 — medium/low:** #15–#38 per table (idempotency on other webhooks, `.gitignore` fix #19, CORS anchor #29, Nitter SSRF #34, redaction completeness #36, dep bumps #37/#38).

---

## Coverage limits / residual blind spots

- **Storefront repo out of scope.** The XSS/JSON-LD sinks (A.2), the impersonation-nonce consumer SPA (A.1), and inbound `CREDITSCORE_CALLBACK_KEY` token verification (A.5) live in `coherencedaddy-landing` and were not audited here. Their backend-side halves are characterized; the sink-side behavior is not.
- **Two findings are infra, not code** (#7/#14 host perms, #24 `.env.frontend`) — host-verified via read-only SSH for #14, but current secret *validity* was not measured (only key names read, never values).
- **Rate-limit keying (#22)** depends on the deployed `trust proxy` / `PAPERCLIP_TRUST_PROXY` setting, inferred not runtime-confirmed.
- **WooCommerce/Hostinger shop** (A.3) not reachable from VPS4 recon; conclusion rests on this repo's own docs.
- Live behavioral testing (actual malicious requests against prod) was **not** performed — findings are from static analysis + config inspection, not exploitation.

---

*Sibling remediation log: [2026-07-01-team-dashboard-backend-remediation.md](2026-07-01-team-dashboard-backend-remediation.md). This audit closes the backend-gated items in the landing remediation log.*
