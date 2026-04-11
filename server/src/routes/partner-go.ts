// ---------------------------------------------------------------------------
// AEO Partner Network — Public Redirect Routes (no auth)
// ---------------------------------------------------------------------------

import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { createHash } from "crypto";
import type { Db } from "@paperclipai/db";
import { partnerCompanies, partnerClicks } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

export function partnerGoRoutes(db: Db): Router {
  const router = Router();

  // ── GET /:slug — Redirect to partner website + log click ────────
  router.get("/:slug", async (req, res) => {
    try {
      const slug = req.params.slug as string;

      const [partner] = await db
        .select()
        .from(partnerCompanies)
        .where(eq(partnerCompanies.slug, slug))
        .limit(1);

      if (!partner || !partner.website) {
        res.status(404).json({ error: "Partner not found" });
        return;
      }

      // Hash the IP for privacy
      const ip = req.ip || "unknown";
      const ipHash = createHash("sha256")
        .update(ip)
        .digest("hex")
        .slice(0, 16);

      // Log the click
      await db.insert(partnerClicks).values({
        partnerSlug: slug,
        companyId: partner.companyId,
        sourceType: (req.query.src as string) || "direct",
        sourceContentId: (req.query.cid as string) || null,
        referrer:
          (req.headers.referer as string) ||
          (req.headers.referrer as string) ||
          null,
        userAgent: (req.headers["user-agent"] as string) || null,
        ipHash,
      });

      // Increment totalClicks on partner record
      await db
        .update(partnerCompanies)
        .set({
          totalClicks: sql`${partnerCompanies.totalClicks} + 1`,
        })
        .where(eq(partnerCompanies.id, partner.id));

      res.redirect(302, partner.website);
    } catch (err) {
      logger.error({ err }, "Failed to process partner redirect");
      res.status(500).json({ error: "Failed to process redirect" });
    }
  });

  return router;
}
