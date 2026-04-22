import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import type { StorageService } from "../storage/types.js";
import { houseAdsService } from "../services/house-ads.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// House Ads routes — mounted at /api/house-ads.
//
// Public endpoints (CORS inherits global wildcard for *.coherencedaddy.com):
//   GET  /api/house-ads/active?slot=header    → { id, image_url, image_alt, click_url }
//   GET  /api/house-ads/:id/image             → streams image bytes
//   POST /api/house-ads/:id/click             → 302 to click_url, records click
//
// Admin endpoints (board auth required):
//   GET    /api/house-ads
//   POST   /api/house-ads
//   PATCH  /api/house-ads/:id
//   DELETE /api/house-ads/:id
// ---------------------------------------------------------------------------

function requireBoard(req: Request, res: Response): boolean {
  if (req.actor?.type !== "board") {
    res.status(401).json({ error: "Board authentication required" });
    return false;
  }
  return true;
}

function parseDate(input: unknown): Date | null | undefined {
  if (input === undefined) return undefined;
  if (input === null || input === "") return null;
  if (typeof input !== "string") return undefined;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function houseAdsRoutes(db: Db, storage: StorageService): Router {
  const router = Router();
  const svc = houseAdsService(db);

  // -- Public -----------------------------------------------------------------

  router.get("/active", async (req: Request, res: Response) => {
    const slot = typeof req.query.slot === "string" ? req.query.slot : "";
    if (!slot) {
      res.status(400).json({ error: "slot required" });
      return;
    }
    try {
      const ad = await svc.pickForSlot(slot);
      if (!ad) {
        res.status(204).end();
        return;
      }
      // Fire-and-forget impression increment.
      svc
        .recordImpression(ad.id)
        .catch((err) => logger.warn({ err, id: ad.id }, "house-ads: impression failed"));
      res.json({
        id: ad.id,
        image_url: `/api/house-ads/${ad.id}/image`,
        image_alt: ad.imageAlt,
        click_url: `/api/house-ads/${ad.id}/click`,
      });
    } catch (err) {
      logger.error({ err, slot }, "house-ads: pickForSlot failed");
      res.status(500).json({ error: "Failed to fetch ad" });
    }
  });

  router.get("/:id/image", async (req: Request, res: Response, next) => {
    const id = req.params.id as string;
    try {
      const ad = await svc.getById(id);
      if (!ad) {
        res.status(404).json({ error: "Ad not found" });
        return;
      }
      const asset = await svc.getAsset(ad.imageAssetId);
      if (!asset) {
        res.status(404).json({ error: "Asset not found" });
        return;
      }
      const object = await storage.getObject(asset.companyId, asset.objectKey);
      const contentType =
        asset.contentType || object.contentType || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Length",
        String(asset.byteSize || object.contentLength || 0),
      );
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("X-Content-Type-Options", "nosniff");
      object.stream.on("error", (err) => next(err));
      object.stream.pipe(res);
    } catch (err) {
      logger.error({ err, id }, "house-ads: stream image failed");
      if (!res.headersSent) res.status(500).json({ error: "Failed to fetch image" });
    }
  });

  router.get("/:id/click", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
      const ad = await svc.getById(id);
      if (!ad) {
        res.status(404).json({ error: "Ad not found" });
        return;
      }
      svc
        .recordClick(id)
        .catch((err) => logger.warn({ err, id }, "house-ads: click increment failed"));
      res.redirect(302, ad.clickUrl);
    } catch (err) {
      logger.error({ err, id }, "house-ads: click handler failed");
      res.status(500).json({ error: "Failed to record click" });
    }
  });

  // -- Admin ------------------------------------------------------------------

  router.get("/", async (req: Request, res: Response) => {
    if (!requireBoard(req, res)) return;
    const companyId = req.actor?.companyId;
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    try {
      const ads = await svc.listAll(companyId);
      res.json({ ads });
    } catch (err) {
      logger.error({ err }, "house-ads: listAll failed");
      res.status(500).json({ error: "Failed to list ads" });
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    if (!requireBoard(req, res)) return;
    const companyId = req.actor?.companyId;
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const body = req.body ?? {};
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const imageAssetId =
      typeof body.imageAssetId === "string" ? body.imageAssetId : "";
    const clickUrl = typeof body.clickUrl === "string" ? body.clickUrl.trim() : "";
    const slot = typeof body.slot === "string" ? body.slot.trim() : "";
    if (!title || !imageAssetId || !clickUrl || !slot) {
      res.status(400).json({
        error: "title, imageAssetId, clickUrl and slot are required",
      });
      return;
    }
    try {
      const ad = await svc.create(companyId, {
        title,
        imageAssetId,
        imageAlt: typeof body.imageAlt === "string" ? body.imageAlt : "",
        clickUrl,
        slot,
        weight: typeof body.weight === "number" ? body.weight : 1,
        active: typeof body.active === "boolean" ? body.active : true,
        startsAt: parseDate(body.startsAt) ?? null,
        endsAt: parseDate(body.endsAt) ?? null,
      });
      res.status(201).json({ ad });
    } catch (err) {
      logger.error({ err }, "house-ads: create failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.patch("/:id", async (req: Request, res: Response) => {
    if (!requireBoard(req, res)) return;
    const id = req.params.id as string;
    const body = req.body ?? {};
    try {
      const existing = await svc.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Ad not found" });
        return;
      }
      const patch: Partial<Parameters<typeof svc.update>[1]> = {};
      if (typeof body.title === "string") patch.title = body.title.trim();
      if (typeof body.imageAssetId === "string") patch.imageAssetId = body.imageAssetId;
      if (typeof body.imageAlt === "string") patch.imageAlt = body.imageAlt;
      if (typeof body.clickUrl === "string") patch.clickUrl = body.clickUrl.trim();
      if (typeof body.slot === "string") patch.slot = body.slot.trim();
      if (typeof body.weight === "number") patch.weight = body.weight;
      if (typeof body.active === "boolean") patch.active = body.active;
      const startsAt = parseDate(body.startsAt);
      if (startsAt !== undefined) patch.startsAt = startsAt;
      const endsAt = parseDate(body.endsAt);
      if (endsAt !== undefined) patch.endsAt = endsAt;

      const ad = await svc.update(id, patch);
      res.json({ ad });
    } catch (err) {
      logger.error({ err, id }, "house-ads: update failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    if (!requireBoard(req, res)) return;
    const id = req.params.id as string;
    try {
      const removed = await svc.remove(id);
      if (!removed) {
        res.status(404).json({ error: "Ad not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, id }, "house-ads: delete failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
