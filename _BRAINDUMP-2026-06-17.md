# Brain-dump items → team-dashboard (agents / partner network / directory) (recording 2026-06-17)

Pointer only. Full context + routing: `/Users/exe/Downloads/Claude/marketing/BRAIN-DUMP-TRIAGE-2026-06-17.md`.

- **FACT:** **Partner Network is LIVE** (Stripe integrated; $49 / $149 / $499) — `docs/products/partner-network-prd.md`.
- **FACT:** **AI & Crypto Directory is LIVE** — 511 companies / 94,660 reports, paid tiers $199 / $499 / $1,499, refreshed every 30 min — `docs/products/directory-listings-prd.md`, `../coherencedaddy-landing/docs/plans/2026-04-24-directory-expansion.md:9`.
- **FACT:** **100 Agents is PLANNED, backend NOT built** — landing live since 2026-04-30, founding cohort 14/30, $79–$1,499/mo — `docs/products/agents-product-prd.md:3`. (The recording's "100 agent fleet / hire 100 specialists" = this; decide build vs. shelve.)
- **OPEN (not a file read):** "how much DB space is the directory using?" is **undocumented** — answer it by running a real size query on Postgres (`SELECT pg_size_pretty(pg_database_size(...))` / `\l+`), not by reading a doc.
