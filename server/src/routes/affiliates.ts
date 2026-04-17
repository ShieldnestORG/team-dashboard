// ---------------------------------------------------------------------------
// Affiliate Marketer System API Routes
// ---------------------------------------------------------------------------

import { Router } from "express";
import { eq, and, ilike, count } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { affiliates, partnerCompanies } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { requireAffiliate } from "../middleware/affiliate-auth.js";
import { createAffiliateJwt } from "../affiliate-auth-jwt.js";
import { assertBoard } from "./authz.js";
import { prefillPartnerFromWebsite, runPartnerOnboarding } from "../services/partner-onboarding.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

// ── Internal password helpers ────────────────────────────────────────────────

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const derived = scryptSync(password, salt, 64);
  return timingSafeEqual(derived, Buffer.from(hash, "hex"));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function randomSuffix(): string {
  return randomBytes(2).toString("hex"); // 4 hex chars
}

// ── Public + JWT-auth routes ─────────────────────────────────────────────────

export function affiliateRoutes(db: Db): Router {
  const router = Router();
  const authMiddleware = requireAffiliate(db);

  // ── POST /register — Public registration ──────────────────────────────────
  router.post("/register", async (req, res) => {
    try {
      const { name, email, password } = req.body as {
        name?: string;
        email?: string;
        password?: string;
      };

      if (!name || !email || !password) {
        res.status(400).json({ error: "name, email, and password are required" });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();

      const existing = await db
        .select({ id: affiliates.id })
        .from(affiliates)
        .where(ilike(affiliates.email, normalizedEmail))
        .limit(1);

      if (existing.length > 0) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }

      const passwordHash = hashPassword(password);

      const [affiliate] = await db
        .insert(affiliates)
        .values({
          name,
          email: normalizedEmail,
          passwordHash,
          status: "pending",
        })
        .returning({
          id: affiliates.id,
          name: affiliates.name,
          email: affiliates.email,
          status: affiliates.status,
        });

      res.status(201).json({ affiliate });
    } catch (err) {
      logger.error({ err }, "Failed to register affiliate");
      res.status(500).json({ error: "Failed to register affiliate" });
    }
  });

  // ── POST /login — Public login ────────────────────────────────────────────
  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body as { email?: string; password?: string };

      if (!email || !password) {
        res.status(400).json({ error: "email and password are required" });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();

      const [affiliate] = await db
        .select()
        .from(affiliates)
        .where(ilike(affiliates.email, normalizedEmail))
        .limit(1);

      if (!affiliate) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const valid = verifyPassword(password, affiliate.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      if (affiliate.status === "suspended") {
        res.status(403).json({ error: "Account suspended" });
        return;
      }

      const token = createAffiliateJwt(affiliate.id, affiliate.email);

      res.json({
        token,
        affiliate: {
          id: affiliate.id,
          name: affiliate.name,
          email: affiliate.email,
          status: affiliate.status,
          commissionRate: affiliate.commissionRate,
        },
      });
    } catch (err) {
      logger.error({ err }, "Failed affiliate login");
      res.status(500).json({ error: "Failed to login" });
    }
  });

  // ── GET /me — Affiliate profile + stats (JWT-auth) ───────────────────────
  router.get("/me", authMiddleware, async (req, res) => {
    try {
      const id = req.affiliateClaims!.sub;

      const [affiliate] = await db
        .select({
          id: affiliates.id,
          name: affiliates.name,
          email: affiliates.email,
          status: affiliates.status,
          commissionRate: affiliates.commissionRate,
          createdAt: affiliates.createdAt,
        })
        .from(affiliates)
        .where(eq(affiliates.id, id))
        .limit(1);

      if (!affiliate) {
        res.status(404).json({ error: "Affiliate not found" });
        return;
      }

      const [prospectResult] = await db
        .select({ count: count() })
        .from(partnerCompanies)
        .where(
          and(
            eq(partnerCompanies.affiliateId, id),
            eq(partnerCompanies.companyId, COMPANY_ID),
          ),
        );

      const prospectCount = Number(prospectResult?.count ?? 0);
      const estimatedEarned =
        parseFloat(affiliate.commissionRate ?? "0.10") * prospectCount * 149;

      res.json({ affiliate, prospectCount, estimatedEarned });
    } catch (err) {
      logger.error({ err }, "Failed to get affiliate profile");
      res.status(500).json({ error: "Failed to get affiliate profile" });
    }
  });

  // ── GET /prospects — List affiliate's prospects (JWT-auth) ───────────────
  router.get("/prospects", authMiddleware, async (req, res) => {
    try {
      const id = req.affiliateClaims!.sub;
      const statusFilter = req.query.status as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      const conditions = [
        eq(partnerCompanies.affiliateId, id),
        eq(partnerCompanies.companyId, COMPANY_ID),
      ];
      if (statusFilter) {
        conditions.push(eq(partnerCompanies.status, statusFilter));
      }

      const where = and(...conditions);

      const [prospects, totalResult] = await Promise.all([
        db
          .select({
            id: partnerCompanies.id,
            slug: partnerCompanies.slug,
            name: partnerCompanies.name,
            industry: partnerCompanies.industry,
            location: partnerCompanies.location,
            website: partnerCompanies.website,
            onboardingStatus: partnerCompanies.onboardingStatus,
            createdAt: partnerCompanies.createdAt,
            affiliateNotes: partnerCompanies.affiliateNotes,
            storeNotes: partnerCompanies.storeNotes,
          })
          .from(partnerCompanies)
          .where(where)
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(partnerCompanies).where(where),
      ]);

      res.json({ prospects, total: totalResult[0]?.total ?? 0 });
    } catch (err) {
      logger.error({ err }, "Failed to list prospects");
      res.status(500).json({ error: "Failed to list prospects" });
    }
  });

  // ── POST /prospects — Create a new prospect (JWT-auth) ───────────────────
  router.post("/prospects", authMiddleware, async (req, res) => {
    try {
      const affiliateId = req.affiliateClaims!.sub;
      const affiliateStatus = req.affiliateClaims!.status;
      const { website } = req.body as { website?: string };

      if (!website) {
        res.status(400).json({ error: "website is required" });
        return;
      }

      if (affiliateStatus !== "active") {
        res.status(403).json({ error: "Account must be active to add prospects" });
        return;
      }

      // Scrape and prefill from website
      let prefill: Awaited<ReturnType<typeof prefillPartnerFromWebsite>>;
      try {
        prefill = await prefillPartnerFromWebsite(website.trim());
      } catch (_err) {
        // Use hostname as fallback name if scrape fails
        prefill = {
          name: new URL(website).hostname.replace(/^www\./, ""),
          industry: "other",
          description: "",
          services: [],
          targetKeywords: [],
          tagline: "",
        };
      }

      const baseName = prefill.name ?? new URL(website).hostname.replace(/^www\./, "");
      const baseSlug = slugify(baseName);

      // Insert with conflict retry on slug
      let slug = baseSlug;
      let partner: typeof partnerCompanies.$inferSelect | undefined;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const inserted = await db
            .insert(partnerCompanies)
            .values({
              companyId: COMPANY_ID,
              slug,
              name: baseName,
              industry: prefill.industry ?? "other",
              location: prefill.location,
              website: website.trim(),
              description: prefill.description,
              services: prefill.services,
              targetKeywords: prefill.targetKeywords,
              tagline: prefill.tagline,
              brandColors: prefill.brandColors,
              affiliateId,
              status: "trial",
              tier: "proof",
              onboardingStatus: "none",
            })
            .returning();
          partner = inserted[0];
          break;
        } catch (err: unknown) {
          const pgErr = err as { code?: string };
          if (pgErr.code === "23505" && attempt === 0) {
            // Unique constraint on slug — append random suffix and retry
            slug = `${baseSlug}-${randomSuffix()}`;
          } else {
            throw err;
          }
        }
      }

      if (!partner) {
        res.status(500).json({ error: "Failed to create prospect" });
        return;
      }

      // Fire-and-forget onboarding
      runPartnerOnboarding(db, partner.slug).catch((err) =>
        logger.error({ err, slug: partner!.slug }, "Affiliate prospect onboarding failed"),
      );

      res.status(201).json({
        prospect: {
          slug: partner.slug,
          name: partner.name,
          onboardingStatus: partner.onboardingStatus,
        },
      });
    } catch (err) {
      logger.error({ err }, "Failed to create prospect");
      res.status(500).json({ error: "Failed to create prospect" });
    }
  });

  // ── GET /prospects/:slug — Get single prospect (JWT-auth) ────────────────
  router.get("/prospects/:slug", authMiddleware, async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const affiliateId = req.affiliateClaims!.sub;

      const [prospect] = await db
        .select({
          id: partnerCompanies.id,
          slug: partnerCompanies.slug,
          name: partnerCompanies.name,
          industry: partnerCompanies.industry,
          location: partnerCompanies.location,
          website: partnerCompanies.website,
          description: partnerCompanies.description,
          services: partnerCompanies.services,
          status: partnerCompanies.status,
          tier: partnerCompanies.tier,
          onboardingStatus: partnerCompanies.onboardingStatus,
          onboardingError: partnerCompanies.onboardingError,
          onboardingCompletedAt: partnerCompanies.onboardingCompletedAt,
          affiliateId: partnerCompanies.affiliateId,
          affiliateNotes: partnerCompanies.affiliateNotes,
          storeNotes: partnerCompanies.storeNotes,
          createdAt: partnerCompanies.createdAt,
          updatedAt: partnerCompanies.updatedAt,
        })
        .from(partnerCompanies)
        .where(
          and(
            eq(partnerCompanies.slug, slug),
            eq(partnerCompanies.affiliateId, affiliateId),
            eq(partnerCompanies.companyId, COMPANY_ID),
          ),
        )
        .limit(1);

      if (!prospect) {
        res.status(404).json({ error: "Prospect not found" });
        return;
      }

      res.json({ prospect });
    } catch (err) {
      logger.error({ err }, "Failed to get prospect");
      res.status(500).json({ error: "Failed to get prospect" });
    }
  });

  // ── PUT /prospects/:slug/notes — Update notes (JWT-auth) ─────────────────
  router.put("/prospects/:slug/notes", authMiddleware, async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const affiliateId = req.affiliateClaims!.sub;
      const { affiliateNotes, storeNotes } = req.body as {
        affiliateNotes?: string;
        storeNotes?: string;
      };

      const result = await db
        .update(partnerCompanies)
        .set({
          ...(affiliateNotes !== undefined ? { affiliateNotes } : {}),
          ...(storeNotes !== undefined ? { storeNotes } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(partnerCompanies.slug, slug),
            eq(partnerCompanies.affiliateId, affiliateId),
          ),
        )
        .returning({ id: partnerCompanies.id });

      if (result.length === 0) {
        res.status(404).json({ error: "Prospect not found" });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to update prospect notes");
      res.status(500).json({ error: "Failed to update notes" });
    }
  });

  // ── PUT /prospects/:slug — Update prospect basic info (JWT-auth) ──────────
  router.put("/prospects/:slug", authMiddleware, async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const affiliateId = req.affiliateClaims!.sub;
      const body = req.body as { name?: string; location?: string; website?: string };

      const updateFields: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) updateFields.name = body.name;
      if (body.location !== undefined) updateFields.location = body.location;
      if (body.website !== undefined) updateFields.website = body.website;

      const result = await db
        .update(partnerCompanies)
        .set(updateFields)
        .where(
          and(
            eq(partnerCompanies.slug, slug),
            eq(partnerCompanies.affiliateId, affiliateId),
          ),
        )
        .returning({ id: partnerCompanies.id });

      if (result.length === 0) {
        res.status(404).json({ error: "Prospect not found" });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to update prospect");
      res.status(500).json({ error: "Failed to update prospect" });
    }
  });

  return router;
}

// ── Admin routes (board auth) ────────────────────────────────────────────────

export function affiliateAdminRoutes(db: Db): Router {
  const router = Router();

  // ── GET / — List all affiliates with prospect count ───────────────────────
  router.get("/", async (req, res) => {
    try {
      assertBoard(req);

      const rows = await db
        .select({
          id: affiliates.id,
          name: affiliates.name,
          email: affiliates.email,
          status: affiliates.status,
          commissionRate: affiliates.commissionRate,
          createdAt: affiliates.createdAt,
        })
        .from(affiliates);

      // Fetch prospect counts in a second query (simple approach)
      const prospectCounts = await db
        .select({
          affiliateId: partnerCompanies.affiliateId,
          prospectCount: count(),
        })
        .from(partnerCompanies)
        .where(eq(partnerCompanies.companyId, COMPANY_ID))
        .groupBy(partnerCompanies.affiliateId);

      const countMap = new Map<string, number>();
      for (const row of prospectCounts) {
        if (row.affiliateId) countMap.set(row.affiliateId, Number(row.prospectCount));
      }

      const affiliateList = rows.map((row) => ({
        ...row,
        prospectCount: countMap.get(row.id) ?? 0,
      }));

      res.json({ affiliates: affiliateList });
    } catch (err) {
      logger.error({ err }, "Failed to list affiliates");
      res.status(500).json({ error: "Failed to list affiliates" });
    }
  });

  // ── PUT /:id/status — Update affiliate status ─────────────────────────────
  router.put("/:id/status", async (req, res) => {
    try {
      assertBoard(req);

      const id = req.params.id as string;
      const { status } = req.body as { status?: string };

      const validStatuses = ["active", "pending", "suspended"];
      if (!status || !validStatuses.includes(status)) {
        res.status(400).json({ error: "status must be one of: active, pending, suspended" });
        return;
      }

      const result = await db
        .update(affiliates)
        .set({ status, updatedAt: new Date() })
        .where(eq(affiliates.id, id))
        .returning({ id: affiliates.id });

      if (result.length === 0) {
        res.status(404).json({ error: "Affiliate not found" });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to update affiliate status");
      res.status(500).json({ error: "Failed to update affiliate status" });
    }
  });

  return router;
}
