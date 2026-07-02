/**
 * Moltbook admin API routes — stats, manual triggers, feed inspection.
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { getStats, ingestFeed, generatePost, engageFeed, trackPerformance } from "../services/moltbook-engine.js";
import { logAdminAccess } from "../middleware/log-admin-access.js";

export function moltbookRoutes(db: Db): Router {
  const router = Router();

  // Admin-only: board-session operators only. Fail-closed — an anonymous
  // (actor.type='none') request is rejected with 401 before any handler runs.
  router.use(logAdminAccess(db));
  router.use((req, res, next) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Admin only" });
      return;
    }
    next();
  });

  // GET /api/moltbook/stats — current stats and status
  router.get("/stats", async (_req, res) => {
    try {
      const stats = await getStats(db);
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/moltbook/ingest — manually trigger feed ingestion
  router.post("/ingest", async (_req, res) => {
    try {
      const result = await ingestFeed(db);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/moltbook/post — manually trigger post generation
  router.post("/post", async (_req, res) => {
    try {
      const result = await generatePost(db);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/moltbook/engage — manually trigger engagement
  router.post("/engage", async (_req, res) => {
    try {
      const result = await engageFeed(db);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/moltbook/performance — manually trigger performance tracking + tuning
  router.post("/performance", async (_req, res) => {
    try {
      const result = await trackPerformance(db);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/moltbook/feed — view ingested feed items
  router.get("/feed", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const rows = await db.execute(sql`
        SELECT id, post_id, submolt, title, author_name, upvotes, comment_count, engaged, engagement_type, ingested_at
        FROM moltbook_feed
        ORDER BY ingested_at DESC
        LIMIT ${limit}
      `);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/moltbook/posts — view our generated posts
  router.get("/posts", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const rows = await db.execute(sql`
        SELECT id, moltbook_post_id, submolt, title, content_type, status, error, created_at
        FROM moltbook_posts
        ORDER BY created_at DESC
        LIMIT ${limit}
      `);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
