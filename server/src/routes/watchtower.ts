// ---------------------------------------------------------------------------
// Watchtower brand-mention monitor — read-only API surface (v1).
//
// Mounted at /api/watchtower by app.ts. Three routes:
//
//   GET  /subscriptions/:id              → subscription + last 4 runs
//   GET  /runs/:id                       → run row + per-result detail
//   POST /runs/:id/trigger-test          → INTERNAL only — runs the
//                                          subscription that owns the run
//                                          id (or, for now, treats :id as
//                                          the subscription id) and
//                                          returns the new runId.
//                                          Gated on INTERNAL_API_TOKEN.
//
// Write/CRUD endpoints (subscription create/update/cancel) are owned by
// Worker A's portal — the Stripe webhook + portal-auth path lands there.
// Don't add them here.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  watchtowerSubscriptions,
  watchtowerRuns,
  watchtowerResults,
} from "@paperclipai/db";
import { runSubscription } from "../services/watchtower-monitor.js";
import { logger } from "../middleware/logger.js";

export function watchtowerRoutes(db: Db) {
  const router = Router();

  // -------------------- GET /subscriptions/:id --------------------
  router.get("/subscriptions/:id", async (req, res) => {
    const id = req.params.id as string;
    const [sub] = await db
      .select()
      .from(watchtowerSubscriptions)
      .where(eq(watchtowerSubscriptions.id, id));

    if (!sub) return res.status(404).json({ error: "not_found" });

    const recentRuns = await db
      .select({
        id: watchtowerRuns.id,
        runAt: watchtowerRuns.runAt,
        engines: watchtowerRuns.engines,
        totalPrompts: watchtowerRuns.totalPrompts,
        mentionCount: watchtowerRuns.mentionCount,
        summary: watchtowerRuns.summary,
      })
      .from(watchtowerRuns)
      .where(eq(watchtowerRuns.subscriptionId, id))
      .orderBy(desc(watchtowerRuns.runAt))
      .limit(4);

    return res.json({ subscription: sub, recentRuns });
  });

  // -------------------- GET /runs/:id --------------------
  router.get("/runs/:id", async (req, res) => {
    const id = req.params.id as string;
    const [run] = await db
      .select()
      .from(watchtowerRuns)
      .where(eq(watchtowerRuns.id, id));

    if (!run) return res.status(404).json({ error: "not_found" });

    const results = await db
      .select()
      .from(watchtowerResults)
      .where(eq(watchtowerResults.runId, id));

    return res.json({ run, results });
  });

  // -------------------- POST /runs/:id/trigger-test --------------------
  // INTERNAL: dev/QA helper. The :id here is interpreted as a
  // SUBSCRIPTION id (we don't yet have a "re-run a specific past run"
  // feature — the v1 unit of work is "rerun this subscription"). Naming
  // the path /runs/:id/trigger-test mirrors the spec.
  router.post("/runs/:id/trigger-test", async (req, res) => {
    const expected = process.env.INTERNAL_API_TOKEN?.trim();
    const supplied =
      (req.headers["x-internal-token"] as string | undefined)?.trim() ??
      (req.headers["authorization"] as string | undefined)
        ?.replace(/^Bearer\s+/i, "")
        .trim();

    if (!expected) {
      return res.status(503).json({ error: "internal_token_unset" });
    }
    if (!supplied || supplied !== expected) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const subscriptionId = req.params.id as string;
    try {
      const result = await runSubscription(db, subscriptionId);
      return res.json({
        ok: true,
        runId: result.runId,
        mentionCount: result.mentionCount,
        totalPrompts: result.totalPrompts,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: message, subscriptionId },
        "watchtower: trigger-test failed",
      );
      return res.status(500).json({ error: "run_failed", detail: message });
    }
  });

  return router;
}
