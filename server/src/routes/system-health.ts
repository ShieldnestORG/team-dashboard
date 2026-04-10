import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns } from "@paperclipai/db";
import { count, eq, gte, and, inArray } from "drizzle-orm";
import * as ladder from "../services/ladder.js";
import { getEvalHistory, getLatestEval } from "../services/eval-store.js";
import { getRecentAlerts } from "../services/alerting.js";
import { getRecentLogs } from "../services/log-store.js";
import { getServiceStatuses, getSystemMetrics, INFRA_COSTS } from "../services/vps-monitor.js";

export function systemHealthRoutes(db: Db) {
  const router = Router();

  // GET /api/system-health/overview
  router.get("/overview", async (_req, res) => {
    try {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

      // Heartbeat run stats (14-day)
      const [totalRuns] = await db
        .select({ count: count() })
        .from(heartbeatRuns)
        .where(gte(heartbeatRuns.startedAt, fourteenDaysAgo));

      const [succeededRuns] = await db
        .select({ count: count() })
        .from(heartbeatRuns)
        .where(
          and(
            gte(heartbeatRuns.startedAt, fourteenDaysAgo),
            eq(heartbeatRuns.status, "completed"),
          ),
        );

      const [activeRuns] = await db
        .select({ count: count() })
        .from(heartbeatRuns)
        .where(inArray(heartbeatRuns.status, ["queued", "running"]));

      const total = Number(totalRuns?.count ?? 0);
      const succeeded = Number(succeededRuns?.count ?? 0);
      const successRate =
        total > 0 ? Math.round((succeeded / total) * 100) : null;

      // Ladder data
      const ladderAvailable = ladder.isAvailable();
      const pipeline = ladderAvailable
        ? ladder.getPipelineStatus("team-dashboard")
        : null;
      const telemetry = ladderAvailable
        ? ladder.getTelemetryStats("team-dashboard", 7)
        : null;
      const recentEvents = ladderAvailable
        ? ladder.getRecentEvents("team-dashboard", 10)
        : [];

      // Eval data
      const latestEval = getLatestEval();
      const evalHistory = getEvalHistory(14);

      // Compute health grade
      let grade = "A";
      const evalPassRate = latestEval
        ? (latestEval.passed / latestEval.totalTests) * 100
        : null;
      if (evalPassRate !== null && evalPassRate < 50) grade = "F";
      else if (evalPassRate !== null && evalPassRate < 70) grade = "D";
      else if (evalPassRate !== null && evalPassRate < 85) grade = "C";
      else if (evalPassRate !== null && evalPassRate < 95) grade = "B";
      if (successRate !== null && successRate < 70)
        grade = grade > "C" ? "C" : grade; // don't improve grade

      res.json({
        grade,
        runs: {
          total,
          succeeded,
          active: Number(activeRuns?.count ?? 0),
          successRate,
        },
        ladder: {
          available: ladderAvailable,
          pipeline,
          telemetry,
          recentEvents,
        },
        evals: { latest: latestEval, history: evalHistory, passRate: evalPassRate },
      });
    } catch (err) {
      console.error("system-health overview error:", err);
      res.status(500).json({ error: "Failed to compute system health" });
    }
  });

  // GET /api/system-health/ladder
  router.get("/ladder", (_req, res) => {
    try {
      if (!ladder.isAvailable()) {
        res.json({
          available: false,
          pipeline: null,
          entries: [],
          telemetry: null,
          projects: [],
        });
        return;
      }
      const project =
        typeof _req.query.project === "string"
          ? _req.query.project
          : undefined;
      res.json({
        available: true,
        pipeline: ladder.getPipelineStatus(project),
        entries: ladder.getEntries({ project, limit: 50 }),
        telemetry: ladder.getTelemetryStats(project, 14),
        projects: ladder.getProjects(),
        recentEvents: ladder.getRecentEvents(project, 30),
      });
    } catch (err) {
      console.error("system-health ladder error:", err);
      res.status(500).json({ error: "Failed to read ladder data" });
    }
  });

  // GET /api/system-health/evals
  router.get("/evals", (_req, res) => {
    try {
      const limit = Math.min(Number(_req.query.limit) || 30, 100);
      res.json({ history: getEvalHistory(limit), latest: getLatestEval() });
    } catch (err) {
      console.error("system-health evals error:", err);
      res.status(500).json({ error: "Failed to read eval data" });
    }
  });

  // GET /api/system-health/alerts
  router.get("/alerts", (_req, res) => {
    res.json({ alerts: getRecentAlerts() });
  });

  // GET /api/system-health/services — VPS service statuses + system metrics + infra costs
  router.get("/services", (_req, res) => {
    try {
      const services = getServiceStatuses();
      const totalMonthlyCents = INFRA_COSTS.reduce((sum, i) => sum + i.cost.monthlyCents, 0);
      res.json({
        services,
        metrics: getSystemMetrics(),
        infraCosts: INFRA_COSTS,
        totalMonthlyCents,
      });
    } catch (err) {
      console.error("system-health services error:", err);
      res.status(500).json({ error: "Failed to read service statuses" });
    }
  });

  // GET /api/system-health/logs
  router.get("/logs", (_req, res) => {
    const level = typeof _req.query.level === "string" ? _req.query.level : undefined;
    const limit = Math.min(Number(_req.query.limit) || 100, 500);
    res.json({ logs: getRecentLogs({ level, limit }) });
  });

  return router;
}
