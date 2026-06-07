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

// Only http(s) destinations are redirectable — blocks javascript:/data: and
// other scheme-based abuse smuggled in via a stored partner website.
function isSafeRedirectTarget(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

// Partners that may receive outbound /go redirects: admin-onboarded ("trial")
// or paid ("active"). A self-enrolled, unpaid partner ("pending_payment") must
// NOT get a working redirect on the trusted api.coherencedaddy.com domain —
// that would be a free open-redirect/phishing primitive.
const REDIRECTABLE_STATUSES = new Set(["trial", "active"]);

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

      // Refuse to redirect for partners that haven't been verified/paid, and
      // refuse non-http(s) destinations regardless of status.
      if (!REDIRECTABLE_STATUSES.has(partner.status)) {
        res.status(404).json({ error: "Partner not found" });
        return;
      }
      const safeTarget = isSafeRedirectTarget(partner.website);
      if (!safeTarget) {
        logger.warn({ slug, website: partner.website }, "Blocked unsafe partner redirect target");
        res.status(404).json({ error: "Partner not found" });
        return;
      }

      // Hash the IP for privacy
      const ip = req.ip || "unknown";
      const ipHash = createHash("sha256")
        .update(ip)
        .digest("hex")
        .slice(0, 16);

      // Parse query params — Express yields string[] for repeated keys, so
      // coerce to a single string before use (an array would throw downstream).
      const qp = (v: unknown): string | null =>
        Array.isArray(v) ? (typeof v[0] === "string" ? v[0] : null) : typeof v === "string" ? v : null;
      const sourceType = qp(req.query.src) || "direct";
      const sourceContentId = qp(req.query.cid);
      const clickOrigin = qp(req.query.origin) || "cd";
      const utmSource = qp(req.query.utm_source);
      const utmMedium = qp(req.query.utm_medium);
      const utmCampaign = qp(req.query.utm_campaign);
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
      let redirectUrl = safeTarget;
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
