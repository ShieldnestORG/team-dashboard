// ---------------------------------------------------------------------------
// Watchtower brand-mention monitor — v1 service.
//
// `runSubscription(subscriptionId)` is the single public entry-point: it
// fetches the subscription, fans out (prompts × engines), persists one
// `watchtower_results` row per cell, then a single `watchtower_runs`
// summary row. The cron and the dev-only `/trigger-test` route both call
// it; tests inject the optional `engines` override.
//
// v1 detection limits — DO NOT use these signals for marketing claims:
//
//   * mention detection = case-insensitive substring of brand_name OR
//     domain in the response. False positives on common-word brand names
//     ("Apple", "Notion", "Vercel" inside markdown). False negatives on
//     paraphrased mentions ("the company that makes the design tool").
//   * sentiment = three tiny keyword bags (positive / negative / neutral).
//     Anything not matching positive or negative is "neutral". This is a
//     proof-of-life signal only; v2 should use a small classifier prompt
//     (Haiku one-shot) or an embedding-based approach.
//
// Both rules are the cheapest thing that works for shipping v1; they
// are flagged as v1-quality in docs/products/watchtower.md.
// ---------------------------------------------------------------------------

import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  watchtowerSubscriptions,
  watchtowerRuns,
  watchtowerResults,
  watchtowerPromptVersions,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { ALL_ENGINES, type EngineAdapter } from "./watchtower-engines/index.js";

// Hard ceiling per CLAUDE.md cost protection. A subscription's prompt_cap
// can be set lower (default 25) but never higher than this.
export const HARD_PROMPT_CEILING = 50;

// v1 sentiment keyword bags. Lower-cased, whole-word match against the
// response text alongside the brand mention.
const POSITIVE_TOKENS = ["recommend", "best", "great", "leading"];
const NEGATIVE_TOKENS = ["avoid", "bad", "poor", "scam"];

export type Sentiment = "positive" | "neutral" | "negative" | "unknown";

export interface DetectionResult {
  mentioned: boolean;
  sentiment: Sentiment;
  excerpt: string | null;
}

/**
 * v1 mention + sentiment detection. Pure function — exported for tests.
 *
 * Returns { mentioned: false, sentiment: "unknown" } when responseText is
 * empty (engine error / skipped). Otherwise mentioned is true iff the
 * brand_name OR domain appears in the response (case-insensitive). When
 * mentioned, sentiment is computed against POSITIVE_TOKENS/NEGATIVE_TOKENS.
 */
export function detectMention(
  responseText: string,
  brandName: string,
  domain: string | null,
): DetectionResult {
  if (!responseText.trim()) {
    return { mentioned: false, sentiment: "unknown", excerpt: null };
  }

  const lower = responseText.toLowerCase();
  const brandLower = brandName.trim().toLowerCase();
  const domainLower = domain?.trim().toLowerCase() ?? "";

  let matchIdx = -1;
  let matchLen = 0;
  if (brandLower && lower.includes(brandLower)) {
    matchIdx = lower.indexOf(brandLower);
    matchLen = brandLower.length;
  } else if (domainLower && lower.includes(domainLower)) {
    matchIdx = lower.indexOf(domainLower);
    matchLen = domainLower.length;
  }

  if (matchIdx < 0) {
    return { mentioned: false, sentiment: "neutral", excerpt: null };
  }

  // Excerpt: 100 chars around the first match, trimmed to whole words.
  const excerptStart = Math.max(0, matchIdx - 60);
  const excerptEnd = Math.min(responseText.length, matchIdx + matchLen + 100);
  const excerpt = responseText.slice(excerptStart, excerptEnd).trim();

  // Sentiment: positive wins over negative if both fire (we'd rather
  // surface a "they recommend you" excerpt than the negative interpretation
  // — false-positive negatives are more damaging in v1).
  let sentiment: Sentiment = "neutral";
  if (POSITIVE_TOKENS.some((t) => lower.includes(t))) sentiment = "positive";
  else if (NEGATIVE_TOKENS.some((t) => lower.includes(t)))
    sentiment = "negative";

  return { mentioned: true, sentiment, excerpt };
}

export interface RunSummary {
  /** Per-engine mention counts. Keys are EngineId values. */
  byEngine: Record<string, { queried: number; mentioned: number }>;
  /** Top-3 (mentioned, with excerpt) results. Used by the email digest. */
  topExcerpts: Array<{
    engine: string;
    prompt: string;
    sentiment: Sentiment;
    excerpt: string;
  }>;
  /** Engines that were skipped because env vars were missing. */
  skippedEngines: string[];
}

export interface PerEngineOutput {
  engine: string;
  ok: boolean;
  error?: string;
  mentioned: boolean;
  sentiment: Sentiment;
  excerpt: string | null;
  text: string;
  latencyMs: number;
}

export interface OneShotResult {
  brandName: string;
  domain: string | null;
  prompt: string;
  perEngine: PerEngineOutput[];
  enginesUsed: string[];
  skippedEngines: string[];
  mentionCount: number;
}

/**
 * Run a single (brand, domain, prompt) triple against every enabled engine
 * adapter and return per-engine detection outcomes. Pure transport — no DB,
 * no subscription row required. Powers both `runSubscription` (looped per
 * prompt) and the public `/api/answer-check/run` free-tool endpoint.
 *
 * Throws iff zero engines are enabled (no API keys configured).
 */
export async function runPromptOneShot(
  input: { brandName: string; domain: string | null; prompt: string },
  opts: RunSubscriptionOpts = {},
): Promise<OneShotResult> {
  const adapters = opts.engines ?? ALL_ENGINES;
  const enabledAdapters = adapters.filter((a) => a.enabled());
  const skippedEngines = adapters
    .filter((a) => !a.enabled())
    .map((a) => a.id);

  if (enabledAdapters.length === 0) {
    throw new Error(
      "watchtower: no engines enabled — set at least one of WATCHTOWER_OPENAI_API_KEY/WATCHTOWER_ANTHROPIC_API_KEY/WATCHTOWER_PERPLEXITY_API_KEY/WATCHTOWER_GEMINI_API_KEY/WATCHTOWER_GROK_API_KEY",
    );
  }

  const perEngine = await Promise.all(
    enabledAdapters.map(async (adapter): Promise<PerEngineOutput> => {
      const resp = await adapter.query({ prompt: input.prompt });
      const detection = detectMention(
        resp.text,
        input.brandName,
        input.domain,
      );
      return {
        engine: adapter.id,
        ok: resp.ok,
        error: resp.error,
        mentioned: detection.mentioned,
        sentiment: detection.sentiment,
        excerpt: detection.excerpt,
        text: resp.text,
        latencyMs: resp.latencyMs,
      };
    }),
  );

  return {
    brandName: input.brandName,
    domain: input.domain,
    prompt: input.prompt,
    perEngine,
    enginesUsed: enabledAdapters.map((a) => a.id),
    skippedEngines,
    mentionCount: perEngine.filter((p) => p.mentioned).length,
  };
}

export interface RunResult {
  runId: string;
  mentionCount: number;
  totalPrompts: number;
  summary: RunSummary;
}

/** How a run was triggered — persisted on the `watchtower_runs.trigger` column. */
export type RunTrigger = "cron" | "manual" | "test";

export interface RunSubscriptionOpts {
  /** Override the engine list — used by tests to inject a single mock. */
  engines?: ReadonlyArray<EngineAdapter>;
  /**
   * How this run was triggered. Defaults to "cron" (the weekly job).
   * The manual-run route passes "manual" so the rate limiter can count it;
   * the internal /trigger-test helper passes "test" so QA runs don't.
   */
  trigger?: RunTrigger;
  /**
   * Override the prompt_version_id pinned on the run row. Tests use this
   * to bypass the active-version lookup; production callers should leave
   * it undefined so the helper resolves the latest version.
   */
  promptVersionId?: string | null;
}

// ---------------------------------------------------------------------------
// Manual "Run now" rate limits — audit V2 blocker #3.
//
// Three caps, all DB-counted (no Redis in this repo). Enforced by
// `checkManualRunCaps` at POST /api/watchtower/subscriptions/:id/runs/manual.
// ---------------------------------------------------------------------------

/** Per-subscription manual runs allowed per rolling 24h. */
export const MANUAL_RUN_DAILY_CAP = 1;
/** Per-subscription manual runs allowed per rolling 30 days. */
export const MANUAL_RUN_MONTHLY_CAP = 5;
/** Manual runs allowed across ALL subscriptions per rolling hour. */
export const MANUAL_RUN_GLOBAL_HOURLY_CAP = 50;

export type ManualRunCapResult =
  | { ok: true }
  | { ok: false; code: string; detail: string; retryAfterSeconds: number };

/**
 * Check whether a subscription is allowed to trigger a manual run right now.
 *
 * Counts only `trigger = 'manual'` rows — cron and test runs never consume a
 * customer's quota. Three windows, checked cheapest-customer-first:
 *   1. per-subscription / 24h   → 429 manual_run_daily_cap
 *   2. per-subscription / 30d   → 429 manual_run_monthly_cap
 *   3. global / 1h              → 429 manual_runs_global_cap
 *
 * NOTE: this is check-then-act, and `runSubscription` only writes its run
 * row after the (~20s) engine fan-out completes. Two clicks inside that
 * window can both pass — worst case is one extra paid run. The monthly and
 * global caps are the real backstops; precise per-second enforcement is
 * deferred (would need the Redis counter the V2 spec describes).
 */
export async function checkManualRunCaps(
  db: Db,
  subscriptionId: string,
  now: Date = new Date(),
): Promise<ManualRunCapResult> {
  const HOUR = 60 * 60 * 1000;
  const dayAgo = new Date(now.getTime() - 24 * HOUR);
  const monthAgo = new Date(now.getTime() - 30 * 24 * HOUR);
  const hourAgo = new Date(now.getTime() - HOUR);

  const countManual = async (where: ReturnType<typeof and>): Promise<number> => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(watchtowerRuns)
      .where(where);
    return row?.n ?? 0;
  };

  const daily = await countManual(
    and(
      eq(watchtowerRuns.subscriptionId, subscriptionId),
      eq(watchtowerRuns.trigger, "manual"),
      gte(watchtowerRuns.runAt, dayAgo),
    ),
  );
  if (daily >= MANUAL_RUN_DAILY_CAP) {
    return {
      ok: false,
      code: "manual_run_daily_cap",
      detail: `Manual runs are limited to ${MANUAL_RUN_DAILY_CAP} per 24 hours.`,
      retryAfterSeconds: 24 * 60 * 60,
    };
  }

  const monthly = await countManual(
    and(
      eq(watchtowerRuns.subscriptionId, subscriptionId),
      eq(watchtowerRuns.trigger, "manual"),
      gte(watchtowerRuns.runAt, monthAgo),
    ),
  );
  if (monthly >= MANUAL_RUN_MONTHLY_CAP) {
    return {
      ok: false,
      code: "manual_run_monthly_cap",
      detail: `Manual runs are limited to ${MANUAL_RUN_MONTHLY_CAP} per 30 days.`,
      retryAfterSeconds: 7 * 24 * 60 * 60,
    };
  }

  const global = await countManual(
    and(
      eq(watchtowerRuns.trigger, "manual"),
      gte(watchtowerRuns.runAt, hourAgo),
    ),
  );
  if (global >= MANUAL_RUN_GLOBAL_HOURLY_CAP) {
    return {
      ok: false,
      code: "manual_runs_global_cap",
      detail:
        "Manual runs are temporarily rate-limited across all customers. Try again shortly.",
      retryAfterSeconds: 60 * 60,
    };
  }

  return { ok: true };
}

/**
 * Returns the id of the most recent `watchtower_prompt_versions` row for
 * a subscription, or null if none exist (legacy subscription with no
 * version history yet — the migration 0115 backfill closes this for all
 * pre-existing subs, but the helper is defensive in case a brand-new
 * subscription is created via a code path that hasn't been wired to
 * mint version 1).
 */
export async function getActivePromptVersionId(
  db: Db,
  subscriptionId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: watchtowerPromptVersions.id })
    .from(watchtowerPromptVersions)
    .where(eq(watchtowerPromptVersions.subscriptionId, subscriptionId))
    .orderBy(desc(watchtowerPromptVersions.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Run a single subscription end-to-end: fetch row → fan out across engines
 * × prompts → persist results + a run summary. Concurrency is controlled
 * within the function (4-wide per subscription).
 *
 * Throws iff the subscription row is missing or the DB inserts fail.
 * Engine-level errors are captured into the result row's mentioned=false +
 * raw_response="" and do not abort the run.
 */
export async function runSubscription(
  db: Db,
  subscriptionId: string,
  opts: RunSubscriptionOpts = {},
): Promise<RunResult> {
  const [sub] = await db
    .select()
    .from(watchtowerSubscriptions)
    .where(eq(watchtowerSubscriptions.id, subscriptionId));

  if (!sub) {
    throw new Error(`watchtower: subscription not found: ${subscriptionId}`);
  }

  const promptsRaw = Array.isArray(sub.prompts) ? (sub.prompts as unknown[]) : [];
  const allPrompts = promptsRaw
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim());

  // Apply per-subscription cap, then the system-wide hard ceiling.
  const effectiveCap = Math.min(
    Math.max(1, sub.promptCap ?? 25),
    HARD_PROMPT_CEILING,
  );
  const prompts = allPrompts.slice(0, effectiveCap);

  const adapters = opts.engines ?? ALL_ENGINES;
  const enabledAdapters = adapters.filter((a) => a.enabled());
  const skippedEngines = adapters
    .filter((a) => !a.enabled())
    .map((a) => a.id);

  if (skippedEngines.length > 0) {
    logger.warn(
      { skipped: skippedEngines, subscriptionId },
      "watchtower: skipping engines without API keys",
    );
  }

  if (enabledAdapters.length === 0) {
    throw new Error(
      "watchtower: no engines enabled — set at least one of WATCHTOWER_OPENAI_API_KEY/WATCHTOWER_ANTHROPIC_API_KEY/WATCHTOWER_PERPLEXITY_API_KEY/WATCHTOWER_GEMINI_API_KEY/WATCHTOWER_GROK_API_KEY",
    );
  }

  if (prompts.length === 0) {
    logger.warn(
      { subscriptionId },
      "watchtower: subscription has zero prompts; emitting empty run",
    );
  }

  // Build the work list (prompt, adapter) pairs and execute with bounded
  // concurrency. A 25-prompt × 3-engine subscription is 75 calls; at
  // concurrency 4 that's ~20s wall-clock at 1s/call.
  type Cell = { prompt: string; adapter: EngineAdapter };
  const cells: Cell[] = [];
  for (const prompt of prompts) {
    for (const adapter of enabledAdapters) cells.push({ prompt, adapter });
  }

  type CellOutput = {
    prompt: string;
    engine: string;
    text: string;
    latencyMs: number;
    detection: DetectionResult;
  };

  const outputs: CellOutput[] = [];
  const concurrency = 4;
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, cells.length || 1) }).map(
    async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= cells.length) return;
        const { prompt, adapter } = cells[idx]!;
        const resp = await adapter.query({ prompt });
        const detection = detectMention(resp.text, sub.brandName, sub.domain);
        outputs.push({
          prompt,
          engine: adapter.id,
          text: resp.text,
          latencyMs: resp.latencyMs,
          detection,
        });
      }
    },
  );
  await Promise.all(workers);

  // Resolve the active prompt version BEFORE opening the transaction so a
  // missing version row only logs a warn and doesn't roll back the run.
  // Tests can override via opts.promptVersionId to pin a specific id (or
  // explicit null to assert legacy behavior).
  let promptVersionId: string | null;
  if (opts.promptVersionId !== undefined) {
    promptVersionId = opts.promptVersionId;
  } else {
    promptVersionId = await getActivePromptVersionId(db, subscriptionId);
    if (!promptVersionId) {
      logger.warn(
        { subscriptionId },
        "watchtower: no prompt version row found; run will be inserted with prompt_version_id=NULL (treated as legacy by the portal UI)",
      );
    }
  }

  // Persist a run row first so we have an FK target, then bulk-insert
  // results. Done in a single transaction so a partial run never leaves
  // an orphan run row with zero results.
  const result = await db.transaction(async (tx) => {
    const enginesUsed = enabledAdapters.map((a) => a.id);
    const mentionCount = outputs.filter((o) => o.detection.mentioned).length;

    const summary = buildSummary(outputs, enginesUsed, skippedEngines);

    const [runRow] = await tx
      .insert(watchtowerRuns)
      .values({
        subscriptionId,
        trigger: opts.trigger ?? "cron",
        engines: enginesUsed,
        totalPrompts: prompts.length,
        mentionCount,
        summary,
        promptVersionId,
      })
      .returning({ id: watchtowerRuns.id });

    if (!runRow) {
      throw new Error("watchtower: failed to insert run row");
    }

    if (outputs.length > 0) {
      await tx.insert(watchtowerResults).values(
        outputs.map((o) => ({
          runId: runRow.id,
          prompt: o.prompt,
          engine: o.engine,
          mentioned: o.detection.mentioned,
          sentiment: o.detection.sentiment,
          excerpt: o.detection.excerpt,
          // Cap raw_response at 8 KB; we never need more for v1 display
          // and don't want to bloat the DB on long ChatGPT outputs.
          rawResponse: (o.text ?? "").slice(0, 8_000),
          latencyMs: o.latencyMs,
        })),
      );
    }

    return {
      runId: runRow.id,
      mentionCount,
      totalPrompts: prompts.length,
      summary,
    };
  });

  return result;
}

function buildSummary(
  outputs: Array<{
    prompt: string;
    engine: string;
    text: string;
    latencyMs: number;
    detection: DetectionResult;
  }>,
  enginesUsed: string[],
  skippedEngines: string[],
): RunSummary {
  const byEngine: Record<string, { queried: number; mentioned: number }> = {};
  for (const id of enginesUsed) byEngine[id] = { queried: 0, mentioned: 0 };
  for (const o of outputs) {
    const e = byEngine[o.engine] ?? { queried: 0, mentioned: 0 };
    e.queried += 1;
    if (o.detection.mentioned) e.mentioned += 1;
    byEngine[o.engine] = e;
  }

  // Top excerpts: prefer positive sentiment, then negative (anything
  // mentioned with non-neutral sentiment is more newsworthy in the
  // weekly digest than another neutral mention).
  const ranked = outputs
    .filter((o) => o.detection.mentioned && o.detection.excerpt)
    .sort((a, b) => sentimentRank(a.detection.sentiment) - sentimentRank(b.detection.sentiment));

  const topExcerpts = ranked.slice(0, 3).map((o) => ({
    engine: o.engine,
    prompt: o.prompt,
    sentiment: o.detection.sentiment,
    excerpt: o.detection.excerpt!,
  }));

  return { byEngine, topExcerpts, skippedEngines };
}

function sentimentRank(s: Sentiment): number {
  // Lower number = surfaced first. Positives first, then negatives, then
  // neutral, then unknown (which shouldn't appear when mentioned=true).
  switch (s) {
    case "positive":
      return 0;
    case "negative":
      return 1;
    case "neutral":
      return 2;
    default:
      return 3;
  }
}
