// ---------------------------------------------------------------------------
// AEO Partner Network API Routes (authenticated)
// ---------------------------------------------------------------------------

import { Router } from "express";
import { eq, and, desc, gte, sql, count, or, inArray, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { Db } from "@paperclipai/db";
import { partnerCompanies, partnerClicks, affiliates } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { runPartnerOnboarding, prefillPartnerFromWebsite } from "../services/partner-onboarding.js";
import { createCheckoutSession } from "../services/stripe-checkout.js";
import { stripeConfigured } from "../services/stripe-client.js";
import { sendTransactional } from "../services/email-templates.js";

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

  // ── POST /prefill — Scrape a website and extract partner data (no save) ──
  router.post("/prefill", async (req, res) => {
    try {
      const { website, name } = req.body as { website?: string; name?: string };
      if (!website || typeof website !== "string") {
        res.status(400).json({ error: "website is required" });
        return;
      }
      const result = await prefillPartnerFromWebsite(website.trim(), name?.trim());
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Failed to prefill partner from website");
      res.status(500).json({ error: (err as Error).message });
    }
  });

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
          .select({
            id: partnerCompanies.id,
            companyId: partnerCompanies.companyId,
            slug: partnerCompanies.slug,
            name: partnerCompanies.name,
            industry: partnerCompanies.industry,
            location: partnerCompanies.location,
            website: partnerCompanies.website,
            description: partnerCompanies.description,
            services: partnerCompanies.services,
            socialHandles: partnerCompanies.socialHandles,
            contactName: partnerCompanies.contactName,
            contactEmail: partnerCompanies.contactEmail,
            tier: partnerCompanies.tier,
            status: partnerCompanies.status,
            monthlyFee: partnerCompanies.monthlyFee,
            referralFeePerClient: partnerCompanies.referralFeePerClient,
            contentMentions: partnerCompanies.contentMentions,
            totalClicks: partnerCompanies.totalClicks,
            dashboardToken: partnerCompanies.dashboardToken,
            partnerSince: partnerCompanies.partnerSince,
            createdAt: partnerCompanies.createdAt,
            updatedAt: partnerCompanies.updatedAt,
            address: partnerCompanies.address,
            phone: partnerCompanies.phone,
            hours: partnerCompanies.hours,
            logoUrl: partnerCompanies.logoUrl,
            brandColors: partnerCompanies.brandColors,
            targetKeywords: partnerCompanies.targetKeywords,
            targetAudience: partnerCompanies.targetAudience,
            siteUrl: partnerCompanies.siteUrl,
            siteRepoUrl: partnerCompanies.siteRepoUrl,
            siteDeployStatus: partnerCompanies.siteDeployStatus,
            siteLastDeployedAt: partnerCompanies.siteLastDeployedAt,
            siteConfig: partnerCompanies.siteConfig,
            siteVercelProjectId: partnerCompanies.siteVercelProjectId,
            baselineAnalytics: partnerCompanies.baselineAnalytics,
            baselineCapturedAt: partnerCompanies.baselineCapturedAt,
            contentPostCount: partnerCompanies.contentPostCount,
            lastContentGeneratedAt: partnerCompanies.lastContentGeneratedAt,
            onboardingStatus: partnerCompanies.onboardingStatus,
            onboardingError: partnerCompanies.onboardingError,
            onboardingCompletedAt: partnerCompanies.onboardingCompletedAt,
            featured: partnerCompanies.featured,
            featuredOrder: partnerCompanies.featuredOrder,
            tagline: partnerCompanies.tagline,
            stripeCustomerId: partnerCompanies.stripeCustomerId,
            stripeSubscriptionId: partnerCompanies.stripeSubscriptionId,
            stripePriceId: partnerCompanies.stripePriceId,
            subscriptionStatus: partnerCompanies.subscriptionStatus,
            currentPeriodEnd: partnerCompanies.currentPeriodEnd,
            affiliateId: partnerCompanies.affiliateId,
            affiliateNotes: partnerCompanies.affiliateNotes,
            storeNotes: partnerCompanies.storeNotes,
            affiliateName: affiliates.name,
          })
          .from(partnerCompanies)
          .leftJoin(affiliates, eq(partnerCompanies.affiliateId, affiliates.id))
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
        // Phase 2 fields
        address?: string;
        phone?: string;
        hours?: Record<string, string>;
        logoUrl?: string;
        brandColors?: { primary: string; secondary: string; accent: string };
        targetKeywords?: string[];
        targetAudience?: string;
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
          address: body.address,
          phone: body.phone,
          hours: body.hours,
          logoUrl: body.logoUrl,
          brandColors: body.brandColors,
          targetKeywords: body.targetKeywords,
          targetAudience: body.targetAudience,
          tier: body.tier,
          referralFeePerClient: body.referralFeePerClient,
          monthlyFee: body.monthlyFee,
          dashboardToken,
        })
        .returning();

      // Fire-and-forget onboarding pipeline if website provided
      if (partner.website) {
        runPartnerOnboarding(db, slug).catch((err) =>
          logger.error({ err, slug }, "Partner onboarding pipeline failed"),
        );
      }

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

      // Fetch current partner to detect website changes
      const [current] = await db
        .select({ website: partnerCompanies.website })
        .from(partnerCompanies)
        .where(
          and(
            eq(partnerCompanies.companyId, COMPANY_ID),
            eq(partnerCompanies.slug, slug),
          ),
        )
        .limit(1);

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

      // Re-trigger onboarding if website changed
      if (
        body.website &&
        typeof body.website === "string" &&
        body.website !== current?.website
      ) {
        runPartnerOnboarding(db, slug).catch((err) =>
          logger.error({ err, slug }, "Partner onboarding pipeline failed"),
        );
      }

      res.json({ partner: result[0] });
    } catch (err) {
      logger.error({ err }, "Failed to update partner");
      res.status(500).json({ error: "Failed to update partner" });
    }
  });

  // ── POST /:slug/send-welcome — Email partner their dashboard link ─
  router.post("/:slug/send-welcome", async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const [partner] = await db
        .select()
        .from(partnerCompanies)
        .where(and(eq(partnerCompanies.companyId, COMPANY_ID), eq(partnerCompanies.slug, slug)))
        .limit(1);

      if (!partner) { res.status(404).json({ error: "Partner not found" }); return; }
      if (!partner.contactEmail) {
        res.status(400).json({ error: "Partner has no contact email — add one first" });
        return;
      }

      const BASE_URL =
        process.env.ADMIN_URL ||
        process.env.PAPERCLIP_PUBLIC_URL ||
        "https://api.coherencedaddy.com";

      await sendTransactional("partner-welcome", partner.contactEmail, {
        recipientEmail: partner.contactEmail,
        companyName: partner.name,
        recipientName: partner.contactName ?? partner.name,
        partnerDashboardUrl: `${BASE_URL}/partner-dashboard/${slug}`,
        partnerToken: partner.dashboardToken ?? undefined,
      });

      res.json({ ok: true, sentTo: partner.contactEmail });
    } catch (err) {
      logger.error({ err }, "Failed to send partner welcome email");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── POST /:slug/onboard — Manually trigger onboarding ──────────
  router.post("/:slug/onboard", async (req, res) => {
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

      if (!partner.website) {
        res.status(400).json({ error: "Partner has no website to scrape" });
        return;
      }

      // Fire-and-forget
      runPartnerOnboarding(db, slug).catch((err) =>
        logger.error({ err, slug }, "Partner onboarding pipeline failed"),
      );

      res.json({ ok: true, status: "started" });
    } catch (err) {
      logger.error({ err }, "Failed to trigger onboarding");
      res.status(500).json({ error: "Failed to trigger onboarding" });
    }
  });

  // ── POST /:slug/checkout — Create Stripe Checkout for partner billing ───────
  router.post("/:slug/checkout", async (req, res) => {
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

      if (!partner.contactEmail) {
        res.status(400).json({ error: "Partner has no contact_email — add contact first" });
        return;
      }

      if (!stripeConfigured()) {
        res.status(503).json({ error: "STRIPE_SECRET_KEY not configured" });
        return;
      }

      // Resolve the Stripe price ID from the partner's tier.
      const tierPriceEnv: Record<string, string> = {
        proof: "STRIPE_PRICE_PARTNER_PROOF",
        performance: "STRIPE_PRICE_PARTNER_PERFORMANCE",
        premium: "STRIPE_PRICE_PARTNER_PREMIUM",
      };
      const priceIdEnv = tierPriceEnv[partner.tier ?? "proof"] ?? "STRIPE_PRICE_PARTNER_PROOF";
      const priceId = process.env[priceIdEnv];
      if (!priceId) {
        res.status(400).json({
          error: `No Stripe price configured for tier '${partner.tier ?? "proof"}' (env: ${priceIdEnv})`,
        });
        return;
      }

      const successUrl =
        process.env.PARTNER_CHECKOUT_SUCCESS_URL ||
        `${process.env.PAPERCLIP_PUBLIC_URL || "https://api.coherencedaddy.com"}/partners/${slug}?checkout=success`;
      const cancelUrl =
        process.env.PARTNER_CHECKOUT_CANCEL_URL ||
        `${process.env.PAPERCLIP_PUBLIC_URL || "https://api.coherencedaddy.com"}/partners/${slug}`;

      const checkoutResult = await createCheckoutSession({
        email: partner.contactEmail,
        priceId,
        successUrl,
        cancelUrl,
        customerId: partner.stripeCustomerId ?? undefined,
        metadata: {
          source: "partner_network",
          partner_slug: slug,
          partner_id: partner.id,
          tier: partner.tier ?? "proof",
        },
      });

      // Persist the price ID and status on the partner row so webhook can match it.
      await db
        .update(partnerCompanies)
        .set({
          stripePriceId: priceId,
          subscriptionStatus: "checkout_sent",
          updatedAt: new Date(),
        })
        .where(eq(partnerCompanies.id, partner.id));

      res.json({ checkoutUrl: checkoutResult.checkoutUrl, sessionId: checkoutResult.sessionId });
    } catch (err) {
      logger.error({ err }, "Failed to create partner checkout");
      res.status(500).json({ error: (err as Error).message });
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

  // ── GET / — Full directory listing ─────────────────────────────
  router.get("/", async (req, res) => {
    try {
      const featured = req.query.featured === "true";
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);

      const conditions = [
        eq(partnerCompanies.companyId, COMPANY_ID),
        or(
          eq(partnerCompanies.status, "active"),
          eq(partnerCompanies.status, "trial"),
        ),
      ];
      if (featured) {
        conditions.push(eq(partnerCompanies.featured, true));
      }

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
          tagline: partnerCompanies.tagline,
          brandColors: partnerCompanies.brandColors,
          totalClicks: partnerCompanies.totalClicks,
          contentMentions: partnerCompanies.contentMentions,
          featured: partnerCompanies.featured,
          featuredOrder: partnerCompanies.featuredOrder,
        })
        .from(partnerCompanies)
        .where(and(...conditions))
        .orderBy(
          featured
            ? asc(partnerCompanies.featuredOrder)
            : partnerCompanies.name,
        )
        .limit(limit);

      res.json({ partners });
    } catch (err) {
      logger.error({ err }, "Failed to get public partner directory");
      res.status(500).json({ error: "Failed to get partner directory" });
    }
  });

  // ── GET /featured — Slim payload for homepage banner ────────────
  router.get("/featured", async (_req, res) => {
    try {
      const partners = await db
        .select({
          slug: partnerCompanies.slug,
          name: partnerCompanies.name,
          logoUrl: partnerCompanies.logoUrl,
          industry: partnerCompanies.industry,
          tagline: partnerCompanies.tagline,
          location: partnerCompanies.location,
        })
        .from(partnerCompanies)
        .where(
          and(
            eq(partnerCompanies.companyId, COMPANY_ID),
            eq(partnerCompanies.featured, true),
            or(
              eq(partnerCompanies.status, "active"),
              eq(partnerCompanies.status, "trial"),
            ),
          ),
        )
        .orderBy(asc(partnerCompanies.featuredOrder))
        .limit(20);

      res.json({ partners });
    } catch (err) {
      logger.error({ err }, "Failed to get featured partners");
      res.status(500).json({ error: "Failed to get featured partners" });
    }
  });

  return router;
}
