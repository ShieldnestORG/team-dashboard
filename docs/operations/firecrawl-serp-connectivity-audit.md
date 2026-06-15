# Firecrawl + SERP Connectivity Audit — Fix List

**Date:** 2026-06-15
**Author:** Echo / agent session (static code audit; runtime checks pending a tailnet-connected box)
**Trigger:** Investigation into whether the self-hosted Firecrawl and the "SERP ingest" pipeline
are correctly connected to the rest of the platform.

> This note was produced from inside an ephemeral, sandboxed agent container that is **not** on
> the Tailscale network and has **no** project env vars or DB access. Everything marked "static"
> was verified by reading the source. Everything marked "runtime" still needs to be run from a
> box that is on the tailnet (VPS4 `.14` or a tailnet laptop).

---

## TL;DR — what needs fixing / confirming

| # | Item | Severity | Type |
|---|---|---|---|
| 1 | This agent environment is not on the tailnet; can't reach Firecrawl `:3002` | Blocker (for agent-driven scraping) | Infra/config |
| 2 | Confirm `FIRECRAWL_URL` is set in prod (falls back to edge-blocked public domain) | High | Runtime |
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

### Runtime checks still required (run on VPS4 / tailnet box)

```bash
# 1. Is FIRECRAWL_URL set? (blank => falls back to public edge, which 403s off-tailnet)
echo "$FIRECRAWL_URL"

# 2. Server-side view: host mode + scrape counts
curl -s localhost:4000/api/firecrawl/admin/overview | jq '.host, .metrics'

# 3. Does the self-hosted instance accept the hardcoded token?
curl -s -X POST "$FIRECRAWL_URL/v1/scrape" \
  -H "Authorization: Bearer self-hosted" -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","formats":["markdown"]}' | jq '.success'

# 4. Embedding service reachable?
curl -s -m 6 -o /dev/null -w '%{http_code}\n' http://147.79.78.251:8000/health || echo unreachable
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

- [ ] (Infra) Decide whether agent/web sessions should be tailnet-connected; if yes, provision
      `TS_AUTHKEY` + network policy + setup script (see §1).
- [ ] (Runtime) Run the four checks in §2 on VPS4; record results.
- [ ] (Harden) Move Firecrawl auth token to `FIRECRAWL_API_KEY` env var.
- [ ] (Harden) Confirm/seed plugin `apiUrl` in the live instance config.
- [ ] (Decision) Confirm whether `CRAWLEE_FALLBACK_ENABLED` should be on in prod.
- [ ] (Feature) Scope SERP ingest M1 if catalog growth (or influencer research) is wanted.
- [ ] Optional: add `scripts/firecrawl-healthcheck.ts` to automate the §2 checks.
