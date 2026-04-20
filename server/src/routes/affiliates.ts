// ---------------------------------------------------------------------------
// Affiliate Marketer System API Routes
// ---------------------------------------------------------------------------

import { Router } from "express";
import { eq, and, ilike, count, sql, isNull, gt, desc, inArray, gte, lte } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import { scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { affiliates, partnerCompanies, referralAttribution, commissions, payouts } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { requireAffiliate } from "../middleware/affiliate-auth.js";
import { createAffiliateJwt } from "../affiliate-auth-jwt.js";
import { assertBoard } from "./authz.js";
import { runPartnerOnboarding } from "../services/partner-onboarding.js";
import { sendTransactional } from "../services/email-templates.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

// ── Simple in-memory rate limiter for auth endpoints ────────────────────────
// Limits: 10 attempts per IP per 15-minute window
// Resets automatically via TTL cleanup; safe for single-server deployment.

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true; // allowed
  }

  if (bucket.count >= RATE_LIMIT) {
    return false; // blocked
  }

  bucket.count += 1;
  return true; // allowed
}

// Cleanup stale buckets every 30 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(key);
  }
}, 30 * 60 * 1000).unref();

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
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
      if (!checkRateLimit(clientIp)) {
        res.status(429).json({ error: "Too many attempts. Please try again in 15 minutes." });
        return;
      }

      const { name, email, password } = req.body as {
        name?: string;
        email?: string;
        password?: string;
      };

      if (!name || !email || !password) {
        res.status(400).json({ error: "name, email, and password are required" });
        return;
      }

      if (password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters" });
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

      // Notify admin — fire and forget
      const adminEmail = process.env.ALERT_EMAIL_TO ?? process.env.SMTP_USER;
      if (adminEmail) {
        sendTransactional("affiliate-application", adminEmail, {
          recipientName: "Team",
          recipientEmail: adminEmail,
          affiliateName: name,
        }).catch(() => {});
      }

      res.status(201).json({ affiliate });
    } catch (err) {
      logger.error({ err }, "Failed to register affiliate");
      res.status(500).json({ error: "Failed to register affiliate" });
    }
  });

  // ── POST /login — Public login ────────────────────────────────────────────
  router.post("/login", async (req, res) => {
    try {
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
      if (!checkRateLimit(clientIp)) {
        res.status(429).json({ error: "Too many attempts. Please try again in 15 minutes." });
        return;
      }

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
          policyAcceptedAt: affiliates.policyAcceptedAt,
          createdAt: affiliates.createdAt,
        })
        .from(affiliates)
        .where(eq(affiliates.id, id))
        .limit(1);

      if (!affiliate) {
        res.status(404).json({ error: "Affiliate not found" });
        return;
      }

      const affiliateWhere = and(
        eq(partnerCompanies.affiliateId, id),
        eq(partnerCompanies.companyId, COMPANY_ID),
      );

      const [[prospectResult], [convertedResult], [feeResult]] = await Promise.all([
        db.select({ count: count() }).from(partnerCompanies).where(affiliateWhere),
        db
          .select({ count: count() })
          .from(partnerCompanies)
          .where(and(eq(partnerCompanies.affiliateId, id), eq(partnerCompanies.companyId, COMPANY_ID), eq(partnerCompanies.isPaying, true))),
        db
          .select({ totalFee: sql<number>`coalesce(sum(monthly_fee), 0)` })
          .from(partnerCompanies)
          .where(and(eq(partnerCompanies.affiliateId, id), eq(partnerCompanies.companyId, COMPANY_ID), eq(partnerCompanies.isPaying, true))),
      ]);

      const prospectCount = Number(prospectResult?.count ?? 0);
      const convertedCount = Number(convertedResult?.count ?? 0);
      const totalMonthlyFees = Number(feeResult?.totalFee ?? 0);
      const estimatedEarned =
        parseFloat(affiliate.commissionRate ?? "0.10") * totalMonthlyFees;

      // Commission bucket aggregates — one grouped query for all statuses.
      const bucketRows = await db
        .select({
          status: commissions.status,
          total: sql<number>`coalesce(sum(${commissions.amountCents}), 0)`,
        })
        .from(commissions)
        .where(eq(commissions.affiliateId, id))
        .groupBy(commissions.status);

      let pendingCents = 0;
      let approvedCents = 0;
      let scheduledCents = 0;
      let paidCents = 0;
      for (const row of bucketRows) {
        const amt = Number(row.total ?? 0);
        switch (row.status) {
          case "pending_activation":
            pendingCents = amt;
            break;
          case "approved":
            approvedCents = amt;
            break;
          case "scheduled_for_payout":
            scheduledCents = amt;
            break;
          case "paid":
            paidCents = amt;
            break;
          default:
            break;
        }
      }
      const lifetimeCents = approvedCents + scheduledCents + paidCents;

      res.json({
        affiliate,
        prospectCount,
        convertedCount,
        estimatedEarned,
        pendingCents,
        approvedCents,
        scheduledCents,
        paidCents,
        lifetimeCents,
      });
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
            isPaying: partnerCompanies.isPaying,
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
      const policyAcceptedAt = req.affiliateClaims!.policyAcceptedAt;

      // Policy gate — must accept policy before submitting prospects
      if (!policyAcceptedAt) {
        res.status(403).json({
          error: "Policy acceptance required",
          code: "POLICY_NOT_ACCEPTED",
        });
        return;
      }

      const body = req.body as {
        website?: string;
        firstTouch?: {
          logged?: boolean;
          type?: string;
          date?: string;
          notes?: string;
          warmth?: string;
        };
        closePath?: string;
      };
      const { website, firstTouch, closePath } = body;

      if (!website) {
        res.status(400).json({ error: "website is required" });
        return;
      }

      if (affiliateStatus !== "active") {
        res.status(403).json({ error: "Account must be active to add prospects" });
        return;
      }

      // Validate firstTouch if provided
      const VALID_TOUCH_TYPES = ["in-person", "call", "text", "email", "social-dm"];
      const VALID_WARMTH = ["strong", "medium", "weak"];
      const VALID_CLOSE_PATHS = ["cd", "shared", "affiliate"];

      if (firstTouch !== undefined) {
        if (typeof firstTouch !== "object" || firstTouch === null) {
          res.status(400).json({ error: "firstTouch must be an object" });
          return;
        }
        if (firstTouch.logged !== undefined && typeof firstTouch.logged !== "boolean") {
          res.status(400).json({ error: "firstTouch.logged must be a boolean" });
          return;
        }
        if (firstTouch.type !== undefined && !VALID_TOUCH_TYPES.includes(firstTouch.type)) {
          res.status(400).json({ error: `firstTouch.type must be one of: ${VALID_TOUCH_TYPES.join(", ")}` });
          return;
        }
        if (firstTouch.warmth !== undefined && !VALID_WARMTH.includes(firstTouch.warmth)) {
          res.status(400).json({ error: `firstTouch.warmth must be one of: ${VALID_WARMTH.join(", ")}` });
          return;
        }
        if (firstTouch.date !== undefined && typeof firstTouch.date !== "string") {
          res.status(400).json({ error: "firstTouch.date must be an ISO string" });
          return;
        }
        if (firstTouch.notes !== undefined && typeof firstTouch.notes !== "string") {
          res.status(400).json({ error: "firstTouch.notes must be a string" });
          return;
        }
      }

      if (closePath !== undefined && !VALID_CLOSE_PATHS.includes(closePath)) {
        res.status(400).json({ error: `closePath must be one of: ${VALID_CLOSE_PATHS.join(", ")}` });
        return;
      }

      // Parse firstTouch.date into Date, rejecting invalid ISO
      let firstTouchDateParsed: Date | null = null;
      if (firstTouch?.date) {
        const d = new Date(firstTouch.date);
        if (isNaN(d.getTime())) {
          res.status(400).json({ error: "firstTouch.date must be a valid ISO date string" });
          return;
        }
        firstTouchDateParsed = d;
      }

      let url: URL;
      try {
        url = new URL(website.trim());
      } catch {
        res.status(400).json({ error: "Please enter a full URL including https:// (e.g. https://example.com)" });
        return;
      }

      // Check for existing prospect with this website
      const existingWebsite = await db
        .select({
          id: partnerCompanies.id,
          slug: partnerCompanies.slug,
          name: partnerCompanies.name,
          affiliateId: partnerCompanies.affiliateId,
          onboardingStatus: partnerCompanies.onboardingStatus,
        })
        .from(partnerCompanies)
        .where(
          and(
            eq(partnerCompanies.website, url.toString()),
            eq(partnerCompanies.companyId, COMPANY_ID),
          ),
        )
        .limit(1);

      if (existingWebsite.length > 0) {
        const dup = existingWebsite[0];

        // Allow re-trigger if this affiliate's own prospect previously failed
        if (dup.affiliateId === affiliateId && dup.onboardingStatus === "failed") {
          await db
            .update(partnerCompanies)
            .set({ onboardingStatus: "none", onboardingError: null, updatedAt: new Date() })
            .where(eq(partnerCompanies.slug, dup.slug));
          runPartnerOnboarding(db, dup.slug).catch((err) =>
            logger.error({ err, slug: dup.slug }, "Affiliate prospect re-onboarding failed"),
          );
          // Re-submission path: do NOT create a new attribution row — reuse existing active one
          res.json({
            prospect: { slug: dup.slug, name: dup.name, onboardingStatus: "none" },
            resubmitted: true,
          });
          return;
        }

        // Check if there's an active, unexpired attribution owned by another affiliate
        const now = new Date();
        const [activeAttribution] = await db
          .select({
            id: referralAttribution.id,
            affiliateId: referralAttribution.affiliateId,
          })
          .from(referralAttribution)
          .where(
            and(
              eq(referralAttribution.leadId, dup.id),
              isNull(referralAttribution.lockReleasedAt),
              gt(referralAttribution.lockExpiresAt, now),
            ),
          )
          .limit(1);

        if (activeAttribution && activeAttribution.affiliateId !== affiliateId) {
          // Actively locked by another affiliate — block
          res.status(409).json({ error: "This business is already in our system.", slug: dup.slug });
          return;
        }

        if (activeAttribution && activeAttribution.affiliateId === affiliateId) {
          // Same affiliate already has an active attribution — treat as duplicate of their own prospect
          res.status(409).json({ error: "This business is already in our system.", slug: dup.slug });
          return;
        }

        // No active attribution (or existing is already released). If there's a stale active
        // attribution that's expired, mark it released so the new one becomes the owner.
        const [expiredActive] = await db
          .select({ id: referralAttribution.id })
          .from(referralAttribution)
          .where(
            and(
              eq(referralAttribution.leadId, dup.id),
              isNull(referralAttribution.lockReleasedAt),
            ),
          )
          .limit(1);
        if (expiredActive) {
          await db
            .update(referralAttribution)
            .set({ lockReleasedAt: now, updatedAt: now })
            .where(eq(referralAttribution.id, expiredActive.id));
        }

        // Fall through: the existing partner_companies row was never successfully owned
        // by an active attribution. Re-own it under this affiliate and create a fresh
        // attribution row.
        await db
          .update(partnerCompanies)
          .set({ affiliateId, updatedAt: now })
          .where(eq(partnerCompanies.id, dup.id));

        const lockExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await db.insert(referralAttribution).values({
          leadId: dup.id,
          affiliateId,
          attributionType: "affiliate_referred_cd_closed",
          lockStartAt: now,
          lockExpiresAt,
          firstTouchLogged: firstTouch?.logged ?? false,
          firstTouchType: firstTouch?.type ?? null,
          firstTouchDate: firstTouchDateParsed,
          firstTouchNotes: firstTouch?.notes ?? null,
          relationshipWarmth: firstTouch?.warmth ?? null,
          affiliateClosePreference: closePath ?? null,
        });

        res.status(201).json({
          prospect: {
            slug: dup.slug,
            name: dup.name,
            onboardingStatus: dup.onboardingStatus,
          },
        });
        return;
      }

      const baseName = url.hostname.replace(/^www\./, "");
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
              industry: "other",
              website: url.toString(),
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

      // Create referral attribution row for this new prospect
      const attributionNow = new Date();
      const attributionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await db.insert(referralAttribution).values({
        leadId: partner.id,
        affiliateId,
        attributionType: "affiliate_referred_cd_closed",
        lockStartAt: attributionNow,
        lockExpiresAt: attributionExpiresAt,
        firstTouchLogged: firstTouch?.logged ?? false,
        firstTouchType: firstTouch?.type ?? null,
        firstTouchDate: firstTouchDateParsed,
        firstTouchNotes: firstTouch?.notes ?? null,
        relationshipWarmth: firstTouch?.warmth ?? null,
        affiliateClosePreference: closePath ?? null,
      });

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

  // ── POST /accept-policy — Record policy acceptance (JWT-auth) ─────────────
  router.post("/accept-policy", authMiddleware, async (req, res) => {
    try {
      const id = req.affiliateClaims!.sub;
      const existing = req.affiliateClaims!.policyAcceptedAt;

      // Idempotent — if already accepted, return the stored timestamp
      if (existing) {
        res.json({ acceptedAt: existing.toISOString() });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(affiliates)
        .set({ policyAcceptedAt: now, updatedAt: now })
        .where(eq(affiliates.id, id))
        .returning({ policyAcceptedAt: affiliates.policyAcceptedAt });

      const acceptedAt = updated?.policyAcceptedAt ?? now;
      res.json({ acceptedAt: acceptedAt.toISOString() });
    } catch (err) {
      logger.error({ err }, "Failed to accept policy");
      res.status(500).json({ error: "Failed to accept policy" });
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

  // ── POST /forgot-password — Public password reset request ────────────────
  router.post("/forgot-password", async (req, res) => {
    try {
      const { email } = req.body as { email?: string };

      // Always return 200 — don't reveal if email exists
      if (!email) {
        res.json({ ok: true });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();

      const [affiliate] = await db
        .select({ id: affiliates.id, email: affiliates.email, name: affiliates.name })
        .from(affiliates)
        .where(ilike(affiliates.email, normalizedEmail))
        .limit(1);

      if (affiliate) {
        // Generate raw token, store SHA-256 hash
        const rawToken = randomBytes(32).toString("hex");
        const hashedToken = createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await db
          .update(affiliates)
          .set({ resetToken: hashedToken, resetTokenExpiresAt: expiresAt, updatedAt: new Date() })
          .where(eq(affiliates.id, affiliate.id));

        sendTransactional("affiliate-reset-password", affiliate.email, {
          recipientName: affiliate.name,
          recipientEmail: affiliate.email,
          resetToken: rawToken,
        }).catch(() => {});
      }

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to process forgot-password request");
      res.json({ ok: true }); // still return 200
    }
  });

  // ── POST /reset-password — Public password reset confirmation ─────────────
  router.post("/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body as { token?: string; password?: string };

      if (!token || !password) {
        res.status(400).json({ error: "token and password are required" });
        return;
      }

      if (password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters" });
        return;
      }

      // Hash the incoming token to compare against the stored hash
      const hashedToken = createHash("sha256").update(token).digest("hex");

      const [affiliate] = await db
        .select({ id: affiliates.id, resetTokenExpiresAt: affiliates.resetTokenExpiresAt })
        .from(affiliates)
        .where(eq(affiliates.resetToken, hashedToken))
        .limit(1);

      if (!affiliate || !affiliate.resetTokenExpiresAt || affiliate.resetTokenExpiresAt < new Date()) {
        res.status(400).json({ error: "Invalid or expired reset link" });
        return;
      }

      const newPasswordHash = hashPassword(password);

      await db
        .update(affiliates)
        .set({
          passwordHash: newPasswordHash,
          resetToken: null,
          resetTokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(affiliates.id, affiliate.id));

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to reset password");
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // ── GET /earnings — Affiliate commission history (JWT-auth) ──────────────
  router.get("/earnings", authMiddleware, async (req, res) => {
    try {
      const affiliateId = req.affiliateClaims!.sub;

      const rawLimit = Number(req.query.limit);
      const rawOffset = Number(req.query.offset);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.max(Math.floor(rawLimit), 1), 200) : 50;
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;

      const statusParam = req.query.status as string | undefined;
      const statusFilter =
        statusParam && statusParam.length > 0
          ? statusParam
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : undefined;

      const conditions = [eq(commissions.affiliateId, affiliateId)];
      if (statusFilter && statusFilter.length > 0) {
        conditions.push(inArray(commissions.status, statusFilter));
      }
      const where = and(...conditions);

      const [rows, totalRows] = await Promise.all([
        db
          .select({
            id: commissions.id,
            leadId: commissions.leadId,
            leadSlug: partnerCompanies.slug,
            leadName: partnerCompanies.name,
            type: commissions.type,
            rate: commissions.rate,
            amountCents: commissions.amountCents,
            basisCents: commissions.basisCents,
            periodStart: commissions.periodStart,
            periodEnd: commissions.periodEnd,
            status: commissions.status,
            stripeInvoiceId: commissions.stripeInvoiceId,
            holdExpiresAt: commissions.holdExpiresAt,
            payoutBatchId: commissions.payoutBatchId,
            createdAt: commissions.createdAt,
          })
          .from(commissions)
          .leftJoin(partnerCompanies, eq(partnerCompanies.id, commissions.leadId))
          .where(where)
          .orderBy(desc(commissions.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(commissions).where(where),
      ]);

      res.json({
        commissions: rows,
        total: Number(totalRows[0]?.total ?? 0),
        limit,
        offset,
      });
    } catch (err) {
      logger.error({ err }, "Failed to list affiliate earnings");
      res.status(500).json({ error: "Failed to list earnings" });
    }
  });

  // ── GET /payouts — Affiliate payout batches (JWT-auth) ───────────────────
  router.get("/payouts", authMiddleware, async (req, res) => {
    try {
      const affiliateId = req.affiliateClaims!.sub;

      const [rows, totalRows] = await Promise.all([
        db
          .select({
            id: payouts.id,
            amountCents: payouts.amountCents,
            commissionCount: payouts.commissionCount,
            method: payouts.method,
            externalId: payouts.externalId,
            status: payouts.status,
            batchMonth: payouts.batchMonth,
            scheduledFor: payouts.scheduledFor,
            sentAt: payouts.sentAt,
            paidAt: payouts.paidAt,
            notes: payouts.notes,
            createdAt: payouts.createdAt,
          })
          .from(payouts)
          .where(eq(payouts.affiliateId, affiliateId))
          .orderBy(desc(payouts.createdAt)),
        db.select({ total: count() }).from(payouts).where(eq(payouts.affiliateId, affiliateId)),
      ]);

      res.json({ payouts: rows, total: Number(totalRows[0]?.total ?? 0) });
    } catch (err) {
      logger.error({ err }, "Failed to list affiliate payouts");
      res.status(500).json({ error: "Failed to list payouts" });
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
      if (body.website !== undefined) {
        try {
          updateFields.website = new URL(body.website.trim()).toString();
        } catch {
          res.status(400).json({ error: "Please enter a full URL including https:// (e.g. https://example.com)" });
          return;
        }
      }

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

      // Fetch prospect counts and converted counts in parallel
      const [prospectCounts, convertedCounts] = await Promise.all([
        db
          .select({ affiliateId: partnerCompanies.affiliateId, prospectCount: count() })
          .from(partnerCompanies)
          .where(eq(partnerCompanies.companyId, COMPANY_ID))
          .groupBy(partnerCompanies.affiliateId),
        db
          .select({ affiliateId: partnerCompanies.affiliateId, convertedCount: count() })
          .from(partnerCompanies)
          .where(and(eq(partnerCompanies.companyId, COMPANY_ID), eq(partnerCompanies.isPaying, true)))
          .groupBy(partnerCompanies.affiliateId),
      ]);

      const countMap = new Map<string, number>();
      for (const row of prospectCounts) {
        if (row.affiliateId) countMap.set(row.affiliateId, Number(row.prospectCount));
      }
      const convertedMap = new Map<string, number>();
      for (const row of convertedCounts) {
        if (row.affiliateId) convertedMap.set(row.affiliateId, Number(row.convertedCount));
      }

      const affiliateList = rows.map((row) => ({
        ...row,
        prospectCount: countMap.get(row.id) ?? 0,
        convertedCount: convertedMap.get(row.id) ?? 0,
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

      // Fetch affiliate before update so we have email + name for notification
      const [affiliate] = await db
        .select({ id: affiliates.id, name: affiliates.name, email: affiliates.email })
        .from(affiliates)
        .where(eq(affiliates.id, id))
        .limit(1);

      if (!affiliate) {
        res.status(404).json({ error: "Affiliate not found" });
        return;
      }

      await db
        .update(affiliates)
        .set({ status, updatedAt: new Date() })
        .where(eq(affiliates.id, id));

      // Notify affiliate if newly approved
      if (status === "active") {
        sendTransactional("affiliate-approved", affiliate.email, {
          recipientName: affiliate.name,
          recipientEmail: affiliate.email,
          affiliateName: affiliate.name,
        }).catch(() => {});
      }

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to update affiliate status");
      res.status(500).json({ error: "Failed to update affiliate status" });
    }
  });

  // ── GET /commissions — List commissions with filters (board auth) ────────
  router.get("/commissions", async (req, res) => {
    try {
      assertBoard(req);

      const rawLimit = Number(req.query.limit);
      const rawOffset = Number(req.query.offset);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.max(Math.floor(rawLimit), 1), 200) : 50;
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;

      const affiliateIdFilter = req.query.affiliateId as string | undefined;
      const statusParam = req.query.status as string | undefined;
      const fromParam = req.query.from as string | undefined;
      const toParam = req.query.to as string | undefined;

      const conditions = [] as ReturnType<typeof eq>[];
      if (affiliateIdFilter) {
        conditions.push(eq(commissions.affiliateId, affiliateIdFilter));
      }
      if (statusParam) {
        const statusList = statusParam
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (statusList.length === 1) {
          conditions.push(eq(commissions.status, statusList[0]));
        } else if (statusList.length > 1) {
          conditions.push(inArray(commissions.status, statusList));
        }
      }
      if (fromParam) {
        const fromDate = new Date(fromParam);
        if (!isNaN(fromDate.getTime())) {
          conditions.push(gte(commissions.createdAt, fromDate));
        }
      }
      if (toParam) {
        const toDate = new Date(toParam);
        if (!isNaN(toDate.getTime())) {
          conditions.push(lte(commissions.createdAt, toDate));
        }
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const selectQuery = db
        .select({
          id: commissions.id,
          affiliateId: commissions.affiliateId,
          affiliateName: affiliates.name,
          leadId: commissions.leadId,
          leadName: partnerCompanies.name,
          leadSlug: partnerCompanies.slug,
          attributionId: commissions.attributionId,
          type: commissions.type,
          rate: commissions.rate,
          amountCents: commissions.amountCents,
          basisCents: commissions.basisCents,
          periodStart: commissions.periodStart,
          periodEnd: commissions.periodEnd,
          status: commissions.status,
          stripeInvoiceId: commissions.stripeInvoiceId,
          stripeChargeId: commissions.stripeChargeId,
          holdExpiresAt: commissions.holdExpiresAt,
          payoutBatchId: commissions.payoutBatchId,
          clawbackReason: commissions.clawbackReason,
          createdAt: commissions.createdAt,
          updatedAt: commissions.updatedAt,
        })
        .from(commissions)
        .leftJoin(affiliates, eq(affiliates.id, commissions.affiliateId))
        .leftJoin(partnerCompanies, eq(partnerCompanies.id, commissions.leadId));

      const listQuery = where ? selectQuery.where(where) : selectQuery;

      const countQueryBase = db.select({ total: count() }).from(commissions);
      const countQuery = where ? countQueryBase.where(where) : countQueryBase;

      const [rows, totalRows] = await Promise.all([
        listQuery.orderBy(desc(commissions.createdAt)).limit(limit).offset(offset),
        countQuery,
      ]);

      res.json({
        commissions: rows,
        total: Number(totalRows[0]?.total ?? 0),
        limit,
        offset,
      });
    } catch (err) {
      logger.error({ err }, "Failed to list commissions (admin)");
      res.status(500).json({ error: "Failed to list commissions" });
    }
  });

  // ── PUT /commissions/:id/approve — Force-approve a commission ────────────
  router.put("/commissions/:id/approve", async (req, res) => {
    try {
      assertBoard(req);

      const id = req.params.id as string;
      const { reason } = (req.body ?? {}) as { reason?: string };

      const [existing] = await db
        .select({ id: commissions.id, status: commissions.status })
        .from(commissions)
        .where(eq(commissions.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Commission not found" });
        return;
      }

      if (existing.status !== "pending_activation" && existing.status !== "held") {
        res.status(409).json({
          error: `Cannot approve commission in status '${existing.status}'`,
          code: "INVALID_STATUS_TRANSITION",
        });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(commissions)
        .set({ status: "approved", updatedAt: now })
        .where(eq(commissions.id, id))
        .returning({ id: commissions.id, status: commissions.status });

      logger.info(
        { commissionId: id, priorStatus: existing.status, reason: reason ?? null },
        "Commission approved by admin",
      );

      res.json({ commission: updated });
    } catch (err) {
      logger.error({ err }, "Failed to approve commission");
      res.status(500).json({ error: "Failed to approve commission" });
    }
  });

  // ── PUT /commissions/:id/reverse — Reverse a commission ──────────────────
  router.put("/commissions/:id/reverse", async (req, res) => {
    try {
      assertBoard(req);

      const id = req.params.id as string;
      const { reason } = (req.body ?? {}) as { reason?: string };

      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        res.status(400).json({ error: "reason is required" });
        return;
      }

      const [existing] = await db
        .select({ id: commissions.id, status: commissions.status })
        .from(commissions)
        .where(eq(commissions.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Commission not found" });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(commissions)
        .set({ status: "reversed", clawbackReason: reason, updatedAt: now })
        .where(eq(commissions.id, id))
        .returning({
          id: commissions.id,
          status: commissions.status,
          clawbackReason: commissions.clawbackReason,
        });

      logger.info(
        { commissionId: id, priorStatus: existing.status, reason },
        "Commission reversed by admin",
      );

      res.json({ commission: updated });
    } catch (err) {
      logger.error({ err }, "Failed to reverse commission");
      res.status(500).json({ error: "Failed to reverse commission" });
    }
  });

  // ── PUT /commissions/:id/hold — Put commission on hold ───────────────────
  router.put("/commissions/:id/hold", async (req, res) => {
    try {
      assertBoard(req);

      const id = req.params.id as string;
      const { reason } = (req.body ?? {}) as { reason?: string };

      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        res.status(400).json({ error: "reason is required" });
        return;
      }

      const [existing] = await db
        .select({ id: commissions.id, status: commissions.status })
        .from(commissions)
        .where(eq(commissions.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Commission not found" });
        return;
      }

      if (existing.status !== "pending_activation" && existing.status !== "approved") {
        res.status(409).json({
          error: `Cannot hold commission in status '${existing.status}'`,
          code: "INVALID_STATUS_TRANSITION",
        });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(commissions)
        .set({ status: "held", clawbackReason: reason, updatedAt: now })
        .where(eq(commissions.id, id))
        .returning({
          id: commissions.id,
          status: commissions.status,
          clawbackReason: commissions.clawbackReason,
        });

      logger.info(
        { commissionId: id, priorStatus: existing.status, reason },
        "Commission put on hold by admin",
      );

      res.json({ commission: updated });
    } catch (err) {
      logger.error({ err }, "Failed to hold commission");
      res.status(500).json({ error: "Failed to hold commission" });
    }
  });

  // ── GET /payouts — List payout batches (board auth) ──────────────────────
  router.get("/payouts", async (req, res) => {
    try {
      assertBoard(req);

      const statusParam = req.query.status as string | undefined;
      const monthParam = req.query.month as string | undefined;
      const affiliateIdFilter = req.query.affiliateId as string | undefined;

      const conditions = [] as ReturnType<typeof eq>[];
      if (statusParam) {
        conditions.push(eq(payouts.status, statusParam));
      }
      if (monthParam) {
        conditions.push(eq(payouts.batchMonth, monthParam));
      }
      if (affiliateIdFilter) {
        conditions.push(eq(payouts.affiliateId, affiliateIdFilter));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const baseQuery = db
        .select({
          id: payouts.id,
          affiliateId: payouts.affiliateId,
          affiliateName: affiliates.name,
          amountCents: payouts.amountCents,
          commissionCount: payouts.commissionCount,
          method: payouts.method,
          externalId: payouts.externalId,
          status: payouts.status,
          batchMonth: payouts.batchMonth,
          scheduledFor: payouts.scheduledFor,
          sentAt: payouts.sentAt,
          paidAt: payouts.paidAt,
          notes: payouts.notes,
          createdAt: payouts.createdAt,
          updatedAt: payouts.updatedAt,
        })
        .from(payouts)
        .leftJoin(affiliates, eq(affiliates.id, payouts.affiliateId));

      const listQuery = where ? baseQuery.where(where) : baseQuery;

      const countBase = db.select({ total: count() }).from(payouts);
      const countQuery = where ? countBase.where(where) : countBase;

      const [rows, totalRows] = await Promise.all([
        listQuery.orderBy(desc(payouts.createdAt)),
        countQuery,
      ]);

      res.json({ payouts: rows, total: Number(totalRows[0]?.total ?? 0) });
    } catch (err) {
      logger.error({ err }, "Failed to list payouts (admin)");
      res.status(500).json({ error: "Failed to list payouts" });
    }
  });

  // ── PUT /payouts/:id/mark-sent — Mark payout sent (board auth) ───────────
  router.put("/payouts/:id/mark-sent", async (req, res) => {
    try {
      assertBoard(req);

      const id = req.params.id as string;
      const { externalId, method } = (req.body ?? {}) as {
        externalId?: string;
        method?: string;
      };

      if (!externalId || typeof externalId !== "string" || externalId.trim().length === 0) {
        res.status(400).json({ error: "externalId is required" });
        return;
      }

      const [existing] = await db
        .select({ id: payouts.id, status: payouts.status })
        .from(payouts)
        .where(eq(payouts.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Payout not found" });
        return;
      }

      if (existing.status !== "scheduled") {
        res.status(409).json({
          error: `Cannot mark payout sent in status '${existing.status}'`,
          code: "INVALID_STATUS_TRANSITION",
        });
        return;
      }

      const now = new Date();
      const updateFields: Record<string, unknown> = {
        status: "sent",
        sentAt: now,
        externalId,
        updatedAt: now,
      };
      if (method && typeof method === "string" && method.trim().length > 0) {
        updateFields.method = method;
      }

      const [updated] = await db
        .update(payouts)
        .set(updateFields)
        .where(eq(payouts.id, id))
        .returning();

      res.json({ payout: updated });
    } catch (err) {
      logger.error({ err }, "Failed to mark payout sent");
      res.status(500).json({ error: "Failed to mark payout sent" });
    }
  });

  // ── PUT /payouts/:id/mark-paid — Mark payout + commissions paid ──────────
  router.put("/payouts/:id/mark-paid", async (req, res) => {
    try {
      assertBoard(req);

      const id = req.params.id as string;

      const [existing] = await db
        .select({ id: payouts.id, status: payouts.status })
        .from(payouts)
        .where(eq(payouts.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Payout not found" });
        return;
      }

      if (existing.status !== "sent") {
        res.status(409).json({
          error: `Cannot mark payout paid in status '${existing.status}'`,
          code: "INVALID_STATUS_TRANSITION",
        });
        return;
      }

      const now = new Date();

      const updated = await db.transaction(async (tx) => {
        const [payoutRow] = await tx
          .update(payouts)
          .set({ status: "paid", paidAt: now, updatedAt: now })
          .where(eq(payouts.id, id))
          .returning();

        await tx
          .update(commissions)
          .set({ status: "paid", updatedAt: now })
          .where(eq(commissions.payoutBatchId, id));

        return payoutRow;
      });

      res.json({ payout: updated });
    } catch (err) {
      logger.error({ err }, "Failed to mark payout paid");
      res.status(500).json({ error: "Failed to mark payout paid" });
    }
  });

  return router;
}
