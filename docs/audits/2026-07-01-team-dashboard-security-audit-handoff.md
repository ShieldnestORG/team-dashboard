# Handoff — Security-audit the team-dashboard backend (the "other server")

> **SUPERSEDED (2026-07-07):** the audit this handoff requested is DONE. Canonical docs: [backend security audit](2026-07-01-team-dashboard-backend-security-audit.md) + [remediation log](2026-07-01-team-dashboard-backend-remediation.md). This file is retained for historical context only.

> **Cluster:** security-audit · **Tags:** handoff, backend-audit, team-dashboard, vps4, stripe-webhook, admin-impersonation, csrf, leaked-secrets, backend-gated · **Related:** [Backend security audit](2026-07-01-team-dashboard-backend-security-audit.md), [Backend remediation log](2026-07-01-team-dashboard-backend-remediation.md), [Landing audit](../../../coherencedaddy-landing/docs/2026-07-01-security-and-hygiene-audit.md), [Landing remediation log](../../../coherencedaddy-landing/docs/2026-07-01-security-remediation.md), [deploy/production.md](../deploy/production.md), [deploy/vps-cheat-sheet.md](../deploy/vps-cheat-sheet.md), [api/intel.md](../api/intel.md)

**For:** the next agent. **Written:** 2026-07-01. **Ask:** run a thorough, adversarially-verified security audit of **team-dashboard** (the backend engine on VPS4) and close the items the landing/portal audit could not.

---

## Why this exists

On 2026-07-01 a double-verified security audit + full remediation was completed for the **public-facing** apps — `coherencedaddy-landing` (storefront/API) and `app-coherencedaddy-portal` (thin frontend). All code-actionable findings are fixed and **live in production**. See the two landing docs linked above.

But that audit **explicitly could not cover `team-dashboard`** — it lives out of tree (VPS4) and is the actual backend-bearing engine (Stripe webhooks, entitlements, admin, portal session minting, intel/agents, the embedding relationship). Multiple landing findings were tagged **"backend-gated"**: their real severity or closure depends on team-dashboard behavior that was never inspected. **team-dashboard has not been security-audited.** That's this job.

## Ground rules (read first)

- **AUDIT FROM `origin/master`, NOT the local working tree.** The local checkout (`/Users/exe/Downloads/Claude/team-dashboard`) is on a stale feature branch (`fix/partner-mentions-attribution`) that diverges from production. The landing audit got this wrong at first — review `git fetch && origin/master`. (This lesson is also in owner memory.)
- **This is the owner's own infrastructure — authorized.** SSH access exists from this machine: `root@31.220.61.14` (VPS4) and `root@31.220.61.12` (VPS1). Recon **read-only first**; never casually restart the prod API (see below).
- **Restarting `team-dashboard-server-1` = a brief blip on `api.coherencedaddy.com`** (creditscore/intel/portal all flow through it). Batch any change that needs a restart; verify health after.
- Mirror the landing audit's **method**: parallel finder agents by dimension → **two independent adversarial verifiers per finding** (correctness lens + exploitability lens) → hand-verify anything Critical. Report in the same format (Critical/High/Med/Low/Info + prioritized fix checklist + honest coverage limits).

## Infrastructure map (verified 2026-07-01)

| Box | Address | Role |
|-----|---------|------|
| **VPS4** | `31.220.61.14` (tailnet `100.65.70.18`) | **team-dashboard prod** — `api.coherencedaddy.com`, Docker Compose at `/opt/team-dashboard`, deploys from git `master` via SSH (`git pull && docker compose up -d --build`). `.env.production` holds the live secrets. |
| **VPS1** | `31.220.61.12` (tailnet `100.67.128.51`) | LLM/scrape stack — Firecrawl `:3002`, **BGE-M3 embeddings `:8080` (now Bearer-enforced, tailnet-only as of 2026-07-01)**, Ollama `:11434`. Tailnet-only bind. |
| VPS2 | `168.231.127.180` | handed off — do not reference |
| VPS3 | `147.79.78.251` | DEAD since 2026-05-09 + was XMRig-compromised |

Repo: `github.com/ShieldnestORG/team-dashboard`, prod branch `master`. Deploy/SSH details: `docs/deploy/production.md` + `docs/deploy/vps-cheat-sheet.md`.

## Must-cover scope

### A. Close the landing audit's backend-gated items
1. **Admin-impersonation safety** (portal `/admin/impersonate` rests entirely on this backend). Verify the nonce minting: admin-only? single-use? short-TTL? unguessable? server-enforced read-only? Read the impersonation route handlers (`server/src/routes/*`); test with a non-admin session + a replayed/expired nonce.
2. **Are partner/company fields attacker-submittable?** This decides landing findings #21/#22 (JSON-LD) severity (Low vs stored-XSS Medium). Inspect the write paths behind `/api/partner-directory/featured` and `/api/intel/company/*` — is there a self-serve submission form, and is field content sanitized before storage/serving?
3. **Shop fulfillment reconciliation.** No Stripe webhook exists in landing (by design); fulfillment rides the buyer's `success_url` return. Confirm team-dashboard reconciles a **paid-but-never-returned** Stripe session against actual Printify order creation (otherwise paid orders silently never ship).
4. **CSRF on state-changing portal endpoints.** The cross-subdomain session cookie is `SameSite=Lax`, `Domain=.coherencedaddy.com`, `credentials:'include'`. Verify CSRF defenses on all mutating portal/admin endpoints.
5. **Portal magic-link / session flow** (backend-owned). `GET /api/portal/auth?token=` is meant to be read-only (preview interstitial); the `POST` consumes + sets `cd_portal_session`. Verify: single-use consumption, short TTL, unguessable tokens, secure cookie flags set server-side, and that a GET truly can't burn the token.

### B. Fresh full audit of team-dashboard itself
- **Route authorization** across all `server/src/routes/*` — which endpoints mutate state or expose data with no/weak auth? (Same fail-open patterns the landing audit found.)
- **Stripe webhook signature verification** (`STRIPE_WEBHOOK_SECRET` exists) — confirm every webhook verifies the signature; check for replay/idempotency.
- **Leaked secrets — HIGH PRIORITY.** Committed/untracked `.env.bak*` files carry plaintext secrets. `.env.bak.pre-university-admins` had the embedding key (scrubbed 2026-07-01) but **likely holds MORE live secrets** (DB, Stripe, Anthropic, Grok, Discord, GitHub, etc. — see the `moltbook-engine.ts` secret-regex for the full set). Audit ALL `.env.bak*` on disk **and git history**; rotate anything exposed.
- **SSRF** in the scrape/Firecrawl paths and any URL-fetching route.
- **SQL injection** across query builders (landing used parameterized neon templates — confirm team-dashboard does too).
- **Embedding client** now sends `Authorization: Bearer $EMBED_API_KEY` to VPS1 (Bearer-enforced) — confirm no other caller still uses the old `X-API-Key` header.
- **Agent/plugin system** (moltbook, agents/*) — sandboxing, secret redaction, prompt-injection surface.
- **Rate limiting / cost controls** on any LLM- or paid-API-backed endpoint.
- **Dependency CVEs** (`npm/pnpm audit`), and the **dual-lockfile hazard** — portal tracked both `package-lock.json` + `pnpm-lock.yaml` (fixed there); check team-dashboard for the same.
- **Secret-management hygiene** on VPS4 (`.env.production` perms, backups, docker secret exposure via `docker inspect`).

## Deliverables
1. A team-dashboard security-audit report in the same format as the landing audit (severity-ranked, adversarially verified, honest coverage limits).
2. Explicit **verdicts on A.1–A.5** so the landing audit's backend-gated items can finally be marked closed (update `coherencedaddy-landing/docs/2026-07-01-security-remediation.md` → "Still backend-gated" section).
3. Remediation (mirroring the landing session: fail-closed shared helpers, verified deploys, rollback safety, docs + memory updates).

## Known leads already surfaced (starting points, not the whole list)
- Embed key was leaked in `team-dashboard/.env.bak.pre-university-admins` → **assume other secrets in `.env.bak*` are also exposed.**
- `STRIPE_WEBHOOK_SECRET` is configured → verify it's actually enforced.
- `CREDITSCORE_CALLBACK_KEY` also signs unsubscribe + member-login magic-link tokens (owner note: reuse the prod value, don't rotate casually) → check its verification paths.

---
*Context: this handoff follows the 2026-07-01 landing/portal security remediation (complete + live). The public apps are hardened; the engine room is the remaining unknown.*
