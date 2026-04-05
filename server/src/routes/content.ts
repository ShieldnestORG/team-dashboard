import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { contentService } from "../services/content.js";
import { contentFeedbackService } from "../services/content-feedback.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Auth helper — content endpoints require CONTENT_API_KEY
// ---------------------------------------------------------------------------

const CONTENT_API_KEY = process.env.CONTENT_API_KEY || "";

function requireContentKey(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  if (!CONTENT_API_KEY) {
    res.status(503).json({ error: "Content API key not configured" });
    return;
  }
  const provided =
    req.headers["x-content-key"] as string | undefined ??
    req.headers["authorization"]?.replace("Bearer ", "");
  if (provided !== CONTENT_API_KEY) {
    res.status(401).json({ error: "Invalid or missing content API key" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function contentRoutes(db: Db) {
  const router = Router();
  const svc = contentService(db);
  const feedbackSvc = contentFeedbackService(db);

  // ---- POST /api/content/preview ----

  router.post("/preview", requireContentKey, async (req, res) => {
    const { personalityId, contentType, topic, contextQuery } = req.body;

    if (!personalityId || !contentType || !topic) {
      res.status(400).json({
        error: "Missing required fields: personalityId, contentType, topic",
      });
      return;
    }

    try {
      const result = await svc.preview({ personalityId, contentType, topic, contextQuery });
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Content preview error");
      res.status(500).json({ error: String(err) });
    }
  });

  // ---- POST /api/content/generate ----

  router.post("/generate", requireContentKey, async (req, res) => {
    const { personalityId, contentType, topic, contextQuery } = req.body;

    if (!personalityId || !contentType || !topic) {
      res.status(400).json({
        error: "Missing required fields: personalityId, contentType, topic",
      });
      return;
    }

    try {
      const result = await svc.generate({ personalityId, contentType, topic, contextQuery });
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Content generation error");
      res.status(500).json({ error: String(err) });
    }
  });

  // ---- GET /api/content/queue ----

  router.get("/queue", requireContentKey, async (req, res) => {
    const status = req.query.status as string | undefined;
    const platform = req.query.platform as string | undefined;
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string ?? "50", 10) || 50),
      200,
    );
    const offset = Math.max(0, parseInt(req.query.offset as string ?? "0", 10) || 0);

    try {
      const items = await svc.listQueue({ status, platform, limit, offset });
      res.json({ items, count: items.length, limit, offset });
    } catch (err) {
      logger.error({ err }, "Content queue list error");
      res.status(500).json({ error: "Failed to list content queue" });
    }
  });

  // ---- PATCH /api/content/queue/:id/review ----

  router.patch("/queue/:id/review", requireContentKey, async (req, res) => {
    const id = req.params.id as string;
    const reviewStatus = req.body.reviewStatus as string;
    const reviewComment = req.body.reviewComment as string | undefined;

    if (!reviewStatus) {
      res.status(400).json({ error: "Missing required field: reviewStatus" });
      return;
    }

    try {
      await svc.reviewItem(id, reviewStatus, reviewComment);
      res.json({ success: true, id, reviewStatus });
    } catch (err) {
      logger.error({ err, id }, "Content review error");
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  // ---- GET /api/content/queue/stats ----

  router.get("/queue/stats", requireContentKey, async (_req, res) => {
    try {
      const result = await svc.stats();
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Content stats error");
      res.status(500).json({ error: "Stats unavailable" });
    }
  });

  // ---- POST /api/content/:id/feedback ----

  router.post("/:id/feedback", requireContentKey, async (req, res) => {
    const contentItemId = req.params.id as string;
    const { rating, comment, contentType } = req.body as {
      rating: string;
      comment?: string;
      contentType?: string;
    };

    if (!rating || (rating !== "like" && rating !== "dislike")) {
      res.status(400).json({ error: 'Missing or invalid rating. Must be "like" or "dislike"' });
      return;
    }

    const companyId = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

    try {
      const feedback = await feedbackSvc.add({
        companyId,
        contentItemId,
        contentType: (contentType as "text" | "visual") || "text",
        rating: rating as "like" | "dislike",
        comment,
        createdByUserId: req.actor?.type === "board" ? req.actor.userId ?? undefined : undefined,
      });
      res.json(feedback);
    } catch (err) {
      logger.error({ err, contentItemId }, "Content feedback error");
      res.status(500).json({ error: "Failed to submit feedback" });
    }
  });

  // ---- GET /api/content/:id/feedback ----

  router.get("/:id/feedback", requireContentKey, async (req, res) => {
    const contentItemId = req.params.id as string;

    try {
      const feedback = await feedbackSvc.getForItem(contentItemId);
      res.json({ feedback });
    } catch (err) {
      logger.error({ err, contentItemId }, "Content feedback list error");
      res.status(500).json({ error: "Failed to fetch feedback" });
    }
  });

  // ---- GET /api/content/feedback/stats ----

  router.get("/feedback/stats", requireContentKey, async (_req, res) => {
    const companyId = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

    try {
      const stats = await feedbackSvc.getStats(companyId);
      res.json(stats);
    } catch (err) {
      logger.error({ err }, "Content feedback stats error");
      res.status(500).json({ error: "Failed to fetch feedback stats" });
    }
  });

  return router;
}
