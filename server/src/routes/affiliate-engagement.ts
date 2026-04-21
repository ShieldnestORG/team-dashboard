// ---------------------------------------------------------------------------
// Affiliate engagement — tier / leaderboard / promo / merch
//
// Two routers exported:
//   - affiliateEngagementRoutes(db): affiliate-facing (requireAffiliate)
//   - affiliateEngagementAdminRoutes(db): board-admin (assertBoard)
// ---------------------------------------------------------------------------

import { Router } from "express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  affiliates,
  affiliateEngagement,
  affiliateTiers,
  commissions,
  leaderboardSnapshots,
  merchRequests,
  promoCampaigns,
  type MerchShippingAddress,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { requireAffiliate } from "../middleware/affiliate-auth.js";
import { assertBoard } from "./authz.js";
import { HttpError } from "../errors.js";
import {
  sendTransactional,
  type EmailTemplate,
  type EmailVars,
} from "../services/email-templates.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function priorMonthKey(now: Date): string {
  const prior = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return monthKey(prior);
}

const VALID_MERCH_STATUSES = ["requested", "approved", "shipped", "canceled"] as const;
type MerchStatus = (typeof VALID_MERCH_STATUSES)[number];

// ---------------------------------------------------------------------------
// Affiliate-facing router
// ---------------------------------------------------------------------------

export function affiliateEngagementRoutes(db: Db): Router {
  const router = Router();
  // Engagement routes are mutating — default (allowSuspended: false) blocks
  // suspended affiliates. Dashboard read-only routes elsewhere can opt in.
  const auth = requireAffiliate(db);

  // ── GET /me/tier ─────────────────────────────────────────────────────────
  router.get("/me/tier", auth, async (req, res) => {
    try {
      const affiliateId = req.affiliateClaims!.sub;

      const [affiliateRow] = await db
        .select({
          id: affiliates.id,
          tier: affiliates.tier,
          tierUpgradedAt: affiliates.tierUpgradedAt,
          commissionRate: affiliates.commissionRate,
        })
        .from(affiliates)
        .where(eq(affiliates.id, affiliateId))
        .limit(1);

      if (!affiliateRow) {
        res.status(404).json({ error: "Affiliate not found" });
        return;
      }

      const allTiers = await db
        .select()
        .from(affiliateTiers)
        .orderBy(asc(affiliateTiers.displayOrder));

      const currentTier = allTiers.find((t) => t.name === affiliateRow.tier);
      const nextTier = allTiers.find(
        (t) => (currentTier ? t.displayOrder > currentTier.displayOrder : true),
      );

      // Progress: lifetime paid commissions + count of active paying partners.
      const [lifetimeRow] = await db
        .select({
          lifetimeCents: sql<number>`coalesce(sum(${commissions.amountCents}), 0)::int`,
        })
        .from(commissions)
        .where(
          and(
            eq(commissions.affiliateId, affiliateId),
            eq(commissions.status, "paid"),
          ),
        );

      const [activeRow] = await db
        .select({
          activePartners: sql<number>`count(distinct ${commissions.leadId})::int`,
        })
        .from(commissions)
        .where(
          and(
            eq(commissions.affiliateId, affiliateId),
            inArray(commissions.status, ["approved", "paid", "scheduled_for_payout"]),
          ),
        );

      res.json({
        currentTier: currentTier ?? null,
        nextTier: nextTier ?? null,
        progress: {
          lifetimeCents: Number(lifetimeRow?.lifetimeCents ?? 0),
          activePartners: Number(activeRow?.activePartners ?? 0),
        },
        affiliate: {
          id: affiliateRow.id,
          tier: affiliateRow.tier,
          tierUpgradedAt: affiliateRow.tierUpgradedAt,
          commissionRate: affiliateRow.commissionRate,
        },
      });
    } catch (err) {
      logger.error({ err }, "Failed to load affiliate tier");
      res.status(500).json({ error: "Failed to load tier" });
    }
  });

  // ── GET /leaderboard?period=month|all_time ──────────────────────────────
  router.get("/leaderboard", auth, async (req, res) => {
    try {
      const affiliateId = req.affiliateClaims!.sub;
      const period = (req.query.period as string | undefined) ?? "month";

      if (period === "month") {
        const key = priorMonthKey(new Date());

        const snaps = await db
          .select({
            rank: leaderboardSnapshots.rank,
            affiliateId: leaderboardSnapshots.affiliateId,
            score: leaderboardSnapshots.score,
            affiliateName: affiliates.name,
          })
          .from(leaderboardSnapshots)
          .leftJoin(affiliates, eq(affiliates.id, leaderboardSnapshots.affiliateId))
          .where(eq(leaderboardSnapshots.period, key))
          .orderBy(asc(leaderboardSnapshots.rank))
          .limit(20);

        const [mine] = await db
          .select({
            rank: leaderboardSnapshots.rank,
            score: leaderboardSnapshots.score,
          })
          .from(leaderboardSnapshots)
          .where(
            and(
              eq(leaderboardSnapshots.period, key),
              eq(leaderboardSnapshots.affiliateId, affiliateId),
            ),
          )
          .limit(1);

        res.json({
          period: key,
          top: snaps,
          me: mine ?? null,
        });
        return;
      }

      if (period === "all_time") {
        // Live sum of commissions per affiliate. Use `paid` + `approved` as
        // the score denominator so top referrers stay visible even before
        // payout.
        const rows = await db
          .select({
            affiliateId: commissions.affiliateId,
            affiliateName: affiliates.name,
            score: sql<number>`coalesce(sum(${commissions.amountCents}), 0)::int`,
          })
          .from(commissions)
          .leftJoin(affiliates, eq(affiliates.id, commissions.affiliateId))
          .where(inArray(commissions.status, ["approved", "paid", "scheduled_for_payout"]))
          .groupBy(commissions.affiliateId, affiliates.name)
          .orderBy(desc(sql`coalesce(sum(${commissions.amountCents}), 0)`))
          .limit(20);

        const top = rows.map((r, idx) => ({
          rank: idx + 1,
          affiliateId: r.affiliateId,
          affiliateName: r.affiliateName,
          score: Number(r.score),
        }));

        // Compute the requester's rank via a separate aggregate + window query.
        const rankRows = await db
          .select({
            affiliateId: commissions.affiliateId,
            score: sql<number>`coalesce(sum(${commissions.amountCents}), 0)::int`,
          })
          .from(commissions)
          .where(inArray(commissions.status, ["approved", "paid", "scheduled_for_payout"]))
          .groupBy(commissions.affiliateId)
          .orderBy(desc(sql`coalesce(sum(${commissions.amountCents}), 0)`));

        const idx = rankRows.findIndex((r) => r.affiliateId === affiliateId);
        const me =
          idx >= 0
            ? { rank: idx + 1, score: Number(rankRows[idx]!.score) }
            : null;

        res.json({ period: "all_time", top, me });
        return;
      }

      res
        .status(400)
        .json({ error: "period must be one of: month, all_time" });
    } catch (err) {
      logger.error({ err }, "Failed to load leaderboard");
      res.status(500).json({ error: "Failed to load leaderboard" });
    }
  });

  // ── GET /promo/campaigns — active campaigns ──────────────────────────────
  router.get("/promo/campaigns", auth, async (_req, res) => {
    try {
      const now = new Date();
      const rows = await db
        .select()
        .from(promoCampaigns)
        .where(
          and(
            eq(promoCampaigns.status, "live"),
            lte(promoCampaigns.startAt, now),
            gte(promoCampaigns.endAt, now),
          ),
        )
        .orderBy(asc(promoCampaigns.endAt));

      res.json({ campaigns: rows });
    } catch (err) {
      logger.error({ err }, "Failed to list active campaigns");
      res.status(500).json({ error: "Failed to list campaigns" });
    }
  });

  // ── POST /promo/posts ────────────────────────────────────────────────────
  router.post("/promo/posts", auth, async (req, res) => {
    try {
      const affiliateId = req.affiliateClaims!.sub;
      const { campaignId, postUrl, hashtagUsed } = req.body as {
        campaignId?: string;
        postUrl?: string;
        hashtagUsed?: string;
      };

      if (!campaignId || !postUrl) {
        res.status(400).json({ error: "campaignId and postUrl are required" });
        return;
      }

      try {
        new URL(postUrl);
      } catch {
        res.status(400).json({ error: "postUrl must be a valid URL" });
        return;
      }

      const [campaign] = await db
        .select({ id: promoCampaigns.id })
        .from(promoCampaigns)
        .where(eq(promoCampaigns.id, campaignId))
        .limit(1);
      if (!campaign) {
        res.status(404).json({ error: "Campaign not found" });
        return;
      }

      const [inserted] = await db
        .insert(affiliateEngagement)
        .values({
          affiliateId,
          campaignId,
          kind: "post",
          postUrl,
          hashtagUsed: hashtagUsed ?? null,
        })
        .returning();

      res.status(201).json({ engagement: inserted });
    } catch (err) {
      logger.error({ err }, "Failed to submit promo post");
      res.status(500).json({ error: "Failed to submit post" });
    }
  });

  // ── POST /merch-requests ─────────────────────────────────────────────────
  router.post("/merch-requests", auth, async (req, res) => {
    try {
      const affiliateId = req.affiliateClaims!.sub;
      const { itemType, sizeOrVariant, shippingAddress } = req.body as {
        itemType?: string;
        sizeOrVariant?: string;
        shippingAddress?: MerchShippingAddress;
      };

      if (!itemType || !shippingAddress) {
        res
          .status(400)
          .json({ error: "itemType and shippingAddress are required" });
        return;
      }
      const addr = shippingAddress;
      if (
        typeof addr !== "object" ||
        !addr.name ||
        !addr.street1 ||
        !addr.city ||
        !addr.region ||
        !addr.postalCode ||
        !addr.country
      ) {
        res.status(400).json({
          error:
            "shippingAddress must include name, street1, city, region, postalCode, country",
        });
        return;
      }

      // Rate limit — reject if any non-canceled request in the last 90 days.
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const [recent] = await db
        .select({ id: merchRequests.id, createdAt: merchRequests.createdAt })
        .from(merchRequests)
        .where(
          and(
            eq(merchRequests.affiliateId, affiliateId),
            gt(merchRequests.createdAt, cutoff),
            sql`${merchRequests.status} != 'canceled'`,
          ),
        )
        .limit(1);

      if (recent) {
        res.status(429).json({
          error: "Merch is rate-limited to one request per 90 days.",
          lastRequestedAt: recent.createdAt,
        });
        return;
      }

      const [inserted] = await db
        .insert(merchRequests)
        .values({
          affiliateId,
          itemType,
          sizeOrVariant: sizeOrVariant ?? null,
          shippingAddress: addr,
          status: "requested",
        })
        .returning();

      res.status(201).json({ merchRequest: inserted });
    } catch (err) {
      logger.error({ err }, "Failed to create merch request");
      res.status(500).json({ error: "Failed to create merch request" });
    }
  });

  // ── GET /merch-requests — own history ────────────────────────────────────
  router.get("/merch-requests", auth, async (req, res) => {
    try {
      const affiliateId = req.affiliateClaims!.sub;
      const rows = await db
        .select()
        .from(merchRequests)
        .where(eq(merchRequests.affiliateId, affiliateId))
        .orderBy(desc(merchRequests.createdAt));
      res.json({ merchRequests: rows });
    } catch (err) {
      logger.error({ err }, "Failed to list merch requests");
      res.status(500).json({ error: "Failed to list merch requests" });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Admin router
// ---------------------------------------------------------------------------

export function affiliateEngagementAdminRoutes(db: Db): Router {
  const router = Router();

  // ── GET /tiers ───────────────────────────────────────────────────────────
  router.get("/tiers", async (req, res) => {
    try {
      assertBoard(req);
      const rows = await db
        .select()
        .from(affiliateTiers)
        .orderBy(asc(affiliateTiers.displayOrder));
      res.json({ tiers: rows });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to list tiers");
      res.status(500).json({ error: "Failed to list tiers" });
    }
  });

  // ── PUT /tiers/:id ───────────────────────────────────────────────────────
  router.put("/tiers/:id", async (req, res) => {
    try {
      assertBoard(req);
      const id = req.params.id as string;
      const body = req.body as {
        name?: string;
        displayOrder?: number;
        commissionRate?: string | number;
        minLifetimeCents?: number;
        minActivePartners?: number;
        perks?: string[];
      };

      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.displayOrder !== undefined) patch.displayOrder = body.displayOrder;
      if (body.commissionRate !== undefined) {
        patch.commissionRate = String(body.commissionRate);
      }
      if (body.minLifetimeCents !== undefined) {
        patch.minLifetimeCents = body.minLifetimeCents;
      }
      if (body.minActivePartners !== undefined) {
        patch.minActivePartners = body.minActivePartners;
      }
      if (body.perks !== undefined) patch.perks = body.perks;

      if (Object.keys(patch).length === 0) {
        res.status(400).json({ error: "No fields to update" });
        return;
      }

      const [updated] = await db
        .update(affiliateTiers)
        .set(patch)
        .where(eq(affiliateTiers.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Tier not found" });
        return;
      }
      res.json({ tier: updated });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to update tier");
      res.status(500).json({ error: "Failed to update tier" });
    }
  });

  // ── GET /promo/campaigns ─────────────────────────────────────────────────
  router.get("/promo/campaigns", async (req, res) => {
    try {
      assertBoard(req);
      const rows = await db
        .select()
        .from(promoCampaigns)
        .orderBy(desc(promoCampaigns.startAt));
      res.json({ campaigns: rows });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to list campaigns (admin)");
      res.status(500).json({ error: "Failed to list campaigns" });
    }
  });

  // ── POST /promo/campaigns ────────────────────────────────────────────────
  router.post("/promo/campaigns", async (req, res) => {
    try {
      assertBoard(req);
      const body = req.body as {
        name?: string;
        hashtag?: string;
        startAt?: string;
        endAt?: string;
        giveawayPrize?: string;
        status?: string;
      };
      const { name, hashtag, startAt, endAt, giveawayPrize, status } = body;

      if (!name || !startAt || !endAt) {
        res
          .status(400)
          .json({ error: "name, startAt, and endAt are required" });
        return;
      }
      const start = new Date(startAt);
      const end = new Date(endAt);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({ error: "startAt and endAt must be ISO dates" });
        return;
      }

      const [inserted] = await db
        .insert(promoCampaigns)
        .values({
          name,
          hashtag: hashtag ?? null,
          startAt: start,
          endAt: end,
          giveawayPrize: giveawayPrize ?? null,
          status: status ?? "draft",
        })
        .returning();

      res.status(201).json({ campaign: inserted });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to create campaign");
      res.status(500).json({ error: "Failed to create campaign" });
    }
  });

  // ── PUT /promo/campaigns/:id ─────────────────────────────────────────────
  router.put("/promo/campaigns/:id", async (req, res) => {
    try {
      assertBoard(req);
      const id = req.params.id as string;
      const body = req.body as {
        name?: string;
        hashtag?: string | null;
        startAt?: string;
        endAt?: string;
        giveawayPrize?: string | null;
        status?: string;
      };

      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.hashtag !== undefined) patch.hashtag = body.hashtag;
      if (body.startAt !== undefined) {
        const d = new Date(body.startAt);
        if (isNaN(d.getTime())) {
          res.status(400).json({ error: "startAt must be ISO date" });
          return;
        }
        patch.startAt = d;
      }
      if (body.endAt !== undefined) {
        const d = new Date(body.endAt);
        if (isNaN(d.getTime())) {
          res.status(400).json({ error: "endAt must be ISO date" });
          return;
        }
        patch.endAt = d;
      }
      if (body.giveawayPrize !== undefined) patch.giveawayPrize = body.giveawayPrize;
      if (body.status !== undefined) patch.status = body.status;

      if (Object.keys(patch).length === 0) {
        res.status(400).json({ error: "No fields to update" });
        return;
      }

      const [updated] = await db
        .update(promoCampaigns)
        .set(patch)
        .where(eq(promoCampaigns.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Campaign not found" });
        return;
      }
      res.json({ campaign: updated });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to update campaign");
      res.status(500).json({ error: "Failed to update campaign" });
    }
  });

  // ── GET /engagement/posts?status=unscored ────────────────────────────────
  router.get("/engagement/posts", async (req, res) => {
    try {
      assertBoard(req);

      const rawLimit = Number(req.query.limit);
      const rawOffset = Number(req.query.offset);
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
          : 50;
      const offset =
        Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;

      const statusFilter = req.query.status as string | undefined;

      const conds = [eq(affiliateEngagement.kind, "post")] as ReturnType<typeof eq>[];
      if (statusFilter === "unscored") {
        conds.push(eq(affiliateEngagement.score, 0));
      }

      const baseQuery = db
        .select({
          id: affiliateEngagement.id,
          affiliateId: affiliateEngagement.affiliateId,
          affiliateName: affiliates.name,
          campaignId: affiliateEngagement.campaignId,
          postUrl: affiliateEngagement.postUrl,
          hashtagUsed: affiliateEngagement.hashtagUsed,
          score: affiliateEngagement.score,
          giveawayEligible: affiliateEngagement.giveawayEligible,
          occurredAt: affiliateEngagement.occurredAt,
        })
        .from(affiliateEngagement)
        .leftJoin(affiliates, eq(affiliates.id, affiliateEngagement.affiliateId))
        .where(and(...conds));

      const [rows, totalRows] = await Promise.all([
        baseQuery
          .orderBy(desc(affiliateEngagement.occurredAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ total: count() })
          .from(affiliateEngagement)
          .where(and(...conds)),
      ]);

      res.json({
        posts: rows,
        total: Number(totalRows[0]?.total ?? 0),
        limit,
        offset,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to list engagement posts");
      res.status(500).json({ error: "Failed to list posts" });
    }
  });

  // ── PUT /engagement/posts/:id/score ──────────────────────────────────────
  router.put("/engagement/posts/:id/score", async (req, res) => {
    try {
      assertBoard(req);
      const id = req.params.id as string;
      const { score, giveawayEligible } = req.body as {
        score?: number;
        giveawayEligible?: boolean;
      };

      if (typeof score !== "number" || !Number.isFinite(score)) {
        res.status(400).json({ error: "score must be a number" });
        return;
      }
      if (typeof giveawayEligible !== "boolean") {
        res.status(400).json({ error: "giveawayEligible must be a boolean" });
        return;
      }

      const [updated] = await db
        .update(affiliateEngagement)
        .set({ score: Math.floor(score), giveawayEligible })
        .where(eq(affiliateEngagement.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      res.json({ engagement: updated });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to score engagement post");
      res.status(500).json({ error: "Failed to score post" });
    }
  });

  // ── GET /merch-requests?status= ──────────────────────────────────────────
  router.get("/merch-requests", async (req, res) => {
    try {
      assertBoard(req);
      const statusFilter = req.query.status as string | undefined;

      const baseQuery = db
        .select({
          id: merchRequests.id,
          affiliateId: merchRequests.affiliateId,
          affiliateName: affiliates.name,
          affiliateEmail: affiliates.email,
          itemType: merchRequests.itemType,
          sizeOrVariant: merchRequests.sizeOrVariant,
          shippingAddress: merchRequests.shippingAddress,
          status: merchRequests.status,
          trackingNumber: merchRequests.trackingNumber,
          notes: merchRequests.notes,
          createdAt: merchRequests.createdAt,
          updatedAt: merchRequests.updatedAt,
        })
        .from(merchRequests)
        .leftJoin(affiliates, eq(affiliates.id, merchRequests.affiliateId));

      const rows = statusFilter
        ? await baseQuery
            .where(eq(merchRequests.status, statusFilter))
            .orderBy(desc(merchRequests.createdAt))
        : await baseQuery.orderBy(desc(merchRequests.createdAt));

      res.json({ merchRequests: rows });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to list merch requests (admin)");
      res.status(500).json({ error: "Failed to list merch requests" });
    }
  });

  // ── PUT /merch-requests/:id/status ───────────────────────────────────────
  router.put("/merch-requests/:id/status", async (req, res) => {
    try {
      assertBoard(req);
      const id = req.params.id as string;
      const body = req.body as {
        status?: MerchStatus;
        trackingNumber?: string | null;
        notes?: string | null;
      };
      const { status, trackingNumber, notes } = body;

      if (!status || !VALID_MERCH_STATUSES.includes(status)) {
        res.status(400).json({
          error: `status must be one of: ${VALID_MERCH_STATUSES.join(", ")}`,
        });
        return;
      }

      // Enforce transition: requested → approved → shipped (canceled from any
      // non-shipped state).
      const [existing] = await db
        .select({
          id: merchRequests.id,
          affiliateId: merchRequests.affiliateId,
          status: merchRequests.status,
        })
        .from(merchRequests)
        .where(eq(merchRequests.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Merch request not found" });
        return;
      }

      const allowed: Record<string, MerchStatus[]> = {
        requested: ["approved", "canceled"],
        approved: ["shipped", "canceled"],
        shipped: [],
        canceled: [],
      };
      const nextStates = allowed[existing.status] ?? [];
      if (!nextStates.includes(status)) {
        res.status(400).json({
          error: `Invalid transition: ${existing.status} -> ${status}`,
        });
        return;
      }

      const patch: Record<string, unknown> = {
        status,
        updatedAt: new Date(),
      };
      if (trackingNumber !== undefined) patch.trackingNumber = trackingNumber;
      if (notes !== undefined) patch.notes = notes;

      const [updated] = await db
        .update(merchRequests)
        .set(patch)
        .where(eq(merchRequests.id, id))
        .returning();

      if (status === "shipped") {
        // Notify affiliate — template owner is the email-templates author.
        // Cast the template name so this compiles before that template lands.
        try {
          const [affRow] = await db
            .select({ name: affiliates.name, email: affiliates.email })
            .from(affiliates)
            .where(eq(affiliates.id, existing.affiliateId))
            .limit(1);
          if (affRow?.email) {
            const vars: EmailVars = {
              recipientName: affRow.name,
              recipientEmail: affRow.email,
              affiliateName: affRow.name,
            };
            sendTransactional(
              "affiliate-merch-shipped" as EmailTemplate,
              affRow.email,
              vars,
            ).catch((err) =>
              logger.warn({ err }, "affiliate-merch-shipped email failed"),
            );
          }
        } catch (err) {
          logger.warn({ err }, "merch-shipped notification lookup failed");
        }
      }

      res.json({ merchRequest: updated });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to update merch request status");
      res.status(500).json({ error: "Failed to update merch request status" });
    }
  });

  return router;
}
