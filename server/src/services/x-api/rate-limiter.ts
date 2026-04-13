// ---------------------------------------------------------------------------
// X API v2 — rate limit tracker (pay-per-use model)
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";
import type { RateLimitInfo, RateLimitStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Per-endpoint rate limit tracking (from x-rate-limit-* headers)
// ---------------------------------------------------------------------------

const endpointLimits = new Map<string, RateLimitInfo>();

// ---------------------------------------------------------------------------
// Daily spend tracking — resets at midnight UTC
// ---------------------------------------------------------------------------

// Pay-per-use costs (USD)
const COST_PER_READ = 0.005;
const COST_PER_WRITE = 0.01;

interface DailyBucket {
  date: string;        // YYYY-MM-DD UTC
  spentUsd: number;    // total dollar spend today
  repliesSent: number; // reply/post count
  readCount: number;   // search/read count
}

let dailyBucket: DailyBucket = { date: todayUTC(), spentUsd: 0, repliesSent: 0, readCount: 0 };

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureBucketCurrent(): void {
  const today = todayUTC();
  if (dailyBucket.date !== today) {
    dailyBucket = { date: today, spentUsd: 0, repliesSent: 0, readCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Configurable budget limits (updated via settings API)
// ---------------------------------------------------------------------------

let budgetConfig = {
  dailySpendCapUsd: 5.0,   // $5/day — burning through $240 API credits
  maxRepliesPerDay: 200,    // 200 replies/day for max engagement
};

// ---------------------------------------------------------------------------
// Panic mode (triggered by 429)
// ---------------------------------------------------------------------------

let panicMode = false;
let panicUntil = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record rate-limit headers from an X API response.
 */
export function recordRequest(endpoint: string, headers: Record<string, string>): void {
  const limit = parseInt(headers["x-rate-limit-limit"] ?? "", 10);
  const remaining = parseInt(headers["x-rate-limit-remaining"] ?? "", 10);
  const resetEpoch = parseInt(headers["x-rate-limit-reset"] ?? "", 10);

  if (!isNaN(limit) && !isNaN(remaining) && !isNaN(resetEpoch)) {
    endpointLimits.set(endpoint, {
      limit,
      remaining,
      resetAt: new Date(resetEpoch * 1000),
    });
  }
}

/**
 * Check whether a request to the given endpoint is allowed (per-endpoint rate limit).
 */
export function canMakeRequest(endpoint: string): { allowed: boolean; retryAfterMs?: number } {
  const info = endpointLimits.get(endpoint);
  if (!info) return { allowed: true };

  if (info.remaining > 0) return { allowed: true };

  const waitMs = info.resetAt.getTime() - Date.now();
  if (waitMs <= 0) {
    endpointLimits.delete(endpoint);
    return { allowed: true };
  }

  return { allowed: false, retryAfterMs: waitMs };
}

/**
 * Check whether the daily dollar budget allows a reply/post action.
 */
export function canUseDailyBudget(action: "reply" | "post" | "like" | "follow"): { allowed: boolean; remaining: number } {
  ensureBucketCurrent();
  const isPanic = panicMode && Date.now() < panicUntil;

  // In panic mode, halve the effective caps
  const effectiveCap = isPanic ? budgetConfig.dailySpendCapUsd * 0.5 : budgetConfig.dailySpendCapUsd;
  const effectiveMaxReplies = isPanic ? Math.floor(budgetConfig.maxRepliesPerDay * 0.5) : budgetConfig.maxRepliesPerDay;

  if (action === "reply" || action === "post") {
    const costOk = dailyBucket.spentUsd + COST_PER_WRITE <= effectiveCap;
    const countOk = dailyBucket.repliesSent < effectiveMaxReplies;
    return {
      allowed: costOk && countOk,
      remaining: Math.max(0, effectiveMaxReplies - dailyBucket.repliesSent),
    };
  }

  // For likes/follows — just check spend cap
  return {
    allowed: dailyBucket.spentUsd + COST_PER_WRITE <= effectiveCap,
    remaining: Math.max(0, Math.floor((effectiveCap - dailyBucket.spentUsd) / COST_PER_WRITE)),
  };
}

/**
 * Increment the daily usage counter for a write action.
 */
export function incrementDailyUsage(action: "reply" | "post" | "like" | "follow"): void {
  ensureBucketCurrent();
  dailyBucket.spentUsd += COST_PER_WRITE;
  if (action === "reply" || action === "post") {
    dailyBucket.repliesSent++;
  }
  logger.info(
    { action, spentUsd: dailyBucket.spentUsd.toFixed(3), repliesSent: dailyBucket.repliesSent },
    "X API daily spend incremented",
  );
}

/**
 * Record a read (search) cost.
 */
export function recordReadCost(estimatedReads: number): void {
  ensureBucketCurrent();
  dailyBucket.spentUsd += estimatedReads * COST_PER_READ;
  dailyBucket.readCount += estimatedReads;
}

/**
 * Check if daily spend allows a search read.
 */
export function canAffordRead(estimatedReads: number): boolean {
  ensureBucketCurrent();
  const isPanic = panicMode && Date.now() < panicUntil;
  const effectiveCap = isPanic ? budgetConfig.dailySpendCapUsd * 0.5 : budgetConfig.dailySpendCapUsd;
  return dailyBucket.spentUsd + (estimatedReads * COST_PER_READ) <= effectiveCap;
}

/**
 * Enable panic mode (halves caps for 1 hour).
 */
export function enablePanicMode(): void {
  panicMode = true;
  panicUntil = Date.now() + 60 * 60 * 1000;
  logger.warn("X API rate limiter: panic mode enabled for 1 hour (429 received)");
}

/**
 * Update budget config (from settings API).
 */
export function updateBudgetConfig(config: { dailySpendCapUsd?: number; maxRepliesPerDay?: number }): void {
  if (config.dailySpendCapUsd != null) budgetConfig.dailySpendCapUsd = config.dailySpendCapUsd;
  if (config.maxRepliesPerDay != null) budgetConfig.maxRepliesPerDay = config.maxRepliesPerDay;
  logger.info({ budgetConfig }, "X API budget config updated");
}

/**
 * Get current budget config.
 */
export function getBudgetConfig(): { dailySpendCapUsd: number; maxRepliesPerDay: number } {
  return { ...budgetConfig };
}

/**
 * Update the multiplier (backward compat — adjusts spend cap proportionally).
 */
export function setMultiplier(value: number): void {
  // In pay-per-use model, multiplier doesn't apply.
  // Kept for backward compatibility with x-oauth route.
  logger.info({ multiplier: value }, "setMultiplier called (no-op in pay-per-use mode)");
}

/**
 * Get full rate limit status for the dashboard.
 */
export function getStatus(): RateLimitStatus {
  ensureBucketCurrent();
  const isPanic = panicMode && Date.now() < panicUntil;
  if (panicMode && Date.now() >= panicUntil) {
    panicMode = false;
  }

  return {
    endpoints: Object.fromEntries(endpointLimits),
    dailyBudget: {
      spentUsd: Math.round(dailyBucket.spentUsd * 1000) / 1000,
      capUsd: budgetConfig.dailySpendCapUsd,
      repliesSent: dailyBucket.repliesSent,
      maxReplies: budgetConfig.maxRepliesPerDay,
      readCount: dailyBucket.readCount,
    },
    panicMode: isPanic,
  };
}

/**
 * Get daily budget summary (backward-compatible name).
 */
export function getDailyBudget(): RateLimitStatus["dailyBudget"] {
  return getStatus().dailyBudget;
}
