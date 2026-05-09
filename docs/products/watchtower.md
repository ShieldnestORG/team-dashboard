# Watchtower — Brand Mention Monitor (v1)

> The cheap, in-house alternative to Profound / Peec ($300–$1,500/mo SaaS) for tracking how AI answer engines (ChatGPT, Claude, Perplexity, Gemini) talk about a brand. v1 = the smallest thing that's useful. Not a marketing-claims product yet.

## Pricing

| Plan | Price | Cadence | Engines | Prompt cap | Surfaces |
|---|---|---|---|---|---|
| **Watchtower** | **$29 / month** recurring | Weekly | All four (chatgpt, claude, perplexity, gemini) | 25 prompts (system hard-cap 50) | Weekly digest email + read-only run viewer at `/api/watchtower/runs/:id` |

Stripe price ID lives in `docs/deploy/stripe-products.md`. Frequency `daily` is reserved for a future upsell tier — no cron is wired for it in v1.

## What it does

- A **subscription** is one `(brand_name, domain, prompts[])` bundle.
- Every Monday 09:00 UTC the cron `watchtower:weekly-runs` selects every `status='active'` AND `frequency='weekly'` subscription and runs each prompt against each enabled engine.
- One row per `(prompt, engine)` lands in `watchtower_results` with: `mentioned`, `sentiment`, `excerpt`, `raw_response` (capped 8 KB), `latency_ms`.
- One `watchtower_runs` row aggregates the cycle and stores a JSONB summary used by the email digest (per-engine mention counts + top-3 excerpts).
- A digest email is sent to `WATCHTOWER_DIGEST_EMAIL` (single broadcast address until per-account email lookup ships with Worker A's portal).

## v1 detection — DO NOT use these signals for marketing claims

Two design decisions deliberately trade fidelity for shipping speed; both are flagged in code comments and have explicit v2 follow-up tasks.

### Mention detection

- **Rule:** case-insensitive substring of `brand_name` OR `domain` in the response text.
- **False positives:** common-word brand names ("Apple", "Notion", "Vercel") fire on incidental mentions in code blocks, URLs, fictional examples.
- **False negatives:** paraphrased mentions ("the company that makes the design tool"), pronoun-only references after the first sentence.

**v2 plan:** small Haiku one-shot classifier (`is the response talking about $brand? yes/no/maybe`) — cost is negligible at the volumes we operate at and removes most false positives.

### Sentiment

- **Rule:** keyword bag.
  - `positive` if response contains brand AND any of `recommend, best, great, leading`
  - `negative` if response contains brand AND any of `avoid, bad, poor, scam`
  - else `neutral`. Empty response = `unknown`.
- **Why this is bad:** any AI-style "you might want to avoid X if Y" trips negative; "Stripe is the leading processor" trips positive even when paraphrasing third-party copy.

**v2 plan:** classifier prompt that returns `{positive | neutral | negative}` against the surrounding ±200 chars of the brand mention.

## Prompt cap rationale

- **Default 25** prompts/subscription. Most operators don't have more than ~10 distinct buyer-intent queries; 25 is the SaaS-norm sweet spot.
- **Hard ceiling 50.** Enforced in `services/watchtower-monitor.ts` (`HARD_PROMPT_CEILING`). Per `CLAUDE.md` cost protection — a runaway prompt list at 50 × 4 engines = 200 LLM calls per subscription per run; at the math below that's still under $0.05/run, but we want the budget brake to be deliberate.

## Cost per run (default 25 prompts × 4 engines = 100 calls)

Order-of-magnitude estimates at v1 model choices and ~600 max output tokens. Treat as ceiling — most prompts return less.

| Engine | Model | Per-call ~cost | 25 prompts/week | Notes |
|---|---|---|---|---|
| ChatGPT | gpt-4o-mini | ~$0.0003 | ~$0.0075 | Cheapest of the four |
| Claude | claude-haiku-4-5 | ~$0.001 | ~$0.025 | Override via `WATCHTOWER_CLAUDE_MODEL` if quality needs Sonnet |
| Perplexity | sonar | ~$0.001 | ~$0.025 | Includes citation overhead |
| Gemini | gemini-2.0-flash | ~$0.00015 | ~$0.004 | Skipped if `GEMINI_API_KEY` unset |
| **Total / week** | | | **≈ $0.06** | |
| **Total / month** | | | **≈ $0.25** | |

**Margin on $29 retail:** ~99%. Even with 10× actual token usage we stay >95% gross margin, which is why this product exists.

## Env vars (which engines are gated on what)

| Var | Required for | If missing |
|---|---|---|
| `OPENAI_API_KEY` | ChatGPT engine | Adapter `enabled()` returns false → engine skipped, single warning log per run |
| `ANTHROPIC_API_KEY` | Claude engine | Same skip-with-warning behavior |
| `PERPLEXITY_API_KEY` | Perplexity engine | Same |
| `GEMINI_API_KEY` | Gemini engine | Same — explicitly mandated to skip-not-crash by the spec |
| `WATCHTOWER_CLAUDE_MODEL` | optional override | defaults to `claude-haiku-4-5` |
| `WATCHTOWER_CALLBACK_KEY` | digest email HMAC | digest send is no-op'd with a warning |
| `WATCHTOWER_EMAIL_CALLBACK_URL` | storefront receiver override | falls back to `https://freetools.coherencedaddy.com/api/email/watchtower` |
| `WATCHTOWER_DIGEST_EMAIL` | single recipient v1 | digest is computed but not sent (logged) |
| `INTERNAL_API_TOKEN` | `/runs/:id/trigger-test` route | route returns 503 |

If **all four** engine keys are missing, `runSubscription()` throws `no engines enabled` — the cron's per-subscription error capture turns this into a logged error per row, not a process crash.

## API surface (read-only in v1)

Mounted at `/api/watchtower` by `app.ts`. CRUD lives with Worker A's portal once the Stripe webhook + portal-auth path lands.

| Route | Purpose |
|---|---|
| `GET /subscriptions/:id` | Subscription row + last 4 runs (summary only) |
| `GET /runs/:id` | One run + every per-result row |
| `POST /runs/:id/trigger-test` | INTERNAL — runs the subscription whose id is in the path. Gated on `X-Internal-Token` header matching `INTERNAL_API_TOKEN` env. Dev/QA helper. |

## Files

- Migrations: `packages/db/src/migrations/0109_watchtower.sql`,
  `packages/db/src/migrations/0111_watchtower_stripe_columns.sql`
- Drizzle schema: `packages/db/src/schema/watchtower.ts`
- Service: `server/src/services/watchtower-monitor.ts`
- Engine adapters: `server/src/services/watchtower-engines/*.ts`
- Cron: `server/src/services/watchtower-cron.ts`
- Read-only routes: `server/src/routes/watchtower.ts`
- Checkout + webhook: `server/src/routes/watchtower-checkout.ts`
- Stripe handlers: `server/src/services/watchtower-stripe-handler.ts`
- Email callback: `server/src/services/watchtower-email-callback.ts`
- Tests: `server/src/__tests__/watchtower-monitor.test.ts`,
  `watchtower-engines.test.ts`, `watchtower-stripe-handler.test.ts`

## Open follow-ups (post-v1)

1. Per-account email lookup — replace `WATCHTOWER_DIGEST_EMAIL` broadcast with `subscription.account_id → user.email` join once Worker A wires the accounts table.
2. v2 mention detection (Haiku one-shot classifier).
3. v2 sentiment classifier.
4. Daily-frequency cron (currently the schema accepts `'daily'` but no cron is wired).
5. Storefront-side `/api/email/watchtower` Resend template (mirrors `lib/creditscore-email.ts`).
6. Portal CRUD + dashboard read view (Worker A).
7. Structure diagram update — register the watchtower service in `ui/src/pages/Structure.tsx` `DEFAULT_DIAGRAM`.

## Changelog

- **2026-05-09** — v1 initial. Migration 0109, 4 engine adapters, weekly cron, read-only API.
- **2026-05-09** — Stripe checkout + webhook + provisioning. Migration 0111
  (adds `stripe_customer_id`, `plan`, `email`; loosens status CHECK to allow
  `past_due`). New `POST /api/watchtower/checkout` route (lookup_key + env
  fallback price resolution) and `POST /api/watchtower/webhook` handler
  covering `checkout.session.completed`,
  `customer.subscription.updated`, and `customer.subscription.deleted`.
  All handlers idempotent. Customer-account-linker is chained on checkout
  so portal-auth can later resolve the customer.
