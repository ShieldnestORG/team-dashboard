# Firecrawl + SERP Connectivity Audit — Fix List

**Date:** 2026-06-15
**Author:** Echo / agent session (static code audit; runtime checks pending a tailnet-connected box)
**Trigger:** Investigation into whether the self-hosted Firecrawl and the "SERP ingest" pipeline
are correctly connected to the rest of the platform.

> This note was produced from inside an ephemeral, sandboxed agent container that is **not** on
> the Tailscale network and has **no** project env vars or DB access. Everything marked "static"
> was verified by reading the source. Everything marked "runtime" still needs to be run from a
> box on the tailnet that can reach **Firecrawl on VPS1 `.12`** (e.g. `ssh root@31.220.61.12`,
> or a tailnet laptop) — **not** VPS4 `.14`, which is the team-dashboard backend, not the
> Firecrawl host.

---

## TL;DR — what needs fixing / confirming

| # | Item | Severity | Type |
|---|---|---|---|
| 1 | This agent environment is not on the tailnet; can't reach Firecrawl `:3002` | Blocker (for agent-driven scraping) | Infra/config |
| 2 | Confirm `FIRECRAWL_URL=http://100.67.128.51:3002` in prod — code default points at the WRONG host (public domain → VPS4 `.14`, but Firecrawl runs on VPS1 `.12`) | High | Runtime |
| 3 | Confirm self-hosted Firecrawl still accepts the hardcoded `Bearer self-hosted` token | High | Runtime |
| 4 | Confirm the **plugin's** `apiUrl` config is populated (schema default is blank `""`) | Medium | Runtime |
| 5 | Confirm embedding service `147.79.78.251:8000` is reachable | Medium | Runtime |
| 6 | SERP ingest pipeline is unbuilt — PRD only, zero code | (Build, not fix) | Feature |
| 7 | Crawlee fallback is off by default (`CRAWLEE_FALLBACK_ENABLED`) — decide if intentional | Low | Config |

---

## 1. Tailscale / environment access

- The agent container has a single address `192.0.2.2` (RFC-5737 documentation range) and **no
  default route**. Outbound works only for harness-whitelisted HTTPS; **all non-web ports are
  blocked** and outbound to `controlplane.tailscale.com` returns 403.
- No `tailscale`/`tailscaled` binary, daemon, or tailnet interface is present. `apt`/`curl`/
  `/dev/net/tun` exist, but the network policy prevents `tailscale up` from reaching the control
  plane, and there is no auth key.
- A browser being logged into Tailscale on the operator's machine does **not** put the agent
  container on the tailnet — there is no bridge between a local browser and this sandbox.

**To actually connect a web/agent session to the tailnet** (do this at environment-creation time):
1. Set a network policy that permits Tailscale egress.
2. Provide a `TS_AUTHKEY` (ephemeral, tagged) auth key as an environment secret.
3. Add a setup script step: install tailscale + `tailscale up --authkey "$TS_AUTHKEY" --hostname <ssesion>`
   (consider `--tun=userspace-networking` if no NET_ADMIN).

Ref: https://code.claude.com/docs/en/claude-code-on-the-web

---

## 2. Firecrawl — wiring status (static: ✅ correctly connected in code)

> **Where Firecrawl actually runs (corrected 2026-06-15):** the self-hosted Firecrawl /
> BGE-M3 / Ollama stack lives on **VPS1 (`root@31.220.61.12`), Tailnet-only**, with the API
> bound to the **Tailnet IP `100.67.128.51:3002`** (not loopback, not public) — confirmed live
> via SSH and the [VPS cheat sheet](../deploy/vps-cheat-sheet.md) ("if it involves an LLM model,
> embedding, or web crawl, it's `.12`. There is no overlap"). It is **not** on VPS4 `.14`, which
> is the team-dashboard backend. **Consequence:** the code default
> `FIRECRAWL_URL = https://firecrawl.coherencedaddy.com` does **not** reach the real API (that
> domain resolves to `.14`), so prod must set **`FIRECRAWL_URL=http://100.67.128.51:3002`** — which
> is why check #2 below is the single most important one. Both VPS use the same SSH key
> (`nestd@pm.me` ed25519); SSH only works from a box where that key is installed.

Verified by reading source:

- **Admin routes mounted** — `server/src/app.ts:339` → `/api/firecrawl/admin`
  (`overview` + `run/:jobName`, whitelisted to `firecrawl:*` jobs only). `routes/firecrawl-admin.ts`.
- **Weekly sync cron registered** — `server/src/app.ts:522` → `startFirecrawlCrons` →
  `firecrawl:sync` `47 3 * * 0` (Sun 3:47am), owner `echo`. `services/firecrawl-crons.ts`.
- **Scrape → embed → store** — `services/firecrawl-sync.ts` POSTs `${FIRECRAWL_URL}/v1/scrape`,
  embeds via `getEmbedding` (BGE-M3, `services/intel-embeddings.ts`), upserts `intel_reports`
  with `embedding::vector`. Circuit breaker (5 fails → 30 min open), concurrency 3, 30s timeout.
- **Crawlee fallback** — `services/crawlee-fallback.ts`, Playwright+turndown, lazy-loaded,
  gated on `CRAWLEE_FALLBACK_ENABLED=true` (OFF by default).
- **Plugin** — `packages/plugins/plugin-firecrawl`: tools scrape/crawl/map/extract/search/
  classify/query/summarize/metrics; jobs `freshness-check` (daily), `directory-sync` (`*/30`).
  Self-hosted via `docker/docker-compose.yml`, documented as `:3002` Tailnet-only.

### Runtime checks still required (run on the box noted)

Firecrawl lives on **VPS1 (`.12`)**; the team-dashboard backend that *calls* it is on **VPS4
(`.14`)**. Run each check on the right box (both use the `nestd@pm.me` ed25519 key).

```bash
# --- on VPS4 (.14): the team-dashboard backend ---
# 1. Is FIRECRAWL_URL set, and does it point at the .12 tailnet API (not the public domain)?
ssh root@31.220.61.14 'grep FIRECRAWL_URL /opt/team-dashboard/.env.production'
#    expect: FIRECRAWL_URL=http://100.67.128.51:3002   (blank/public domain => misconfigured)

# 2. Server-side view: host mode + scrape counts (admin route; may require admin auth)
ssh root@31.220.61.14 "curl -s localhost:3200/api/firecrawl/admin/overview" | jq '.host, .metrics'

# --- on VPS1 (.12), or any tailnet box that can reach 100.67.128.51 ---
# 3. Does the self-hosted instance accept the hardcoded token?
ssh root@31.220.61.12 'curl -s -X POST http://100.67.128.51:3002/v1/scrape \
  -H "Authorization: Bearer self-hosted" -H "Content-Type: application/json" \
  -d "{\"url\":\"https://example.com\",\"formats\":[\"markdown\"]}"' | jq '.success'

# 4. Embedding (BGE-M3) service reachable from the tailnet?
ssh root@31.220.61.12 "curl -s -m 6 -o /dev/null -w '%{http_code}\n' http://147.79.78.251:8000/health" || echo unreachable
```

### Known risks to harden

- **Hardcoded auth token.** `services/firecrawl-sync.ts` sends `Authorization: Bearer self-hosted`
  literally. If the instance is ever switched to a real key, sync silently 403s. Consider moving
  to a `FIRECRAWL_API_KEY` env var with `self-hosted` as the default.
- **Plugin `apiUrl` default is blank.** `plugin-firecrawl` `instanceConfigSchema.apiUrl` defaults
  to `""`. If unset in the live instance config, the plugin tool path no-ops while the server
  service keeps working — an easy-to-miss split-brain. Confirm it's populated.

---

## 3. SERP / "SCRP" ingest — NOT connected (does not exist as code)

- The design lives only in `docs/products/directory-serp-ingest-prd.md`, **`Status: Planning —
  unshipped`**.
- Grep for every artifact it specifies — `directory_niche_queries`, `directory_pending`,
  `directory-serp-discovery` cron, `directory-ingest` routes, `DirectoryIngestQueue.tsx` —
  returns **only docs/PRD matches. Zero implementation.**
- As designed it ingests **crypto / AI-ML / DeFi / DevTools companies** into `intel_companies`,
  not influencers or any other entity type.

**Action:** if we want SERP discovery, it's an M1 build from the PRD (schema + `directory-serp-
discovery` cron + seed queries), not a connectivity fix.

---

## Recommended next actions

- [x] (Infra) Tailnet provisioning path documented + scripted →
      [`docs/deploy/tailnet-session-access.md`](../deploy/tailnet-session-access.md)
      + `scripts/tailscale-up.sh`. Still requires loosening the env network policy
      and minting a `TS_AUTHKEY` at environment-creation time.
- [ ] (Runtime) Run the four checks in §2 on the correct boxes (`.14` for #1–2, `.12` for #3–4); record results.
- [ ] (Fix) If `FIRECRAWL_URL` is blank/public-domain in prod, set it to `http://100.67.128.51:3002` (VPS1 tailnet).
- [ ] (Harden) Move Firecrawl auth token to `FIRECRAWL_API_KEY` env var.
- [ ] (Harden) Confirm/seed plugin `apiUrl` in the live instance config.
- [ ] (Decision) Confirm whether `CRAWLEE_FALLBACK_ENABLED` should be on in prod.
- [ ] (Feature) Scope SERP ingest M1 if catalog growth (or influencer research) is wanted.
- [ ] Optional: add `scripts/firecrawl-healthcheck.ts` to automate the §2 checks.
