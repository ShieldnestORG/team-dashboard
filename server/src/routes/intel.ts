import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { intelService } from "../services/index.js";
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

  router.get("/companies", async (_req, res) => {
    try {
      const companies = await svc.listCompanies();
      res.json({ companies });
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

  return router;
}
