# Hostinger DNS — What to Add Right Now

Last updated: 2026-04-14

This is your punch list for Hostinger DNS. Everything below goes under
**Hostinger → Domains → coherencedaddy.com → DNS / Nameservers → Manage DNS
Records**. You only need to touch one zone — `coherencedaddy.com` — because
every subdomain we care about is a CNAME under that zone.

## Current DNS state (verified 2026-04-14)

All 6 existing subdomains already resolve and serve `200 OK`:

| Subdomain | Status | Serves |
|---|---|---|
| `coherencedaddy.com` (apex + www) | ✅ live | Next.js landing (Vercel) |
| `directory.coherencedaddy.com` | ✅ live | Directory home (Vercel, middleware rewrite) |
| `freetools.coherencedaddy.com` | ✅ live | 523+ free tools (Vercel, middleware rewrite) |
| `token.coherencedaddy.com` | ✅ live | Daddy Token migration (Vercel, middleware rewrite) |
| `law.coherencedaddy.com` | ✅ live | Coherence Law (Vercel, middleware rewrite) |
| `optimize-me.coherencedaddy.com` | ✅ live | YourArchi / OptimizeMe (Vercel, middleware rewrite) |
| `shop.coherencedaddy.com` | ✅ live | Stripe + Printify shop |
| `partners.coherencedaddy.com` | ❌ not configured | **(needs DNS — see below)** |

**Do not touch any of the ✅ rows — they are already correct. The only action
item is partners.**

---

## Action 1 — Add `partners.coherencedaddy.com` (required for partner expansion)

The partner-network expansion is building a public-facing partner directory
at `partners.coherencedaddy.com`. Hostinger needs one new CNAME record.

### Step 1: Add DNS record in Hostinger

**Hostinger → coherencedaddy.com → DNS/Nameservers → Manage DNS records → Add record**

| Field | Value |
|---|---|
| Type | `CNAME` |
| Name | `partners` |
| Target / Points to | `cname.vercel-dns.com` |
| TTL | `3600` (1 hour) — or whatever Hostinger calls "default" |

Save. Propagation usually takes 1–5 minutes on Hostinger's resolvers, up to 15
minutes worst case.

### Step 2: Add domain in Vercel

After the DNS propagates, go to **Vercel → Project `coherencedaddy` → Settings
→ Domains → Add**, type `partners.coherencedaddy.com`, click Add. Vercel
verifies via the CNAME you just created and auto-issues a Let's Encrypt cert
(~30 seconds).

Tell me when this is done and I'll verify it resolves, then roll out the
`partners.` middleware rewrite and subdomain landing page in the next commit.

---

## Action 2 — Verification TXT records for new Bing Webmaster properties

If you're adding `partners.coherencedaddy.com` (and any other new subdomain) to
Bing Webmaster Tools for sitemap submission, Bing will ask for a TXT record.
Same pattern for every subdomain:

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `partners` (or whatever subdomain) |
| Value | (copy from Bing Webmaster Tools verification prompt) |
| TTL | `3600` |

You may not need to do this — Bing usually accepts file-based verification
via `BingSiteAuth.xml`, which I can add to the repo directly. But if you
prefer DNS verification, use the above.

---

## Action 3 — Verify Google Search Console ownership for subdomains

Each subdomain is a **separate property** in GSC. Check **Search Console →
Property selector** and confirm these all exist:

- `https://coherencedaddy.com` (or `sc-domain:coherencedaddy.com` for the
  unified domain property — this is the best option because it covers *all*
  subdomains in one property)
- `https://directory.coherencedaddy.com`
- `https://freetools.coherencedaddy.com`
- `https://token.coherencedaddy.com`
- `https://optimize-me.coherencedaddy.com`
- `https://law.coherencedaddy.com`
- `https://partners.coherencedaddy.com` (add after Action 1 completes)

**Recommendation:** use the **Domain property** `sc-domain:coherencedaddy.com`
if you haven't already. One DNS TXT record, one property, covers every current
and future subdomain in one place. If GSC asks for the verification TXT:

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `@` (apex) |
| Value | `google-site-verification=...` (copy from GSC prompt) |
| TTL | `3600` |

If the Domain property is already verified, skip this.

---

## Action 4 — (Optional, later) Email deliverability for coherencedaddy.com

Not urgent, but if you ever send partner outreach email from
`@coherencedaddy.com` (Proton Mail is already set up for alerts per your
`SMTP_*` env vars), you'll want:

- **SPF:** `TXT @ "v=spf1 include:_spf.protonmail.ch ~all"`
- **DKIM:** CNAMEs from Proton's admin panel (`protonmail._domainkey`,
  `protonmail2._domainkey`, `protonmail3._domainkey`)
- **DMARC:** `TXT _dmarc "v=DMARC1; p=quarantine; rua=mailto:postmaster@coherencedaddy.com"`

These are only needed if you plan to email partners from the CD domain. Skip
for now unless you're launching partner outreach this week.

---

## Summary — do this in order

1. **Right now:** Add the `partners` CNAME in Hostinger (Action 1, Step 1).
2. **After ~5 minutes:** Add `partners.coherencedaddy.com` in Vercel (Action 1, Step 2).
3. **Tell me when done.** I'll verify it resolves + serves + has a cert, then ship the middleware rewrite and the partner subdomain landing page.
4. **Sometime this week:** Verify the GSC Domain property (Action 3) if you haven't already — unlocks unified reporting across all subdomains.
5. **Skip Actions 2 and 4** unless a specific tool asks for them.

Total work on your side: **one DNS record + one Vercel domain add**. ~2 minutes of clicking.
