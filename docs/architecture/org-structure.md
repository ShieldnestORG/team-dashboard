# Org Structure — Coherence Daddy Ecosystem

> Business / organizational view of the 508(c)(1)(A) ecosystem — who owns what, which repo deploys where, and how the storefronts fan out. Complements:
> - `docs/architecture/system-overview.md` — technical control-plane overview
> - `docs/guides/board-operator/org-structure.md` — agent reporting hierarchy (different "org")

---

## High-Level Org Chart

```mermaid
graph TB
    %% ── Governance / legal entity ────────────────────────────────
    subgraph GOV["508(c)(1)(A) Faith-Based Mission Org"]
        CD["Coherence Daddy\n(mission hub — coherencedaddy.com)"]
    end

    %% ── Builder arm ─────────────────────────────────────────────
    subgraph BUILDER["Build / Infra Arm"]
        SN["ShieldNest\n(shieldnest.org — privacy-first dev co,\nbuilds all ecosystem infra)"]
    end

    CD --> SN

    %% ── Product ventures (consumer) ─────────────────────────────
    subgraph PRODUCTS["Consumer Products & Properties"]
        YA["YourArchi — yourarchi.com\n(flagship self-help / notes app)"]
        TXF["tokns.fi — crypto / NFT / staking platform\n(+ app.tokns.fi dashboard)"]
        TX["TX Blockchain — tx.org\n(Cosmos SDK chain, validator)"]
        DAO["Trustee DAO — dao.nestd.xyz\n(VPS4 — DAO governance)"]
        ROLL["rollwithsolo.com / runatthebullets.com\n(ShieldNest properties, VPS3)"]
    end

    SN --> YA
    SN --> TXF
    SN --> TX
    SN --> DAO
    SN --> ROLL

    %% ── coherencedaddy.com subdomains (storefront repo) ─────────
    subgraph SUBDOMAINS["coherencedaddy.com subdomains\n(one Next.js app — ShieldnestORG/coherencedaddy repo)"]
        S_LAND["/ — landing / donate"]
        S_FREE["freetools — 500+ tools"]
        S_DIR["directory — intel"]
        S_TOK["token — Daddy token"]
        S_PART["partners — AEO network\n(self-serve funnel at /partners-pricing)"]
        S_CS["creditscore — SEO audit"]
        S_LAW["law — legal AI"]
        S_OPT["optimize-me — privacy notes"]
        S_SHOP["shop — merch PREVIEW only"]
    end

    CD --> SUBDOMAINS

    %% ── Authoritative shop (Hostinger) ──────────────────────────
    subgraph SHOP["shop.coherencedaddy.com — authoritative commerce"]
        HOST["Hostinger WordPress\noutrizzd.shop"]
        WOO["WooCommerce core\n(cart · checkout · orders · WooPayments)"]
        PF["Printful plugin\n(apparel, hats, bags)"]
        PY["Printify plugin\n(mugs, stickers)"]
        MAN["Manually-listed\n(first-party merch, bundles, digital)"]

        HOST --> WOO
        WOO --> PF
        WOO --> PY
        WOO --> MAN
    end

    S_SHOP -.->|link-out checkout| HOST

    %% ── Control plane (this repo) ───────────────────────────────
    subgraph TD["team-dashboard (this repo) — 31.220.61.12:3200"]
        ADMIN["Admin control plane\n(agents · intel · content · pricing · Stripe · crons)"]
    end

    SN --> TD
    ADMIN -.->|site metrics ingest| CD
    ADMIN -.->|Stripe · entitlements · blog publish| SUBDOMAINS
```

---

## Org / Ownership Matrix

| Layer | Entity | What it owns |
|---|---|---|
| **Governance** | Coherence Daddy (508(c)(1)(A)) | Mission, donations, brand, public-facing hub |
| **Build arm** | ShieldNest | All ecosystem repos, infra, VPS fleet, blockchain validator |
| **Flagship product** | YourArchi | yourarchi.com — private self-help / notes app |
| **Crypto layer** | tokns.fi + TX Blockchain | Token, staking, NFT platform, Cosmos validator |
| **Governance DAO** | Trustee DAO | On-chain ecosystem governance |
| **Public storefront (marketing)** | `ShieldnestORG/coherencedaddy` Next.js app | 9 subdomains, blog, LLM discovery, donations |
| **Authoritative commerce** | Hostinger WordPress + WooCommerce | Cart, checkout, orders, fulfillment, payments |
| **Control plane** | `ShieldnestORG/team-dashboard` (this repo) | Agents, intel, content publishing, pricing, Stripe, crons |

---

## Shop Storefront Detail

`shop.coherencedaddy.com` has **two tiers**:

1. **Preview tier (Next.js, Vercel)** — `app/shop-home/page.tsx` in the coherencedaddy repo. Uses `lib/printify.ts` to render a browse grid for SEO and marketing. No cart state, no checkout, no payment handling.
2. **Commerce tier (WordPress + WooCommerce on Hostinger)** — the actual store. Aggregates three product sources under one cart:
   - **Printful plugin** — POD fulfillment (apparel, hats, bags, embroidered items)
   - **Printify plugin** — POD fulfillment (mugs, stickers, alt catalog)
   - **Manual products** — first-party merch, digital goods, bundles

Why two tiers: the Vercel app can't host a compliant PCI/tax/shipping stack cheaply, and WooCommerce already solves the aggregation-across-POD problem via its plugin ecosystem. The Next.js preview gets SEO + brand consistency; Hostinger gets the messy commerce work.

**API key storage:** each POD plugin stores its own API key in WordPress `wp_options` (scoped per-plugin). Keys never live in any Git repo — they're set once in `wp-admin → <Provider> → Settings`.

**Categories as source tags:** products use WooCommerce categories like `Apparel - Printful`, `Drinkware - Printify`, `Coherence Daddy Originals` so the storefront can filter/section by source while keeping cart + checkout unified.

> See `coherencedaddy-landing/memory/project_shop_architecture.md` and `coherencedaddy-landing/docs/ARCHITECTURE.md#shop-storefront--hostinger-woocommerce-authoritative` for the counterpart repo-side notes.

---

## Data Flow Between Layers

```mermaid
sequenceDiagram
    participant User
    participant Vercel as Next.js (Vercel)<br/>shop.coherencedaddy.com
    participant Woo as WooCommerce (Hostinger)
    participant POD as Printful / Printify
    participant TD as team-dashboard (VPS)

    User->>Vercel: Browse merch preview grid
    Vercel->>Vercel: lib/printify.ts fetch (cached 5m)
    User->>Vercel: Click "Buy"
    Vercel-->>User: Redirect to Woo product page
    User->>Woo: Add to cart + checkout (WooPayments)
    Woo->>POD: Order fulfillment via plugin
    POD-->>Woo: Tracking + status
    Woo-->>User: Order confirmation email
    Vercel->>TD: Daily metrics push (/api/metrics/report)
```

---

## Future States / Open Questions

- **Domain mapping:** `shop.coherencedaddy.com` currently resolves to the Next.js preview. When WooCommerce launches, either (a) map it directly to Hostinger and move the preview to a subpath, or (b) keep preview at `shop.*` and point the "Buy" CTAs to `store.coherencedaddy.com` on Hostinger. Pending decision.
- **Order events back into team-dashboard:** no webhook exists yet. When implemented, add a WooCommerce webhook → team-dashboard ingest endpoint so order analytics flow into the control plane alongside site metrics.
- **Third POD / dropship provider:** architecture supports it — install another plugin + add a category. No cross-repo coordination required.
