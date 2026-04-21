// ---------------------------------------------------------------------------
// Affiliate Marketer System API Routes
// ---------------------------------------------------------------------------

import { Router } from "express";
import { eq, and, ilike, count, sql, isNull, gt, desc, inArray, gte, lte } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import { scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "@paperclipai/db";
import {
  affiliates,
  partnerCompanies,
  referralAttribution,
  commissions,
  payouts,
  crmActivities,
  attributionOverrides,
  authUsers,
} from "@paperclipai/db";
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

// ── Lead-status case conversion ───────────────────────────────────────────────
// DB stores lowercase snake_case ("demo_scheduled"). UI uses TitleCase
// ("DemoScheduled"). Convert at the admin API boundary.

function toUiStatus(snake: string | null | undefined): string {
  if (!snake) return "";
  return snake.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
}

function toDbStatus(titleCase: string): string {
  return titleCase.replace(/([A-Z])/g, (_, c: string, i: number) =>
    i === 0 ? c.toLowerCase() : "_" + c.toLowerCase(),
  );
}

// Allowed forward transitions per CRM spec. DuplicateReview, Nurture, Expired
// act as sinks or rejoin points; Won/Lost are terminals (reopenable only via
// explicit admin override which bypasses this map).
const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted", "rejected"],
  submitted: ["enriched", "duplicate_review", "qualified", "rejected", "expired"],
  enriched: ["duplicate_review", "qualified", "rejected"],
  duplicate_review: ["qualified", "rejected", "locked"],
  qualified: ["locked", "assigned", "rejected"],
  rejected: ["nurture"],
  locked: ["assigned", "expired"],
  assigned: ["contacted", "nurture"],
  contacted: ["awaiting_response", "interested", "nurture", "lost"],
  awaiting_response: ["interested", "contacted", "nurture", "lost"],
  interested: ["demo_scheduled", "proposal_sent", "nurture", "lost"],
  demo_scheduled: ["proposal_sent", "negotiation", "nurture", "lost"],
  proposal_sent: ["negotiation", "won", "lost", "nurture"],
  negotiation: ["won", "lost", "nurture"],
  won: [],
  lost: ["nurture"],
  nurture: ["contacted", "expired"],
  expired: [],
};

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

      const [[prospectResult], [convertedResult]] = await Promise.all([
        db.select({ count: count() }).from(partnerCompanies).where(affiliateWhere),
        db
          .select({ count: count() })
          .from(partnerCompanies)
          .where(and(eq(partnerCompanies.affiliateId, id), eq(partnerCompanies.companyId, COMPANY_ID), eq(partnerCompanies.isPaying, true))),
      ]);

      const prospectCount = Number(prospectResult?.count ?? 0);
      const convertedCount = Number(convertedResult?.count ?? 0);

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
        firstTouchStatus?: boolean;
        firstTouchType?: string;
        firstTouchDate?: string;
        firstTouchNotes?: string;
        relationshipWarmth?: string;
        closePreference?: string;
      };
      const {
        website,
        firstTouchStatus,
        firstTouchType,
        firstTouchDate,
        firstTouchNotes,
        relationshipWarmth,
        closePreference,
      } = body;

      if (!website) {
        res.status(400).json({ error: "website is required" });
        return;
      }

      if (affiliateStatus !== "active") {
        res.status(403).json({ error: "Account must be active to add prospects" });
        return;
      }

      // Phase 4 — hard-block suspended affiliates. JWT middleware gates the
      // session-level suspendedAt check; re-check here for defense in depth
      // in case the column was updated between JWT issue and this request.
      const [suspensionCheck] = await db
        .select({
          suspendedAt: affiliates.suspendedAt,
          suspensionReason: affiliates.suspensionReason,
        })
        .from(affiliates)
        .where(eq(affiliates.id, affiliateId))
        .limit(1);
      if (suspensionCheck?.suspendedAt) {
        res.status(403).json({
          error: "Account suspended",
          reason: suspensionCheck.suspensionReason ?? null,
        });
        return;
      }

      const VALID_TOUCH_TYPES = ["in_person", "call", "text", "email", "social_dm"];
      const VALID_WARMTH = ["strong", "medium", "weak"];
      const VALID_CLOSE_PREFERENCES = ["cd_closes", "affiliate_assists", "affiliate_attempts_first"];

      if (firstTouchStatus !== undefined && typeof firstTouchStatus !== "boolean") {
        res.status(400).json({ error: "firstTouchStatus must be a boolean" });
        return;
      }
      if (firstTouchType !== undefined && !VALID_TOUCH_TYPES.includes(firstTouchType)) {
        res.status(400).json({ error: `firstTouchType must be one of: ${VALID_TOUCH_TYPES.join(", ")}` });
        return;
      }
      if (relationshipWarmth !== undefined && !VALID_WARMTH.includes(relationshipWarmth)) {
        res.status(400).json({ error: `relationshipWarmth must be one of: ${VALID_WARMTH.join(", ")}` });
        return;
      }
      if (firstTouchNotes !== undefined && typeof firstTouchNotes !== "string") {
        res.status(400).json({ error: "firstTouchNotes must be a string" });
        return;
      }
      if (closePreference !== undefined && !VALID_CLOSE_PREFERENCES.includes(closePreference)) {
        res.status(400).json({ error: `closePreference must be one of: ${VALID_CLOSE_PREFERENCES.join(", ")}` });
        return;
      }

      let firstTouchDateParsed: Date | null = null;
      if (firstTouchDate) {
        const d = new Date(firstTouchDate);
        if (isNaN(d.getTime())) {
          res.status(400).json({ error: "firstTouchDate must be a valid ISO date string" });
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
          firstTouchLogged: firstTouchStatus ?? false,
          firstTouchType: firstTouchType ?? null,
          firstTouchDate: firstTouchDateParsed,
          firstTouchNotes: firstTouchNotes ?? null,
          relationshipWarmth: relationshipWarmth ?? null,
          affiliateClosePreference: closePreference ?? null,
        });

        await db
          .update(partnerCompanies)
          .set({ leadStatus: "submitted", pipelineEnteredAt: now, lastActivityAt: now, updatedAt: now })
          .where(eq(partnerCompanies.id, dup.id));

        await db.insert(crmActivities).values({
          leadId: dup.id,
          actorType: "affiliate",
          actorId: affiliateId,
          activityType: "status_change",
          toStatus: "submitted",
          note: "Lead resubmitted",
          visibleToAffiliate: true,
        });

        if (closePreference === "affiliate_attempts_first") {
          logger.warn(
            { leadId: dup.id, slug: dup.slug, affiliateId },
            "affiliate-prospect: affiliate_attempts_first close preference — admin review needed",
          );
        }

        // Phase 4 — stamp lastLeadSubmittedAt for inactive-reengagement cron.
        await db
          .update(affiliates)
          .set({ lastLeadSubmittedAt: now, updatedAt: now })
          .where(eq(affiliates.id, affiliateId));

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
        firstTouchLogged: firstTouchStatus ?? false,
        firstTouchType: firstTouchType ?? null,
        firstTouchDate: firstTouchDateParsed,
        firstTouchNotes: firstTouchNotes ?? null,
        relationshipWarmth: relationshipWarmth ?? null,
        affiliateClosePreference: closePreference ?? null,
      });

      await db
        .update(partnerCompanies)
        .set({
          leadStatus: "submitted",
          pipelineEnteredAt: attributionNow,
          lastActivityAt: attributionNow,
          updatedAt: attributionNow,
        })
        .where(eq(partnerCompanies.id, partner.id));

      await db.insert(crmActivities).values({
        leadId: partner.id,
        actorType: "affiliate",
        actorId: affiliateId,
        activityType: "status_change",
        toStatus: "submitted",
        note: "Lead submitted",
        visibleToAffiliate: true,
      });

      if (closePreference === "affiliate_attempts_first") {
        logger.warn(
          { leadId: partner.id, slug: partner.slug, affiliateId },
          "affiliate-prospect: affiliate_attempts_first close preference — admin review needed",
        );
      }

      // Fire-and-forget onboarding
      runPartnerOnboarding(db, partner.slug).catch((err) =>
        logger.error({ err, slug: partner!.slug }, "Affiliate prospect onboarding failed"),
      );

      // Phase 4 — stamp lastLeadSubmittedAt for inactive-reengagement cron.
      await db
        .update(affiliates)
        .set({ lastLeadSubmittedAt: attributionNow, updatedAt: attributionNow })
        .where(eq(affiliates.id, affiliateId));

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

  // ── GET /leads/:id — Affiliate-facing lead detail ────────────────────────
  router.get("/leads/:id", authMiddleware, async (req, res) => {
    try {
      const id = req.params.id as string;
      const affiliateId = req.affiliateClaims!.sub;

      const [row] = await db
        .select({
          id: partnerCompanies.id,
          name: partnerCompanies.name,
          slug: partnerCompanies.slug,
          website: partnerCompanies.website,
          industry: partnerCompanies.industry,
          location: partnerCompanies.location,
          leadStatus: partnerCompanies.leadStatus,
          lastActivityAt: partnerCompanies.lastActivityAt,
          createdAt: partnerCompanies.createdAt,
          attributionAffiliateId: referralAttribution.affiliateId,
          lockReleasedAt: referralAttribution.lockReleasedAt,
        })
        .from(partnerCompanies)
        .leftJoin(
          referralAttribution,
          and(
            eq(referralAttribution.leadId, partnerCompanies.id),
            isNull(referralAttribution.lockReleasedAt),
          ),
        )
        .where(eq(partnerCompanies.id, id))
        .limit(1);

      if (!row || row.attributionAffiliateId !== affiliateId) {
        res.status(404).json({ error: "Lead not found" });
        return;
      }

      res.json({
        lead: {
          id: row.id,
          name: row.name,
          slug: row.slug,
          website: row.website,
          industry: row.industry,
          location: row.location,
          pipelineStage: row.leadStatus,
          lastActivityAt: row.lastActivityAt ? row.lastActivityAt.toISOString() : null,
          createdAt: row.createdAt.toISOString(),
        },
      });
    } catch (err) {
      logger.error({ err }, "Failed to fetch affiliate lead");
      res.status(500).json({ error: "Failed to fetch lead" });
    }
  });

  // ── GET /leads/:id/timeline — Affiliate-visible activity feed ────────────
  router.get("/leads/:id/timeline", authMiddleware, async (req, res) => {
    try {
      const id = req.params.id as string;
      const affiliateId = req.affiliateClaims!.sub;

      const [owner] = await db
        .select({ affiliateId: referralAttribution.affiliateId })
        .from(referralAttribution)
        .where(
          and(
            eq(referralAttribution.leadId, id),
            isNull(referralAttribution.lockReleasedAt),
          ),
        )
        .limit(1);

      if (!owner || owner.affiliateId !== affiliateId) {
        res.status(404).json({ error: "Lead not found" });
        return;
      }

      const [leadRow] = await db
        .select({
          id: partnerCompanies.id,
          name: partnerCompanies.name,
          slug: partnerCompanies.slug,
          website: partnerCompanies.website,
          industry: partnerCompanies.industry,
          location: partnerCompanies.location,
          leadStatus: partnerCompanies.leadStatus,
          lastActivityAt: partnerCompanies.lastActivityAt,
          createdAt: partnerCompanies.createdAt,
        })
        .from(partnerCompanies)
        .where(eq(partnerCompanies.id, id))
        .limit(1);

      if (!leadRow) {
        res.status(404).json({ error: "Lead not found" });
        return;
      }

      const acts = await db
        .select({
          id: crmActivities.id,
          actorType: crmActivities.actorType,
          activityType: crmActivities.activityType,
          note: crmActivities.note,
          createdAt: crmActivities.createdAt,
        })
        .from(crmActivities)
        .where(
          and(
            eq(crmActivities.leadId, id),
            eq(crmActivities.visibleToAffiliate, true),
          ),
        )
        .orderBy(desc(crmActivities.createdAt));

      res.json({
        lead: {
          id: leadRow.id,
          name: leadRow.name,
          slug: leadRow.slug,
          website: leadRow.website,
          industry: leadRow.industry,
          location: leadRow.location,
          pipelineStage: leadRow.leadStatus,
          lastActivityAt: leadRow.lastActivityAt ? leadRow.lastActivityAt.toISOString() : null,
          createdAt: leadRow.createdAt.toISOString(),
        },
        activities: acts.map((a) => ({
          id: a.id,
          actorType: a.actorType,
          activityType: a.activityType,
          note: a.note,
          timestamp: a.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      logger.error({ err }, "Failed to fetch lead timeline");
      res.status(500).json({ error: "Failed to fetch timeline" });
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

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 3 — CRM pipeline + attribution console
  // ───────────────────────────────────────────────────────────────────────────

  // GET /leads — list with filters
  router.get("/leads", async (req, res) => {
    try {
      assertBoard(req);

      const rawLimit = Number(req.query.limit);
      const rawOffset = Number(req.query.offset);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.max(Math.floor(rawLimit), 1), 200) : 50;
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;

      const statusFilter = req.query.status as string | undefined;
      const repFilter = req.query.assignedRepId as string | undefined;
      const affiliateFilter = req.query.affiliateId as string | undefined;
      const attrFilter = req.query.attributionType as string | undefined;

      const conds: ReturnType<typeof eq>[] = [eq(partnerCompanies.companyId, COMPANY_ID)];
      if (statusFilter) conds.push(eq(partnerCompanies.leadStatus, toDbStatus(statusFilter)));
      if (repFilter) conds.push(eq(partnerCompanies.assignedRepId, repFilter));
      if (affiliateFilter) conds.push(eq(partnerCompanies.affiliateId, affiliateFilter));
      if (attrFilter) conds.push(eq(referralAttribution.attributionType, attrFilter));

      const rows = await db
        .select({
          id: partnerCompanies.id,
          leadName: partnerCompanies.name,
          leadStatus: partnerCompanies.leadStatus,
          assignedRepId: partnerCompanies.assignedRepId,
          pipelineEnteredAt: partnerCompanies.pipelineEnteredAt,
          lastActivityAt: partnerCompanies.lastActivityAt,
          createdAt: partnerCompanies.createdAt,
          affiliateId: referralAttribution.affiliateId,
          affiliateName: affiliates.name,
          attributionType: referralAttribution.attributionType,
        })
        .from(partnerCompanies)
        .leftJoin(
          referralAttribution,
          and(
            eq(referralAttribution.leadId, partnerCompanies.id),
            isNull(referralAttribution.lockReleasedAt),
          ),
        )
        .leftJoin(affiliates, eq(affiliates.id, referralAttribution.affiliateId))
        .where(and(...conds))
        .orderBy(desc(partnerCompanies.lastActivityAt))
        .limit(limit)
        .offset(offset);

      const [{ total } = { total: 0 }] = await db
        .select({ total: count() })
        .from(partnerCompanies)
        .leftJoin(
          referralAttribution,
          and(
            eq(referralAttribution.leadId, partnerCompanies.id),
            isNull(referralAttribution.lockReleasedAt),
          ),
        )
        .where(and(...conds));

      const reps = new Map<string, string>();
      const repIds = rows.map((r) => r.assignedRepId).filter((x): x is string => !!x);
      if (repIds.length > 0) {
        const repRows = await db
          .select({ id: authUsers.id, name: authUsers.name })
          .from(authUsers)
          .where(inArray(authUsers.id, repIds));
        for (const r of repRows) reps.set(r.id, r.name);
      }

      res.json({
        leads: rows.map((r) => ({
          id: r.id,
          affiliateId: r.affiliateId ?? "",
          affiliateName: r.affiliateName ?? "",
          leadName: r.leadName,
          status: toUiStatus(r.leadStatus),
          attributionType: r.attributionType ?? "",
          assignedRepId: r.assignedRepId,
          assignedRepName: r.assignedRepId ? reps.get(r.assignedRepId) ?? null : null,
          pipelineEnteredAt: (r.pipelineEnteredAt ?? r.createdAt).toISOString(),
          lastActivityAt: r.lastActivityAt ? r.lastActivityAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
          isDuplicate: r.leadStatus === "duplicate_review",
          duplicateOfLeadId: null,
        })),
        total: Number(total),
        limit,
        offset,
      });
    } catch (err) {
      logger.error({ err }, "Failed to list leads");
      res.status(500).json({ error: "Failed to list leads" });
    }
  });

  // GET /leads/:id — full detail
  router.get("/leads/:id", async (req, res) => {
    try {
      assertBoard(req);
      const id = req.params.id as string;

      const [row] = await db
        .select({
          id: partnerCompanies.id,
          leadName: partnerCompanies.name,
          website: partnerCompanies.website,
          industry: partnerCompanies.industry,
          location: partnerCompanies.location,
          description: partnerCompanies.description,
          affiliateNotes: partnerCompanies.affiliateNotes,
          storeNotes: partnerCompanies.storeNotes,
          leadStatus: partnerCompanies.leadStatus,
          assignedRepId: partnerCompanies.assignedRepId,
          pipelineEnteredAt: partnerCompanies.pipelineEnteredAt,
          lastActivityAt: partnerCompanies.lastActivityAt,
          createdAt: partnerCompanies.createdAt,
          affiliateId: referralAttribution.affiliateId,
          attributionType: referralAttribution.attributionType,
          firstTouchType: referralAttribution.firstTouchType,
          firstTouchDate: referralAttribution.firstTouchDate,
          firstTouchNotes: referralAttribution.firstTouchNotes,
          relationshipWarmth: referralAttribution.relationshipWarmth,
          affiliateClosePreference: referralAttribution.affiliateClosePreference,
          affiliateName: affiliates.name,
        })
        .from(partnerCompanies)
        .leftJoin(
          referralAttribution,
          and(
            eq(referralAttribution.leadId, partnerCompanies.id),
            isNull(referralAttribution.lockReleasedAt),
          ),
        )
        .leftJoin(affiliates, eq(affiliates.id, referralAttribution.affiliateId))
        .where(eq(partnerCompanies.id, id))
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Lead not found" });
        return;
      }

      const acts = await db
        .select()
        .from(crmActivities)
        .where(eq(crmActivities.leadId, id))
        .orderBy(desc(crmActivities.createdAt));

      const overrides = await db
        .select()
        .from(attributionOverrides)
        .where(eq(attributionOverrides.leadId, id))
        .orderBy(desc(attributionOverrides.createdAt));

      const repName = row.assignedRepId
        ? (
            await db
              .select({ name: authUsers.name })
              .from(authUsers)
              .where(eq(authUsers.id, row.assignedRepId))
              .limit(1)
          )[0]?.name ?? null
        : null;

      res.json({
        lead: {
          id: row.id,
          affiliateId: row.affiliateId ?? "",
          affiliateName: row.affiliateName ?? "",
          leadName: row.leadName,
          website: row.website,
          industry: row.industry,
          location: row.location,
          description: row.description,
          affiliateNotes: row.affiliateNotes,
          storeNotes: row.storeNotes,
          status: toUiStatus(row.leadStatus),
          attributionType: row.attributionType ?? "",
          assignedRepId: row.assignedRepId,
          assignedRepName: repName,
          pipelineEnteredAt: (row.pipelineEnteredAt ?? row.createdAt).toISOString(),
          lastActivityAt: row.lastActivityAt ? row.lastActivityAt.toISOString() : null,
          createdAt: row.createdAt.toISOString(),
          isDuplicate: row.leadStatus === "duplicate_review",
          duplicateOfLeadId: null,
          firstTouch: {
            type: row.firstTouchType,
            date: row.firstTouchDate ? row.firstTouchDate.toISOString() : null,
            notes: row.firstTouchNotes,
            warmth: row.relationshipWarmth,
            closePath: row.affiliateClosePreference,
          },
          activities: acts.map((a) => ({
            id: a.id,
            leadId: a.leadId,
            type: a.activityType,
            actorType: a.actorType,
            actorName: null,
            note: a.note,
            metadata: a.fromStatus || a.toStatus ? { fromStatus: a.fromStatus, toStatus: a.toStatus } : null,
            visibleToAffiliate: a.visibleToAffiliate,
            createdAt: a.createdAt.toISOString(),
          })),
          attributionHistory: overrides.map((o) => ({
            id: o.id,
            leadId: o.leadId,
            previousType: "",
            newType: o.overrideType,
            previousAffiliateId: o.previousAffiliateId,
            newAffiliateId: o.newAffiliateId,
            reason: o.reason,
            adminName: null,
            createdAt: o.createdAt.toISOString(),
          })),
        },
      });
    } catch (err) {
      logger.error({ err }, "Failed to fetch lead detail");
      res.status(500).json({ error: "Failed to fetch lead" });
    }
  });

  // PUT /leads/:id/status — transition with validation + activity log
  router.put("/leads/:id/status", async (req, res) => {
    try {
      assertBoard(req);
      const id = req.params.id as string;
      const { toStatus, note } = req.body as { toStatus?: string; note?: string };

      if (!toStatus) {
        res.status(400).json({ error: "toStatus is required" });
        return;
      }
      const toDb = toDbStatus(toStatus);

      const [cur] = await db
        .select({ leadStatus: partnerCompanies.leadStatus })
        .from(partnerCompanies)
        .where(eq(partnerCompanies.id, id))
        .limit(1);
      if (!cur) {
        res.status(404).json({ error: "Lead not found" });
        return;
      }

      const from = cur.leadStatus;
      const allowed = STATUS_TRANSITIONS[from] ?? [];
      if (from !== toDb && !allowed.includes(toDb)) {
        res.status(409).json({
          error: `Invalid transition ${toUiStatus(from)} -> ${toStatus}`,
          code: "INVALID_STATUS_TRANSITION",
        });
        return;
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(partnerCompanies)
          .set({
            leadStatus: toDb,
            pipelineEnteredAt: from === toDb ? partnerCompanies.pipelineEnteredAt : now,
            lastActivityAt: now,
            updatedAt: now,
          })
          .where(eq(partnerCompanies.id, id));

        await tx.insert(crmActivities).values({
          leadId: id,
          actorType: "admin",
          actorId: null,
          activityType: "status_change",
          fromStatus: from,
          toStatus: toDb,
          note: note ?? null,
          visibleToAffiliate: true,
        });
      });

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to transition lead status");
      res.status(500).json({ error: "Failed to transition status" });
    }
  });

  // PUT /leads/:id/assign — assign rep
  router.put("/leads/:id/assign", async (req, res) => {
    try {
      assertBoard(req);
      const id = req.params.id as string;
      const { repId } = req.body as { repId?: string | null };

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(partnerCompanies)
          .set({ assignedRepId: repId ?? null, lastActivityAt: now, updatedAt: now })
          .where(eq(partnerCompanies.id, id));
        await tx.insert(crmActivities).values({
          leadId: id,
          actorType: "admin",
          activityType: "assignment",
          note: repId ? `Assigned rep ${repId}` : "Unassigned",
          visibleToAffiliate: false,
        });
      });

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to assign rep");
      res.status(500).json({ error: "Failed to assign rep" });
    }
  });

  // POST /leads/:id/notes — add a note activity
  router.post("/leads/:id/notes", async (req, res) => {
    try {
      assertBoard(req);
      const id = req.params.id as string;
      const { note, visibleToAffiliate } = req.body as { note?: string; visibleToAffiliate?: boolean };

      if (!note || typeof note !== "string") {
        res.status(400).json({ error: "note is required" });
        return;
      }

      const now = new Date();
      const [act] = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(crmActivities)
          .values({
            leadId: id,
            actorType: "admin",
            activityType: "note",
            note,
            visibleToAffiliate: visibleToAffiliate ?? false,
          })
          .returning();
        await tx
          .update(partnerCompanies)
          .set({ lastActivityAt: now, updatedAt: now })
          .where(eq(partnerCompanies.id, id));
        return inserted;
      });

      res.json({
        ok: true,
        activity: {
          id: act.id,
          leadId: act.leadId,
          type: act.activityType,
          actorType: act.actorType,
          actorName: null,
          note: act.note,
          metadata: null,
          visibleToAffiliate: act.visibleToAffiliate,
          createdAt: act.createdAt.toISOString(),
        },
      });
    } catch (err) {
      logger.error({ err }, "Failed to add note");
      res.status(500).json({ error: "Failed to add note" });
    }
  });

  // PUT /leads/:id/attribution — override attribution type
  // Existing commissions are NOT re-rated — only future commissions inherit
  // the new type (webhook looks up attributionType at insert time).
  router.put("/leads/:id/attribution", async (req, res) => {
    try {
      assertBoard(req);
      const id = req.params.id as string;
      const { attributionType, reason } = req.body as { attributionType?: string; reason?: string };

      const VALID = [
        "affiliate_referred_cd_closed",
        "affiliate_assisted_cd_closed",
        "affiliate_led_cd_finalized",
        "cd_direct",
        "admin_override",
      ];
      if (!attributionType || !VALID.includes(attributionType)) {
        res.status(400).json({ error: `attributionType must be one of: ${VALID.join(", ")}` });
        return;
      }
      if (!reason) {
        res.status(400).json({ error: "reason is required" });
        return;
      }

      const [current] = await db
        .select({ id: referralAttribution.id, affiliateId: referralAttribution.affiliateId })
        .from(referralAttribution)
        .where(
          and(
            eq(referralAttribution.leadId, id),
            isNull(referralAttribution.lockReleasedAt),
          ),
        )
        .limit(1);
      if (!current) {
        res.status(404).json({ error: "No active attribution for lead" });
        return;
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(referralAttribution)
          .set({ attributionType, adminOverride: true, overrideReason: reason, updatedAt: now })
          .where(eq(referralAttribution.id, current.id));

        await tx.insert(attributionOverrides).values({
          leadId: id,
          previousAttributionId: current.id,
          newAttributionId: current.id,
          previousAffiliateId: current.affiliateId,
          newAffiliateId: current.affiliateId,
          overrideType: "type_change",
          reason,
          overriddenByUserId: (req as unknown as { user?: { id?: string } }).user?.id ?? "board",
        });

        await tx.insert(crmActivities).values({
          leadId: id,
          actorType: "admin",
          activityType: "attribution_change",
          note: `Attribution changed to ${attributionType}: ${reason}`,
          visibleToAffiliate: false,
        });

        await tx
          .update(partnerCompanies)
          .set({ lastActivityAt: now, updatedAt: now })
          .where(eq(partnerCompanies.id, id));
      });

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to override attribution");
      res.status(500).json({ error: "Failed to override attribution" });
    }
  });

  // POST /leads/:id/transfer — move ownership to a different affiliate
  router.post("/leads/:id/transfer", async (req, res) => {
    try {
      assertBoard(req);
      const id = req.params.id as string;
      const { newAffiliateId, reason } = req.body as { newAffiliateId?: string; reason?: string };

      if (!newAffiliateId || !reason) {
        res.status(400).json({ error: "newAffiliateId and reason are required" });
        return;
      }

      const [oldAtt] = await db
        .select({ id: referralAttribution.id, affiliateId: referralAttribution.affiliateId })
        .from(referralAttribution)
        .where(
          and(
            eq(referralAttribution.leadId, id),
            isNull(referralAttribution.lockReleasedAt),
          ),
        )
        .limit(1);

      const now = new Date();
      const lockExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      await db.transaction(async (tx) => {
        if (oldAtt) {
          await tx
            .update(referralAttribution)
            .set({ lockReleasedAt: now, adminOverride: true, overrideReason: reason, updatedAt: now })
            .where(eq(referralAttribution.id, oldAtt.id));
        }

        const [newAtt] = await tx
          .insert(referralAttribution)
          .values({
            leadId: id,
            affiliateId: newAffiliateId,
            attributionType: "admin_override",
            lockStartAt: now,
            lockExpiresAt,
            adminOverride: true,
            overrideReason: reason,
          })
          .returning({ id: referralAttribution.id });

        await tx.insert(attributionOverrides).values({
          leadId: id,
          previousAttributionId: oldAtt?.id ?? null,
          newAttributionId: newAtt.id,
          previousAffiliateId: oldAtt?.affiliateId ?? null,
          newAffiliateId,
          overrideType: "transfer",
          reason,
          overriddenByUserId: (req as unknown as { user?: { id?: string } }).user?.id ?? "board",
        });

        await tx
          .update(partnerCompanies)
          .set({ affiliateId: newAffiliateId, lastActivityAt: now, updatedAt: now })
          .where(eq(partnerCompanies.id, id));

        await tx.insert(crmActivities).values({
          leadId: id,
          actorType: "admin",
          activityType: "transfer",
          note: `Transferred from ${oldAtt?.affiliateId ?? "(none)"} to ${newAffiliateId}: ${reason}`,
          visibleToAffiliate: false,
        });
      });

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to transfer lead");
      res.status(500).json({ error: "Failed to transfer lead" });
    }
  });

  // POST /leads/:id/duplicate-resolve — resolve duplicate_review
  router.post("/leads/:id/duplicate-resolve", async (req, res) => {
    try {
      assertBoard(req);
      const id = req.params.id as string;
      const { winnerAffiliateId, reason } = req.body as { winnerAffiliateId?: string; reason?: string };

      if (!winnerAffiliateId || !reason) {
        res.status(400).json({ error: "winnerAffiliateId and reason are required" });
        return;
      }

      const activeAtts = await db
        .select({ id: referralAttribution.id, affiliateId: referralAttribution.affiliateId })
        .from(referralAttribution)
        .where(
          and(
            eq(referralAttribution.leadId, id),
            isNull(referralAttribution.lockReleasedAt),
          ),
        );

      const winner = activeAtts.find((a) => a.affiliateId === winnerAffiliateId);
      const losers = activeAtts.filter((a) => a.affiliateId !== winnerAffiliateId);

      if (!winner && activeAtts.length === 0) {
        res.status(404).json({ error: "No active attribution to resolve" });
        return;
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        for (const loser of losers) {
          await tx
            .update(referralAttribution)
            .set({ lockReleasedAt: now, adminOverride: true, overrideReason: reason, updatedAt: now })
            .where(eq(referralAttribution.id, loser.id));

          await tx.insert(attributionOverrides).values({
            leadId: id,
            previousAttributionId: loser.id,
            newAttributionId: winner?.id ?? null,
            previousAffiliateId: loser.affiliateId,
            newAffiliateId: winnerAffiliateId,
            overrideType: "duplicate_resolution",
            reason,
            overriddenByUserId: (req as unknown as { user?: { id?: string } }).user?.id ?? "board",
          });
        }

        await tx
          .update(partnerCompanies)
          .set({
            affiliateId: winnerAffiliateId,
            leadStatus: "qualified",
            pipelineEnteredAt: now,
            lastActivityAt: now,
            updatedAt: now,
          })
          .where(eq(partnerCompanies.id, id));

        await tx.insert(crmActivities).values({
          leadId: id,
          actorType: "admin",
          activityType: "status_change",
          fromStatus: "duplicate_review",
          toStatus: "qualified",
          note: `Duplicate resolved in favor of affiliate ${winnerAffiliateId}: ${reason}`,
          visibleToAffiliate: true,
        });
      });

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to resolve duplicate");
      res.status(500).json({ error: "Failed to resolve duplicate" });
    }
  });

  // GET /reps — minimal rep directory for the assign dropdown
  router.get("/reps", async (req, res) => {
    try {
      assertBoard(req);
      const rows = await db
        .select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
        .from(authUsers);
      res.json({ reps: rows });
    } catch (err) {
      logger.error({ err }, "Failed to list reps");
      res.status(500).json({ error: "Failed to list reps" });
    }
  });

  return router;
}
