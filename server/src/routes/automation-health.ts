/**
 * Automation Health route — returns a single aggregated snapshot of the
 * automated services state (crons, plugins, integrations, advisory queue).
 *
 * Backs the `/automation-health` admin dashboard.
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { getAutomationHealth } from "../services/automation-health.js";
import { logger } from "../middleware/logger.js";

export function automationHealthRoutes(db: Db) {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const snapshot = await getAutomationHealth(db);
      res.json(snapshot);
    } catch (err) {
      logger.error({ err }, "Failed to build automation health snapshot");
      res.status(500).json({ error: "Failed to build automation health snapshot" });
    }
  });

  return router;
}
