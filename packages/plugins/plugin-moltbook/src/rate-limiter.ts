/**
 * Moltbook rate limiter — tracks API usage against Moltbook's limits
 * with a configurable safety multiplier and daily budget caps.
 *
 * Moltbook limits:
 *   Reads:    60 requests / 60 seconds
 *   Writes:   30 requests / 60 seconds
 *   Posts:     1 per 30 minutes
 *   Comments:  1 per 20 seconds, 50/day
 *   Votes:     (included in write limit)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

type RequestType = "read" | "write";
type BudgetAction = "post" | "comment" | "vote";

interface WindowTracker {
  timestamps: number[];
  windowMs: number;
  maxRequests: number;
}

interface DailyBudget {
  date: string;
  posts: number;
  comments: number;
  votes: number;
}

interface RateLimitCheck {
  allowed: boolean;
  retryAfterMs?: number;
  remaining?: number;
}

interface BudgetCheck {
  allowed: boolean;
  remaining: number;
  limit: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const WINDOW_MS = 60_000;

const BASE_LIMITS: Record<RequestType, number> = {
  read: 60,
  write: 30,
};

const PANIC_DURATION_MS = 60 * 60 * 1000; // 1 hour
const PANIC_MULTIPLIER = 0.5; // halve budgets during panic

// ─── Rate limiter class ─────────────────────────────────────────────────────

export class MoltbookRateLimiter {
  private windows: Record<RequestType, WindowTracker>;
  private daily: DailyBudget;
  private safetyMultiplier: number;
  private maxPostsPerDay: number;
  private maxCommentsPerDay: number;
  private maxVotesPerDay: number;
  private panicUntil: number = 0;

  // Server-reported limits (updated from response headers)
  private serverRemaining: Record<RequestType, number | null> = {
    read: null,
    write: null,
  };
  private serverRetryAfter: number | null = null;

  constructor(opts: {
    safetyMultiplier?: number;
    maxPostsPerDay?: number;
    maxCommentsPerDay?: number;
    maxVotesPerDay?: number;
  } = {}) {
    this.safetyMultiplier = opts.safetyMultiplier ?? 0.5;
    this.maxPostsPerDay = opts.maxPostsPerDay ?? 4;
    this.maxCommentsPerDay = opts.maxCommentsPerDay ?? 20;
    this.maxVotesPerDay = opts.maxVotesPerDay ?? 50;

    this.windows = {
      read: { timestamps: [], windowMs: WINDOW_MS, maxRequests: BASE_LIMITS.read },
      write: { timestamps: [], windowMs: WINDOW_MS, maxRequests: BASE_LIMITS.write },
    };

    this.daily = this.freshDailyBudget();
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /** Check if a request of the given type is allowed. */
  canMakeRequest(type: RequestType): RateLimitCheck {
    // Server says wait
    if (this.serverRetryAfter !== null && Date.now() < this.serverRetryAfter) {
      return { allowed: false, retryAfterMs: this.serverRetryAfter - Date.now() };
    }

    // Server says exhausted
    if (this.serverRemaining[type] !== null && this.serverRemaining[type]! <= 0) {
      return { allowed: false, retryAfterMs: 5_000 };
    }

    const tracker = this.windows[type];
    this.pruneWindow(tracker);

    const effectiveMax = Math.floor(tracker.maxRequests * this.effectiveMultiplier());
    const remaining = effectiveMax - tracker.timestamps.length;

    if (remaining <= 0) {
      const oldestInWindow = tracker.timestamps[0]!;
      const retryAfterMs = oldestInWindow + tracker.windowMs - Date.now();
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1_000) };
    }

    return { allowed: true, remaining };
  }

  /** Check if a daily budget action is allowed. */
  canUseDailyBudget(action: BudgetAction): BudgetCheck {
    this.rotateDailyIfNeeded();
    const multiplier = this.effectiveMultiplier();
    const limits: Record<BudgetAction, { used: number; max: number }> = {
      post: { used: this.daily.posts, max: Math.floor(this.maxPostsPerDay * multiplier) },
      comment: { used: this.daily.comments, max: Math.floor(this.maxCommentsPerDay * multiplier) },
      vote: { used: this.daily.votes, max: Math.floor(this.maxVotesPerDay * multiplier) },
    };

    const { used, max } = limits[action];
    const remaining = Math.max(0, max - used);
    return { allowed: remaining > 0, remaining, limit: max };
  }

  /** Record a completed request. */
  recordRequest(type: RequestType): void {
    this.pruneWindow(this.windows[type]);
    this.windows[type].timestamps.push(Date.now());
  }

  /** Record a daily budget usage. */
  recordDailyUsage(action: BudgetAction): void {
    this.rotateDailyIfNeeded();
    this.daily[action === "post" ? "posts" : action === "comment" ? "comments" : "votes"]++;
  }

  /** Update from Moltbook response headers. */
  updateFromHeaders(type: RequestType, headers: Record<string, string>): void {
    const remaining = headers["x-ratelimit-remaining"];
    if (remaining !== undefined) {
      this.serverRemaining[type] = parseInt(remaining, 10);
    }

    const retryAfter = headers["retry-after"];
    if (retryAfter !== undefined) {
      this.serverRetryAfter = Date.now() + parseInt(retryAfter, 10) * 1000;
    }

    // Reset server remaining when window resets
    const reset = headers["x-ratelimit-reset"];
    if (reset !== undefined) {
      const resetAt = parseInt(reset, 10) * 1000;
      if (Date.now() >= resetAt) {
        this.serverRemaining[type] = null;
      }
    }
  }

  /** Enter panic mode — triggered on 429 responses. Halves all budgets for 1 hour. */
  enterPanicMode(): void {
    this.panicUntil = Date.now() + PANIC_DURATION_MS;
  }

  /** Check if currently in panic mode. */
  get isPanic(): boolean {
    return Date.now() < this.panicUntil;
  }

  /** Reset daily counters (called by daily-cleanup job). */
  resetDaily(): void {
    this.daily = this.freshDailyBudget();
  }

  /** Get current usage stats for logging/display. */
  getStats(): {
    daily: DailyBudget;
    isPanic: boolean;
    effectiveMultiplier: number;
  } {
    this.rotateDailyIfNeeded();
    return {
      daily: { ...this.daily },
      isPanic: this.isPanic,
      effectiveMultiplier: this.effectiveMultiplier(),
    };
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private effectiveMultiplier(): number {
    return this.isPanic
      ? this.safetyMultiplier * PANIC_MULTIPLIER
      : this.safetyMultiplier;
  }

  private pruneWindow(tracker: WindowTracker): void {
    const cutoff = Date.now() - tracker.windowMs;
    while (tracker.timestamps.length > 0 && tracker.timestamps[0]! < cutoff) {
      tracker.timestamps.shift();
    }
  }

  private rotateDailyIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.daily.date !== today) {
      this.daily = this.freshDailyBudget();
    }
  }

  private freshDailyBudget(): DailyBudget {
    return {
      date: new Date().toISOString().slice(0, 10),
      posts: 0,
      comments: 0,
      votes: 0,
    };
  }
}
