import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { Db } from "@paperclipai/db";
import { getLatestSignals } from "../services/trend-crons.js";
import { trendScannerService } from "../services/trend-scanner.js";
import { seoEngineService } from "../services/seo-engine.js";

const CONTENT_API_KEY = process.env.CONTENT_API_KEY || "";

function requireContentKey(req: Request, res: Response, next: NextFunction) {
  if (!CONTENT_API_KEY) {
    res.status(503).json({ error: "Content API key not configured" });
    return;
  }
  const provided =
    (req.headers["x-content-key"] as string | undefined) ??
    req.headers["authorization"]?.replace("Bearer ", "");
  if (provided !== CONTENT_API_KEY) {
    res.status(401).json({ error: "Invalid or missing content API key" });
    return;
  }
  next();
}

export function trendRoutes(db?: Db) {
  const router = Router();

  // GET /api/trends/signals — latest cached signals (no auth, read-only)
  router.get("/trends/signals", (_req, res) => {
    const signals = getLatestSignals();
    if (!signals) {
      res.status(503).json({ error: "Signals not yet available. Scanner initializing." });
      return;
    }
    res.json(signals);
  });

  // POST /api/trends/scan — force a fresh scan (requires CONTENT_API_KEY)
  router.post("/trends/scan", requireContentKey, async (_req, res) => {
    try {
      const svc = trendScannerService();
      const signals = await svc.scan();
      res.json(signals);
    } catch (err) {
      res.status(500).json({ error: "Scan failed" });
    }
  });

  // POST /api/trends/generate — force SEO engine run (requires CONTENT_API_KEY)
  router.post("/trends/generate", requireContentKey, async (_req, res) => {
    try {
      const engine = seoEngineService(db);
      const result = await engine.run();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "SEO engine run failed" });
    }
  });

  return router;
}
