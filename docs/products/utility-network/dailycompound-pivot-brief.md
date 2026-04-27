# Pivot Brief: dailycompound.app → Crypto Yield Compound Calculator

**Status:** Proposal. Pivot up-stack from generic compound interest into crypto-yield compounding.
**Owner:** Utility-network playbook.
**Companion:** [docs/products/topic-takeover-roadmap.md](../topic-takeover-roadmap.md)

---

## Why pivot

Generic "daily compound interest calculator" is saturated — investor.gov,
calculator.net, NerdWallet, MoneyChimp, plus 20+ no-signup tools.
dailycompound.app gets some long-tail but the SERP ceiling is low.

The un-saturated adjacent query is **"how much will my staked / restaked /
LP'd crypto compound to"** — generic compound calculators don't handle
variable APR, restaking auto-compound cadence, or yield-source switching.
Crypto users currently use spreadsheets.

This pivot also creates a tight feedback loop with **Initiative E
(EigenLayer/Restaking AVS Directory)** — every LRT in that directory has a
"calculate compound" deep link to dailycompound.app.

---

## New positioning

> "The compound-yield calculator for crypto — restaking, LP, vault
> auto-compounders, with live APRs from DefiLlama."

Same URL. Generic compound calc moves to a `/classic` subpath.

---

## Feature additions (in order)

1. **Live APR import.** Type a token / vault / LRT name, autocomplete from
   DefiLlama yields API, populate APR.
2. **Auto-compound cadence selector.** Daily / weekly / per-block / on-claim
   manual. Each LRT or vault gets a sensible default.
3. **Switching scenarios.** "What if I move from Lido to ether.fi at month
   3?" — multi-leg compounding.
4. **Gas/fee modeling.** Each compound step has an estimated gas cost.
   Auto-recommend optimal compound interval given gas ↔ APR tradeoff.
5. **Tax-aware mode.** Optional toggle that flags taxable events at each
   compound (US default, simplified).
6. **Cross-link to directory.** Each LRT/vault links to its
   `directory.coherencedaddy.com/restaking/[slug]` profile.

---

## SEO/AEO target queries

- `"restaking compound calculator"` (320/mo, ~zero competition)
- `"LRT yield calculator"` (480/mo, low)
- `"defi yield compound calculator"` (1.2k/mo, low)
- `"ether.fi APR calculator"`, `"renzo restaking calculator"` (long-tail
  branded; capture per-protocol)
- `"optimal compound frequency crypto"` (210/mo, low)

---

## Monetization path

- **AdSense** (current).
- **Affiliate** to staking aggregators (Stakefish, P2P, Figment) where they
  have programs.
- **Cross-product traffic** to directory.coherencedaddy.com/restaking — the
  enriched profile pages have their own monetization.

---

## Backlink hooks

- r/eigenlayer, r/ethstaker, r/defi — "free APR calculator with live data".
- Bankless newsletter mention (the "tools we use" sections).
- DefiLlama community — they cite tools that consume their API thoughtfully.

---

## Rollout

**Week 1:** DefiLlama yields API integration; live APR autocomplete.
**Week 2:** Auto-compound cadence + gas modeling.
**Week 3:** Switching scenarios, tax-aware mode.
**Week 4:** Cross-link to Initiative E directory; backlink push.

---

## Risks

- **DefiLlama rate limits.** Cache aggressively; precompute top 50 LRTs.
- **Yield volatility.** Make it clear the calc is point-in-time. Add an
  "uncertainty band" input (±X% APR variance).
- **Tax complexity.** Tax-aware mode is a footgun — keep it US-only,
  simplified, with a prominent "not advice" disclaimer.

---

## Success metrics (60 days)

- 5x traffic on dailycompound.app vs pre-pivot baseline.
- Top 3 for `"restaking compound calculator"`, `"LRT yield calculator"`.
- ≥30% click-through to directory.coherencedaddy.com/restaking from
  embedded profile links.
