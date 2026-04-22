import { Router } from "express";
import type { Request, Response } from "express";
import type { Db } from "@paperclipai/db";
import { ownedSitesService, type OwnedSiteStatus } from "../services/owned-sites.js";
import { triggerCronJob } from "../services/cron-registry.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Owned utility-site registry routes — mounted at /api/owned-sites.
// Authenticated: all endpoints require a companyId on req.actor.
// ---------------------------------------------------------------------------

const VALID_STATUSES: OwnedSiteStatus[] = [
  "building",
  "live",
  "adsense_pending",
  "monetized",
  "killed",
];

function parseStatus(value: unknown): OwnedSiteStatus | undefined {
  return typeof value === "string" && (VALID_STATUSES as string[]).includes(value)
    ? (value as OwnedSiteStatus)
    : undefined;
}

export function ownedSitesRoutes(db: Db): Router {
  const router = Router();
  const svc = ownedSitesService(db);

  router.get("/", async (req: Request, res: Response) => {
    const companyId = req.actor?.companyId;
    if (!companyId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const sites = await svc.listSites(companyId);
      res.json({ sites });
    } catch (err) {
      logger.error({ err }, "owned-sites: list failed");
      res.status(500).json({ error: "Failed to list owned sites" });
    }
  });

  router.get("/:slug", async (req: Request, res: Response) => {
    const companyId = req.actor?.companyId;
    if (!companyId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const slug = req.params.slug as string;
    const rangeDays = Number(req.query.range) > 0 ? Number(req.query.range) : 90;
    try {
      const detail = await svc.getSiteDetail(companyId, slug, rangeDays);
      if (!detail) {
        res.status(404).json({ error: "Site not found" });
        return;
      }
      res.json(detail);
    } catch (err) {
      logger.error({ err, slug }, "owned-sites: detail failed");
      res.status(500).json({ error: "Failed to load site" });
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    const companyId = req.actor?.companyId;
    if (!companyId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
    const domain = typeof body?.domain === "string" ? body.domain.trim().toLowerCase() : "";
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
    if (!slug || !domain || !displayName) {
      res.status(400).json({ error: "slug, domain, and displayName required" });
      return;
    }
    try {
      const row = await svc.createSite({
        companyId,
        slug,
        domain,
        displayName,
        primaryTool: typeof body?.primaryTool === "string" ? body.primaryTool : undefined,
        niche: typeof body?.niche === "string" ? body.niche : undefined,
        status: parseStatus(body?.status),
        adsenseAccountId:
          typeof body?.adsenseAccountId === "string" ? body.adsenseAccountId : undefined,
        gaPropertyId:
          typeof body?.gaPropertyId === "string" ? body.gaPropertyId : undefined,
        gscSiteUrl: typeof body?.gscSiteUrl === "string" ? body.gscSiteUrl : undefined,
        notes: typeof body?.notes === "string" ? body.notes : undefined,
      });
      res.status(201).json({ site: row });
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ err, slug }, "owned-sites: create failed");
      if (msg.includes("unique") || msg.includes("duplicate")) {
        res.status(409).json({ error: "slug or domain already exists" });
        return;
      }
      res.status(500).json({ error: "Failed to create site" });
    }
  });

  router.patch("/:slug", async (req: Request, res: Response) => {
    const companyId = req.actor?.companyId;
    if (!companyId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const slug = req.params.slug as string;
    const body = req.body as Record<string, unknown> | undefined;
    try {
      const row = await svc.updateSite(companyId, slug, {
        companyId,
        slug,
        domain: typeof body?.domain === "string" ? body.domain : undefined,
        displayName:
          typeof body?.displayName === "string" ? body.displayName : undefined,
        primaryTool:
          typeof body?.primaryTool === "string" ? body.primaryTool : undefined,
        niche: typeof body?.niche === "string" ? body.niche : undefined,
        status: parseStatus(body?.status),
        adsenseAccountId:
          typeof body?.adsenseAccountId === "string" ? body.adsenseAccountId : undefined,
        gaPropertyId:
          typeof body?.gaPropertyId === "string" ? body.gaPropertyId : undefined,
        gscSiteUrl: typeof body?.gscSiteUrl === "string" ? body.gscSiteUrl : undefined,
        notes: typeof body?.notes === "string" ? body.notes : undefined,
      });
      if (!row) {
        res.status(404).json({ error: "Site not found" });
        return;
      }
      res.json({ site: row });
    } catch (err) {
      logger.error({ err, slug }, "owned-sites: update failed");
      res.status(500).json({ error: "Failed to update site" });
    }
  });

  router.post("/:slug/sync", async (req: Request, res: Response) => {
    const companyId = req.actor?.companyId;
    if (!companyId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const slug = req.params.slug as string;
    try {
      const site = await svc.getSiteBySlug(companyId, slug);
      if (!site) {
        res.status(404).json({ error: "Site not found" });
        return;
      }
      const ga4 = await svc.syncMetricsFromGa4(site.id);
      const adsense = await svc.syncMetricsFromAdSense(site.id);
      res.json({ siteId: site.id, ga4, adsense });
    } catch (err) {
      logger.error({ err, slug }, "owned-sites: manual sync failed");
      res.status(500).json({ error: "Failed to sync site" });
    }
  });

  router.post("/cron/run", async (req: Request, res: Response) => {
    const companyId = req.actor?.companyId;
    if (!companyId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const result = await triggerCronJob("owned-sites:sync-metrics");
      res.json(result);
    } catch (err) {
      logger.error({ err }, "owned-sites: cron trigger failed");
      res.status(500).json({ error: "Failed to trigger cron" });
    }
  });

  return router;
}
