// ---------------------------------------------------------------------------
// Campaigns API Routes (authenticated)
// ---------------------------------------------------------------------------

import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { Db } from "@paperclipai/db";
import { campaigns, contentItems } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

export function campaignRoutes(db: Db): Router {
  const router = Router();

  // ── GET / — List campaigns ──────────────────────────────────────
  router.get("/", async (req, res) => {
    try {
      const brand = req.query.brand as string | undefined;
      const status = req.query.status as string | undefined;
      const companyId = (req.query.companyId as string | undefined) || COMPANY_ID;

      const conditions = [eq(campaigns.companyId, companyId)];
      if (brand) conditions.push(eq(campaigns.brand, brand));
      if (status) conditions.push(eq(campaigns.status, status));

      const rows = await db
        .select()
        .from(campaigns)
        .where(and(...conditions))
        .orderBy(desc(campaigns.createdAt));

      // Attach content count per campaign
      const ids = rows.map((r) => r.id);
      let countMap: Record<string, number> = {};
      if (ids.length > 0) {
        const counts = await db
          .select({
            campaignId: contentItems.campaignId,
            cnt: sql<number>`count(*)::int`,
          })
          .from(contentItems)
          .where(
            and(
              eq(contentItems.companyId, companyId),
              sql`${contentItems.campaignId} = ANY(ARRAY[${sql.join(
                ids.map((id) => sql`${id}`),
                sql`, `,
              )}]::text[])`,
            ),
          )
          .groupBy(contentItems.campaignId);

        for (const row of counts) {
          if (row.campaignId) countMap[row.campaignId] = row.cnt;
        }
      }

      const result = rows.map((c) => ({
        ...c,
        contentCount: countMap[c.id] ?? 0,
      }));

      res.json({ campaigns: result });
    } catch (err) {
      logger.error({ err }, "Failed to list campaigns");
      res.status(500).json({ error: "Failed to list campaigns" });
    }
  });

  // ── POST / — Create campaign ────────────────────────────────────
  router.post("/", async (req, res) => {
    try {
      const body = req.body as {
        name: string;
        brand?: string;
        goal?: string;
        status?: string;
        startDate?: string;
        endDate?: string;
        targetSites?: string[];
        personalityAllowlist?: string[];
        companyId?: string;
      };

      if (!body.name) {
        res.status(400).json({ error: "name is required" });
        return;
      }

      const companyId = body.companyId || COMPANY_ID;

      const [campaign] = await db
        .insert(campaigns)
        .values({
          id: randomUUID(),
          companyId,
          name: body.name,
          brand: body.brand || "cd",
          goal: body.goal,
          status: body.status || "draft",
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          endDate: body.endDate ? new Date(body.endDate) : undefined,
          targetSites: body.targetSites ?? [],
          personalityAllowlist: body.personalityAllowlist ?? [],
        })
        .returning();

      res.status(201).json({ campaign });
    } catch (err) {
      logger.error({ err }, "Failed to create campaign");
      res.status(500).json({ error: "Failed to create campaign" });
    }
  });

  // ── GET /:id — Get single campaign ─────────────────────────────
  router.get("/:id", async (req, res) => {
    try {
      const id = req.params.id as string;

      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .limit(1);

      if (!campaign) {
        res.status(404).json({ error: "Campaign not found" });
        return;
      }

      res.json({ campaign });
    } catch (err) {
      logger.error({ err }, "Failed to get campaign");
      res.status(500).json({ error: "Failed to get campaign" });
    }
  });

  // ── PATCH /:id — Update campaign ───────────────────────────────
  router.patch("/:id", async (req, res) => {
    try {
      const id = req.params.id as string;
      const body = req.body as Partial<{
        name: string;
        brand: string;
        goal: string;
        status: string;
        startDate: string;
        endDate: string;
        targetSites: string[];
        personalityAllowlist: string[];
      }>;

      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (body.name !== undefined) updates.name = body.name;
      if (body.brand !== undefined) updates.brand = body.brand;
      if (body.goal !== undefined) updates.goal = body.goal;
      if (body.status !== undefined) updates.status = body.status;
      if (body.startDate !== undefined) updates.startDate = body.startDate ? new Date(body.startDate) : null;
      if (body.endDate !== undefined) updates.endDate = body.endDate ? new Date(body.endDate) : null;
      if (body.targetSites !== undefined) updates.targetSites = body.targetSites;
      if (body.personalityAllowlist !== undefined) updates.personalityAllowlist = body.personalityAllowlist;

      const [campaign] = await db
        .update(campaigns)
        .set(updates)
        .where(eq(campaigns.id, id))
        .returning();

      if (!campaign) {
        res.status(404).json({ error: "Campaign not found" });
        return;
      }

      res.json({ campaign });
    } catch (err) {
      logger.error({ err }, "Failed to update campaign");
      res.status(500).json({ error: "Failed to update campaign" });
    }
  });

  // ── DELETE /:id — Delete campaign ──────────────────────────────
  router.delete("/:id", async (req, res) => {
    try {
      const id = req.params.id as string;

      const [deleted] = await db
        .delete(campaigns)
        .where(eq(campaigns.id, id))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Campaign not found" });
        return;
      }

      res.status(204).end();
    } catch (err) {
      logger.error({ err }, "Failed to delete campaign");
      res.status(500).json({ error: "Failed to delete campaign" });
    }
  });

  // ── GET /:id/content — Content items for a campaign ─────────────
  router.get("/:id/content", async (req, res) => {
    try {
      const id = req.params.id as string;

      // Verify campaign exists
      const [campaign] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .limit(1);

      if (!campaign) {
        res.status(404).json({ error: "Campaign not found" });
        return;
      }

      const items = await db
        .select({
          id: contentItems.id,
          topic: contentItems.topic,
          platform: contentItems.platform,
          personalityId: contentItems.personalityId,
          contentType: contentItems.contentType,
          status: contentItems.status,
          reviewStatus: contentItems.reviewStatus,
          engagementScore: contentItems.engagementScore,
          clickCount: contentItems.clickCount,
          publishedAt: contentItems.publishedAt,
          createdAt: contentItems.createdAt,
        })
        .from(contentItems)
        .where(eq(contentItems.campaignId, id))
        .orderBy(desc(contentItems.createdAt));

      res.json({ items });
    } catch (err) {
      logger.error({ err }, "Failed to get campaign content");
      res.status(500).json({ error: "Failed to get campaign content" });
    }
  });

  return router;
}
