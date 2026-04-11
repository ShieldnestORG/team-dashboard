// ---------------------------------------------------------------------------
// AEO Partner Network API Routes (authenticated)
// ---------------------------------------------------------------------------

import { Router } from "express";
import { eq, and, desc, gte, sql, count, or, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { Db } from "@paperclipai/db";
import { partnerCompanies, partnerClicks } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function partnerRoutes(db: Db): Router {
  const router = Router();

  // ── GET / — List all partners ───────────────────────────────────
  router.get("/", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const industry = req.query.industry as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      const conditions = [eq(partnerCompanies.companyId, COMPANY_ID)];
      if (status) conditions.push(eq(partnerCompanies.status, status));
      if (industry) conditions.push(eq(partnerCompanies.industry, industry));

      const where = and(...conditions);

      const [partners, totalResult] = await Promise.all([
        db
          .select()
          .from(partnerCompanies)
          .where(where)
          .orderBy(desc(partnerCompanies.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ total: count() })
          .from(partnerCompanies)
          .where(where),
      ]);

      res.json({ partners, total: totalResult[0]?.total ?? 0 });
    } catch (err) {
      logger.error({ err }, "Failed to list partners");
      res.status(500).json({ error: "Failed to list partners" });
    }
  });

  // ── GET /:slug — Get single partner ─────────────────────────────
  router.get("/:slug", async (req, res) => {
    try {
      const slug = req.params.slug as string;
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

      if (!partner) {
        res.status(404).json({ error: "Partner not found" });
        return;
      }
      res.json({ partner });
    } catch (err) {
      logger.error({ err }, "Failed to get partner");
      res.status(500).json({ error: "Failed to get partner" });
    }
  });

  // ── POST / — Create partner ─────────────────────────────────────
  router.post("/", async (req, res) => {
    try {
      const body = req.body as {
        name: string;
        slug?: string;
        industry: string;
        location?: string;
        website?: string;
        description?: string;
        services?: string[];
        socialHandles?: Record<string, string>;
        contactName?: string;
        contactEmail?: string;
        tier?: string;
        referralFeePerClient?: number;
        monthlyFee?: number;
      };

      if (!body.name || !body.industry) {
        res.status(400).json({ error: "name and industry are required" });
        return;
      }

      const slug = body.slug || slugify(body.name);
      const dashboardToken = randomUUID();

      const [partner] = await db
        .insert(partnerCompanies)
        .values({
          companyId: COMPANY_ID,
          slug,
          name: body.name,
          industry: body.industry,
          location: body.location,
          website: body.website,
          description: body.description,
          services: body.services,
          socialHandles: body.socialHandles,
          contactName: body.contactName,
          contactEmail: body.contactEmail,
          tier: body.tier,
          referralFeePerClient: body.referralFeePerClient,
          monthlyFee: body.monthlyFee,
          dashboardToken,
        })
        .returning();

      res.status(201).json({ partner });
    } catch (err) {
      logger.error({ err }, "Failed to create partner");
      res.status(500).json({ error: "Failed to create partner" });
    }
  });

  // ── PUT /:slug — Update partner ─────────────────────────────────
  router.put("/:slug", async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const body = req.body as Record<string, unknown>;

      const result = await db
        .update(partnerCompanies)
        .set({ ...body, updatedAt: new Date() })
        .where(
          and(
            eq(partnerCompanies.companyId, COMPANY_ID),
            eq(partnerCompanies.slug, slug),
          ),
        )
        .returning();

      if (result.length === 0) {
        res.status(404).json({ error: "Partner not found" });
        return;
      }
      res.json({ partner: result[0] });
    } catch (err) {
      logger.error({ err }, "Failed to update partner");
      res.status(500).json({ error: "Failed to update partner" });
    }
  });

  // ── DELETE /:slug — Delete partner ──────────────────────────────
  router.delete("/:slug", async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const result = await db
        .delete(partnerCompanies)
        .where(
          and(
            eq(partnerCompanies.companyId, COMPANY_ID),
            eq(partnerCompanies.slug, slug),
          ),
        )
        .returning();

      if (result.length === 0) {
        res.status(404).json({ error: "Partner not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to delete partner");
      res.status(500).json({ error: "Failed to delete partner" });
    }
  });

  // ── GET /:slug/clicks — Paginated click log ─────────────────────
  router.get("/:slug/clicks", async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      // Verify partner exists
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

      if (!partner) {
        res.status(404).json({ error: "Partner not found" });
        return;
      }

      const [clicks, totalResult] = await Promise.all([
        db
          .select()
          .from(partnerClicks)
          .where(eq(partnerClicks.partnerSlug, slug))
          .orderBy(desc(partnerClicks.clickedAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ total: count() })
          .from(partnerClicks)
          .where(eq(partnerClicks.partnerSlug, slug)),
      ]);

      res.json({ clicks, total: totalResult[0]?.total ?? 0 });
    } catch (err) {
      logger.error({ err }, "Failed to get partner clicks");
      res.status(500).json({ error: "Failed to get partner clicks" });
    }
  });

  // ── GET /:slug/metrics — Partner click metrics ──────────────────
  router.get("/:slug/metrics", async (req, res) => {
    try {
      const slug = req.params.slug as string;

      // Verify partner exists
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

      if (!partner) {
        res.status(404).json({ error: "Partner not found" });
        return;
      }

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [totalResult, clicksByDay, clicksBySource] = await Promise.all([
        db
          .select({ total: count() })
          .from(partnerClicks)
          .where(eq(partnerClicks.partnerSlug, slug)),
        db
          .select({
            date: sql<string>`date_trunc('day', ${partnerClicks.clickedAt})::date::text`,
            count: count(),
          })
          .from(partnerClicks)
          .where(
            and(
              eq(partnerClicks.partnerSlug, slug),
              gte(partnerClicks.clickedAt, thirtyDaysAgo),
            ),
          )
          .groupBy(sql`date_trunc('day', ${partnerClicks.clickedAt})`)
          .orderBy(sql`date_trunc('day', ${partnerClicks.clickedAt})`),
        db
          .select({
            source: partnerClicks.sourceType,
            count: count(),
          })
          .from(partnerClicks)
          .where(eq(partnerClicks.partnerSlug, slug))
          .groupBy(partnerClicks.sourceType),
      ]);

      res.json({
        totalClicks: totalResult[0]?.total ?? 0,
        clicksByDay,
        clicksBySource,
        contentMentions: partner.contentMentions,
      });
    } catch (err) {
      logger.error({ err }, "Failed to get partner metrics");
      res.status(500).json({ error: "Failed to get partner metrics" });
    }
  });

  // ── GET /:slug/dashboard — Public dashboard (token-authed) ──────
  router.get("/:slug/dashboard", async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const token = req.query.token as string;

      if (!token) {
        res.status(403).json({ error: "Token required" });
        return;
      }

      const [partner] = await db
        .select()
        .from(partnerCompanies)
        .where(
          and(
            eq(partnerCompanies.slug, slug),
            eq(partnerCompanies.dashboardToken, token),
          ),
        )
        .limit(1);

      if (!partner) {
        res.status(403).json({ error: "Invalid token" });
        return;
      }

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [totalResult, clicksByDay, clicksBySource] = await Promise.all([
        db
          .select({ total: count() })
          .from(partnerClicks)
          .where(eq(partnerClicks.partnerSlug, slug)),
        db
          .select({
            date: sql<string>`date_trunc('day', ${partnerClicks.clickedAt})::date::text`,
            count: count(),
          })
          .from(partnerClicks)
          .where(
            and(
              eq(partnerClicks.partnerSlug, slug),
              gte(partnerClicks.clickedAt, thirtyDaysAgo),
            ),
          )
          .groupBy(sql`date_trunc('day', ${partnerClicks.clickedAt})`)
          .orderBy(sql`date_trunc('day', ${partnerClicks.clickedAt})`),
        db
          .select({
            source: partnerClicks.sourceType,
            count: count(),
          })
          .from(partnerClicks)
          .where(eq(partnerClicks.partnerSlug, slug))
          .groupBy(partnerClicks.sourceType),
      ]);

      res.json({
        name: partner.name,
        industry: partner.industry,
        website: partner.website,
        totalClicks: totalResult[0]?.total ?? 0,
        clicksByDay,
        clicksBySource,
        contentMentions: partner.contentMentions,
      });
    } catch (err) {
      logger.error({ err }, "Failed to get partner dashboard");
      res.status(500).json({ error: "Failed to get partner dashboard" });
    }
  });

  // ── GET /directory — Public partner directory (no auth needed) ──
  // Note: this is mounted under authenticated routes, but we include it
  // for agents calling via API key. For the public-facing version,
  // use partnerDirectoryRoutes below.
  router.get("/directory", async (_req, res) => {
    try {
      const partners = await db
        .select({
          slug: partnerCompanies.slug,
          name: partnerCompanies.name,
          industry: partnerCompanies.industry,
          location: partnerCompanies.location,
          description: partnerCompanies.description,
          website: partnerCompanies.website,
          siteUrl: partnerCompanies.siteUrl,
          siteDeployStatus: partnerCompanies.siteDeployStatus,
          logoUrl: partnerCompanies.logoUrl,
          services: partnerCompanies.services,
        })
        .from(partnerCompanies)
        .where(
          and(
            eq(partnerCompanies.companyId, COMPANY_ID),
            or(
              eq(partnerCompanies.status, "active"),
              eq(partnerCompanies.status, "trial"),
            ),
          ),
        )
        .orderBy(partnerCompanies.name);

      res.json({ partners });
    } catch (err) {
      logger.error({ err }, "Failed to get partner directory");
      res.status(500).json({ error: "Failed to get partner directory" });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Public partner directory (unauthenticated)
// ---------------------------------------------------------------------------

export function partnerDirectoryRoutes(db: Db): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const partners = await db
        .select({
          slug: partnerCompanies.slug,
          name: partnerCompanies.name,
          industry: partnerCompanies.industry,
          location: partnerCompanies.location,
          description: partnerCompanies.description,
          website: partnerCompanies.website,
          siteUrl: partnerCompanies.siteUrl,
          logoUrl: partnerCompanies.logoUrl,
          services: partnerCompanies.services,
        })
        .from(partnerCompanies)
        .where(
          and(
            eq(partnerCompanies.companyId, COMPANY_ID),
            or(
              eq(partnerCompanies.status, "active"),
              eq(partnerCompanies.status, "trial"),
            ),
          ),
        )
        .orderBy(partnerCompanies.name);

      res.json({ partners });
    } catch (err) {
      logger.error({ err }, "Failed to get public partner directory");
      res.status(500).json({ error: "Failed to get partner directory" });
    }
  });

  return router;
}
