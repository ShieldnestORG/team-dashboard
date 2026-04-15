# Hostinger DNS Setup — Coherence Daddy Ecosystem
**Date:** 2026-04-14

## Required DNS Records

Add these in Hostinger DNS Manager for `coherencedaddy.com`:

| Type | Name | Value | TTL | Notes |
|------|------|-------|-----|-------|
| A | `@` | `76.76.21.21` | 3600 | Vercel IP for coherencedaddy.com root |
| CNAME | `www` | `cname.vercel-dns.com` | 3600 | Vercel www redirect |
| CNAME | `directory` | `cname.vercel-dns.com` | 3600 | directory.coherencedaddy.com → Vercel |
| CNAME | `freetools` | `cname.vercel-dns.com` | 3600 | freetools.coherencedaddy.com → Vercel |
| CNAME | `token` | `cname.vercel-dns.com` | 3600 | token.coherencedaddy.com → Vercel |
| A | `api` | `31.220.61.12` | 3600 | api.coherencedaddy.com → VPS backend |
| A | `shop` | (Shopify IP or CNAME) | 3600 | shop.coherencedaddy.com → Shopify/Printify |

## Verify in Vercel Dashboard

For each subdomain that goes to Vercel, you must ALSO add it in the Vercel project settings:
1. Go to your Vercel project → Settings → Domains
2. Add `directory.coherencedaddy.com`, `freetools.coherencedaddy.com`, `token.coherencedaddy.com`
3. Vercel will verify each domain via the CNAME

## VPS (api.coherencedaddy.com)

The A record pointing to `31.220.61.12` is handled by Caddy on the VPS.
Caddy auto-provisions HTTPS via Let's Encrypt — no SSL cert needed from Hostinger.

## Caddy Config (reference)

The `Caddyfile` in the repo root handles:
- `api.coherencedaddy.com` → Express :3100 (API + admin dashboard)
- All subdomains routed via `reverse_proxy localhost:3100`

## Currently Confirmed Working
- `coherencedaddy.com` → Vercel ✅
- `api.coherencedaddy.com` → VPS ✅ (Caddy + Let's Encrypt)
- `directory.coherencedaddy.com` → launched 2026-04-12 ✅
- `firecrawl.coherencedaddy.com` → VPS_4 (`168.231.127.180`) ✅ (Nginx + Let's Encrypt, cert issued 2026-04-14, expires 2026-07-14)

## New — No New Domains Needed
The AEO marketing push uses existing domains. `/directory-pricing` is served from the VPS admin UI (accessible at `api.coherencedaddy.com/directory-pricing`). The public enrollment endpoint `POST /api/directory-listings/public/enroll` is already reachable via the Vercel `/api/*` rewrite rule in `vercel.json`.
