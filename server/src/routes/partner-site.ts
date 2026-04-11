// ---------------------------------------------------------------------------
// Partner Site Management API (authenticated)
// ---------------------------------------------------------------------------

import { Router, type Request } from "express";
import { eq, and, desc, count } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { partnerCompanies, partnerSiteContent } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 80);
}

function getSlug(req: Request): string {
  return (req.params as Record<string, string>).slug ?? "";
}

export function partnerSiteRoutes(db: Db): Router {
  const router = Router({ mergeParams: true });

  // Helper: resolve partner by slug
  async function resolvePartner(slug: string) {
    const [partner] = await db
      .select()
      .from(partnerCompanies)
      .where(
        and(
          eq(partnerCompanies.companyId, COMPANY_ID),
          eq(partnerCompanies.slug, slug),
        ),
      )
      .limit(1);
    return partner ?? null;
  }

  // ── GET /config — Site config + deploy status ─────────────────
  router.get("/config", async (req, res) => {
    try {
      const partner = await resolvePartner(getSlug(req));
      if (!partner) { res.status(404).json({ error: "Partner not found" }); return; }

      res.json({
        siteUrl: partner.siteUrl,
        siteRepoUrl: partner.siteRepoUrl,
        siteDeployStatus: partner.siteDeployStatus,
        siteLastDeployedAt: partner.siteLastDeployedAt,
        siteConfig: partner.siteConfig,
        siteVercelProjectId: partner.siteVercelProjectId,
      });
    } catch (err) {
      logger.error({ err }, "Failed to get site config");
      res.status(500).json({ error: "Failed to get site config" });
    }
  });

  // ── PUT /config — Update site config ──────────────────────────
  router.put("/config", async (req, res) => {
    try {
      const slug = getSlug(req);
      const partner = await resolvePartner(slug);
      if (!partner) { res.status(404).json({ error: "Partner not found" }); return; }

      const body = req.body as Record<string, unknown>;
      const allowed = [
        "siteUrl", "siteRepoUrl", "siteConfig", "siteVercelProjectId",
        "siteDeployStatus",
      ];
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const key of allowed) {
        if (key in body) {
          // Convert camelCase to snake_case for DB
          const dbKey = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
          updates[dbKey] = body[key];
        }
      }

      const [updated] = await db
        .update(partnerCompanies)
        .set(updates)
        .where(eq(partnerCompanies.id, partner.id))
        .returning();

      res.json({
        siteUrl: updated.siteUrl,
        siteRepoUrl: updated.siteRepoUrl,
        siteDeployStatus: updated.siteDeployStatus,
        siteLastDeployedAt: updated.siteLastDeployedAt,
        siteConfig: updated.siteConfig,
        siteVercelProjectId: updated.siteVercelProjectId,
      });
    } catch (err) {
      logger.error({ err }, "Failed to update site config");
      res.status(500).json({ error: "Failed to update site config" });
    }
  });

  // ── POST /deploy — Trigger deploy ─────────────────────────────
  router.post("/deploy", async (req, res) => {
    try {
      const slug = getSlug(req);
      const partner = await resolvePartner(slug);
      if (!partner) { res.status(404).json({ error: "Partner not found" }); return; }

      const [updated] = await db
        .update(partnerCompanies)
        .set({
          siteDeployStatus: "building",
          updatedAt: new Date(),
        })
        .where(eq(partnerCompanies.id, partner.id))
        .returning();

      res.json({
        status: "building",
        message: `Deploy triggered for ${partner.name}`,
      });
    } catch (err) {
      logger.error({ err }, "Failed to trigger deploy");
      res.status(500).json({ error: "Failed to trigger deploy" });
    }
  });

  // ── GET /content — List partner site content ──────────────────
  router.get("/content", async (req, res) => {
    try {
      const slug = getSlug(req);
      const partner = await resolvePartner(slug);
      if (!partner) { res.status(404).json({ error: "Partner not found" }); return; }

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const status = req.query.status as string | undefined;

      const conditions = [eq(partnerSiteContent.partnerId, partner.id)];
      if (status) conditions.push(eq(partnerSiteContent.status, status));

      const [items, totalResult] = await Promise.all([
        db
          .select()
          .from(partnerSiteContent)
          .where(and(...conditions))
          .orderBy(desc(partnerSiteContent.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ total: count() })
          .from(partnerSiteContent)
          .where(and(...conditions)),
      ]);

      res.json({ content: items, total: totalResult[0]?.total ?? 0 });
    } catch (err) {
      logger.error({ err }, "Failed to list partner content");
      res.status(500).json({ error: "Failed to list partner content" });
    }
  });

  // ── POST /content — Create content item ───────────────────────
  router.post("/content", async (req, res) => {
    try {
      const slug = getSlug(req);
      const partner = await resolvePartner(slug);
      if (!partner) { res.status(404).json({ error: "Partner not found" }); return; }

      const body = req.body as {
        title: string;
        body: string;
        contentType?: string;
        metaDescription?: string;
        keywords?: string[];
        slug?: string;
      };

      if (!body.title || !body.body) {
        res.status(400).json({ error: "title and body are required" });
        return;
      }

      const [item] = await db
        .insert(partnerSiteContent)
        .values({
          partnerId: partner.id,
          companyId: COMPANY_ID,
          slug: body.slug || slugify(body.title),
          title: body.title,
          body: body.body,
          contentType: body.contentType || "blog_post",
          metaDescription: body.metaDescription,
          keywords: body.keywords,
        })
        .returning();

      res.status(201).json({ content: item });
    } catch (err) {
      logger.error({ err }, "Failed to create partner content");
      res.status(500).json({ error: "Failed to create partner content" });
    }
  });

  // ── PUT /content/:contentId — Update content item ─────────────
  router.put("/content/:contentId", async (req, res) => {
    try {
      const contentId = (req.params as Record<string, string>).contentId;
      const body = req.body as Record<string, unknown>;

      const [updated] = await db
        .update(partnerSiteContent)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(partnerSiteContent.id, contentId))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Content not found" });
        return;
      }
      res.json({ content: updated });
    } catch (err) {
      logger.error({ err }, "Failed to update partner content");
      res.status(500).json({ error: "Failed to update partner content" });
    }
  });

  // ── POST /content/:contentId/publish — Queue for publish ──────
  router.post("/content/:contentId/publish", async (req, res) => {
    try {
      const contentId = (req.params as Record<string, string>).contentId;

      const [updated] = await db
        .update(partnerSiteContent)
        .set({ status: "queued", updatedAt: new Date() })
        .where(eq(partnerSiteContent.id, contentId))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Content not found" });
        return;
      }
      res.json({ content: updated });
    } catch (err) {
      logger.error({ err }, "Failed to publish partner content");
      res.status(500).json({ error: "Failed to publish partner content" });
    }
  });

  // ── POST /baseline — Store baseline analytics ─────────────────
  router.post("/baseline", async (req, res) => {
    try {
      const slug = getSlug(req);
      const partner = await resolvePartner(slug);
      if (!partner) { res.status(404).json({ error: "Partner not found" }); return; }

      const body = req.body as {
        monthlyVisitors?: number;
        domainAuthority?: number;
        topKeywords?: string[];
        sourceBreakdown?: Record<string, number>;
      };

      const baseline = {
        capturedAt: new Date().toISOString(),
        monthlyVisitors: body.monthlyVisitors,
        domainAuthority: body.domainAuthority,
        topKeywords: body.topKeywords,
        sourceBreakdown: body.sourceBreakdown,
      };

      const [updated] = await db
        .update(partnerCompanies)
        .set({
          baselineAnalytics: baseline,
          baselineCapturedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(partnerCompanies.id, partner.id))
        .returning();

      res.json({ baseline: updated.baselineAnalytics });
    } catch (err) {
      logger.error({ err }, "Failed to store baseline");
      res.status(500).json({ error: "Failed to store baseline" });
    }
  });

  // ── GET /baseline — Get baseline analytics ────────────────────
  router.get("/baseline", async (req, res) => {
    try {
      const partner = await resolvePartner(getSlug(req));
      if (!partner) { res.status(404).json({ error: "Partner not found" }); return; }

      res.json({
        baseline: partner.baselineAnalytics,
        capturedAt: partner.baselineCapturedAt,
      });
    } catch (err) {
      logger.error({ err }, "Failed to get baseline");
      res.status(500).json({ error: "Failed to get baseline" });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Public partner site content feed (no auth)
// ---------------------------------------------------------------------------

export function partnerSiteFeedRoutes(db: Db): Router {
  const router = Router();

  // ── GET /:slug/feed — Published content for partner microsites ─
  router.get("/:slug/feed", async (req, res) => {
    try {
      const slug = getSlug(req);

      const [partner] = await db
        .select()
        .from(partnerCompanies)
        .where(eq(partnerCompanies.slug, slug))
        .limit(1);

      if (!partner) {
        res.status(404).json({ error: "Partner not found" });
        return;
      }

      const items = await db
        .select({
          slug: partnerSiteContent.slug,
          title: partnerSiteContent.title,
          contentType: partnerSiteContent.contentType,
          body: partnerSiteContent.body,
          metaDescription: partnerSiteContent.metaDescription,
          keywords: partnerSiteContent.keywords,
          publishedAt: partnerSiteContent.publishedAt,
        })
        .from(partnerSiteContent)
        .where(
          and(
            eq(partnerSiteContent.partnerId, partner.id),
            eq(partnerSiteContent.status, "published"),
          ),
        )
        .orderBy(desc(partnerSiteContent.publishedAt))
        .limit(50);

      res.json({
        partner: { name: partner.name, industry: partner.industry, slug: partner.slug },
        content: items,
      });
    } catch (err) {
      logger.error({ err }, "Failed to get partner feed");
      res.status(500).json({ error: "Failed to get partner feed" });
    }
  });

  return router;
}
