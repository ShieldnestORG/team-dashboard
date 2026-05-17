// ---------------------------------------------------------------------------
// Watchtower admin — internal control-plane view of the Watchtower product.
//
// Mounted at /api/watchtower-admin by app.ts. Every route in this file is
// board-only (the storefront/customer surfaces live in `watchtower.ts` and
// `watchtower-checkout.ts`).
//
// Routes:
//   GET /customers                      → list of all subscriptions with
//                                         a denormalised "last run" column
//   GET /customers/:subscriptionId      → single-subscription drill-down
//                                         (subscription + prompts + last 8
//                                         runs + last 20 activity log entries)
//   GET /aggregate                      → top-line ops stats for the page
//                                         header
//
// Read-only for now. Phase 2 will add refund / cancel / re-run actions.
// ---------------------------------------------------------------------------
import { Router } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
  customerAccounts,
  watchtowerRuns,
  watchtowerResults,
  watchtowerSubscriptions,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logAdminAccess } from "../middleware/log-admin-access.js";

// Stripe price for the single Watchtower tier today. Used to compute MRR
// from the count of active subscriptions — the runtime price lookup lives
// in watchtower-checkout.ts; this is a "good enough for the dashboard"
// fallback so we don't have to round-trip Stripe just to render the header.
const WATCHTOWER_MONTHLY_PRICE_CENTS = 4900;

// Hard cap on the customer-list query. Pagination is deliberately deferred
// (Phase-2 work item); for now we surface `truncated: true` to the UI so
// a 500-customer day doesn't silently swallow the oldest rows.
const LIST_LIMIT = 500;

export function watchtowerAdminRoutes(db: Db) {
  const router = Router();

  // Mount the access-log middleware FIRST so it sees unauth attempts too —
  // the board-only guard below will short-circuit with 401, but the
  // res.on('finish') hook still fires and records the row with
  // actor_type='none', status_code=401. Forensic value (someone is
  // probing /watchtower-admin without a board key) > log volume cost.
  router.use(logAdminAccess(db));

  // Every route here is board-only. Mirrors the inline guard pattern used
  // across the existing admin routes (see intel-billing.ts, house-ads.ts).
  router.use((req, res, next) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Admin only" });
      return;
    }
    next();
  });

  // -------------------- GET /customers --------------------
  // Returns every Watchtower subscription plus the most-recent run row for
  // each. Uses a DISTINCT ON window so we only pay one query for the
  // "latest run per subscription" join (LATERAL would also work; DISTINCT
  // ON is simpler for v1 and pg-only — which is fine, we're not portable).
  router.get("/customers", async (_req, res) => {
    try {
      const subs = await db
        .select({
          subscriptionId: watchtowerSubscriptions.id,
          email: watchtowerSubscriptions.email,
          accountEmail: customerAccounts.email,
          brandName: watchtowerSubscriptions.brandName,
          domain: watchtowerSubscriptions.domain,
          plan: watchtowerSubscriptions.plan,
          status: watchtowerSubscriptions.status,
          signupAt: watchtowerSubscriptions.createdAt,
          stripeCustomerId: watchtowerSubscriptions.stripeCustomerId,
        })
        .from(watchtowerSubscriptions)
        .leftJoin(
          customerAccounts,
          eq(customerAccounts.id, watchtowerSubscriptions.accountId),
        )
        .orderBy(desc(watchtowerSubscriptions.createdAt))
        .limit(LIST_LIMIT);

      const ids = subs.map((s) => s.subscriptionId);
      // Latest run per subscription. We fetch every relevant run ordered
      // by (subscription, run_at desc) and pick the first per group in JS.
      // This keeps the query pure Drizzle and avoids a raw SQL window
      // function. Bounded by the 500-subscription cap above; even at five
      // runs each that's 2.5k rows worst case.
      const latestRunBySub = new Map<
        string,
        { runAt: Date; mentionCount: number }
      >();
      if (ids.length > 0) {
        const runRows = await db
          .select({
            subscriptionId: watchtowerRuns.subscriptionId,
            runAt: watchtowerRuns.runAt,
            mentionCount: watchtowerRuns.mentionCount,
          })
          .from(watchtowerRuns)
          .where(inArray(watchtowerRuns.subscriptionId, ids))
          .orderBy(desc(watchtowerRuns.runAt));
        for (const row of runRows) {
          if (!latestRunBySub.has(row.subscriptionId)) {
            latestRunBySub.set(row.subscriptionId, {
              runAt: row.runAt,
              mentionCount: row.mentionCount,
            });
          }
        }
      }

      const customers = subs.map((s) => {
        const last = latestRunBySub.get(s.subscriptionId);
        return {
          subscriptionId: s.subscriptionId,
          // Prefer the subscription-row email (captured at checkout) and
          // fall back to the joined customer_accounts.email when present.
          email: s.email ?? s.accountEmail ?? null,
          brandName: s.brandName,
          domain: s.domain,
          plan: s.plan,
          status: s.status,
          signupAt: s.signupAt,
          stripeCustomerId: s.stripeCustomerId,
          lastRunAt: last?.runAt ?? null,
          lastMentionCount: last?.mentionCount ?? null,
        };
      });

      // Signal silent truncation so the UI can show a "showing first 500"
      // hint and we don't lop off the oldest customers without notice.
      res.json({ customers, truncated: subs.length >= LIST_LIMIT });
    } catch (err) {
      logger.error({ err }, "watchtower-admin: listCustomers failed");
      res.status(500).json({ error: "Failed to list customers" });
    }
  });

  // -------------------- GET /customers/:subscriptionId --------------------
  router.get("/customers/:subscriptionId", async (req, res) => {
    const subscriptionId = req.params.subscriptionId as string;
    try {
      const [sub] = await db
        .select({
          id: watchtowerSubscriptions.id,
          accountId: watchtowerSubscriptions.accountId,
          email: watchtowerSubscriptions.email,
          accountEmail: customerAccounts.email,
          brandName: watchtowerSubscriptions.brandName,
          domain: watchtowerSubscriptions.domain,
          plan: watchtowerSubscriptions.plan,
          status: watchtowerSubscriptions.status,
          prompts: watchtowerSubscriptions.prompts,
          frequency: watchtowerSubscriptions.frequency,
          promptCap: watchtowerSubscriptions.promptCap,
          stripeCustomerId: watchtowerSubscriptions.stripeCustomerId,
          stripeSubscriptionId: watchtowerSubscriptions.stripeSubscriptionId,
          createdAt: watchtowerSubscriptions.createdAt,
        })
        .from(watchtowerSubscriptions)
        .leftJoin(
          customerAccounts,
          eq(customerAccounts.id, watchtowerSubscriptions.accountId),
        )
        .where(eq(watchtowerSubscriptions.id, subscriptionId))
        .limit(1);

      if (!sub) {
        res.status(404).json({ error: "Subscription not found" });
        return;
      }

      // Prompts are stored as jsonb; coerce to string[] for the wire.
      const promptsArray = Array.isArray(sub.prompts)
        ? (sub.prompts as unknown[])
            .filter((p): p is string => typeof p === "string")
        : [];

      const runs = await db
        .select({
          id: watchtowerRuns.id,
          runAt: watchtowerRuns.runAt,
          engines: watchtowerRuns.engines,
          totalPrompts: watchtowerRuns.totalPrompts,
          mentionCount: watchtowerRuns.mentionCount,
          summary: watchtowerRuns.summary,
        })
        .from(watchtowerRuns)
        .where(eq(watchtowerRuns.subscriptionId, subscriptionId))
        .orderBy(desc(watchtowerRuns.runAt))
        .limit(8);

      // Per-run error count (a result with empty raw_response is treated as
      // an engine-level failure; see services/watchtower-monitor.ts).
      const runIds = runs.map((r) => r.id);
      let errorCountByRun = new Map<string, number>();
      if (runIds.length > 0) {
        const errorRows = await db
          .select({
            runId: watchtowerResults.runId,
            count: sql<number>`count(*)::int`,
          })
          .from(watchtowerResults)
          .where(
            and(
              inArray(watchtowerResults.runId, runIds),
              sql`coalesce(length(${watchtowerResults.rawResponse}), 0) = 0`,
            ),
          )
          .groupBy(watchtowerResults.runId);
        errorCountByRun = new Map(
          errorRows.map((r) => [r.runId, Number(r.count)]),
        );
      }

      const runsOut = runs.map((r) => ({
        id: r.id,
        runAt: r.runAt,
        engines: r.engines,
        totalPrompts: r.totalPrompts,
        mentionCount: r.mentionCount,
        errorCount: errorCountByRun.get(r.id) ?? 0,
        summary: r.summary,
      }));

      // Activity log entries for this subscription. The activity-log table
      // is keyed (entity_type, entity_id) so we filter on those.
      const activity = await db
        .select({
          id: activityLog.id,
          action: activityLog.action,
          entityType: activityLog.entityType,
          entityId: activityLog.entityId,
          actorType: activityLog.actorType,
          actorId: activityLog.actorId,
          details: activityLog.details,
          createdAt: activityLog.createdAt,
        })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityType, "watchtower_subscription"),
            eq(activityLog.entityId, subscriptionId),
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .limit(20);

      res.json({
        subscription: {
          id: sub.id,
          email: sub.email ?? sub.accountEmail ?? null,
          accountId: sub.accountId,
          brandName: sub.brandName,
          domain: sub.domain,
          plan: sub.plan,
          status: sub.status,
          frequency: sub.frequency,
          promptCap: sub.promptCap,
          stripeCustomerId: sub.stripeCustomerId,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          createdAt: sub.createdAt,
        },
        prompts: promptsArray,
        runs: runsOut,
        activityLog: activity,
      });
    } catch (err) {
      logger.error(
        { err, subscriptionId },
        "watchtower-admin: getCustomer failed",
      );
      res.status(500).json({ error: "Failed to load customer" });
    }
  });

  // -------------------- GET /aggregate --------------------
  router.get("/aggregate", async (_req, res) => {
    try {
      const now = Date.now();
      const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

      const [counts] = await db
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${watchtowerSubscriptions.status} = 'active')::int`,
        })
        .from(watchtowerSubscriptions);

      const totalCustomers = Number(counts?.total ?? 0);
      const activeCustomers = Number(counts?.active ?? 0);
      const mrrCents = activeCustomers * WATCHTOWER_MONTHLY_PRICE_CENTS;

      const [runs7d] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(watchtowerRuns)
        .where(gte(watchtowerRuns.runAt, sevenDaysAgo));

      const [runs30d] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(watchtowerRuns)
        .where(gte(watchtowerRuns.runAt, thirtyDaysAgo));

      const [mentions30d] = await db
        .select({
          c: sql<number>`coalesce(sum(${watchtowerRuns.mentionCount}), 0)::int`,
        })
        .from(watchtowerRuns)
        .where(gte(watchtowerRuns.runAt, thirtyDaysAgo));

      // Engines that produced at least one empty raw_response in the last
      // 7 days. Joins runs (for the time window) to results (for the
      // engine bucket).
      const erroredRows = await db
        .selectDistinct({ engine: watchtowerResults.engine })
        .from(watchtowerResults)
        .innerJoin(
          watchtowerRuns,
          eq(watchtowerRuns.id, watchtowerResults.runId),
        )
        .where(
          and(
            gte(watchtowerRuns.runAt, sevenDaysAgo),
            sql`coalesce(length(${watchtowerResults.rawResponse}), 0) = 0`,
          ),
        );

      res.json({
        totalCustomers,
        activeCustomers,
        mrrCents,
        runsLast7d: Number(runs7d?.c ?? 0),
        runsLast30d: Number(runs30d?.c ?? 0),
        enginesWithErrorsLast7d: erroredRows.map((r) => r.engine),
        totalMentionsLast30d: Number(mentions30d?.c ?? 0),
      });
    } catch (err) {
      logger.error({ err }, "watchtower-admin: aggregate failed");
      res.status(500).json({ error: "Failed to load aggregate" });
    }
  });

  return router;
}
