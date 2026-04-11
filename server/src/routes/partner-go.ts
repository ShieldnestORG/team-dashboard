// ---------------------------------------------------------------------------
// AEO Partner Network — Public Redirect Routes (no auth)
// ---------------------------------------------------------------------------

import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { createHash } from "crypto";
import type { Db } from "@paperclipai/db";
import { partnerCompanies, partnerClicks } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Known bot/agent user-agent patterns for visitor type detection
// ---------------------------------------------------------------------------

const AGENT_UA_PATTERNS = [
  /googlebot/i, /bingbot/i, /yandexbot/i, /baiduspider/i,
  /gptbot/i, /claudebot/i, /chatgpt/i, /anthropic/i,
  /perplexity/i, /cohere/i, /ai2bot/i, /ccbot/i,
  /bytespider/i, /applebot/i, /facebookexternalhit/i,
  /twitterbot/i, /slackbot/i, /discordbot/i,
  /semrushbot/i, /ahrefsbot/i, /mj12bot/i,
  /duckduckbot/i, /ia_archiver/i, /petalbot/i,
];

function detectVisitorType(ua: string | undefined): string {
  if (!ua) return "unknown";
  for (const pattern of AGENT_UA_PATTERNS) {
    if (pattern.test(ua)) return "agent";
  }
  return "human";
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

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

      // Parse query params
      const sourceType = (req.query.src as string) || "direct";
      const sourceContentId = (req.query.cid as string) || null;
      const clickOrigin = (req.query.origin as string) || "cd";
      const utmSource = (req.query.utm_source as string) || null;
      const utmMedium = (req.query.utm_medium as string) || null;
      const utmCampaign = (req.query.utm_campaign as string) || null;
      const ua = (req.headers["user-agent"] as string) || null;
      const visitorType = detectVisitorType(ua ?? undefined);

      // Log the click
      await db.insert(partnerClicks).values({
        partnerSlug: slug,
        companyId: partner.companyId,
        sourceType,
        sourceContentId,
        referrer:
          (req.headers.referer as string) ||
          (req.headers.referrer as string) ||
          null,
        userAgent: ua,
        ipHash,
        clickOrigin,
        visitorType,
        utmSource,
        utmMedium,
        utmCampaign,
      });

      // Increment totalClicks on partner record
      await db
        .update(partnerCompanies)
        .set({
          totalClicks: sql`${partnerCompanies.totalClicks} + 1`,
        })
        .where(eq(partnerCompanies.id, partner.id));

      // Build redirect URL with UTM params if not already present
      let redirectUrl = partner.website;
      if (utmSource || utmMedium || utmCampaign) {
        const url = new URL(redirectUrl);
        if (utmSource && !url.searchParams.has("utm_source"))
          url.searchParams.set("utm_source", utmSource);
        if (utmMedium && !url.searchParams.has("utm_medium"))
          url.searchParams.set("utm_medium", utmMedium);
        if (utmCampaign && !url.searchParams.has("utm_campaign"))
          url.searchParams.set("utm_campaign", utmCampaign);
        redirectUrl = url.toString();
      }

      res.redirect(302, redirectUrl);
    } catch (err) {
      logger.error({ err }, "Failed to process partner redirect");
      res.status(500).json({ error: "Failed to process redirect" });
    }
  });

  return router;
}
