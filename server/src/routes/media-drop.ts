import { Router } from "express";
import multer from "multer";
import type { Db } from "@paperclipai/db";
import { mediaDrops } from "@paperclipai/db";
import { eq, desc, and } from "drizzle-orm";
import type { StorageService } from "../storage/types.js";
import { logger } from "../middleware/logger.js";

interface MediaDropFile {
  objectKey: string;
  contentType: string;
  originalFilename: string;
  byteSize: number;
}

const MAX_FILES = 4;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function requireContentKey(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  const key = req.headers["content-api-key"] || req.headers["x-content-api-key"];
  const expected = process.env.CONTENT_API_KEY;
  if (!expected || key !== expected) {
    res.status(401).json({ error: "Invalid or missing Content-API-Key" });
    return;
  }
  next();
}

export function mediaDropRoutes(db: Db, storageService: StorageService) {
  const router = Router();
  const companyId = process.env.TEAM_DASHBOARD_COMPANY_ID || "default";

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  });

  // POST /api/media/drop — Upload files with context
  router.post("/drop", requireContentKey, async (req, res) => {
    await new Promise<void>((resolve, reject) => {
      upload.array("files", MAX_FILES)(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    }).catch((err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(422).json({ error: `File exceeds ${MAX_FILE_SIZE} bytes` });
          return;
        }
        if (err.code === "LIMIT_FILE_COUNT") {
          res.status(422).json({ error: `Maximum ${MAX_FILES} files allowed` });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    });

    if (res.headersSent) return;

    const files = (req as unknown as { files?: Express.Multer.File[] }).files;
    if (!files || files.length === 0) {
      res.status(400).json({ error: "At least one file is required (field: 'files')" });
      return;
    }

    try {
      const storedFiles: MediaDropFile[] = [];

      for (const file of files) {
        const result = await storageService.putFile({
          companyId,
          namespace: "media-drops",
          originalFilename: file.originalname,
          contentType: file.mimetype,
          body: file.buffer,
        });
        storedFiles.push({
          objectKey: result.objectKey,
          contentType: result.contentType,
          originalFilename: file.originalname,
          byteSize: result.byteSize,
        });
      }

      // Parse hashtags from comma-separated string or JSON array
      let hashtags: string[] | null = null;
      if (req.body.hashtags) {
        if (typeof req.body.hashtags === "string") {
          try {
            hashtags = JSON.parse(req.body.hashtags);
          } catch {
            hashtags = req.body.hashtags.split(",").map((h: string) => h.trim()).filter(Boolean);
          }
        } else if (Array.isArray(req.body.hashtags)) {
          hashtags = req.body.hashtags;
        }
      }

      const [row] = await db
        .insert(mediaDrops)
        .values({
          companyId,
          caption: req.body.caption || null,
          hashtags,
          platform: req.body.platform || "twitter",
          status: "available",
          files: storedFiles,
        })
        .returning();

      logger.info({ dropId: row.id, fileCount: storedFiles.length }, "Media drop created");

      res.status(201).json({
        id: row.id,
        caption: row.caption,
        hashtags: row.hashtags,
        platform: row.platform,
        status: row.status,
        files: storedFiles.map((f, i) => ({
          index: i,
          filename: f.originalFilename,
          contentType: f.contentType,
          byteSize: f.byteSize,
          url: `/api/media/drops/${row.id}/file/${i}`,
        })),
        createdAt: row.createdAt,
      });
    } catch (err) {
      logger.error({ err }, "Media drop upload failed");
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // GET /api/media/drops — List drops
  router.get("/drops", requireContentKey, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const platform = req.query.platform as string | undefined;
      const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10) || 50, 200);

      const conditions = [eq(mediaDrops.companyId, companyId)];
      if (status) conditions.push(eq(mediaDrops.status, status));
      if (platform) conditions.push(eq(mediaDrops.platform, platform));

      const rows = await db
        .select()
        .from(mediaDrops)
        .where(and(...conditions))
        .orderBy(desc(mediaDrops.createdAt))
        .limit(limit);

      res.json({
        drops: rows.map((row) => ({
          id: row.id,
          caption: row.caption,
          hashtags: row.hashtags,
          platform: row.platform,
          status: row.status,
          postedTweetId: row.postedTweetId,
          files: (row.files as MediaDropFile[]).map((f, i) => ({
            index: i,
            filename: f.originalFilename,
            contentType: f.contentType,
            byteSize: f.byteSize,
            url: `/api/media/drops/${row.id}/file/${i}`,
          })),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
        total: rows.length,
      });
    } catch (err) {
      logger.error({ err }, "Media drops list failed");
      res.status(500).json({ error: "List failed" });
    }
  });

  // GET /api/media/drops/:id — Single drop
  router.get("/drops/:id", requireContentKey, async (req, res) => {
    try {
      const [row] = await db
        .select()
        .from(mediaDrops)
        .where(and(eq(mediaDrops.id, req.params.id as string), eq(mediaDrops.companyId, companyId)));

      if (!row) {
        res.status(404).json({ error: "Drop not found" });
        return;
      }

      res.json({
        id: row.id,
        caption: row.caption,
        hashtags: row.hashtags,
        platform: row.platform,
        status: row.status,
        postedTweetId: row.postedTweetId,
        files: (row.files as MediaDropFile[]).map((f, i) => ({
          index: i,
          filename: f.originalFilename,
          contentType: f.contentType,
          byteSize: f.byteSize,
          url: `/api/media/drops/${row.id}/file/${i}`,
        })),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    } catch (err) {
      logger.error({ err }, "Media drop fetch failed");
      res.status(500).json({ error: "Fetch failed" });
    }
  });

  // PATCH /api/media/drops/:id — Update caption, hashtags, status, postedTweetId
  router.patch("/drops/:id", requireContentKey, async (req, res) => {
    try {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (req.body.caption !== undefined) updates.caption = req.body.caption;
      if (req.body.hashtags !== undefined) updates.hashtags = req.body.hashtags;
      if (req.body.platform !== undefined) updates.platform = req.body.platform;
      if (req.body.status !== undefined) updates.status = req.body.status;
      if (req.body.postedTweetId !== undefined) updates.postedTweetId = req.body.postedTweetId;

      const [row] = await db
        .update(mediaDrops)
        .set(updates)
        .where(and(eq(mediaDrops.id, req.params.id as string), eq(mediaDrops.companyId, companyId)))
        .returning();

      if (!row) {
        res.status(404).json({ error: "Drop not found" });
        return;
      }

      res.json({ id: row.id, status: row.status, updatedAt: row.updatedAt });
    } catch (err) {
      logger.error({ err }, "Media drop update failed");
      res.status(500).json({ error: "Update failed" });
    }
  });

  // DELETE /api/media/drops/:id
  router.delete("/drops/:id", requireContentKey, async (req, res) => {
    try {
      const [row] = await db
        .select()
        .from(mediaDrops)
        .where(and(eq(mediaDrops.id, req.params.id as string), eq(mediaDrops.companyId, companyId)));

      if (!row) {
        res.status(404).json({ error: "Drop not found" });
        return;
      }

      // Delete stored files
      for (const file of row.files as MediaDropFile[]) {
        try {
          await storageService.deleteObject(companyId, file.objectKey);
        } catch {
          // Best effort — file may already be gone
        }
      }

      await db.delete(mediaDrops).where(eq(mediaDrops.id, row.id));
      res.json({ deleted: true });
    } catch (err) {
      logger.error({ err }, "Media drop delete failed");
      res.status(500).json({ error: "Delete failed" });
    }
  });

  // GET /api/media/drops/:id/file/:index — Serve file (no auth — x-bot extension needs this)
  router.get("/drops/:id/file/:index", async (req, res) => {
    try {
      const [row] = await db
        .select()
        .from(mediaDrops)
        .where(and(eq(mediaDrops.id, req.params.id as string), eq(mediaDrops.companyId, companyId)));

      if (!row) {
        res.status(404).json({ error: "Drop not found" });
        return;
      }

      const files = row.files as MediaDropFile[];
      const idx = parseInt(req.params.index as string, 10);
      if (isNaN(idx) || idx < 0 || idx >= files.length) {
        res.status(404).json({ error: "File index out of range" });
        return;
      }

      const file = files[idx];
      const obj = await storageService.getObject(companyId, file.objectKey);
      if (obj.contentType) res.setHeader("Content-Type", obj.contentType);
      if (obj.contentLength) res.setHeader("Content-Length", obj.contentLength);
      res.setHeader("Cache-Control", "public, max-age=3600");
      obj.stream.pipe(res);
    } catch (err) {
      logger.error({ err }, "Media drop file serve failed");
      res.status(404).json({ error: "File not found" });
    }
  });

  return router;
}
