// ---------------------------------------------------------------------------
// API usage/cost meter — admin rollup surface (board-only).
//
// Mounted at /api/api-usage by app.ts. Reads the api_usage_events ledger that
// logApiUsage() (services/api-usage.ts) fills on every successful provider
// call. Gating copies university-agents-admin: access-log every attempt
// (incl. unauthenticated probes), then board-gate.
//
// Routes:
//   GET /summary → { todayUsd, weekUsd, monthUsd, byProvider[], byService[] }
//                  each breakdown row carries today/7d/30d calls + tokens + usd
// ---------------------------------------------------------------------------

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logAdminAccess } from "../middleware/log-admin-access.js";
import { summarizeApiUsage } from "../services/api-usage.js";

export function apiUsageRoutes(db: Db) {
  const router = Router();

  // Access-log every attempt (incl. unauthenticated probes), then board-gate.
  router.use(logAdminAccess(db));
  router.use((req, res, next) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Admin only" });
      return;
    }
    next();
  });

  // -------------------- GET /summary --------------------
  router.get("/summary", async (_req, res) => {
    try {
      res.json(await summarizeApiUsage(db));
    } catch (err) {
      logger.error({ err }, "api-usage: GET /summary failed");
      res.status(500).json({ error: "Failed to load API usage summary" });
    }
  });

  return router;
}
