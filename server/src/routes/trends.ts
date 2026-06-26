import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { Db } from "@paperclipai/db";
import { getLatestSignals } from "../services/trend-crons.js";
import { trendScannerService } from "../services/trend-scanner.js";
import { seoEngineService } from "../services/seo-engine.js";
import { trendsDigestStore } from "../services/trends-digest/store.js";
import { buildAndStorePendingDigest } from "../services/trends-digest/build.js";
import { sendWhatsHotDigestToFoundingList } from "../services/trends-digest/whats-hot-email-callback.js";

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

  // -------------------------------------------------------------------------
  // "What's Hot" digest — the hardened anti-hallucination feed. A digest is
  // built `pending`, a human approves it (Rule 7), then it can be sent.
  // -------------------------------------------------------------------------

  function requireDb(res: Response): Db | null {
    if (!db) {
      res.status(503).json({ error: "Database not available" });
      return null;
    }
    return db;
  }

  // GET /api/trends/today — the latest APPROVED (or sent) digest. Members read
  // this; a pending digest is NEVER exposed here (Rule 7). Public, read-only.
  router.get("/trends/today", async (_req, res) => {
    const database = requireDb(res);
    if (!database) return;
    try {
      const latest = await trendsDigestStore(database).latestPublished();
      if (!latest) {
        res.status(404).json({ error: "No approved digest yet." });
        return;
      }
      res.json(latest.payload);
    } catch (err) {
      res.status(500).json({ error: "Failed to load digest" });
    }
  });

  // POST /api/trends/digest/build — build a fresh PENDING digest (admin).
  router.post("/trends/digest/build", requireContentKey, async (req, res) => {
    const database = requireDb(res);
    if (!database) return;
    try {
      const forceScan = req.body?.forceScan === true;
      const digest = await buildAndStorePendingDigest(database, { forceScan });
      res.json({
        ok: true,
        digestDate: digest.digestDate,
        items: digest.items.length,
        adFriendly: digest.adFriendlyItemIds.length,
        status: digest.status,
      });
    } catch (err) {
      res.status(500).json({ error: "Digest build failed" });
    }
  });

  // GET /api/trends/digest/pending — newest digest awaiting review (admin).
  router.get("/trends/digest/pending", requireContentKey, async (_req, res) => {
    const database = requireDb(res);
    if (!database) return;
    try {
      const pending = await trendsDigestStore(database).latestPending();
      if (!pending) {
        res.status(404).json({ error: "No pending digest." });
        return;
      }
      res.json(pending);
    } catch (err) {
      res.status(500).json({ error: "Failed to load pending digest" });
    }
  });

  // POST /api/trends/digest/:date/approve — Rule 7 human gate (admin).
  router.post(
    "/trends/digest/:date/approve",
    requireContentKey,
    async (req, res) => {
      const database = requireDb(res);
      if (!database) return;
      const date = String(req.params.date);
      const approver =
        (req.headers["x-actor"] as string | undefined)?.slice(0, 120) ||
        "admin";
      try {
        const ok = await trendsDigestStore(database).approve(date, approver);
        if (!ok) {
          res
            .status(409)
            .json({ error: "No pending digest for that date to approve." });
          return;
        }
        res.json({ ok: true, digestDate: date, status: "approved" });
      } catch (err) {
        res.status(500).json({ error: "Approve failed" });
      }
    },
  );

  // POST /api/trends/digest/:date/reject — discard a bad run (admin).
  router.post(
    "/trends/digest/:date/reject",
    requireContentKey,
    async (req, res) => {
      const database = requireDb(res);
      if (!database) return;
      const date = String(req.params.date);
      try {
        const ok = await trendsDigestStore(database).reject(date);
        if (!ok) {
          res.status(409).json({ error: "No pending digest for that date." });
          return;
        }
        res.json({ ok: true, digestDate: date, status: "rejected" });
      } catch (err) {
        res.status(500).json({ error: "Reject failed" });
      }
    },
  );

  // POST /api/trends/digest/:date/send — blast an APPROVED digest to the
  // founding list, then mark it sent. Refuses anything not yet approved.
  router.post(
    "/trends/digest/:date/send",
    requireContentKey,
    async (req, res) => {
      const database = requireDb(res);
      if (!database) return;
      const store = trendsDigestStore(database);
      const date = String(req.params.date);
      try {
        const row = await store.getByDate(date);
        if (!row) {
          res.status(404).json({ error: "No digest for that date." });
          return;
        }
        if (row.status !== "approved") {
          res.status(409).json({
            error: `Digest is '${row.status}', not 'approved'. Approve before sending (Rule 7).`,
          });
          return;
        }
        const result = await sendWhatsHotDigestToFoundingList(
          database,
          row.payload,
        );
        await store.markSent(date);
        res.json({ ok: true, digestDate: date, status: "sent", ...result });
      } catch (err) {
        res.status(500).json({ error: "Send failed" });
      }
    },
  );

  return router;
}
