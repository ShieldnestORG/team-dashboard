// ---------------------------------------------------------------------------
// X API v2 — in-memory rate limit tracker
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";
import type { RateLimitInfo, RateLimitStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Per-endpoint rate limit tracking (from x-rate-limit-* headers)
// ---------------------------------------------------------------------------

const endpointLimits = new Map<string, RateLimitInfo>();

// ---------------------------------------------------------------------------
// Daily budget tracking — resets at midnight UTC
// ---------------------------------------------------------------------------

type ActionType = "post" | "like" | "follow" | "reply";

interface DailyBucket {
  date: string;  // YYYY-MM-DD UTC
  post: number;
  like: number;
  follow: number;
  reply: number;
}

let dailyBucket: DailyBucket = { date: todayUTC(), post: 0, like: 0, follow: 0, reply: 0 };

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureBucketCurrent(): void {
  const today = todayUTC();
  if (dailyBucket.date !== today) {
    dailyBucket = { date: today, post: 0, like: 0, follow: 0, reply: 0 };
  }
}

// ---------------------------------------------------------------------------
// Multiplier & panic mode
// ---------------------------------------------------------------------------

let multiplier = 0.5;   // 50% of official limits by default
let panicMode = false;
let panicUntil = 0;

// Free-tier daily hard caps (X API v2 Free)
const FREE_TIER_CAPS: Record<ActionType, number> = {
  post: 17,     // 17 posts/24h (free tier)
  like: 17,     // approximate free tier
  follow: 17,   // approximate free tier
  reply: 17,    // counted against post cap on free tier
};

function effectiveLimit(action: ActionType): number {
  const m = panicMode && Date.now() < panicUntil ? multiplier * 0.5 : multiplier;
  return Math.max(1, Math.floor(FREE_TIER_CAPS[action] * m));
}

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
 * Check whether a request to the given endpoint is allowed.
 */
export function canMakeRequest(endpoint: string): { allowed: boolean; retryAfterMs?: number } {
  const info = endpointLimits.get(endpoint);
  if (!info) return { allowed: true }; // no data yet — allow

  if (info.remaining > 0) return { allowed: true };

  const waitMs = info.resetAt.getTime() - Date.now();
  if (waitMs <= 0) {
    // Reset time has passed — clear stale data and allow
    endpointLimits.delete(endpoint);
    return { allowed: true };
  }

  return { allowed: false, retryAfterMs: waitMs };
}

/**
 * Check whether the daily budget allows the given action.
 */
export function canUseDailyBudget(action: ActionType): { allowed: boolean; remaining: number } {
  ensureBucketCurrent();
  const limit = effectiveLimit(action);
  const used = dailyBucket[action];
  return { allowed: used < limit, remaining: Math.max(0, limit - used) };
}

/**
 * Increment the daily usage counter for an action.
 */
export function incrementDailyUsage(action: ActionType): void {
  ensureBucketCurrent();
  dailyBucket[action]++;
  logger.info({ action, used: dailyBucket[action], limit: effectiveLimit(action) }, "X API daily budget incremented");
}

/**
 * Enable panic mode (drops to 25% for 1 hour).
 */
export function enablePanicMode(): void {
  panicMode = true;
  panicUntil = Date.now() + 60 * 60 * 1000;
  logger.warn("X API rate limiter: panic mode enabled for 1 hour (429 received)");
}

/**
 * Update the multiplier (0–1 range).
 */
export function setMultiplier(value: number): void {
  multiplier = Math.max(0.1, Math.min(1, value));
  logger.info({ multiplier }, "X API rate limit multiplier updated");
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
      posts: { used: dailyBucket.post, limit: effectiveLimit("post") },
      likes: { used: dailyBucket.like, limit: effectiveLimit("like") },
      follows: { used: dailyBucket.follow, limit: effectiveLimit("follow") },
      replies: { used: dailyBucket.reply, limit: effectiveLimit("reply") },
    },
    multiplier,
    panicMode: isPanic,
  };
}

/**
 * Get daily budget summary.
 */
export function getDailyBudget(): RateLimitStatus["dailyBudget"] {
  return getStatus().dailyBudget;
}
