import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { getCronStatus, updateCronJob, triggerCronJob } from "../services/cron-registry.js";

export function systemCronRoutes(db: Db) {
  const router = Router();

  // GET /api/system-crons — list all registered cron jobs with DB + in-memory state
  router.get("/", (_req, res) => {
    try {
      const crons = getCronStatus();
      res.json({ crons });
    } catch (err) {
      console.error("system-crons list error:", err);
      res.status(500).json({ error: "Failed to list cron jobs" });
    }
  });

  // PATCH /api/system-crons/:jobName — toggle enabled, set schedule override
  router.patch("/:jobName", async (req, res) => {
    try {
      const jobName = req.params.jobName as string;
      const { enabled, scheduleOverride } = req.body as {
        enabled?: boolean;
        scheduleOverride?: string | null;
      };

      const result = await updateCronJob(db, jobName, { enabled, scheduleOverride });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("system-crons update error:", err);
      res.status(500).json({ error: "Failed to update cron job" });
    }
  });

  // POST /api/system-crons/:jobName/run — manually trigger a cron job
  router.post("/:jobName/run", async (req, res) => {
    try {
      const jobName = req.params.jobName as string;
      const result = await triggerCronJob(jobName);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("system-crons trigger error:", err);
      res.status(500).json({ error: "Failed to trigger cron job" });
    }
  });

  return router;
}
