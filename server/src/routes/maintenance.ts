import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { runRetentionSweep } from "../services/maintenance/retention-sweep.js";
import { logger } from "../middleware/logger.js";

export function maintenanceRoutes(db: Db) {
  const router = Router();

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
