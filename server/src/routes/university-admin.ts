// ---------------------------------------------------------------------------
// University member admin — internal control-plane view of the Coherent Ones
// University membership product.
//
// Mounted at /api/university-admin by app.ts. Every route in this file is
// board-only (the storefront/member surfaces live in `university-checkout.ts`).
//
// Cloned from the Watchtower admin pattern (routes/watchtower-admin.ts) but
// adapted to the University member model (schema/university.ts):
//   - the entity is a MEMBER (university_members), not a subscription;
//   - each member has at most one billing record (university_subscriptions),
//     joined latest-first on member_id;
//   - "activity" for a member is DERIVED (joined event + current status +
//     recent community posts), NOT read from activity_log — see note below.
//
// Routes:
//   GET  /members?status=&q=           → member list (+ latest subscription)
//   GET  /members/:id                  → member detail (sub + posts + timeline)
//   POST /members/:id/cancel           → cancel member + sub (local DB only)
//   POST /members/:id/reactivate       → reactivate member + sub (local DB only)
//   POST /members/:id/refund           → record a refund (demo — no Stripe)
//   GET  /recovery                     → at-risk pipeline (past_due | cancelled)
//
// STATUS SEMANTICS — reused from services/university-stripe-handler.ts:
//   active | past_due | cancelled (University has NO 'paused' member state).
//   The cancel/reactivate handlers mirror handleUniversitySubscriptionDeleted /
//   handleUniversitySubscriptionUpdated's two-row write (member + subscription)
//   EXCEPT they act DIRECTLY on the local DB and never touch Stripe.
//
// WHY NO STRIPE: the synthetic demo members carry fake stripe ids
//   (cus_SYNTH_* / sub_SYNTH_*). A real Stripe API call against those would
//   404. Admin actions here therefore write straight to Postgres so the demo
//   actually works end-to-end. Search "SYNTHETIC/NO-STRIPE" below for the exact
//   bypass points.
//
// WHY NO activity_log WRITES/READS: activity_log.company_id is a NOT NULL FK to
//   companies.id, and the local demo DB has an EMPTY companies table. Calling
//   logActivity would throw a foreign-key violation and 500 the action. So this
//   route neither writes nor reads activity_log; the member timeline is
//   synthesized from the member's own rows instead. This keeps the demo honest
//   (Rule 10: fail loud, never silently break the action on a logging write).
// ---------------------------------------------------------------------------
import { Router } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  universityMembers,
  universitySubscriptions,
  universityCommunityPosts,
  universityCancelFeedback,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logAdminAccess } from "../middleware/log-admin-access.js";

// Hard cap on the member-list query. Pagination is deferred; we surface
// `truncated: true` so a big day doesn't silently swallow rows. Mirrors
// watchtower-admin's LIST_LIMIT.
const LIST_LIMIT = 500;

// The University statuses that count as "at risk" for the recovery pipeline.
const RECOVERY_STATUSES = ["past_due", "cancelled"] as const;

// Reused from university-stripe-handler.ts — the University member status set.
type UniversityStatus = "active" | "past_due" | "cancelled";

export function universityAdminRoutes(db: Db) {
  const router = Router();

  // Access-log middleware first (same as watchtower-admin) so unauth probes
  // still get a forensic row. admin_access_log has no company FK, so this is
  // safe in the local demo.
  router.use(logAdminAccess(db));

  // Board-only guard. Mirrors watchtower-admin / intel-billing inline pattern.
  router.use((req, res, next) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Admin only" });
      return;
    }
    next();
  });

  // ---- shared: latest subscription per member ----
  // A member has at most one live billing record in practice, but we defend
  // against duplicates by taking the most-recently-created row per member.
  async function latestSubsByMemberId(
    memberIds: string[],
  ): Promise<
    Map<
      string,
      {
        id: string;
        status: string | null;
        plan: string | null;
        currentPeriodEnd: Date | null;
        canceledAt: Date | null;
        stripeCustomerId: string | null;
        stripeSubscriptionId: string | null;
      }
    >
  > {
    const byMember = new Map<
      string,
      {
        id: string;
        status: string | null;
        plan: string | null;
        currentPeriodEnd: Date | null;
        canceledAt: Date | null;
        stripeCustomerId: string | null;
        stripeSubscriptionId: string | null;
      }
    >();
    if (memberIds.length === 0) return byMember;
    const rows = await db
      .select({
        id: universitySubscriptions.id,
        memberId: universitySubscriptions.memberId,
        status: universitySubscriptions.status,
        plan: universitySubscriptions.plan,
        currentPeriodEnd: universitySubscriptions.currentPeriodEnd,
        canceledAt: universitySubscriptions.canceledAt,
        stripeCustomerId: universitySubscriptions.stripeCustomerId,
        stripeSubscriptionId: universitySubscriptions.stripeSubscriptionId,
        createdAt: universitySubscriptions.createdAt,
      })
      .from(universitySubscriptions)
      .where(inArray(universitySubscriptions.memberId, memberIds))
      .orderBy(desc(universitySubscriptions.createdAt));
    for (const row of rows) {
      if (!row.memberId) continue;
      if (!byMember.has(row.memberId)) {
        byMember.set(row.memberId, {
          id: row.id,
          status: row.status,
          plan: row.plan,
          currentPeriodEnd: row.currentPeriodEnd,
          canceledAt: row.canceledAt,
          stripeCustomerId: row.stripeCustomerId,
          stripeSubscriptionId: row.stripeSubscriptionId,
        });
      }
    }
    return byMember;
  }

  // -------------------- GET /members?status=&q= --------------------
  router.get("/members", async (req, res) => {
    try {
      const statusFilter =
        typeof req.query.status === "string" && req.query.status.trim()
          ? req.query.status.trim()
          : null;
      const q =
        typeof req.query.q === "string" && req.query.q.trim()
          ? req.query.q.trim()
          : null;

      const conditions = [];
      if (statusFilter) {
        conditions.push(eq(universityMembers.status, statusFilter));
      }
      if (q) {
        const like = `%${q.toLowerCase()}%`;
        conditions.push(
          or(
            sql`LOWER(${universityMembers.email}) LIKE ${like}`,
            sql`LOWER(COALESCE(${universityMembers.displayName}, '')) LIKE ${like}`,
          ),
        );
      }

      const members = await db
        .select({
          id: universityMembers.id,
          email: universityMembers.email,
          displayName: universityMembers.displayName,
          status: universityMembers.status,
          plan: universityMembers.plan,
          joinedAt: universityMembers.joinedAt,
        })
        .from(universityMembers)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(universityMembers.createdAt))
        .limit(LIST_LIMIT);

      const subsByMember = await latestSubsByMemberId(members.map((m) => m.id));

      const out = members.map((m) => {
        const sub = subsByMember.get(m.id) ?? null;
        return {
          id: m.id,
          email: m.email,
          displayName: m.displayName,
          status: m.status,
          plan: m.plan,
          joinedAt: m.joinedAt,
          subscription: sub
            ? {
                status: sub.status,
                currentPeriodEnd: sub.currentPeriodEnd,
                canceledAt: sub.canceledAt,
              }
            : null,
        };
      });

      res.json({ members: out, truncated: members.length >= LIST_LIMIT });
    } catch (err) {
      logger.error({ err }, "university-admin: listMembers failed");
      res.status(500).json({ error: "Failed to list members" });
    }
  });

  // -------------------- GET /members/:id --------------------
  router.get("/members/:id", async (req, res) => {
    const memberId = req.params.id as string;
    try {
      const [member] = await db
        .select({
          id: universityMembers.id,
          accountId: universityMembers.accountId,
          email: universityMembers.email,
          displayName: universityMembers.displayName,
          status: universityMembers.status,
          plan: universityMembers.plan,
          joinedAt: universityMembers.joinedAt,
          createdAt: universityMembers.createdAt,
          updatedAt: universityMembers.updatedAt,
        })
        .from(universityMembers)
        .where(eq(universityMembers.id, memberId))
        .limit(1);

      if (!member) {
        res.status(404).json({ error: "Member not found" });
        return;
      }

      const subsByMember = await latestSubsByMemberId([member.id]);
      const sub = subsByMember.get(member.id) ?? null;

      // Recent community posts. Posts are joined by account_id (the canonical
      // key the seed uses; author_email kept as a durable fallback for members
      // whose account link hasn't resolved).
      const postConditions = [];
      if (member.accountId) {
        postConditions.push(
          eq(universityCommunityPosts.accountId, member.accountId),
        );
      }
      postConditions.push(
        sql`LOWER(${universityCommunityPosts.authorEmail}) = ${member.email.toLowerCase()}`,
      );

      const posts = await db
        .select({
          id: universityCommunityPosts.id,
          body: universityCommunityPosts.body,
          status: universityCommunityPosts.status,
          commentCount: universityCommunityPosts.commentCount,
          reactionCount: universityCommunityPosts.reactionCount,
          createdAt: universityCommunityPosts.createdAt,
        })
        .from(universityCommunityPosts)
        .where(or(...postConditions))
        .orderBy(desc(universityCommunityPosts.createdAt))
        .limit(20);

      // Synthesized timeline — derived from the member's own state, NOT from
      // activity_log (which is empty + has an unsatisfiable company FK in the
      // demo; see file header). Newest first.
      const timeline: Array<{
        at: Date | null;
        kind: string;
        label: string;
      }> = [];
      if (member.joinedAt) {
        timeline.push({
          at: member.joinedAt,
          kind: "joined",
          label: "Joined University",
        });
      }
      if (sub?.canceledAt) {
        timeline.push({
          at: sub.canceledAt,
          kind: "cancelled",
          label: "Subscription cancelled",
        });
      }
      timeline.push({
        at: member.updatedAt,
        kind: `status:${member.status}`,
        label: `Current status: ${member.status}`,
      });
      for (const p of posts.slice(0, 5)) {
        timeline.push({
          at: p.createdAt,
          kind: "community_post",
          label: `Posted in the community`,
        });
      }
      timeline.sort((a, b) => {
        const at = a.at ? new Date(a.at).getTime() : 0;
        const bt = b.at ? new Date(b.at).getTime() : 0;
        return bt - at;
      });

      res.json({
        member: {
          id: member.id,
          accountId: member.accountId,
          email: member.email,
          displayName: member.displayName,
          status: member.status,
          plan: member.plan,
          joinedAt: member.joinedAt,
          createdAt: member.createdAt,
        },
        subscription: sub
          ? {
              id: sub.id,
              status: sub.status,
              plan: sub.plan,
              currentPeriodEnd: sub.currentPeriodEnd,
              canceledAt: sub.canceledAt,
              stripeCustomerId: sub.stripeCustomerId,
              stripeSubscriptionId: sub.stripeSubscriptionId,
            }
          : null,
        posts,
        timeline,
      });
    } catch (err) {
      logger.error({ err, memberId }, "university-admin: getMember failed");
      res.status(500).json({ error: "Failed to load member" });
    }
  });

  // ---- shared: update member + its subscription status in one write ----
  // Mirrors the two-row write in university-stripe-handler.ts
  // (handleUniversitySubscriptionUpdated/Deleted) but DIRECT on the local DB —
  // SYNTHETIC/NO-STRIPE: the synthetic members' stripe ids are fake, so we
  // never round-trip Stripe; we set the status straight in Postgres.
  async function applyStatus(
    memberId: string,
    status: UniversityStatus,
    opts: { setCanceledAt: boolean; clearCanceledAt: boolean },
  ): Promise<boolean> {
    const now = new Date();

    // S1 (review fix): flip member + subscription atomically so a mid-action
    // failure can't leave the member half-cancelled / out of sync.
    return await db.transaction(async (tx) => {
      const [updatedMember] = await tx
        .update(universityMembers)
        .set({ status, updatedAt: now })
        .where(eq(universityMembers.id, memberId))
        .returning({ id: universityMembers.id });

      if (!updatedMember) return false;

      const subPatch: Record<string, unknown> = { status, updatedAt: now };
      if (opts.setCanceledAt) subPatch.canceledAt = now;
      if (opts.clearCanceledAt) subPatch.canceledAt = null;

      await tx
        .update(universitySubscriptions)
        .set(subPatch)
        .where(eq(universitySubscriptions.memberId, memberId));

      return true;
    });
  }

  // ---- shared: re-fetch the member in the list/detail shape after an action ----
  async function memberSummary(memberId: string) {
    const [m] = await db
      .select({
        id: universityMembers.id,
        email: universityMembers.email,
        displayName: universityMembers.displayName,
        status: universityMembers.status,
        plan: universityMembers.plan,
        joinedAt: universityMembers.joinedAt,
      })
      .from(universityMembers)
      .where(eq(universityMembers.id, memberId))
      .limit(1);
    if (!m) return null;
    const subsByMember = await latestSubsByMemberId([m.id]);
    const sub = subsByMember.get(m.id) ?? null;
    return {
      id: m.id,
      email: m.email,
      displayName: m.displayName,
      status: m.status,
      plan: m.plan,
      joinedAt: m.joinedAt,
      subscription: sub
        ? {
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd,
            canceledAt: sub.canceledAt,
          }
        : null,
    };
  }

  // -------------------- POST /members/:id/cancel --------------------
  router.post("/members/:id/cancel", async (req, res) => {
    const memberId = req.params.id as string;
    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 2000)
        : null;
    try {
      const [existing] = await db
        .select({ id: universityMembers.id, email: universityMembers.email, accountId: universityMembers.accountId })
        .from(universityMembers)
        .where(eq(universityMembers.id, memberId))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Member not found" });
        return;
      }

      const ok = await applyStatus(memberId, "cancelled", {
        setCanceledAt: true,
        clearCanceledAt: false,
      });
      if (!ok) {
        res.status(404).json({ error: "Member not found" });
        return;
      }

      // Honest cancel-reason storage — university_cancel_feedback is real and
      // has no company FK, so this write succeeds in the demo. Append-only.
      if (reason) {
        await db.insert(universityCancelFeedback).values({
          accountId: existing.accountId,
          email: existing.email.toLowerCase(),
          reason,
        });
      }

      const member = await memberSummary(memberId);
      res.json({ ok: true, member });
    } catch (err) {
      logger.error({ err, memberId }, "university-admin: cancel failed");
      res.status(500).json({ error: "Failed to cancel member" });
    }
  });

  // -------------------- POST /members/:id/reactivate --------------------
  router.post("/members/:id/reactivate", async (req, res) => {
    const memberId = req.params.id as string;
    try {
      const ok = await applyStatus(memberId, "active", {
        setCanceledAt: false,
        clearCanceledAt: true,
      });
      if (!ok) {
        res.status(404).json({ error: "Member not found" });
        return;
      }
      const member = await memberSummary(memberId);
      res.json({ ok: true, member });
    } catch (err) {
      logger.error({ err, memberId }, "university-admin: reactivate failed");
      res.status(500).json({ error: "Failed to reactivate member" });
    }
  });

  // -------------------- POST /members/:id/refund --------------------
  // DEMO refund. SYNTHETIC/NO-STRIPE: there is no Stripe call and no dedicated
  // university payments/ledger table in the schema, so there is nowhere to
  // durably persist a refund. We do NOT fabricate a record — we return an
  // honest "refund recorded (demo)" envelope and log the intent server-side.
  router.post("/members/:id/refund", async (req, res) => {
    const memberId = req.params.id as string;
    const rawAmount = req.body?.amount;
    const amount =
      typeof rawAmount === "number" && Number.isFinite(rawAmount) && rawAmount >= 0
        ? rawAmount
        : null;
    try {
      const [member] = await db
        .select({ id: universityMembers.id, email: universityMembers.email })
        .from(universityMembers)
        .where(eq(universityMembers.id, memberId))
        .limit(1);
      if (!member) {
        res.status(404).json({ error: "Member not found" });
        return;
      }

      logger.info(
        { memberId, email: member.email, amount },
        "university-admin: refund recorded (demo — no Stripe, no ledger table)",
      );

      res.json({
        ok: true,
        message: "refund recorded (demo)",
        memberId,
        amount,
      });
    } catch (err) {
      logger.error({ err, memberId }, "university-admin: refund failed");
      res.status(500).json({ error: "Failed to record refund" });
    }
  });

  // -------------------- GET /recovery --------------------
  // The at-risk pipeline: every member whose status is past_due | cancelled,
  // with their subscription info, newest first. This is the recovery view.
  router.get("/recovery", async (_req, res) => {
    try {
      const members = await db
        .select({
          id: universityMembers.id,
          email: universityMembers.email,
          displayName: universityMembers.displayName,
          status: universityMembers.status,
          plan: universityMembers.plan,
          joinedAt: universityMembers.joinedAt,
        })
        .from(universityMembers)
        .where(inArray(universityMembers.status, [...RECOVERY_STATUSES]))
        .orderBy(desc(universityMembers.updatedAt))
        .limit(LIST_LIMIT);

      const subsByMember = await latestSubsByMemberId(members.map((m) => m.id));

      const out = members.map((m) => {
        const sub = subsByMember.get(m.id) ?? null;
        return {
          id: m.id,
          email: m.email,
          displayName: m.displayName,
          status: m.status,
          plan: m.plan,
          joinedAt: m.joinedAt,
          subscription: sub
            ? {
                status: sub.status,
                currentPeriodEnd: sub.currentPeriodEnd,
                canceledAt: sub.canceledAt,
              }
            : null,
        };
      });

      res.json({ members: out });
    } catch (err) {
      logger.error({ err }, "university-admin: recovery failed");
      res.status(500).json({ error: "Failed to load recovery pipeline" });
    }
  });

  return router;
}
