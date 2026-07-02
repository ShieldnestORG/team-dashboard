import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { runRetentionSweep } from "../services/maintenance/retention-sweep.js";
import { logger } from "../middleware/logger.js";
import { logAdminAccess } from "../middleware/log-admin-access.js";

export function maintenanceRoutes(db: Db) {
  const router = Router();

  // SECURITY: this router triggers an IRREVERSIBLE destructive data purge.
  // Admin-access audit log first (records unauth probes too), then require an
  // instance admin. Mirrors the board-only guard on system-crons.ts, escalated
  // to instance-admin given the destructive blast radius.
  router.use(logAdminAccess(db));
  router.use((req, res, next) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Admin only" });
      return;
    }
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin) {
      res.status(403).json({ error: "Instance admin only" });
      return;
    }
    next();
  });

  router.post("/retention-sweep/run-now", async (_req, res) => {
    try {
      const summary = await runRetentionSweep(db);
      res.json({ ok: true, summary });
    } catch (err) {
      logger.error({ err }, "retention-sweep manual trigger failed");
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
