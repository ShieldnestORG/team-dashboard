// ---------------------------------------------------------------------------
// API usage / cost metering — the SUCCESS-path mirror of provider-alerts.ts.
//
// Phase 1 (PR #172) instrumented every LLM call site's FAILURE branch with
// noteProviderFailure(). This module is Phase 2: each call site calls
// logApiUsage() right where it parses a successful response, and one
// api_usage_events row lands with token counts and a computed cost. Like
// noteProviderFailure, logApiUsage NEVER throws — metering must never break
// the call it measures.
//
// Pricing policy:
//   - Anthropic: reuse MODEL_PRICES from agent-runner/pricing.ts (rates
//     verified against the Anthropic model table). Do not fork prices.
//   - "ollama:*" models: $0 (free tier, runs on our own VPS).
//   - EVERY other provider/model: tokens recorded faithfully, cost_usd = 0,
//     with ONE logger.warn per unknown model per process. Tokens are the
//     ground truth; dollars only where the price is verified.
//     TODO(owner): supply verified prices for the non-Anthropic models seen
//     at the call sites (openai gpt-4o-mini, xai grok-* chat/image/video/tts,
//     gemini-2.5-flash, perplexity sonar) — never invent them from memory.
//
// The community agents are deliberately NOT metered here: agent-runner keeps
// its own dollar ledger (university_agent_usage) and a second row per call
// would double-count spend.
// ---------------------------------------------------------------------------

import { gte, sql } from "drizzle-orm";
import { apiUsageEvents, type Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { MODEL_PRICES } from "./agent-runner/pricing.js";

// Optional DB handle so usage persists to api_usage_events (set at boot in
// app.ts, same pattern as alerting's setAlertDb; without it events are
// dropped silently — metering never blocks a caller).
let usageDb: Db | null = null;

export function setApiUsageDb(db: Db): void {
  usageDb = db;
}

// One "model not in price map" warn per model per process — a busy unknown
// model must not turn the logs into a firehose.
const warnedUnknownModels = new Set<string>();

/** Test seam: reset the module-level DB handle + warn dedup. */
export function _resetApiUsageForTests(): void {
  usageDb = null;
  warnedUnknownModels.clear();
}

/**
 * Anthropic model ids sometimes carry a date suffix (e.g.
 * claude-haiku-4-5-20251001, the ANTHROPIC_MODEL prod default). Price-wise
 * they are the same model, so strip the suffix before the price lookup rather
 * than recording verified-price calls as $0.
 */
function normalizeAnthropicModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

/**
 * Cost of one call in USD. $0 for anything without a VERIFIED price:
 * non-Anthropic models (warned once per process) and the free ollama tier.
 * Rounded to 6 dp (micro-dollars) to match the NUMERIC(12,6) cost_usd column.
 */
export function computeCostUsd(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  if (model.startsWith("ollama:")) return 0; // free tier — known-$0, no warn

  const price = provider === "anthropic" ? MODEL_PRICES[normalizeAnthropicModel(model)] : undefined;
  if (!price) {
    if (!warnedUnknownModels.has(model)) {
      warnedUnknownModels.add(model);
      logger.warn(
        { provider, model },
        "api-usage: model not in price map — cost recorded as $0 (tokens still metered)",
      );
    }
    return 0;
  }

  const dollars =
    (inputTokens / 1_000_000) * price.inputPerMtok +
    (outputTokens / 1_000_000) * price.outputPerMtok;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}

export interface ApiUsageEvent {
  provider: string; // same string the site passes to noteProviderFailure
  service: string; // same string the site passes to noteProviderFailure
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Record one successful provider call: computes cost, inserts an
 * api_usage_events row. Fire-and-forget — NEVER throws or rejects, so it can
 * be dropped into any success path as `void logApiUsage({...})` without
 * changing behavior.
 */
export async function logApiUsage(event: ApiUsageEvent): Promise<void> {
  try {
    if (!usageDb) return; // pre-boot or tests without a DB — drop silently
    const costUsd = computeCostUsd(
      event.provider,
      event.model,
      event.inputTokens,
      event.outputTokens,
    );
    await usageDb.insert(apiUsageEvents).values({
      provider: event.provider,
      service: event.service,
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      costUsd: costUsd.toFixed(6),
    });
  } catch (err) {
    logger.warn(
      { err, provider: event.provider, service: event.service },
      "api-usage: failed to record usage event",
    );
  }
}

// ---------------------------------------------------------------------------
// Admin rollup — powers GET /api/api-usage/summary.
// ---------------------------------------------------------------------------

export interface ApiUsageWindowTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export interface ApiUsageSummary {
  todayUsd: number;
  weekUsd: number;
  monthUsd: number;
  byProvider: Array<
    { provider: string; today: ApiUsageWindowTotals; week: ApiUsageWindowTotals; month: ApiUsageWindowTotals }
  >;
  byService: Array<
    { service: string; today: ApiUsageWindowTotals; week: ApiUsageWindowTotals; month: ApiUsageWindowTotals }
  >;
}

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const EMPTY_TOTALS: ApiUsageWindowTotals = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };

export async function summarizeApiUsage(db: Db): Promise<ApiUsageSummary> {
  const dayStart = startOfUtcDay();
  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const monthStart = new Date(dayStart);
  monthStart.setUTCDate(monthStart.getUTCDate() - 30);

  const groupedSince = async (dimension: "provider" | "service", since: Date) => {
    const column = dimension === "provider" ? apiUsageEvents.provider : apiUsageEvents.service;
    const rows = await db
      .select({
        key: column,
        calls: sql<string>`COUNT(*)`,
        inputTokens: sql<string>`COALESCE(SUM(${apiUsageEvents.inputTokens}), 0)`,
        outputTokens: sql<string>`COALESCE(SUM(${apiUsageEvents.outputTokens}), 0)`,
        usd: sql<string>`COALESCE(SUM(${apiUsageEvents.costUsd}), 0)`,
      })
      .from(apiUsageEvents)
      .where(gte(apiUsageEvents.createdAt, since))
      .groupBy(column);
    return new Map<string, ApiUsageWindowTotals>(
      rows.map((r) => [
        r.key,
        {
          calls: Number(r.calls),
          inputTokens: Number(r.inputTokens),
          outputTokens: Number(r.outputTokens),
          usd: Number(r.usd),
        },
      ]),
    );
  };

  const [providerToday, providerWeek, providerMonth, serviceToday, serviceWeek, serviceMonth] =
    await Promise.all([
      groupedSince("provider", dayStart),
      groupedSince("provider", weekStart),
      groupedSince("provider", monthStart),
      groupedSince("service", dayStart),
      groupedSince("service", weekStart),
      groupedSince("service", monthStart),
    ]);

  const sumUsd = (m: Map<string, ApiUsageWindowTotals>) =>
    [...m.values()].reduce((acc, t) => acc + t.usd, 0);

  // The 30-day map holds every key the shorter windows can have.
  const byProvider = [...providerMonth.keys()].sort().map((provider) => ({
    provider,
    today: providerToday.get(provider) ?? EMPTY_TOTALS,
    week: providerWeek.get(provider) ?? EMPTY_TOTALS,
    month: providerMonth.get(provider) ?? EMPTY_TOTALS,
  }));
  const byService = [...serviceMonth.keys()].sort().map((service) => ({
    service,
    today: serviceToday.get(service) ?? EMPTY_TOTALS,
    week: serviceWeek.get(service) ?? EMPTY_TOTALS,
    month: serviceMonth.get(service) ?? EMPTY_TOTALS,
  }));

  return {
    todayUsd: sumUsd(providerToday),
    weekUsd: sumUsd(providerWeek),
    monthUsd: sumUsd(providerMonth),
    byProvider,
    byService,
  };
}
