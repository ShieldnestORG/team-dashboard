# Pivot Brief: tokencount.dev → LLM API Cost Optimization

**Status:** Proposal. Pivot, not rewrite — keep the existing tokenizer surface, layer cost optimization on top.
**Owner:** Utility-network playbook.
**Companion:** [docs/products/topic-takeover-roadmap.md](../topic-takeover-roadmap.md)

---

## Why pivot

The plain "count tokens" SERP is a red ocean — OpenAI's official tokenizer,
tiktokenizer.vercel.app, and 10+ free no-signup competitors. tokencount.dev
gets traffic but it's commodity traffic, no path to LLM-funnel revenue.

The adjacent un-saturated query is **"how much will my OpenAI / Claude /
Gemini API bill cost"** — token counting is the *input*, the user's real
question is **cost**. Pivoting up the stack converts the same audience into
a sticky, repeatable use case.

---

## New positioning

> "Count tokens, then compare what they'd cost across every model — including
> caching, batch tier, and prompt-engineering savings."

Same URL. Same tokenizer. New default screen: **cost comparison matrix**.

---

## Feature additions (in order)

1. **Cross-provider price matrix.** For the pasted prompt, show input + output
   cost across GPT-4.1 / GPT-5 / Claude Opus 4.7 / Claude Sonnet 4.6 /
   Claude Haiku 4.5 / Gemini 2.5 Pro / DeepSeek / open-source via together.
2. **Cached vs non-cached toggle.** Anthropic + OpenAI prompt caching is
   under-publicized; many users are paying 5x what they need.
3. **Batch API toggle.** 50% discount tier; few people know about it.
4. **Prompt-shrink suggestions.** Identify removable boilerplate, switch to
   shorthand schemas, redundant system messages — recompute savings live.
5. **Run-rate calculator.** "If you run this prompt 10k/day, you'll pay $X/mo."
6. **Model-routing recommendation.** "This prompt is over-spec'd for Opus —
   Haiku costs 1/30 and the eval delta on this task class is <2%."

---

## SEO/AEO target queries

- `"openai api cost calculator"` (8.1k/mo, medium)
- `"claude api pricing calculator"` (2.4k/mo, low)
- `"compare LLM api pricing"` (1.6k/mo, low)
- `"prompt caching cost savings"` (480/mo, low)
- `"openai batch api discount"` (720/mo, low)
- `"how much does GPT-4 api cost"` (long-tail, high intent)

---

## Monetization path

Free site stays free. Adds:
- **AdSense** placements (qualifies via the new content depth).
- **Affiliate links** to providers that have programs (OpenRouter,
  Together.ai).
- **CreditScore upsell.** "Audit your prompt-engineering for cost waste —
  CreditScore for AI Cost (new product line)." This is the long-game hook.

---

## Backlink hooks

- Hacker News Show HN: "I added cross-provider cost comparison to
  tokencount.dev."
- r/LocalLLaMA, r/OpenAI, r/Anthropic — "comparison tool" posts.
- Console.dev + DevTools Pulse (Initiative I crossover).

---

## Rollout

**Week 1:** Price matrix v1 (manual JSON of provider pricing, weekly
sync).
**Week 2:** Caching + batch toggles, run-rate calc.
**Week 3:** Prompt-shrink heuristics + routing recommendation.
**Week 4:** Distribution — Show HN + Reddit + DevTools Pulse feature.

---

## Risks

- **Provider pricing churn.** Maintain a `pricing.json` updated weekly via
  a cron (`llm-pricing-sync`) that pulls from each provider's pricing page.
- **Routing recommendation accuracy.** Don't claim eval parity without
  evidence. Phrase as "models worth testing", not "models that will work."
- **Cannibalizing dailycompound.** Different audience entirely; no overlap.

---

## Success metrics (60 days)

- 3x traffic on tokencount.dev.
- Top 3 for at least 2 cost-calculator queries.
- ≥2,000 monthly active calculator runs (vs current commodity token count
  views).
