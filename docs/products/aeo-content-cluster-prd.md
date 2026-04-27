# PRD: AEO Content Cluster — "Why ChatGPT Won't Cite Your Website" (Initiative G)

**Status:** Planning — unshipped. Drives CreditScore funnel.
**Parent plan:** [docs/products/topic-takeover-roadmap.md](./topic-takeover-roadmap.md)
**Target repos:** `coherencedaddy-landing` (blog renderer), team-dashboard (only if cron-published; otherwise repo-managed).

---

## What It Is

A 12–15 piece content cluster that takes over the SERP and AI-citation
graph for the question "**why won't ChatGPT cite my website?**" and adjacent
queries. Cornerstone post links to the 48 rule IDs in CD's existing
[AEO/SEO Playbook PRD](./aeo-seo-playbook-prd.md), and every spoke post
deep-dives one rule or rule cluster.

The cluster is the front door for the CreditScore product — every spoke
ends with "want this audited automatically? CreditScore does it free."

---

## Customer Promise

> "Read why your site isn't cited by AI, see the exact rule it's failing,
> then run a free audit that scores you on all 48."

---

## Why This Initiative

- **Direct competitor exists** (`seoscore.tools`). Beating them requires
  *content*, not features — they have no editorial moat.
- **AEO/GEO query volume is ramping**. `"answer engine optimization"`,
  `"how to get cited by ChatGPT"`, `"GEO vs SEO"` — all up sharply over
  the last 12 months. Most content is shallow listicles by SEO agencies
  retrofitting.
- **Self-referential link graph.** CreditScore audits content for AEO
  compliance. CD writes the most AEO-compliant content about AEO. Walking
  the talk = compounding authority.
- **48 rule IDs = 48 ready spoke topics.** The PRD already exists.

---

## Cluster Architecture

```
Cornerstone: "Why ChatGPT Won't Cite Your Website (and the 48-rule fix)"
       │
       ├── Spoke: "SEO-001 — Crawlability for AI bots: GPTBot, ClaudeBot, PerplexityBot"
       ├── Spoke: "SEO-014 — Structured data that LLMs actually parse"
       ├── Spoke: "AEO-022 — Why your FAQ schema is invisible to ChatGPT"
       ├── Spoke: "AEO-031 — Citation-friendly URL structures"
       ├── Spoke: "ADS-101 — AdSense readiness vs answer engine readiness"
       ├── Spoke: "GEO vs SEO vs AEO — terminology decoded"
       ├── Spoke: "How to get into Perplexity's source tray (3 levers)"
       ├── Spoke: "ChatGPT search vs ChatGPT browse — different rules"
       ├── Spoke: "Why your sitemap doesn't matter to LLMs"
       ├── Spoke: "Llms.txt: the spec, the reality, the workaround"
       ├── Spoke: "Schema.org for the AI era (FAQPage, HowTo, Article)"
       ├── Spoke: "Internal linking when your reader is a model, not a human"
       ├── Spoke: "Brand mentions vs backlinks in AI training data"
       ├── Spoke: "How CD audits its own content with CreditScore (case study)"
       └── Spoke: "Open AEO playbook — all 48 rules, free"
```

Each spoke = 1,500–2,500 words, internally links to 3+ siblings + the
cornerstone, and ends with a CreditScore CTA.

---

## SEO/AEO Targets

| Cluster piece | Primary query | Estimated monthly volume | Difficulty |
|---|---|---|---|
| Cornerstone | "why ChatGPT won't cite my site" | 1.2k | Medium |
| Cornerstone alt | "how to get cited by AI" | 2.4k | Medium |
| Spoke (GPTBot) | "block GPTBot" + "allow GPTBot" | 4.8k | Low |
| Spoke (llms.txt) | "llms.txt example" | 6.6k | Low |
| Spoke (GEO vs SEO) | "GEO vs SEO" | 1.9k | Medium |
| Spoke (FAQ schema) | "FAQ schema ChatGPT" | 880 | Low |
| Spoke (Perplexity) | "get into Perplexity sources" | 720 | Low |
| (others) | long-tail rule-specific queries | ~300 each | Low |

(Volumes are pre-publish estimates; revise with real data after M1.)

---

## Where the Content Lives

`coherencedaddy-landing/content/blog/aeo/*.mdx`. Render at
`coherencedaddy.com/blog/aeo/{slug}`. Cornerstone gets the slug
`/blog/why-chatgpt-wont-cite-your-website`.

Every post:
- Starts with a 50-word TL;DR (AEO-friendly).
- Has an FAQ block with FAQPage schema.
- Includes a "rule reference" callout linking to the canonical rule ID.
- Ends with a CreditScore embed (the "run a free audit" form).

---

## Distribution

- **Tier 3c backlinks** (see BACKLINK-TARGETS.md rows 15–18): Reddit r/SEO
  + r/bigseo, Hacker News, Indie Hackers.
- **Twitter threading**: 5 spokes get a 7-tweet thread version.
- **Newsletter**: each spoke goes out to the existing CD list.
- **GitHub**: cornerstone gets a public repo at
  `Coherence-Daddy/aeo-playbook` mirroring the rule list, README links
  back. (Tutorial-library pattern, per CLAUDE.md.)

---

## Rollout Milestones

**M1 — Cornerstone + 3 spokes (1 week)**
- Cornerstone published.
- Spokes: GPTBot crawlability, llms.txt, GEO vs SEO.
- CreditScore CTA wired.

**M2 — Mid-cluster (3 weeks)**
- 6 more spokes.
- First Hacker News submission of cornerstone.
- Twitter thread series begins.

**M3 — Full cluster + GitHub mirror (4 weeks)**
- Final 5 spokes.
- `Coherence-Daddy/aeo-playbook` repo public, tutorial-quality.
- Outreach push: every listed AVS / faith-tech company gets a
  link to the relevant spoke as the AEO outbound (Initiative B) opener.

**M4 — Refresh cycle (ongoing)**
- Re-scan rankings monthly via CreditScore-on-CD.
- Top-of-funnel spokes get refreshed every 90 days.

---

## Success Metrics (120 days)

- Cornerstone in top 3 for at least 1 of the target queries.
- ≥6 spokes ranked top 10 for their primary query.
- ≥3 AI-citation captures (verified via Perplexity / ChatGPT browse for
  "AEO checklist", "why won't ChatGPT cite my site").
- ≥500 CreditScore audit runs attributed to blog traffic.

---

## Risks + Open Decisions

- **AI-content saturation.** Most AEO content is itself AI-generated and
  shallow. Mitigate by every post being grounded in a real rule with a
  reproducible test — the 48 rules are the proof.
- **CreditScore CTA fatigue.** Don't put the same CTA on every post; rotate
  three (audit, newsletter, GitHub repo).
- **Direct competitor response.** seoscore.tools could ship the same
  cluster. Beat them on speed (M1 in week 1) and on link velocity.

---

## Dependencies

- **Upstream:** [aeo-seo-playbook-prd.md](./aeo-seo-playbook-prd.md) — the
  48-rule canonical reference.
- **Downstream:** CreditScore conversion funnel; Initiative B outbound
  pulls quotes from these spokes for cold-email anchors.
