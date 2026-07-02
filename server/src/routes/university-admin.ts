// ---------------------------------------------------------------------------
// University member admin — staff control-plane view of the Coherent Ones
// University membership product.
//
// Mounted at /api/university-admin by app.ts. Every route here is staff-only
// (the storefront/member surfaces live in `university-checkout.ts` and the
// member-facing portal in `portal.ts`).
//
// Cloned from the Watchtower admin pattern (routes/watchtower-admin.ts) but
// adapted to the University member model (schema/university.ts):
//   - the entity is a MEMBER (university_members), not a subscription;
//   - each member has at most one billing record (university_subscriptions),
//     joined latest-first on member_id;
//   - "activity" for a member is DERIVED (joined event + current status +
//     recent community posts), NOT read from activity_log.
//
// AUTHORIZATION (two layers, fail-closed — see the guard below):
//   1. Production board auth: req.actor.type === "board" (a real dashboard
//      session or board API key; anonymous callers are type "none").
//   2. University admin allow-list: the caller's board-account email must be
//      on UNIVERSITY_SESSION_ADMINS — the SAME env allow-list the University
//      *sessions* admin endpoints use (routes/portal.ts requireSessionAdmin).
//      An empty/unset allow-list means NOBODY is an admin (403). There is no
//      dev bypass: even the local_trusted implicit board actor has no
//      authUsers email row, so it fails the allow-list.
//
// BILLING (cancel / reactivate) mirrors the member-facing precedent in
//   portal.ts (POST /university/cancel, /reactivate): each destructive action
//   is POST + an explicit member id (no bulk endpoints), reads the member's
//   OWN stripe_subscription_id from university_subscriptions, and calls Stripe
//   via stripeRequest(..., universityStripeKey()) — the SEPARATE Starwise
//   account. Because the subscription id is read only from
//   university_subscriptions (the only writer keyed to that account) and the
//   call is authenticated with the University key, an admin here cannot act on
//   a subscription outside the University product. Status is mirrored back into
//   the DB by the customer.subscription.updated/.deleted webhook
//   (university-stripe-handler.ts) — this route never writes billing status
//   directly (avoids Stripe/DB desync).
//
// STATUS SEMANTICS — reused from services/university-stripe-handler.ts:
//   active | past_due | cancelled (University has NO 'paused' member state).
// ---------------------------------------------------------------------------
import { Router } from "express";
import type { Response } from "express";
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
import { boardAuthService } from "../services/board-auth.js";
import {
  stripeConfigured,
  stripeRequest,
  universityStripeKey,
} from "../services/stripe-client.js";

// Hard cap on the member-list query. Pagination is deferred; we surface
// `truncated: true` so a big day doesn't silently swallow rows. Mirrors
// watchtower-admin's LIST_LIMIT.
const LIST_LIMIT = 500;

// The University statuses that count as "at risk" for the recovery pipeline.
const RECOVERY_STATUSES = ["past_due", "cancelled"] as const;

// Parse the University admin allow-list from the env. Same mechanism the
// University sessions admin endpoints use (portal.ts `sessionAdminEmails`):
// UNIVERSITY_SESSION_ADMINS, comma-separated, lower-cased, blanks dropped.
function universityAdminEmails(): Set<string> {
  const raw = process.env.UNIVERSITY_SESSION_ADMINS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

export function universityAdminRoutes(db: Db) {
  const router = Router();
  const boardAuth = boardAuthService(db);

  // Access-log middleware first (same as watchtower-admin) so unauth probes
  // still get a forensic row. admin_access_log has no company FK.
  router.use(logAdminAccess(db));

  // Staff-only guard, hardened beyond the sibling admin routes because this
  // surface performs billing mutations. Two layers, both fail closed:
  router.use(async (req, res, next) => {
    // 1) Production board auth. In an `authenticated` deployment this requires
    //    a real session or board API key; type is "none" for anonymous callers.
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Admin only" });
      return;
    }
    const userId = req.actor.userId;
    if (!userId) {
      res.status(401).json({ error: "Admin only" });
      return;
    }

    // 2) University admin allow-list. FAIL CLOSED: empty allow-list ⇒ nobody
    //    is an admin ⇒ 403 (checked before any DB lookup).
    const allow = universityAdminEmails();
    if (allow.size === 0) {
      res
        .status(403)
        .json({ error: "University administration is not enabled" });
      return;
    }

    let access: Awaited<ReturnType<typeof boardAuth.resolveBoardAccess>>;
    try {
      access = await boardAuth.resolveBoardAccess(userId);
    } catch (err) {
      logger.error({ err }, "university-admin: admin lookup failed");
      res.status(500).json({ error: "Failed to verify admin" });
      return;
    }
    const email = access.user?.email?.trim().toLowerCase() ?? "";
    if (!email || !allow.has(email)) {
      res.status(403).json({ error: "University administration required" });
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
      // key) with author_email kept as a durable fallback for members whose
      // account link hasn't resolved.
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

      // Synthesized timeline — derived from the member's own state. Newest
      // first.
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

  // ---- shared: resolve a member + its live Stripe subscription id ----
  // Returns { member, subId } on success, or null after writing the response
  // (404 unknown member, 503 Stripe unconfigured, 409 no billing on file).
  // The subscription id is read ONLY from university_subscriptions, so a
  // subsequent Stripe call authenticated with universityStripeKey() can only
  // ever touch this member's University subscription — never a subscription
  // outside the University product.
  async function resolveMemberSubscription(
    memberId: string,
    res: Response,
  ): Promise<{
    member: { id: string; email: string; accountId: string | null };
    subId: string;
  } | null> {
    const [member] = await db
      .select({
        id: universityMembers.id,
        email: universityMembers.email,
        accountId: universityMembers.accountId,
      })
      .from(universityMembers)
      .where(eq(universityMembers.id, memberId))
      .limit(1);
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return null;
    }
    if (!stripeConfigured()) {
      res.status(503).json({ error: "Stripe not configured" });
      return null;
    }
    const subsByMember = await latestSubsByMemberId([member.id]);
    const sub = subsByMember.get(member.id) ?? null;
    if (!sub?.stripeSubscriptionId) {
      res
        .status(409)
        .json({ error: "No Stripe subscription on file for this member" });
      return null;
    }
    return { member, subId: sub.stripeSubscriptionId };
  }

  // -------------------- POST /members/:id/cancel --------------------
  // Cancel-at-period-end on Stripe (member keeps access through the paid
  // period); the webhook mirrors status into the DB. Mirrors portal.ts
  // POST /university/cancel.
  router.post("/members/:id/cancel", async (req, res) => {
    const memberId = req.params.id as string;
    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 2000)
        : null;
    try {
      const resolved = await resolveMemberSubscription(memberId, res);
      if (!resolved) return;
      const { member, subId } = resolved;

      const updated = await stripeRequest<{ current_period_end?: number }>(
        "POST",
        `/subscriptions/${subId}`,
        { cancel_at_period_end: true },
        universityStripeKey(),
      );

      // Churn feedback is non-critical — a failed insert must NOT fail the
      // cancel (which already took effect at Stripe).
      if (reason) {
        try {
          await db.insert(universityCancelFeedback).values({
            accountId: member.accountId,
            email: member.email.toLowerCase(),
            reason,
          });
        } catch (err) {
          logger.error(
            { err, memberId },
            "university-admin: recordCancelFeedback failed (cancel still applied)",
          );
        }
      }

      const summary = await memberSummary(memberId);
      res.json({
        ok: true,
        member: summary,
        message: "Cancellation scheduled at period end",
        accessUntil: updated.current_period_end
          ? new Date(updated.current_period_end * 1000).toISOString()
          : null,
      });
    } catch (err) {
      logger.error({ err, memberId }, "university-admin: cancel failed");
      res.status(500).json({ error: "Failed to cancel member" });
    }
  });

  // -------------------- POST /members/:id/reactivate --------------------
  // Undo a pending cancel and lift any pause on Stripe; the webhook mirrors
  // status into the DB. Mirrors portal.ts POST /university/reactivate.
  router.post("/members/:id/reactivate", async (req, res) => {
    const memberId = req.params.id as string;
    try {
      const resolved = await resolveMemberSubscription(memberId, res);
      if (!resolved) return;
      const { subId } = resolved;

      await stripeRequest(
        "POST",
        `/subscriptions/${subId}`,
        // Empty string clears pause_collection (Stripe's documented unset form).
        { cancel_at_period_end: false, pause_collection: "" },
        universityStripeKey(),
      );

      const summary = await memberSummary(memberId);
      res.json({ ok: true, member: summary, message: "Reactivation applied" });
    } catch (err) {
      logger.error({ err, memberId }, "university-admin: reactivate failed");
      res.status(500).json({ error: "Failed to reactivate member" });
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
