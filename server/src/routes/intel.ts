import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { intelService } from "../services/index.js";
import { intelDiscoveryService } from "../services/intel-discovery.js";
import { mintscanService } from "../services/mintscan.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Auth helper — ingest/seed endpoints require INTEL_INGEST_KEY
// ---------------------------------------------------------------------------

const INTEL_INGEST_KEY = process.env.INTEL_INGEST_KEY || "";

function requireIngestKey(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  if (!INTEL_INGEST_KEY) {
    res.status(503).json({ error: "Intel ingest key not configured" });
    return;
  }
  const provided =
    req.headers["x-intel-key"] as string | undefined ??
    req.headers["authorization"]?.replace("Bearer ", "");
  if (provided !== INTEL_INGEST_KEY) {
    res.status(401).json({ error: "Invalid or missing intel ingest key" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function intelRoutes(db: Db) {
  const router = Router();
  const svc = intelService(db);
  const discovery = intelDiscoveryService(db);
  const mintscan = mintscanService(db);

  // ---- Public read endpoints (no auth) ----

  router.get("/search", async (req, res) => {
    const q = req.query.q as string | undefined;
    if (!q || q.trim().length === 0) {
      res.json({ results: [] });
      return;
    }

    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string ?? "10", 10) || 10), 50);
    const company = req.query.company as string | undefined;

    try {
      const result = await svc.search(q, limit, company);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Intel search error");
      res.status(500).json({ results: [], error: "Search unavailable" });
    }
  });

  router.get("/company/:slug", async (req, res) => {
    try {
      const result = await svc.getCompany(req.params.slug);
      if (!result) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Intel company error");
      res.status(500).json({ error: "Failed to fetch company data" });
    }
  });

  router.get("/companies", async (req, res) => {
    try {
      const directory = req.query.directory as string | undefined;
      const companies = await svc.listCompanies(directory);
      res.json({ companies, directory: directory ?? "all" });
    } catch (err) {
      logger.error({ err }, "Intel list companies error");
      res.status(500).json({ error: "Failed to list companies" });
    }
  });

  router.get("/stats", async (_req, res) => {
    try {
      const result = await svc.stats();
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Intel stats error");
      res.status(500).json({ error: "Stats unavailable" });
    }
  });

  router.get("/chain/:network", async (req, res) => {
    try {
      const result = await mintscan.getLatestChainMetrics(req.params.network as string);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Chain metrics fetch error");
      res.status(500).json({ error: "Failed to fetch chain metrics" });
    }
  });

  // ---- Protected write endpoints (require INTEL_INGEST_KEY) ----

  router.post("/seed", requireIngestKey, async (_req, res) => {
    try {
      const result = await svc.seedCompanies();
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Intel seed error");
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  router.post("/backfill", requireIngestKey, async (_req, res) => {
    try {
      const result = await svc.backfillNewCompanies();
      res.json({ success: true, ...result });
    } catch (err) {
      logger.error({ err }, "Intel backfill error");
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  router.post("/ingest/prices", requireIngestKey, async (req, res) => {
    const limit = parseInt(req.query.limit as string ?? "90", 10);
    const offset = parseInt(req.query.offset as string ?? "0", 10);
    try {
      const result = await svc.ingestPrices(limit, offset);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Intel price ingest error");
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  router.post("/ingest/news", requireIngestKey, async (req, res) => {
    const limit = parseInt(req.query.limit as string ?? "30", 10);
    const offset = parseInt(req.query.offset as string ?? "0", 10);
    try {
      const result = await svc.ingestNews(limit, offset);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Intel news ingest error");
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  router.post("/ingest/twitter", requireIngestKey, async (req, res) => {
    const limit = parseInt(req.query.limit as string ?? "20", 10);
    const offset = parseInt(req.query.offset as string ?? "0", 10);
    try {
      const result = await svc.ingestTwitter(limit, offset);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Intel twitter ingest error");
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  router.post("/ingest/github", requireIngestKey, async (req, res) => {
    const limit = parseInt(req.query.limit as string ?? "15", 10);
    const offset = parseInt(req.query.offset as string ?? "0", 10);
    try {
      const result = await svc.ingestGithub(limit, offset);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Intel github ingest error");
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  router.post("/ingest/reddit", requireIngestKey, async (req, res) => {
    const limit = parseInt(req.query.limit as string ?? "20", 10);
    const offset = parseInt(req.query.offset as string ?? "0", 10);
    try {
      const result = await svc.ingestReddit(limit, offset);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Intel reddit ingest error");
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ---- Discovery endpoints ----

  router.get("/discoveries", requireIngestKey, async (_req, res) => {
    try {
      const discoveries = await discovery.listDiscoveries();
      res.json({ discoveries });
    } catch (err) {
      logger.error({ err }, "Intel discoveries list error");
      res.status(500).json({ error: "Failed to list discoveries" });
    }
  });

  router.post("/discoveries/:id/approve", requireIngestKey, async (req, res) => {
    try {
      const result = await discovery.approveDiscovery(parseInt(req.params.id as string, 10));
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Intel discovery approve error");
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  router.post("/discoveries/:id/reject", requireIngestKey, async (req, res) => {
    try {
      const result = await discovery.rejectDiscovery(parseInt(req.params.id as string, 10));
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Intel discovery reject error");
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  router.post("/discover", requireIngestKey, async (_req, res) => {
    try {
      const result = await discovery.discoverNewProjects();
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Intel discovery run error");
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── Feed endpoint (recent reports for Discord/external polling) ──────────

  router.get("/feed", async (req, res) => {
    try {
      const since = req.query.since as string | undefined;
      if (!since) {
        res.status(400).json({ error: "since parameter required (ISO timestamp)" });
        return;
      }
      const typeFilter = req.query.type as string | undefined;
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string ?? "20", 10) || 20));

      const types = typeFilter ? typeFilter.split(",").map((t: string) => t.trim()) : null;

      const { sql: sqlTag } = await import("drizzle-orm");

      // Build type filter using sql.join for proper parameterization
      const typeCondition = types && types.length > 0
        ? sqlTag`AND r.report_type IN (${sqlTag.join(types.map((t) => sqlTag`${t}`), sqlTag`, `)})`
        : sqlTag``;

      const result = await db.execute(sqlTag`
        SELECT
          r.id,
          r.company_slug,
          c.name AS company_name,
          r.report_type,
          r.headline,
          LEFT(r.body, 300) AS body,
          r.source_url,
          r.captured_at
        FROM intel_reports r
        LEFT JOIN intel_companies c ON c.slug = r.company_slug
        WHERE r.captured_at > ${since}::timestamptz
        ${typeCondition}
        ORDER BY r.captured_at DESC
        LIMIT ${limit}
      `);

      res.json({ reports: result as unknown as Record<string, unknown>[] });
    } catch (err) {
      logger.error({ err }, "Intel feed error");
      res.status(500).json({ error: "Feed unavailable" });
    }
  });

  return router;
}
