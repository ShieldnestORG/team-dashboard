import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns } from "@paperclipai/db";
import { count, eq, gte, and, inArray } from "drizzle-orm";
import * as ladder from "../services/ladder.js";
import { getEvalHistory, getLatestEval } from "../services/eval-store.js";
import { getRecentAlerts } from "../services/alerting.js";
import { getRecentLogs } from "../services/log-store.js";
import { getServiceStatuses, getSystemMetrics, INFRA_COSTS } from "../services/vps-monitor.js";
import { getOllamaUsageStats } from "../services/ollama-client.js";
import { API_REGISTRY, getTotalEndpointCount, type ApiRouteGroup } from "../services/api-registry.js";

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
        ollamaUsage: getOllamaUsageStats(),
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

  // ---------------------------------------------------------------------------
  // API Routes registry
  // ---------------------------------------------------------------------------

  // Cache for ping results (60s TTL)
  const pingCache = new Map<string, { status: "up" | "down" | "degraded"; latencyMs: number; checkedAt: string }>();
  const PING_CACHE_TTL = 60_000;

  async function pingRoute(group: ApiRouteGroup): Promise<{ status: "up" | "down" | "degraded"; latencyMs: number; checkedAt: string }> {
    const cached = pingCache.get(group.prefix);
    if (cached && Date.now() - new Date(cached.checkedAt).getTime() < PING_CACHE_TTL) {
      return cached;
    }

    const port = process.env.PORT || "3100";
    const url = `http://127.0.0.1:${port}${group.pingUrl}`;
    const start = Date.now();
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      const latencyMs = Date.now() - start;
      const result = {
        status: resp.ok ? "up" as const : "degraded" as const,
        latencyMs,
        checkedAt: new Date().toISOString(),
      };
      pingCache.set(group.prefix, result);
      return result;
    } catch {
      const latencyMs = Date.now() - start;
      const result = { status: "down" as const, latencyMs, checkedAt: new Date().toISOString() };
      pingCache.set(group.prefix, result);
      return result;
    }
  }

  // GET /api/system-health/api-routes — list all route groups with optional live status
  router.get("/api-routes", async (req, res) => {
    try {
      const withPing = req.query.ping === "true";

      let routes: Array<ApiRouteGroup & { liveStatus?: { status: string; latencyMs: number; checkedAt: string } }>;

      if (withPing) {
        const results = await Promise.allSettled(API_REGISTRY.map((g) => pingRoute(g)));
        routes = API_REGISTRY.map((g, i) => ({
          ...g,
          liveStatus: results[i]?.status === "fulfilled" ? results[i].value : { status: "down", latencyMs: 0, checkedAt: new Date().toISOString() },
        }));
      } else {
        // Return cached pings if available, no fresh pings
        routes = API_REGISTRY.map((g) => {
          const cached = pingCache.get(g.prefix);
          return { ...g, liveStatus: cached ?? undefined };
        });
      }

      const totalEndpoints = getTotalEndpointCount();
      const upCount = routes.filter((r) => r.liveStatus?.status === "up").length;
      const publicCount = API_REGISTRY.filter((r) => r.authType === "public").length;
      const authCount = API_REGISTRY.filter((r) => r.authType === "authenticated").length;
      const contentKeyCount = API_REGISTRY.filter((r) => r.authType === "content-key").length;
      const ingestKeyCount = API_REGISTRY.filter((r) => r.authType === "ingest-key").length;

      res.json({
        routes,
        stats: {
          totalGroups: API_REGISTRY.length,
          totalEndpoints,
          upCount,
          publicCount,
          authCount,
          contentKeyCount,
          ingestKeyCount,
        },
      });
    } catch (err) {
      console.error("api-routes error:", err);
      res.status(500).json({ error: "Failed to list API routes" });
    }
  });

  // POST /api/system-health/api-routes/ping — ping a specific route group
  router.post("/api-routes/ping", async (req, res) => {
    try {
      const { prefix } = req.body as { prefix?: string };
      if (!prefix) {
        res.status(400).json({ error: "prefix is required" });
        return;
      }
      const group = API_REGISTRY.find((g) => g.prefix === prefix);
      if (!group) {
        res.status(404).json({ error: "Route group not found" });
        return;
      }
      // Clear cache for this group to force fresh ping
      pingCache.delete(group.prefix);
      const result = await pingRoute(group);
      res.json({ prefix: group.prefix, ...result });
    } catch (err) {
      console.error("api-routes ping error:", err);
      res.status(500).json({ error: "Failed to ping route" });
    }
  });

  return router;
}
