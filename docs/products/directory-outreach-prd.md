# PRD: Directory Outbound AEO Campaign (Initiative B)

**Status:** Planning — unshipped.
**Parent plan:** `coherencedaddy-landing/docs/plans/2026-04-24-directory-expansion.md`
**Depends on:** Initiative A (Directory SERP Ingest) providing catalog growth. Can start in parallel but outbound volume only makes sense with more companies to reach.
**Target repos:** team-dashboard (discovery, crons, agent, schema), storefront (email templates, Resend delivery, tracking receiver).

---

## What It Is

A per-company outbound email system. For every unclaimed company in `intel_companies`, discover a contact email, then send one templated outreach telling them they've been listed on directory.coherencedaddy.com and pitching the paid tiers ($199/$499/$1,499 mo) for AEO amplification.

Emails are written by the **Prism** agent using the company's actual latest intel reports (github activity, news, category), not canned copy. Sending is capped, tracked, and CAN-SPAM compliant.

---

## Customer Promise

> "You just found out we exist. Here's what it does for you."

The customer promise isn't to the company receiving the email — it's to the *company's search visibility*. Paying customers get content mentions that increase their AI citation mass. The cold email's job is to tell them this exists, with enough specificity to not feel like spam.

---

## The Honesty Gate (READ FIRST)

**This initiative cannot ship if the content pipeline it pitches doesn't actually run at quota.** The AEO promise is:

- Featured ($199/mo): 2 mentions/mo via Blaze
- Verified ($499/mo): 5 mentions/mo via Blaze + Prism
- Boosted ($1,499/mo): 15 mentions/mo via Blaze + Prism + Sage

If Blaze/Prism content crons are dark or throttled below these quotas, outbound emails making the AEO pitch are fraudulent. Before sending a single email:

1. Confirm `content-crons.ts` is scheduled on the VPS and firing.
2. Confirm last 30 days of generated content volume per agent matches or exceeds the quota math for current paying customers × tier.
3. Confirm `directoryListingMentions` table is being written to (schema from `directory-listings-prd.md`).

If any of these fail, **stop and fix the content pipeline before any outreach send.**

---

## Data Flow

```
intel_companies (unclaimed, no contact_email)
        ↓
contact-discovery agent (hourly)
  mailto: / /contact / WHOIS / GitHub commit email / Twitter bio
        ↓
intel_companies.contact_email + contact_source set
        ↓
directory-outreach-send cron (daily)
  filters: contact_email IS NOT NULL
           listing_tier IS NULL
           last_outreach_at IS NULL OR < now() - 30d
           opt_out = false
  caps:    50 sends/day total, 5 sends/domain/day
        ↓
Prism generates personalized email per company
        ↓
Resend delivery (from outreach@coherencedaddy.com)
        ↓
directory_outreach row written (sent_at)
        ↓
Resend webhook → storefront /api/email/webhooks/resend → team-dashboard
        ↓
directory_outreach.opened_at / clicked_at / unsubscribed_at / bounced_at
        ↓
Nightly attribution sweep: did clicked_at → paid conversion?
```

---

## Schema Additions

### `directory_outreach`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `company_id` | int FK → `intel_companies.id` | |
| `email_to` | text | Copied from `intel_companies.contact_email` at send time |
| `template_slug` | text | e.g. `discovered-v1`, `re-engage-v1` |
| `variant_slug` | text | e.g. `subject-a`, `subject-b` for A/B |
| `prism_content_sha` | text | Hash of the personalized body, so we don't resend identical content |
| `sent_at` / `delivered_at` / `opened_at` / `clicked_at` | timestamptz | |
| `bounced_at` / `complained_at` / `unsubscribed_at` | timestamptz | |
| `converted_listing_id` | int FK → `directory_listings.id` | Populated if a paid listing is created within 30 days of click |
| `resend_message_id` | text | For webhook correlation |

### `directory_outreach_opt_out`
| Column | Type | Notes |
|---|---|---|
| `email_hash` | text PK | Hashed on write — never store raw unsubscribed addresses |
| `opted_out_at` | timestamptz | |
| `reason` | text | Nullable |

Queried by `directory-outreach-send` before every send.

### Updates to `intel_companies`
Existing columns `contact_email`, `contact_name`, `contact_source`, `last_outreach_at` are already present per `directory-listings-prd.md`. Add:
- `contact_discovery_attempted_at` — prevents re-probing companies we already failed to find.
- `contact_discovery_last_error` — text.

---

## Contact Discovery (Waterfall)

Executed by `contact-discovery` cron (hourly, batch of 100 oldest companies without `contact_email` and `contact_discovery_attempted_at < now() - 30d`):

1. **Homepage `mailto:` scan.** Fetch `homepage_url`, parse for `mailto:` anchors. If found, use the first one whose local-part isn't generic (prefer `hello@`, `contact@`, `team@` over personal names).
2. **Common contact paths.** Probe `/contact`, `/about`, `/team` if homepage didn't yield. Same mailto extraction.
3. **GitHub commit email.** If `github_org` is set, list top contributors via GitHub API, pull their public email addresses from commit history.
4. **Twitter/X bio.** If `twitter_handle` is set, fetch profile, regex for emails in bio.
5. **WHOIS admin email.** Last resort — many modern registrars redact this, but worth a try for older domains.

Log which step succeeded in `contact_source`. If none succeed, set `contact_discovery_last_error` and skip for 30 days.

Respect rate limits: GitHub API token, Twitter scraping cadence, WHOIS servers. Discovery is hourly, not realtime — no user is waiting.

---

## Send Eligibility & Caps

A company is eligible for an outreach send when:

1. `contact_email IS NOT NULL`
2. `listing_tier IS NULL` (unclaimed — paying customers don't get cold pitches)
3. `last_outreach_at IS NULL OR last_outreach_at < now() - 30d`
4. Email hash NOT in `directory_outreach_opt_out`
5. Previous sent email isn't in `bounced` / `complained` state

**Hard caps per daily run:**
- 50 total sends
- 5 sends per email domain (defined as everything after the `@`)
- 0 sends if system-wide pause flag (`DIRECTORY_OUTREACH_PAUSED=true`) is set

**Time-of-day:** daily cron at 14:00 UTC (morning in EU, late-morning-to-afternoon in US). No sends on weekends.

---

## Template Generation

**Prism** writes one email per eligible company. Input:
- Company row (name, category, description, homepage, contact_name if any, tags)
- Latest 3 intel reports from `intel_reports` (scoped to `report_type IN ('news','github','generated-content')`)
- Template variant assignment (subject A/B)

Output: HTML body + plaintext body + subject.

**Template constraints:**
- Personalize on at least one specific detail (recent GitHub release, recent news, specific tag). If Prism can't find a personal detail, fall back to a generic-but-polite variant — never send an "I see you just launched {{feature}}" when no feature was detected.
- Max 120 words.
- Include unsubscribe link (`https://coherencedaddy.com/unsubscribe?t={signed_token}`).
- Include physical address (CAN-SPAM requirement) — stored in storefront `app/email-templates/shared/footer.tsx`, not in Prism's prompt.
- Include exactly one CTA link to `https://directory.coherencedaddy.com/directory-pricing?slug={company.slug}` — the slug pre-fills the enroll form (TODO on storefront: actually read the `slug` query param; currently passed but unused — tracked in `coherencedaddy-landing/TODO.md`).

---

## Agent Assignments

| Agent | Task | Trigger |
|---|---|---|
| **contact-discovery** (new) | Discover contact emails via waterfall | Hourly cron |
| **Prism** | Generate personalized outreach emails | Inline within `directory-outreach-send` cron |
| **Nexus** (existing) | Already extracts entity relationships — reused to enrich the personalization input Prism sees | No new trigger |

---

## New Crons

| Cron | Schedule | Purpose |
|---|---|---|
| `directory-contact-discovery` | Hourly | Process 100 oldest companies without contact info |
| `directory-outreach-send` | `0 14 * * 1-5` (Mon-Fri 14:00 UTC) | Generate + send 50/day with 5/domain cap |
| `directory-outreach-attribution` | `0 3 * * *` (nightly) | Sweep 30-day window for click → listing conversion |

---

## Backend Endpoints

New routes in `server/src/routes/directory-outreach.ts`:

- `GET /api/directory-outreach/stats` — MRR attribution, CTR, conversion rate by cohort (admin)
- `GET /api/directory-outreach/queue?date=…` — preview today's send list before the cron fires (admin)
- `POST /api/directory-outreach/pause` — emergency stop (admin, authed, audit-logged)
- `POST /api/directory-outreach/unsubscribe` — public, idempotent; takes signed token, writes to `directory_outreach_opt_out`

Storefront endpoints (owned per `OWNERSHIP.md` email-template rule):

- `POST /api/email/webhooks/resend` (new) — receives Resend webhook events, forwards relevant ones to team-dashboard `/api/directory-outreach/webhook-event`
- `GET /unsubscribe?t=…` — public page calling `POST /api/directory-outreach/unsubscribe` via the existing `vercel.json` rewrite

---

## Sending Infrastructure

- **From address:** `outreach@coherencedaddy.com`
- **Dedicated sending subdomain:** `send.coherencedaddy.com` (not shared with transactional email — separation protects transactional deliverability)
- **SPF / DKIM / DMARC:** configured on `send.coherencedaddy.com` via Resend domain setup
- **IP warmup:** 6 weeks. Week 1: 10 sends/day. Each week +50%. Only hit the 50/day cap in week 6.

Budget: Resend is ~$0.0004 per email at volume. 50/day × 30d = 1,500/mo. Negligible cost. Deliverability risk dwarfs it.

---

## Compliance

- **CAN-SPAM:** physical address in footer + one-click unsubscribe + accurate subject + identify as promotional. The faith-based 508(c)(1)(A) nonprofit designation doesn't exempt us — it only exempts religious-fundraising content, and we're selling a product.
- **GDPR:** scope v1 to non-EU recipients. `contact-discovery` agent runs a reverse-DNS / ccTLD check (`.eu`, `.de`, `.fr`, `.uk`, etc.) and refuses to record emails from EU-country contact sources. Revisit in v2 with proper legitimate-interest documentation.
- **CASL (Canada):** same v1 handling as GDPR — skip `.ca` until we have documented implied consent (directory listing is public, but CASL is strict).

---

## Rollout Milestones

**M1 — Contact discovery live, no sends (1 week)**
- `contact-discovery` agent + cron shipped. Running hourly, filling `contact_email`.
- Observe: how many of ~511 companies get an email? Expect ~30-40%.

**M2 — Opt-out + unsubscribe plumbing (3 days)**
- `directory_outreach_opt_out` table live.
- `/unsubscribe?t=…` page + signed-token flow working end-to-end.
- Manual test: send a test email, click unsubscribe, verify opt-out record.

**M3 — Warmup week 1 (10/day) (1 week)**
- `directory-outreach-send` cron wired with 10/day cap.
- Resend webhook receiver live.
- Prism template live, A/B subject variants.
- Daily manual review of the first 5 sends before the cron runs.

**M4 — Warmup weeks 2-6 (5 weeks)**
- Automated cap scales per week: 15 → 22 → 32 → 42 → 50.
- Any week with bounce rate > 3% or complaint rate > 0.1%, hold volume for a week.

**M5 — Attribution live (rolling, ongoing)**
- `directory-outreach-attribution` cron running.
- Admin dashboard widget showing CTR, conversion rate per cohort.

---

## Success Metrics (30 days after M4)

- **5% CTR** to `/directory-pricing` (opens × clicks)
- **1% conversion** per cohort to any paid tier within 30 days of click
- **Bounce rate < 2%** (healthy sender reputation)
- **Complaint rate < 0.08%** (Resend threshold; exceeding this throttles sending)
- **Opt-out rate < 1%** (industry healthy range for cold outreach)

Any metric failing → hold sends, investigate, tune.

---

## Risks + Open Decisions

- **Deliverability.** Cold outreach from a newly-warmed domain is the biggest risk. Warmup schedule is conservative; exceed it at our peril.
- **Sender reputation.** If CD's transactional email (CreditScore, tool receipts) is on the same sending domain, any spam-flag hit damages both. The subdomain split (`send.coherencedaddy.com` separate from `coherencedaddy.com`) is non-negotiable.
- **Over-personalization backfire.** If Prism references a detail that turns out to be wrong (wrong project, stale news), the email feels creepy. Mitigation: personalization is optional — only include it when confidence > threshold.
- **Content pipeline honesty gate (see top of doc).** Cannot emphasize enough.
- **Brand dilution.** If outreach reads salesy, it hurts the faith-based nonprofit brand. Template review by a non-engineer before M3.

---

## Dependencies

- **Upstream:** Initiative A (more companies = more outreach material).
- **Upstream:** Blaze + Prism + Sage content pipeline actually firing (the honesty gate).
- **Upstream:** `directory-pricing?slug=…` pre-fill on storefront (currently tracked in `coherencedaddy-landing/TODO.md` — needs to land before M3 for the CTA link to actually help).
- **Downstream:** Initiative C (prospects) reuses the same outreach + opt-out plumbing; build the shared pieces here with that reuse in mind.

---

## Post-Ship Documentation Updates

When M4 completes (warmup done, steady-state sending):
- `team-dashboard/docs/architecture/system-overview.md` — add outreach arrow from intel DB → Resend → storefront receiver → team-dashboard attribution sweep.
- `team-dashboard/docs/operations/cron-inventory.md` — list the 3 new crons.
- `team-dashboard/docs/products/directory-listings-prd.md` — cross-link the outreach mechanism as the primary lead source.
- Mermaid diagram in `coherencedaddy-landing/docs/ARCHITECTURE.md` — add outreach flow.
- Close Initiative B checkboxes in `TODO.md`.
