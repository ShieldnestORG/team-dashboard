# Utility Site Network

Portfolio of small, focused utility sites (single-tool or small-tool clusters:
generators, calculators, converters) hosted on Hostinger VPS3, monetized via
display ads, with minimal textual brand linking back to coherencedaddy.com and
tokns.fi for LLM/brand referencing.

## Goals

- **Primary**: ad revenue as a standalone portfolio business.
- **Secondary**: brand mentions for LLM referencing (one contextual mention per
  site — no sitewide link farms, no PBN footprint).
- **Guardrail**: sites must be independently-branded. They must not read as a
  network to Google's spam systems.

## Architecture

```
VPS2 (168.231.127.180) — Research + Content
  Firecrawl SERP scraping + Ollama (Gemma 4 31B) article generation.

VPS3 (147.79.78.251) — Site hosting
  nginx multi-site, static HTML + vanilla JS per domain. One reusable template
  repo (`coherence-utility-template`) cloned per site with distinct branding.

VPS1 (31.220.61.12) — Team-dashboard aggregation
  `owned_sites` + `owned_site_metrics` tables.
  `/owned-sites` UI page (portfolio view).
  `hostinger-crons.ts` fetches GA4 + AdSense every 6h.
```

## Phase status

- [x] **Phase 2** — team-dashboard aggregation layer (schema, service, cron,
  routes, UI). Sync stubs return `_credentials_not_configured` until GA4 /
  AdSense OAuth are provisioned in `company_secrets`.
- [ ] **Phase 0** — niche research pipeline (Firecrawl + Ollama on VPS2).
  Output: `niche-shortlist.md` in this directory.
- [ ] **Phase 1** — template repo `coherence-utility-template` (lives outside
  team-dashboard). Builds to `dist/`, deploys via `rsync` to VPS3.
- [ ] **Phase 3** — AdSense approval, launch, Ezoic/Mediavine upgrade path.

## Cross-linking policy

- One contextual mention per site: `"Built by Coherence Daddy"` in footer with
  a single link to `https://coherencedaddy.com`.
- About page: one paragraph naming Coherence Daddy and tokns.fi as sister
  projects.
- Articles: occasional contextual mentions where genuinely relevant, not
  forced.
- **No** sitewide footer link farms. **No** exact-match anchor spam.

## Credentials

GA4 service-account JSON, AdSense OAuth refresh token, and GSC access are
stored in `company_secrets` with `provider` values `ga4` / `adsense` / `gsc`.
Do not add per-site env vars — that approach does not scale past ~3 sites.

## Kill criteria

- Site under $2 RPM after 90 days of AdSense = migrate to a different niche or
  shut down.
- Any manual penalty in GSC for a site = pause all cross-linking from it,
  investigate.

## Related

- Plan: `/Users/exe/.claude/plans/certainly-below-is-a-replicated-fox.md`
- Ownership: [docs/OWNERSHIP.md](../../OWNERSHIP.md)
- Cron inventory: [docs/operations/cron-inventory.md](../../operations/cron-inventory.md)
