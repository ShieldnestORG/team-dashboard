# GEO / AEO / AI-Visibility Tactics — Running Roadmap

> **Cluster:** Products · **Tags:** geo, aeo, ai-visibility, roadmap, seo, tactics · **Related:** [Topic-Takeover Roadmap](topic-takeover-roadmap.md), [Knowledge Graph Positioning](knowledge-graph-positioning.md), [Docs Index](../README.md)

**Status:** Living doc. Last updated 2026-05-09.
**Owner:** Coherence Daddy ecosystem (team-dashboard + coherencedaddy-landing).
**Origin:** Three-persona analysis (Contrarian, Enthusiast, Realist — all run on Opus) over the GEO/AEO/SEO tactic stack circa 2026.

This doc tracks (a) the full catalog of AI-era visibility tactics worth knowing, (b) which we adopt for **our own brand**, (c) which we offer **as products**, and (d) the customer-integration UX gap that blocks productization. Edit freely as we ship things or learn the world has moved.

---

## 1. Tactic Catalog (the running list)

| Tactic | What it is | One-liner |
|---|---|---|
| **SEO** | Search Engine Optimization | Rank in classical SERPs |
| **AEO** | Answer Engine Optimization | Win the answer box / People Also Ask / voice answer |
| **GEO** | Generative Engine Optimization | Get cited inside LLM-generated answers |
| **AIO** | AI Optimization (umbrella) | Marketing repackaging of the above three |
| **LLMO** | Large Language Model Optimization | Influence what models *learn* during training |
| **RAG Optimization** | Chunk-friendly content | Self-contained passages clean for retrieval |
| **Citation Engineering** | Quotable declarative writing | Stats + sources + dates → LLM-citable |
| **`llms.txt`** | Markdown sitemap for LLMs | Robots.txt for AI crawlers |
| **`agents.json`** | Agent-action manifest | Declares what agents can do on your site |
| **Product-as-MCP-server** | Expose features via MCP | New acquisition surface inside Claude/ChatGPT |
| **Brand defense** | Hallucination monitoring | Track + correct what AI says about you |
| **Schema.org / JSON-LD** | Structured data | Machine-readable facts |
| **Entity SEO** | Wikidata / Crunchbase / KG | Be a *thing*, not a string |
| **Reddit/YouTube/GitHub seeding** | Citation farming on overweighted sources | LLMs over-index these in retrieval |
| **Wikipedia / Wikidata presence** | Highest-leverage citation source | Hardest to earn, biggest payoff |
| **PR for AI** | Coverage in NYT / TechCrunch / .edu | Compounds via training data |
| **Podcast + YouTube transcripts** | Searchable spoken content | One interview → 100s of quotable passages |
| **AI visibility dashboards** | Profound / Peec / Otterly / Athena / Goodie | The "Ahrefs of GEO" |
| **Bot management** | Allow/deny GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot | Block = invisible to that model |
| **C2PA provenance** | Cryptographic content signing | Proves origin of media |

---

## 2. Verdict Matrix (synthesis of three personas)

✅ adopt / 💰 productize / ⏸ park / ❌ kill. **Resolution = where Realist sits unless Enthusiast can prove specific revenue and Contrarian can't kill it.**

| Tactic | For US | For SALE | Resolution |
|---|---|---|---|
| `llms.txt` | ✅ already shipped on landing | 💰 small SKU or onboarding freebie ($19 one-time, free with $49+) | **Ship as portal artifact in v1; bundle, don't headline.** |
| Schema.org / JSON-LD | ✅ enforced via `creditscore-schema-agent.ts` | 💰 already in Growth $149; productize "snippet on demand" $39/mo addon at month 3 | **Real product. Ship in 90-day window.** |
| Entity SEO (Wikidata/Crunchbase) | ✅ file for CD, ShieldNest, Tokns ourselves | ⚠ services-in-disguise — sell as $499 one-time **with explicit "no placement guarantee" language** | **Do for ourselves now; sell only after 3 internal reps.** |
| Brand-mention monitor (poller) | ✅ build internal first | 💰 **strongest new SKU** — start at $29/mo "Watchtower," upgrade path to $99 add-on or higher tier later | **30-day priority. Build, don't buy Profound.** |
| AI visibility dashboards (resell) | ❌ too expensive at our customer count | ❌ revisit at 200+ paid customers | **Skip. Build the cheap version ourselves.** |
| Product-as-MCP-server | ✅ ship `mcp.coherencedaddy.com` exposing CreditScore | 💰 free for $49+ tiers as differentiator | **Ship at month 4–6 (after portal). Permanent distribution moat.** |
| Bot management (Cloudflare AI controls) | ✅ explicit allow on storefront, block on team-dashboard | ⚠ requires holding customer credentials — defer | **Configure for ourselves. Don't sell until credential vault is hardened.** |
| Reddit/YouTube/GitHub seeding | ✅ continue (we already shipped `Coherence-Daddy/use-ollama-to-enhance-claude`) | ⚠ pure consulting — bundle into highest tier only | **Service, not product. Cap volume. Don't promise placement.** |
| C2PA provenance | ❌ not for our scale | ⏸ park; revisit if a faith-creator customer asks | **Skip 2026 unless inbound demand.** |
| `agents.json` | ⏸ ship one for free, no consumer of it yet | ❌ don't sell vapor | **Generate with `llms.txt`. Don't market it.** |
| LLMO (training-time influence) | ⚠ unfalsifiable as a service | ❌ don't sell hope | **Don't claim outcomes we can't measure.** |
| PR for AI | ⚠ either we hire a PR person or we don't | ❌ not productizable | **Not a SKU. Period.** |
| Podcast/YouTube transcripts | ⏸ no podcast, no YouTube — N/A today | ⏸ revisit if we launch one | **Skip until we have the assets.** |
| RAG optimization / Citation engineering | ✅ encoded in `aeo-seo-playbook-prd.md` rules `AEO-001..009` | ✅ already operational in CreditScore | **Already shipped. Audit ourselves quarterly.** |
| Wikipedia presence | ✅ author "Answer engine optimization" subhead on existing SEO article | ⚠ never promise placement | **Try for ourselves. Tell customers it's an attempt, not a deliverable.** |

---

## 3. The Customer Integration UX Gap (THE blocker)

> The user explicitly flagged: *"we should make sure that the users that integrate from these services or are going to use the services actually have an easy way to use these services. Are we doing it through a dash or do they just sign up something and give credentials? I don't think that we have any of that in place yet."*

**They are correct.** Verified: the only post-purchase customer surface today is Stripe Checkout + Resend email + token-URL report viewer. No login, no dashboard, no credential vault, no Stripe Customer Portal. `partner-onboarding.ts` references a magic-link dashboard that doesn't exist.

This is the **single highest-leverage gap in the company**, because every productized tactic below depends on it.

### Recommended architecture (Realist design — adopt as-is)

- **Domain:** `app.coherencedaddy.com` (new Vercel project, mirror existing storefront subdomain pattern). Keeps marketing site SEO-clean.
- **Auth:** Magic-link via Resend. No passwords, no OAuth in v1.
  - `customer_magic_links (token, email, expires_at, consumed_at)` — 15-min TTL, single-use
  - 30-day HMAC-signed cookie session (no DB session table)
- **Source of truth:** team-dashboard Postgres. New tables (additive, no data migration):
  - `customer_accounts (id, email citext unique, stripe_customer_id, created_at, last_login_at)`
  - `customer_magic_links` (above)
  - `customer_credentials (id, account_id, kind enum, encrypted_value, created_at, revoked_at)` — reuse existing `secrets.ts` AES-GCM helper
  - `customer_action_log (id, account_id, kind, payload jsonb, created_at)` — audit trail (508(c)(1)(A) trust hygiene)
- **Routes** (new `team-dashboard/server/src/routes/portal.ts`):
  - `POST /api/portal/login` — request magic link
  - `GET /api/portal/auth?token=...` — exchange for session
  - `GET /api/portal/me` — account + entitlements (joins on `email` to existing `*_subscriptions` tables)
  - `GET/POST/DELETE /api/portal/credentials` — credential vault CRUD
  - `POST /api/portal/stripe-portal` — proxy to Stripe Billing Portal session URL
  - `/api/portal/<product>/*` — per-product subroutes
- **Storefront app:** ~6 routes — `/login`, `/auth`, `/` (cards), `/billing`, `/credentials`, `/<product>`.

**Effort:** ~6 engineering days to MVP that unblocks selling 3+ AEO upsell SKUs.

### Credential-handling spectrum (per-tactic)

| Tactic | Surface needed | Notes |
|---|---|---|
| `llms.txt` / `agents.json` generation | (a) email + portal download | One-shot file. No creds. |
| Brand-mention monitor | (b) read-only dashboard | Customer enters domain + 5–25 prompts. No creds. |
| Schema.org snippet service | (a) → (b) | v1 email; v2 dashboard with diff/refresh. No creds. |
| MCP server hosting | (c) per-customer API key | We issue, they paste into Claude/ChatGPT MCP config. |
| Cloudflare AI bot controls | (c) credential paste | **Defer until vault is hardened.** Read it back masked. |
| Reddit/X seeding | (d) full OAuth | **Defer to month 9+.** They approve drafts, we post. |
| Wikidata/Crunchbase filings | (b) status queue | We do work, they watch progress. Never give them write access. |
| GA4 / Search Console correlation | (d) read-only OAuth | Month 6+, after monitor v1 proves out. |

**Rule:** every recurring product needs (b). Don't ship (c) or (d) until the vault is audited and the magic-link flow is stable for ≥30 days with zero auth incidents.

---

## 4. Build Sequence — 30 / 90 / 180 / 365 days

### 🎯 30-day P0 (blocks everything)
- [ ] **Customer Portal MVP** at `app.coherencedaddy.com` — magic-link auth, `/me`, Stripe Billing Portal proxy. ~6 days. Files: `server/src/routes/portal.ts`, `server/src/services/customer-portal.ts`, `server/migrations/NNN_customer_accounts.sql`.
- [ ] **`llms.txt` + `agents.json` one-shot generator** — bundled free with $49+, $19 standalone. Generate from sitemap on payment. Deliver via portal.
- [ ] **Brand-mention monitor v1** ("Watchtower" $29/mo) — weekly Perplexity + ChatGPT prompt sweep, email digest. Cap 50 prompts/wk/customer. New table `visibility_runs`.
- [ ] **Stripe Customer Portal enabled** — let customers cancel/update card/see invoices without us. Refund-deflection.

### 🛠 90 days
- [ ] **Schema.org JSON-LD as a service** — $39/mo addon. Validated snippet, weekly refresh.
- [ ] **100 Agents dashboard MVP** — activity feed + approval queue for the 3 agent types whose backend services already exist (`creditscore-content-agent`, `creditscore-schema-agent`, `creditscore-competitor-agent`). 14 founding-cohort customers need this to use what they bought. **Non-negotiable.**
- [ ] **File entity SEO assets for ourselves** — Wikidata items for Coherence Daddy, ShieldNest, Tokns. Crunchbase listings. Half a day each. Forever asset.
- [ ] **Extend `aeo-seo-playbook-prd.md` with `LLMS-*` and `ENTITY-*` rule categories** (append-only). Auditor scores them automatically.

### 📦 180 days
- [ ] **CreditScore MCP Server** at `mcp.coherencedaddy.com` exposing `audit_url`, `score_signals`, `get_competitors`, `generate_schema`, `check_llms_txt`. Submit to Anthropic directory + Smithery + Glama + mcp.so. Free tier returns score; paid returns full report (Stripe link in tool response).
- [ ] **Cloudflare AI bot controls (managed)** — $49/mo addon. Credential vault must be audited first.
- [ ] **Reddit/HN/YouTube citation tracker** (read-only) — bundled into Growth tier.
- [ ] **AI visibility prompt-sweep dashboard v2** — graduate Watchtower to a $99/mo addon with full UI.

### 🌳 365 days
- [ ] **Wikidata/Crunchbase entity service** for customers — $499 one-time, **explicit "attempts not guarantees"** language.
- [ ] **Reddit OAuth + draft-post queue** — Growth tier feature. Document Reddit's shadow-ban realities.
- [ ] **Build vs. resell decision** on the visibility dashboard at scale (Profound API resell math kicks in around 50+ paying customers on the addon).
- [ ] **All 12 of the 100 Agents agent types** (we shipped 3 in the 90-day window).
- [ ] **C2PA provenance signing for faith creators** — only if inbound demand exists. Niche but brand-fit ($29/mo at `verify.coherencedaddy.com`).

---

## 5. Don't-Kid-Ourselves List (positioning constraints)

Things that look like products in slide form but are services in delivery. Price and staff accordingly:

- **Wikipedia/Wikidata placements** — editorial campaigns, not API calls. Sell as "$499 one-time, public attempt log, no placement guarantee, refundable if no draft submitted."
- **Reddit citation outreach** — community managers, not crons. Posts from fresh accounts shadow-ban by default. Sell only inside Pro/Command tiers ($499+) with human-in-loop on every draft.
- **Brand-mention monitor → response strategy** — software finds the mention; humans decide what to do. Ship detection as software ($29/mo). Sell response work as separate $250/incident retainer. Don't blur.
- **YouTube comment seeding** — Google's anti-spam deletes most agent posts. Don't promise this; bundle into highest manual-service tier only.
- **AI visibility tools** — at <200 customers, our LLM API bill to match Profound's feature set exceeds the cost of reselling them. Build cheap, resell expensive at scale.
- **`llms.txt` generation** — one-shot file. Customer doesn't re-buy. Treat as sticky onboarding, not recurring SKU.
- **C2PA** — verifier ecosystem isn't there yet. Defer.
- **The 100 Agents brand** — actually 12 agent types instanced per customer. Make sure marketing copy matches the PRD or a TechCrunch fact-check will sting.

### 508(c)(1)(A) constraints (always-on)
- Refund policy must be written and visible. Faith-based status is **not** legal shield.
- No manufactured scarcity copy. The 100 Agents "30-customer founding cohort" is fine — it's an honest infra constraint.
- Always offer a `$0 + suggested donation` Stripe option alongside paid tiers. Reinforces nonprofit identity, excellent for press.

---

## 6. The 3 Things to Ship in the Next 30 Days

If we ship nothing else from this roadmap in May–June, ship:

1. **Customer Portal MVP at `app.coherencedaddy.com`.** Magic-link auth + `/me` + Stripe Billing Portal proxy. 6 engineering days. Unblocks every paid SKU below.
2. **100 Agents dashboard, narrow MVP** for the 3 agent types whose services already exist. 14 founding-cohort customers cannot use what they bought without this — we're going to refund or churn them otherwise.
3. **`llms.txt` generator + Watchtower brand-mention monitor v1** as the first paid addons on the portal. End-to-end loop: Stripe → entitlement → cron → portal artifact. Once one loop works, every future AEO SKU is a copy-paste, not a re-architecture.

---

## 7. Open Questions (resolve before shipping the 90-day list)

- **Pricing ceiling.** Enthusiast wants $299/$799 tiers. Contrarian explicitly argues against $499+ tiers pre-portal. **Decision:** stay ≤$149 until portal has 30 days of clean operation; then reopen.
- **`app.coherencedaddy.com` vs. expanding `partner.coherencedaddy.com`.** Realist suggests new Vercel project; `partner.*` is referenced in `partner-onboarding.ts` but not built. **Decision:** build `app.*`, alias `partner.*` to it later if useful.
- **Donation tier mechanics.** Where does the `$0 + suggested donation` button live? Portal landing? Each product card? **Decision needed:** product or finance owner.
- **MCP server billing.** If a free-tier MCP user runs 1000 audits, what's our LLM/compute cost vs. conversion rate? **Need real numbers** before submitting to marketplaces.
- **Resend deliverability for magic links.** Are we on a subdomain that's warmed for transactional? Verify before launch — magic-link auth is dead if 5% of emails go to spam.

---

## 8. References

- `team-dashboard/docs/products/aeo-seo-playbook-prd.md` — 48 stable rule IDs (extend with `LLMS-*`, `ENTITY-*`)
- `team-dashboard/docs/products/aeo-content-cluster-prd.md` — 12-15 piece cluster, "why won't ChatGPT cite my website"
- `team-dashboard/docs/products/agents-product-prd.md` — 100 Agents PRD
- `team-dashboard/docs/OWNERSHIP.md` — repo boundary (entitlements + Stripe live in team-dashboard)
- `coherencedaddy-landing/SERVICES.md` — current CreditScore tiers
- `coherencedaddy-landing/CLAUDE.md` — domain layout
- `coherencedaddy-landing/docs/SEO-CHECKLIST.md` — search console registration
- `coherencedaddy-landing/public/llms.txt`, `llms-full.txt` — already shipped, audit quarterly
