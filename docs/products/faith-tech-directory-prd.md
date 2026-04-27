# PRD: Faith-Based Tech Companies Directory (Initiative F)

**Status:** Planning — unshipped. Strategic moat priority.
**Parent plan:** [docs/products/topic-takeover-roadmap.md](./topic-takeover-roadmap.md)
**Target repos:** team-dashboard (vertical seed + governance), `directory.coherencedaddy.com` (renderer).

---

## What It Is

The first comprehensive, enriched directory of **faith-based software
companies** — distinct from `faith.tools` (which lists *apps* a Christian
might use) and FaithTech (a community, not a directory).

CD's structural advantage: ShieldNest Inc. operates under 508(c)(1)(A)
status. No for-profit competitor can credibly claim editorial neutrality on
faith-based business directories the way CD can.

---

## Customer Promise

> "The directory of every faith-driven software company — who's hiring,
> what they ship, who funds them. Curated by a 508(c)(1)(A) faith
> organization."

---

## Why This Initiative

- **No competitor.** `faith.tools` = consumer apps. `christiantechjobs.io` =
  job board. `FaithTech` = events + community. None of them are an
  enriched company-level directory.
- **508(c)(1)(A) is unforgeable.** A for-profit publisher would have to
  *become* a faith org to compete authentically. That's a 5+ year moat.
- **Backlink magnet.** Every listed company has reason to link back to the
  directory page — it's social proof inside their niche.
- **Lead-gen for CreditScore.** Faith-based founders are underserved by SEO
  tooling and over-target ChatGPT for distribution. Perfect AEO buyers.

---

## Scope

**In scope:**
- New `directory_vertical = 'faith-tech'` partition.
- Seed list of ~120 companies (CCM platforms, Bible apps, faith-based AI,
  Christian SaaS, faith-driven dev shops, ministry tooling).
- Lightweight editorial layer: a "faith alignment statement" field on each
  profile (self-attested, not adjudicated).
- Renderer subpage at `/faith-tech`.
- Cross-link partnerships with `faith.tools`, FaithTech, christiantechjobs.io.

**Out of scope:**
- Doctrinal grading or denominational filtering. CD takes no theological
  position — directory inclusion is about whether the company self-describes
  as faith-driven.
- Donation pages or merch.

---

## Data Flow

```
Initiative A SERP ingest (existing, with new faith-tech queries) ──┐
                                                                    ├─→ directory_pending
Hand-seeded ~120 row migration ─────────────────────────────────────┘          │
                                                                                ↓
                                                                Echo enrichment + manual review
                                                                                ↓
                                                                intel_companies (vertical=faith-tech)
                                                                                ↓
                                                                directory.coherencedaddy.com/faith-tech
```

---

## Schema Additions

Reuse `intel_companies`. New table for faith-specific metadata:

| Column | Type | Notes |
|---|---|---|
| `company_id` | int FK → intel_companies.id (PK) | |
| `faith_alignment_statement` | text | Self-attested; ≤500 chars |
| `denomination_self_id` | text | Optional; nullable; never used to filter |
| `nonprofit_status` | text | `for-profit` / `508c1a` / `501c3` / `other` / `unknown` |
| `hiring_count` | int | Pulled from job board partnership |
| `updated_at` | timestamptz | |

---

## Seed Queries (Initiative A, faith-tech vertical)

Add to `directory_niche_queries`:
- `"faith-based SaaS startups 2026"`
- `"Christian tech companies hiring"`
- `"Bible study app developers"`
- `"church management software companies"`
- `"faith-driven AI startups"`
- `"Christian podcast tools SaaS"`
- `"Catholic software companies"`
- `"ministry analytics platform"`

(~12 seed queries; expand post-M1 based on what ranks.)

---

## Renderer (storefront)

- `/faith-tech` index — sortable by hiring activity, GitHub recency,
  funding stage.
- `/faith-tech/[slug]` profile — standard intel profile + faith-alignment
  card.
- `/faith-tech/about` — explains 508(c)(1)(A) editorial stance, neutrality,
  and self-attestation policy.

---

## Editorial Policy (load-bearing)

CD will list companies that **self-describe** as faith-driven. CD does not:
- Verify doctrinal claims.
- Exclude based on denomination.
- Endorse any particular theological position.

This neutrality is *the* differentiator — it lets CD list both Catholic
ministry tools and evangelical Bible apps without picking sides. Document
this on `/faith-tech/about` and link from every profile.

---

## Rollout Milestones

**M1 — Schema + seed (3 days)**
- `faith_tech_metadata` table migration.
- Hand-seed 120 rows from existing CCM lists, FaithTech alumni, faith.tools
  parent companies.
- 12 SERP queries added to `directory_niche_queries`.

**M2 — Renderer + about page (3 days)**
- `/faith-tech` + profiles + `/faith-tech/about`.
- Cross-links to faith.tools, FaithTech, christiantechjobs.io.

**M3 — Outreach (2 weeks)**
- Email every listed company offering "claim your profile."
- Submit to Tier 2 + Tier 3b backlink targets.
- Guest post on FaithTech Collective blog (see BACKLINK-TARGETS.md row 7).

**M4 — Hiring integration (later)**
- Christian Tech Jobs API or scrape integration to populate `hiring_count`.

---

## Success Metrics (90 days)

- ≥150 enriched profiles live.
- Top 3 Google for `"faith based tech companies"`, `"Christian SaaS directory"`.
- ≥30 self-claimed profiles (claim flow shows founder buy-in).
- ≥3 cross-link partnerships established.

---

## Risks + Open Decisions

- **Theological flame wars.** Comment sections / community submissions
  could attract drama. Mitigate by making the directory read-only — no
  comments, no ratings, no denominational filters.
- **Defining "faith-based."** Edge cases: a Christian founder running a
  secular SaaS is *not* faith-tech. The company itself must self-describe
  that way. Codify on `/faith-tech/about`.
- **Mission creep.** Resist adding non-tech faith ventures (publishing,
  music, retail). This directory is **software companies**.

---

## Dependencies

- **Upstream:** Initiative A SERP ingest, existing intel pipeline.
- **Downstream:** Tier 2 backlink campaign, CreditScore funnel.
