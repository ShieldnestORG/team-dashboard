import { createHash } from "node:crypto";
import type { RequestHandler, Request } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { intelApiKeys, intelCustomers, intelPlans, intelUsageMeter } from "@paperclipai/db";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Intel API rate limiter + quota enforcement
// - Anonymous requests fall back to the "free" plan (keyed on IP).
// - Authenticated requests (Bearer / x-api-key) are keyed on the API key and
//   use the plan associated with the paying customer.
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;

type KeyLookup = {
  apiKeyId: string;
  customerId: string;
  planSlug: string;
  monthlyRequestQuota: number;
  rateLimitPerMin: number;
};

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();
const keyCache = new Map<string, { value: KeyLookup | null; expiresAt: number }>();
const KEY_CACHE_TTL_MS = 60_000;

// Free-plan defaults if the DB row is missing (lets the API keep serving
// during migrations or first boot before the seed row is inserted).
const FREE_PLAN_FALLBACK: Omit<KeyLookup, "apiKeyId" | "customerId" | "planSlug"> & {
  planSlug: "free";
} = {
  planSlug: "free",
  monthlyRequestQuota: 1_000,
  rateLimitPerMin: 60,
};

let freePlanCache: {
  monthlyRequestQuota: number;
  rateLimitPerMin: number;
  expiresAt: number;
} | null = null;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of windows) {
    if (now > v.resetAt) windows.delete(k);
  }
  for (const [k, v] of keyCache) {
    if (now > v.expiresAt) keyCache.delete(k);
  }
}, 5 * 60_000).unref();

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function extractKey(req: Request): string | null {
  const header = req.headers["authorization"];
  if (header && typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim() || null;
  }
  const xKey = req.headers["x-api-key"];
  if (typeof xKey === "string" && xKey.trim()) return xKey.trim();
  return null;
}

function clientIp(req: Request): string {
  return (
    req.ip ||
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function periodStartDate(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

async function lookupFreePlan(db: Db): Promise<{ monthlyRequestQuota: number; rateLimitPerMin: number }> {
  const now = Date.now();
  if (freePlanCache && now < freePlanCache.expiresAt) return freePlanCache;
  try {
    const rows = await db
      .select({
        quota: intelPlans.monthlyRequestQuota,
        rate: intelPlans.rateLimitPerMin,
      })
      .from(intelPlans)
      .where(eq(intelPlans.slug, "free"))
      .limit(1);
    if (rows.length > 0) {
      freePlanCache = {
        monthlyRequestQuota: Number(rows[0].quota),
        rateLimitPerMin: rows[0].rate,
        expiresAt: now + KEY_CACHE_TTL_MS,
      };
      return freePlanCache;
    }
  } catch (err) {
    logger.warn({ err }, "intel-rate-limit: free plan lookup failed");
  }
  return {
    monthlyRequestQuota: FREE_PLAN_FALLBACK.monthlyRequestQuota,
    rateLimitPerMin: FREE_PLAN_FALLBACK.rateLimitPerMin,
  };
}

async function lookupKey(db: Db, rawKey: string): Promise<KeyLookup | null> {
  const hash = hashToken(rawKey);
  const cached = keyCache.get(hash);
  const now = Date.now();
  if (cached && now < cached.expiresAt) return cached.value;

  try {
    const rows = await db
      .select({
        apiKeyId: intelApiKeys.id,
        customerId: intelCustomers.id,
        status: intelCustomers.status,
        planSlug: intelPlans.slug,
        monthlyRequestQuota: intelPlans.monthlyRequestQuota,
        rateLimitPerMin: intelPlans.rateLimitPerMin,
      })
      .from(intelApiKeys)
      .innerJoin(intelCustomers, eq(intelApiKeys.customerId, intelCustomers.id))
      .leftJoin(intelPlans, eq(intelCustomers.planId, intelPlans.id))
      .where(and(eq(intelApiKeys.keyHash, hash), isNull(intelApiKeys.revokedAt)))
      .limit(1);

    if (rows.length === 0) {
      keyCache.set(hash, { value: null, expiresAt: now + KEY_CACHE_TTL_MS });
      return null;
    }

    const row = rows[0];
    if (row.status !== "active") {
      keyCache.set(hash, { value: null, expiresAt: now + KEY_CACHE_TTL_MS });
      return null;
    }

    const value: KeyLookup = {
      apiKeyId: row.apiKeyId,
      customerId: row.customerId,
      planSlug: row.planSlug ?? "starter",
      monthlyRequestQuota: Number(row.monthlyRequestQuota ?? 0),
      rateLimitPerMin: row.rateLimitPerMin ?? 60,
    };
    keyCache.set(hash, { value, expiresAt: now + KEY_CACHE_TTL_MS });
    // Fire-and-forget last-used bump.
    db.update(intelApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(intelApiKeys.id, row.apiKeyId))
      .catch((err) => logger.debug({ err }, "intel-rate-limit: last_used_at bump failed"));
    return value;
  } catch (err) {
    logger.warn({ err }, "intel-rate-limit: key lookup failed");
    return null;
  }
}

async function incrementMonthlyUsage(
  db: Db,
  apiKeyId: string,
  quota: number,
): Promise<{ requestCount: number; overageCount: number }> {
  const period = periodStartDate();
  try {
    // UPSERT + conditional overage.
    const rows = await db.execute<{ request_count: number; overage_count: number }>(sql`
      INSERT INTO intel_usage_meter (api_key_id, period_start, request_count, overage_count)
      VALUES (${apiKeyId}, ${period}, 1, 0)
      ON CONFLICT (api_key_id, period_start) DO UPDATE SET
        request_count = intel_usage_meter.request_count + 1,
        overage_count = CASE
          WHEN intel_usage_meter.request_count + 1 > ${quota}
          THEN intel_usage_meter.overage_count + 1
          ELSE intel_usage_meter.overage_count
        END,
        updated_at = now()
      RETURNING request_count, overage_count
    `);
    const row = (rows as unknown as { rows?: Array<{ request_count: number; overage_count: number }> }).rows?.[0]
      ?? (Array.isArray(rows) ? (rows as Array<{ request_count: number; overage_count: number }>)[0] : undefined);
    if (row) {
      return {
        requestCount: Number(row.request_count),
        overageCount: Number(row.overage_count),
      };
    }
  } catch (err) {
    logger.warn({ err }, "intel-rate-limit: usage increment failed");
  }
  return { requestCount: 0, overageCount: 0 };
}

export function createIntelRateLimit(db: Db): RequestHandler {
  return async (req, res, next) => {
    const rawKey = extractKey(req);
    let lookup: KeyLookup | null = null;
    let windowKey: string;
    let planSlug: string;
    let rateLimit: number;
    let quota: number;

    if (rawKey) {
      lookup = await lookupKey(db, rawKey);
      if (!lookup) {
        res.status(401).json({ error: "Invalid or revoked API key" });
        return;
      }
      windowKey = `key:${lookup.apiKeyId}`;
      planSlug = lookup.planSlug;
      rateLimit = lookup.rateLimitPerMin;
      quota = lookup.monthlyRequestQuota;
    } else {
      const freePlan = await lookupFreePlan(db);
      windowKey = `ip:${clientIp(req)}`;
      planSlug = "free";
      rateLimit = freePlan.rateLimitPerMin;
      quota = freePlan.monthlyRequestQuota;
    }

    // Sliding-window check.
    const now = Date.now();
    let entry = windows.get(windowKey);
    if (!entry || now > entry.resetAt) {
      entry = { count: 1, resetAt: now + WINDOW_MS };
      windows.set(windowKey, entry);
    } else {
      entry.count += 1;
    }

    const remaining = Math.max(0, rateLimit - entry.count);
    res.set("X-RateLimit-Limit", String(rateLimit));
    res.set("X-RateLimit-Remaining", String(remaining));
    res.set("X-Intel-Plan", planSlug);

    if (entry.count > rateLimit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "Rate limit exceeded",
        plan: planSlug,
        retryAfter,
        upgrade:
          planSlug === "free"
            ? "Subscribe at /intel/pricing for higher limits"
            : undefined,
      });
      return;
    }

    // Monthly quota check (only for keyed requests — anon gets IP quota via in-memory window).
    if (lookup) {
      const usage = await incrementMonthlyUsage(db, lookup.apiKeyId, quota);
      res.set("X-Intel-Quota-Used", String(usage.requestCount));
      res.set("X-Intel-Quota-Limit", String(quota));
    } else {
      // For anon, we don't persist a meter — the window limiter above
      // already caps them. Just expose the headers for visibility.
      res.set("X-Intel-Quota-Limit", String(quota));
    }

    next();
  };
}

// Legacy export name kept for any ad-hoc imports. No-op without a db.
export const intelRateLimit: RequestHandler = (_req, _res, next) => next();
