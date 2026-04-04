import { Router } from "express";
import type { Db } from "@paperclipai/db";
import type { StorageService } from "../storage/types.js";
import { logger } from "../middleware/logger.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Types matching visual-content.ts
interface VisualAsset {
  id: string;
  type: "image" | "video" | "animation";
  objectKey: string;
  contentType: string;
  width: number;
  height: number;
  durationMs?: number;
  thumbnailKey?: string;
  byteSize: number;
}

interface VisualContentItem {
  id: string;
  agentId: string;
  contentType: string;
  platform: string;
  status: string;
  prompt: string;
  scriptText?: string;
  backend: string;
  assets: VisualAsset[];
  metadata: {
    topic: string;
    contextQuery?: string;
    model: string;
    width: number;
    height: number;
    durationSec?: number;
  };
  reviewStatus: string;
  reviewComment?: string;
  jobId?: string;
  createdAt: string;
}

const QUEUE_PATH = join(process.cwd(), "data", "visual-content-queue.json");

function readQueue(): VisualContentItem[] {
  if (!existsSync(QUEUE_PATH)) return [];
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, "utf-8")) as VisualContentItem[];
  } catch {
    return [];
  }
}

/** Public reel shape — sanitized for external consumption */
interface PublicReel {
  id: string;
  title: string;
  topic: string;
  platform: string;
  contentType: string;
  thumbnailUrl: string;
  videoUrl: string;
  downloadUrl: string;
  duration: number | null;
  resolution: string;
  hashtags: string[];
  createdAt: string;
  source: string;
}

function toPublicReel(item: VisualContentItem): PublicReel | null {
  const asset = item.assets[0];
  if (!asset) return null;

  const topic = item.metadata?.topic || "trending";
  const hashtags = topic.split(/[\s,]+/).filter(Boolean).slice(0, 5);

  return {
    id: item.id,
    title: item.scriptText?.split("\n")[0]?.slice(0, 100) || `${topic} — Trend Reel`,
    topic,
    platform: item.platform,
    contentType: item.contentType,
    thumbnailUrl: `/api/reels/${item.id}/thumbnail`,
    videoUrl: `/api/reels/${item.id}/stream`,
    downloadUrl: `/api/reels/${item.id}/download`,
    duration: asset.durationMs ? asset.durationMs / 1000 : null,
    resolution: `${asset.width}x${asset.height}`,
    hashtags,
    createdAt: item.createdAt,
    source: "Coherence Daddy AI — Intel Pipeline",
  };
}

export function publicReelsRoutes(
  _db: Db,
  storageService: StorageService,
  companyId: string,
) {
  const router = Router();

  // GET /api/reels — List published reels (public, no auth)
  router.get("/", (req, res) => {
    try {
      const items = readQueue().filter(
        (i) => i.status === "published" && i.reviewStatus === "approved" && i.assets.length > 0,
      );

      // Filters
      const platform = req.query.platform as string | undefined;
      const topic = req.query.topic as string | undefined;
      const limit = Math.min(parseInt((req.query.limit as string) ?? "20", 10) || 20, 100);
      const offset = Math.max(parseInt((req.query.offset as string) ?? "0", 10) || 0, 0);

      let filtered = items;
      if (platform) filtered = filtered.filter((i) => i.platform === platform);
      if (topic) filtered = filtered.filter((i) => i.metadata?.topic?.toLowerCase().includes(topic.toLowerCase()));

      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const reels = filtered
        .slice(offset, offset + limit)
        .map(toPublicReel)
        .filter((r): r is PublicReel => r !== null);

      res.json({
        reels,
        total: filtered.length,
        limit,
        offset,
        platforms: ["youtube_shorts", "tiktok", "instagram_reels", "twitter_video"],
      });
    } catch (err) {
      logger.error({ err }, "Public reels list error");
      res.status(500).json({ error: "Failed to list reels" });
    }
  });

  // GET /api/reels/:id — Single reel metadata
  router.get("/:id", (req, res) => {
    const id = req.params.id as string;
    const item = readQueue().find(
      (i) => i.id === id && i.status === "published" && i.reviewStatus === "approved",
    );
    if (!item) {
      res.status(404).json({ error: "Reel not found" });
      return;
    }
    const reel = toPublicReel(item);
    if (!reel) {
      res.status(404).json({ error: "Reel has no assets" });
      return;
    }
    res.json(reel);
  });

  // GET /api/reels/:id/stream — Stream the video/image (for inline playback)
  router.get("/:id/stream", async (req, res) => {
    const id = req.params.id as string;
    const item = readQueue().find(
      (i) => i.id === id && i.status === "published" && i.reviewStatus === "approved",
    );
    if (!item || !item.assets[0]) {
      res.status(404).json({ error: "Reel not found" });
      return;
    }

    try {
      const asset = item.assets[0];
      const obj = await storageService.getObject(companyId, asset.objectKey);
      if (obj.contentType) res.setHeader("Content-Type", obj.contentType);
      if (obj.contentLength) res.setHeader("Content-Length", obj.contentLength);
      res.setHeader("Cache-Control", "public, max-age=3600");
      obj.stream.pipe(res);
    } catch (err) {
      logger.error({ err, id }, "Reel stream error");
      res.status(404).json({ error: "Asset not found" });
    }
  });

  // GET /api/reels/:id/download — Download with Content-Disposition header
  router.get("/:id/download", async (req, res) => {
    const id = req.params.id as string;
    const item = readQueue().find(
      (i) => i.id === id && i.status === "published" && i.reviewStatus === "approved",
    );
    if (!item || !item.assets[0]) {
      res.status(404).json({ error: "Reel not found" });
      return;
    }

    try {
      const asset = item.assets[0];
      const topic = item.metadata?.topic?.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40) || "trend";
      const ext = asset.contentType.includes("video") ? "mp4" : "png";
      const filename = `coherencedaddy-${topic}-${id.slice(0, 8)}.${ext}`;

      const obj = await storageService.getObject(companyId, asset.objectKey);
      if (obj.contentType) res.setHeader("Content-Type", obj.contentType);
      if (obj.contentLength) res.setHeader("Content-Length", obj.contentLength);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "public, max-age=3600");
      obj.stream.pipe(res);
    } catch (err) {
      logger.error({ err, id }, "Reel download error");
      res.status(404).json({ error: "Asset not found" });
    }
  });

  // GET /api/reels/:id/thumbnail — Serve thumbnail (or fallback to first frame)
  router.get("/:id/thumbnail", async (req, res) => {
    const id = req.params.id as string;
    const item = readQueue().find(
      (i) => i.id === id && i.status === "published" && i.reviewStatus === "approved",
    );
    if (!item || !item.assets[0]) {
      res.status(404).json({ error: "Reel not found" });
      return;
    }

    try {
      const asset = item.assets[0];
      // Use thumbnail if available, otherwise serve the asset itself (works for images)
      const objectKey = asset.thumbnailKey || asset.objectKey;
      const obj = await storageService.getObject(companyId, objectKey);
      const ct = asset.thumbnailKey ? "image/jpeg" : (obj.contentType || asset.contentType);
      res.setHeader("Content-Type", ct);
      if (obj.contentLength) res.setHeader("Content-Length", obj.contentLength);
      res.setHeader("Cache-Control", "public, max-age=86400");
      obj.stream.pipe(res);
    } catch (err) {
      logger.error({ err, id }, "Reel thumbnail error");
      res.status(404).json({ error: "Thumbnail not found" });
    }
  });

  return router;
}
