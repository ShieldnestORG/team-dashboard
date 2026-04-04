import { Router } from "express";
import type { Db } from "@paperclipai/db";
import type { StorageService } from "../storage/types.js";
import { visualContentService } from "../services/visual-content.js";
import { getBackendSummary } from "../services/visual-backends/index.js";
import { getJob } from "../services/visual-jobs.js";
import { logger } from "../middleware/logger.js";

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
    (req.headers["x-content-key"] as string | undefined) ??
    req.headers["authorization"]?.replace("Bearer ", "");
  if (provided !== CONTENT_API_KEY) {
    res.status(401).json({ error: "Invalid or missing content API key" });
    return;
  }
  next();
}

export function visualContentRoutes(
  db: Db,
  storageService: StorageService,
  companyId: string,
) {
  const router = Router();
  const svc = visualContentService(db, storageService, companyId);

  router.get("/backends", requireContentKey, (_req, res) => {
    res.json({ backends: getBackendSummary() });
  });

  router.post("/generate", requireContentKey, async (req, res) => {
    const {
      agentId,
      contentType,
      platform,
      topic,
      prompt,
      scriptText,
      contextQuery,
      backendName,
    } = req.body;

    if (!agentId || !contentType || !platform || !topic || !prompt) {
      res.status(400).json({
        error:
          "Missing required fields: agentId, contentType, platform, topic, prompt",
      });
      return;
    }

    try {
      const result = await svc.generate({
        agentId,
        contentType,
        platform,
        topic,
        prompt,
        scriptText,
        contextQuery,
        backendName,
      });
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Visual content generation error");
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/jobs/:jobId", requireContentKey, (req, res) => {
    const job = getJob(req.params.jobId as string);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(job);
  });

  router.get("/queue", requireContentKey, async (req, res) => {
    const status = req.query.status as string | undefined;
    const platform = req.query.platform as string | undefined;
    const agentId = req.query.agentId as string | undefined;
    const limit = Math.min(
      Math.max(1, parseInt((req.query.limit as string) ?? "50", 10) || 50),
      200,
    );
    const offset = Math.max(
      0,
      parseInt((req.query.offset as string) ?? "0", 10) || 0,
    );

    try {
      const items = await svc.listQueue({
        status,
        platform,
        agentId,
        limit,
        offset,
      });
      res.json({ items, count: items.length, limit, offset });
    } catch (err) {
      logger.error({ err }, "Visual content queue list error");
      res.status(500).json({ error: "Failed to list visual content queue" });
    }
  });

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
      logger.error({ err, id }, "Visual content review error");
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.get("/queue/stats", requireContentKey, async (_req, res) => {
    try {
      const result = await svc.stats();
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Visual content stats error");
      res.status(500).json({ error: "Stats unavailable" });
    }
  });

  router.get("/assets/*assetPath", requireContentKey, async (req, res) => {
    const objectKey = req.params.assetPath as string;
    if (!objectKey) {
      res.status(400).json({ error: "Missing asset path" });
      return;
    }

    try {
      const obj = await storageService.getObject(companyId, objectKey);
      if (obj.contentType) res.setHeader("Content-Type", obj.contentType);
      if (obj.contentLength)
        res.setHeader("Content-Length", obj.contentLength);
      obj.stream.pipe(res);
    } catch (err) {
      logger.error({ err, objectKey }, "Asset fetch error");
      res.status(404).json({ error: "Asset not found" });
    }
  });

  return { router, stopPolling: svc.stopPolling };
}
