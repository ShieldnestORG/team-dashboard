import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  socialAccounts,
  socialAutomations,
  socialPosts,
  platformCaps,
  authUsers,
  socialLeads,
  zernioWebhookEvents,
  zernioCommentAutomations,
  zernioPostAnalytics,
} from "@paperclipai/db";
import { loadCalendar } from "../services/socials/calendar.js";
import { syncSocialAutomations } from "../services/socials/cron-introspect.js";
import { runSocialRelayerTick, runLeadRelayerTick } from "../services/social-relayer.js";
import {
  createZernioCommentAutomation,
  deleteZernioCommentAutomation,
  getZernioCommentAutomationLogs,
  listZernioCommentAutomations,
  registerZernioWebhookForAllKeys,
  fetchZernioAnalytics,
  validateZernioAutomationInput,
  ZernioAddonMissingError,
  ZernioApiError,
  ZERNIO_ANALYTICS_PATHS,
  type ZernioAutomationInput,
} from "../services/platform-publishers/zernio.js";
import { runZernioEngagementSyncTick, syncZernioAutomationsMirror } from "../services/socials/zernio-sync.js";
import {
  buildZernioRecommendations,
  latestZernioSnapshots,
  runZernioAnalyticsIngestTick,
} from "../services/socials/zernio-analytics.js";
import { enqueueApprovedContent } from "../services/socials/content-bridge.js";
import { invalidatePlatformCapCache, listCounters } from "../services/socials/platform-caps.js";
import { logger } from "../middleware/logger.js";
import type { StorageService } from "../storage/types.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

/** True when the actor is an authenticated instance admin. */
function isAdminActor(req: Request): boolean {
  return req.actor.type === "board" && Boolean(req.actor.isInstanceAdmin);
}

/**
 * The authoring auth-user id for attribution, or null. Excludes the
 * local_trusted implicit board principal ("local-board"), which is not a real
 * user row.
 */
function actorUserId(req: Request): string | null {
  if (req.actor.type !== "board") return null;
  if (req.actor.source === "local_implicit") return null;
  return req.actor.userId ?? null;
}

export function socialsRoutes(db: Db, storageService: StorageService) {
  const router = Router();

  // Socials is a logged-in dashboard surface — only the authenticated UI calls
  // these endpoints. Require a board actor: this rejects unauthenticated
  // requests in authenticated mode (previously NONE of these routes checked the
  // actor) and is satisfied implicitly by the local_trusted dev principal.
  router.use((req, res, next) => {
    if (req.actor.type !== "board") {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    next();
  });

  // Publishing is admin-gated: employees create drafts (pending_approval); an
  // instance admin approves them into the relayer queue.
  const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    if (!isAdminActor(req)) {
      res.status(403).json({ error: "admin role required to approve/publish" });
      return;
    }
    next();
  };

  // ----- Accounts -----
  router.get("/accounts", async (req, res) => {
    const brand = req.query.brand as string | undefined;
    const platform = req.query.platform as string | undefined;
    const status = req.query.status as string | undefined;
    const where = [eq(socialAccounts.companyId, COMPANY_ID), eq(socialAccounts.archived, false)];
    if (brand) where.push(eq(socialAccounts.brand, brand));
    if (platform) where.push(eq(socialAccounts.platform, platform));
    if (status) where.push(eq(socialAccounts.status, status));
    const rows = await db
      .select()
      .from(socialAccounts)
      .where(and(...where))
      .orderBy(socialAccounts.brand, socialAccounts.platform);
    // Derive the publish-routing signal and avoid leaking the raw oauthRef.
    // An account posts via Zernio exactly when its oauthRef begins with
    // "zernio:" (see services/platform-publishers/zernio.ts parseZernioAccountId).
    const accounts = rows.map(({ oauthRef, ...rest }) => ({
      ...rest,
      routing: (oauthRef?.startsWith("zernio:") ? "zernio" : "native") as "zernio" | "native",
    }));
    res.json({ accounts });
  });

  router.post("/accounts", requireAdmin, async (req, res) => {
    const body = req.body ?? {};
    if (!body.brand || !body.platform || !body.handle) {
      return res.status(400).json({ error: "brand, platform, handle required" });
    }
    const inserted = await db
      .insert(socialAccounts)
      .values({
        companyId: COMPANY_ID,
        brand: String(body.brand),
        platform: String(body.platform),
        handle: String(body.handle),
        displayName: body.displayName ?? null,
        profileUrl: body.profileUrl ?? null,
        connectionType: body.connectionType ?? "manual",
        oauthRef: body.oauthRef ?? null,
        status: body.status ?? "active",
        automationMode: body.automationMode ?? "manual",
        automationNotes: body.automationNotes ?? null,
        ownerUserId: body.ownerUserId ?? null,
        tags: Array.isArray(body.tags) ? body.tags : [],
      })
      .returning();
    res.status(201).json({ account: inserted[0] });
  });

  router.patch("/accounts/:id", requireAdmin, async (req, res) => {
    const id = req.params.id as string;
    const patch: Record<string, unknown> = {};
    const fields = [
      "brand", "platform", "handle", "displayName", "profileUrl",
      "connectionType", "oauthRef", "status", "automationMode",
      "automationNotes", "ownerUserId", "tags", "archived",
    ];
    for (const f of fields) {
      if (f in req.body) patch[f] = req.body[f];
    }
    patch.updatedAt = sql`now()`;
    const updated = await db
      .update(socialAccounts)
      .set(patch)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.companyId, COMPANY_ID)))
      .returning();
    if (!updated[0]) return res.status(404).json({ error: "not found" });
    res.json({ account: updated[0] });
  });

  router.delete("/accounts/:id", requireAdmin, async (req, res) => {
    const id = req.params.id as string;
    // Soft-delete via archived flag.
    const updated = await db
      .update(socialAccounts)
      .set({ archived: true, updatedAt: sql`now()` })
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.companyId, COMPANY_ID)))
      .returning();
    if (!updated[0]) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  });

  // ----- Automations -----
  router.get("/automations", async (req, res) => {
    const accountId = req.query.accountId as string | undefined;
    const where = accountId ? [eq(socialAutomations.socialAccountId, accountId)] : [];
    const rows = await db
      .select()
      .from(socialAutomations)
      .where(where.length ? and(...where) : undefined)
      .orderBy(socialAutomations.sourceRef);
    res.json({ automations: rows });
  });

  router.post("/automations/sync", requireAdmin, async (_req, res) => {
    try {
      const result = await syncSocialAutomations(db, COMPANY_ID);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "syncSocialAutomations failed");
      res.status(500).json({ error: "sync failed" });
    }
  });

  // ----- Posts queue (relayer) -----

  // List queued/posted/failed posts. Supports ?accountId=, ?status=, ?limit=
  router.get("/posts", async (req, res) => {
    const accountId = req.query.accountId as string | undefined;
    const status = req.query.status as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const where = [eq(socialAccounts.companyId, COMPANY_ID)];
    if (accountId) where.push(eq(socialPosts.socialAccountId, accountId));
    if (status) where.push(eq(socialPosts.status, status));

    const rows = await db
      .select({
        id: socialPosts.id,
        socialAccountId: socialPosts.socialAccountId,
        text: socialPosts.text,
        mediaUrls: socialPosts.mediaUrls,
        altTexts: socialPosts.altTexts,
        replyToUrl: socialPosts.replyToUrl,
        scheduledAt: socialPosts.scheduledAt,
        status: socialPosts.status,
        attempts: socialPosts.attempts,
        maxAttempts: socialPosts.maxAttempts,
        postedUrl: socialPosts.postedUrl,
        platformPostId: socialPosts.platformPostId,
        error: socialPosts.error,
        createdAt: socialPosts.createdAt,
        postedAt: socialPosts.postedAt,
        platform: socialAccounts.platform,
        brand: socialAccounts.brand,
        handle: socialAccounts.handle,
        createdByUserId: socialPosts.createdByUserId,
        authorEmail: authUsers.email,
        authorName: authUsers.name,
      })
      .from(socialPosts)
      .innerJoin(socialAccounts, eq(socialAccounts.id, socialPosts.socialAccountId))
      .leftJoin(authUsers, eq(authUsers.id, socialPosts.createdByUserId))
      .where(and(...where))
      .orderBy(desc(socialPosts.scheduledAt))
      .limit(limit);
    res.json({ posts: rows });
  });

  // Schedule a new post.
  router.post("/posts", async (req, res) => {
    const body = req.body ?? {};
    if (!body.socialAccountId || typeof body.text !== "string" || !body.text.trim()) {
      return res.status(400).json({ error: "socialAccountId and non-empty text required" });
    }
    // Verify the account belongs to this company before scheduling.
    const account = await db
      .select({ id: socialAccounts.id, status: socialAccounts.status })
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.id, String(body.socialAccountId)),
          eq(socialAccounts.companyId, COMPANY_ID),
        ),
      )
      .limit(1);
    if (!account[0]) return res.status(404).json({ error: "social_account not found" });

    const scheduledAt = body.scheduledAt ? new Date(String(body.scheduledAt)) : new Date();
    if (Number.isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ error: "scheduledAt is invalid" });
    }

    // Two-tier publishing: non-admin employees create DRAFTS that wait for an
    // admin to approve (status 'pending_approval' — the relayer only drains
    // 'scheduled'). Admins publish directly. Either way we attribute the author.
    const status = isAdminActor(req) ? "scheduled" : "pending_approval";
    const inserted = await db
      .insert(socialPosts)
      .values({
        socialAccountId: String(body.socialAccountId),
        text: String(body.text),
        mediaUrls: Array.isArray(body.mediaUrls) ? body.mediaUrls.map(String) : [],
        altTexts: Array.isArray(body.altTexts) ? body.altTexts.map(String) : [],
        replyToUrl: body.replyToUrl ? String(body.replyToUrl) : null,
        scheduledAt,
        status,
        maxAttempts: typeof body.maxAttempts === "number" ? body.maxAttempts : 3,
        payload: body.payload && typeof body.payload === "object" ? body.payload : {},
        createdByUserId: actorUserId(req),
      })
      .returning();
    res.status(201).json({ post: inserted[0], pendingApproval: status === "pending_approval" });
  });

  // Approve a pending draft → enqueue it for the relayer (admins only).
  // Optional scheduledAt override lets the approver set/adjust the publish time.
  router.post("/posts/:id/approve", requireAdmin, async (req, res) => {
    const id = req.params.id as string;
    const body = req.body ?? {};
    // Confirm the post belongs to this company and is awaiting approval.
    const existing = await db
      .select({ status: socialPosts.status })
      .from(socialPosts)
      .innerJoin(socialAccounts, eq(socialAccounts.id, socialPosts.socialAccountId))
      .where(and(eq(socialPosts.id, id), eq(socialAccounts.companyId, COMPANY_ID)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: "post not found" });
    if (existing[0].status !== "pending_approval") {
      return res.status(409).json({ error: "post is not pending approval" });
    }
    const patch: Record<string, unknown> = { status: "scheduled", updatedAt: sql`now()` };
    if (body.scheduledAt) {
      const when = new Date(String(body.scheduledAt));
      if (Number.isNaN(when.getTime())) return res.status(400).json({ error: "scheduledAt is invalid" });
      patch.scheduledAt = when;
    }
    const updated = await db
      .update(socialPosts)
      .set(patch)
      .where(and(eq(socialPosts.id, id), eq(socialPosts.status, "pending_approval")))
      .returning();
    if (!updated[0]) return res.status(409).json({ error: "post is not pending approval" });
    res.json({ post: updated[0] });
  });

  // Cancel a queued post or reject a pending draft. Authors may cancel their
  // own scheduled/pending posts; admins may cancel any.
  router.delete("/posts/:id", async (req, res) => {
    const id = req.params.id as string;
    const rows = await db
      .select({
        status: socialPosts.status,
        createdByUserId: socialPosts.createdByUserId,
      })
      .from(socialPosts)
      .innerJoin(socialAccounts, eq(socialAccounts.id, socialPosts.socialAccountId))
      .where(and(eq(socialPosts.id, id), eq(socialAccounts.companyId, COMPANY_ID)))
      .limit(1);
    const post = rows[0];
    if (!post) return res.status(404).json({ error: "post not found" });
    if (post.status !== "scheduled" && post.status !== "pending_approval") {
      return res.status(409).json({ error: "post can only be canceled while scheduled or pending approval" });
    }
    if (!isAdminActor(req) && post.createdByUserId !== actorUserId(req)) {
      return res.status(403).json({ error: "not allowed to cancel this post" });
    }
    await db
      .update(socialPosts)
      .set({ status: "canceled", updatedAt: sql`now()` })
      .where(eq(socialPosts.id, id));
    res.json({ ok: true });
  });

  // Admin-only: this enqueues directly as 'scheduled' (bypasses the draft
  // approval gate), so it must not be reachable by a non-admin employee.
  router.post("/posts/enqueue-from-content", requireAdmin, async (req, res) => {
    const contentItemId = req.body?.contentItemId;
    if (typeof contentItemId !== "string" || !contentItemId) {
      return res.status(400).json({ error: "contentItemId required" });
    }
    // Optional explicit media reference (internal storage objectKeys). The
    // relayer stages these to public R2 before publishing. content_items has no
    // media link, so this must be supplied by the caller — see EnqueueOptions.
    const mediaObjectKeys = Array.isArray(req.body?.mediaObjectKeys)
      ? req.body.mediaObjectKeys.map(String)
      : undefined;
    try {
      const result = await enqueueApprovedContent(db, contentItemId, { mediaObjectKeys });
      const status = result.enqueued ? 201 : 200;
      return res.status(status).json(result);
    } catch (err) {
      logger.error({ err, contentItemId }, "enqueue-from-content failed");
      return res.status(500).json({ error: "enqueue failed" });
    }
  });

  // Manual relayer tick — force-drains the queue now; admin-only ops action.
  router.post("/posts/relay-now", requireAdmin, async (_req, res) => {
    try {
      const result = await runSocialRelayerTick(db, storageService);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "relay-now failed");
      res.status(500).json({ error: "relay failed" });
    }
  });

  // ----- Platform caps -----
  router.get("/platform-caps", async (_req, res) => {
    const rows = await db.select().from(platformCaps).orderBy(platformCaps.platform);
    res.json({ caps: rows });
  });

  router.patch("/platform-caps/:platform", requireAdmin, async (req, res) => {
    const platform = req.params.platform as string;
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof body.maxGeneratedPerDay === "number") patch.maxGeneratedPerDay = body.maxGeneratedPerDay;
    if (typeof body.maxPublishedPerDay === "number") patch.maxPublishedPerDay = body.maxPublishedPerDay;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.notes === "string" || body.notes === null) patch.notes = body.notes;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "no fields to update" });
    }
    patch.updatedAt = sql`now()`;
    const updated = await db
      .update(platformCaps)
      .set(patch)
      .where(eq(platformCaps.platform, platform))
      .returning();
    if (!updated[0]) return res.status(404).json({ error: "not found" });
    invalidatePlatformCapCache(platform);
    res.json({ cap: updated[0] });
  });

  router.get("/platform-counters", async (_req, res) => {
    try {
      const counters = await listCounters(db);
      res.json({ counters });
    } catch (err) {
      logger.error({ err }, "platform-counters failed");
      res.status(500).json({ error: "counters failed" });
    }
  });

  // ===========================================================================
  // Zernio engagement layer (plan-zernio-leverage §2; CONTROLLER-AUDIT Goal B).
  // The inbound webhook itself is NOT here — it lives in routes/zernio-webhook.ts
  // (raw-body + HMAC, mounted before the JSON parser), because this router is
  // board-actor-gated. Everything below is the authenticated cockpit surface.
  // NOTE: Zernio analytics ≠ X-engine analytics (/api/x/analytics,
  // x_engagement_log). They measure different things — never blend them.
  // ===========================================================================

  const zernioErr = (res: Response, err: unknown): void => {
    if (err instanceof ZernioAddonMissingError) {
      res.status(402).json({ error: "zernio analytics add-on gate", detail: err.message });
      return;
    }
    if (err instanceof ZernioApiError) {
      res.status(502).json({ error: "zernio api error", detail: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  };

  // ----- comment-automation CRUD (keyword funnels: ROOM / COHERENT / ...) -----

  // Live list from Zernio, refreshing the local mirror as a side effect.
  router.get("/zernio/automations", async (req, res) => {
    try {
      const zid = req.query.zernioAccountId as string | undefined;
      const { automations, errors } = await listZernioCommentAutomations(zid);
      // Refresh the mirror opportunistically so the webhook keyword-attribution
      // set stays warm even between hourly sync ticks.
      syncZernioAutomationsMirror(db).catch((err) =>
        logger.warn({ err }, "zernio automations mirror refresh failed"),
      );
      res.json({ automations, errors });
    } catch (err) {
      zernioErr(res, err);
    }
  });

  // Mirror-only list (no Zernio round-trip) for fast cockpit rendering.
  router.get("/zernio/automations/mirror", async (_req, res) => {
    const rows = await db
      .select()
      .from(zernioCommentAutomations)
      .orderBy(desc(zernioCommentAutomations.updatedAt));
    res.json({ automations: rows });
  });

  router.post("/zernio/automations", requireAdmin, async (req, res) => {
    const body = (req.body ?? {}) as Partial<ZernioAutomationInput>;
    const input: ZernioAutomationInput = {
      zernioAccountId: String(body.zernioAccountId ?? ""),
      name: String(body.name ?? ""),
      trigger: body.trigger,
      keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : [],
      matchMode: body.matchMode,
      dmMessage: String(body.dmMessage ?? ""),
      buttons: body.buttons,
      commentReply: body.commentReply ? String(body.commentReply) : undefined,
      linkTracking: body.linkTracking,
      clickTag: body.clickTag ? String(body.clickTag) : undefined,
      platformPostId: body.platformPostId ? String(body.platformPostId) : undefined,
      postId: body.postId ? String(body.postId) : undefined,
      postTitle: body.postTitle ? String(body.postTitle) : undefined,
    };
    const problems = validateZernioAutomationInput(input);
    if (problems.length > 0) {
      return res.status(400).json({ error: "invalid automation", problems });
    }
    try {
      const automation = await createZernioCommentAutomation(input);
      // Mirror immediately so keyword attribution works from the first comment.
      await syncZernioAutomationsMirror(db).catch((err) =>
        logger.warn({ err }, "zernio automations mirror refresh failed"),
      );
      res.status(201).json({ automation });
    } catch (err) {
      zernioErr(res, err);
    }
  });

  router.delete("/zernio/automations/:automationId", requireAdmin, async (req, res) => {
    const automationId = req.params.automationId as string;
    const zid = String(req.query.zernioAccountId ?? req.body?.zernioAccountId ?? "");
    if (!zid) return res.status(400).json({ error: "zernioAccountId required" });
    try {
      await deleteZernioCommentAutomation(zid, automationId);
      await db
        .update(zernioCommentAutomations)
        .set({ isActive: false, updatedAt: sql`now()` })
        .where(eq(zernioCommentAutomations.zernioAutomationId, automationId));
      res.json({ ok: true });
    } catch (err) {
      zernioErr(res, err);
    }
  });

  router.get("/zernio/automations/:automationId/logs", async (req, res) => {
    const automationId = req.params.automationId as string;
    const zid = String(req.query.zernioAccountId ?? "");
    if (!zid) return res.status(400).json({ error: "zernioAccountId required" });
    try {
      const logs = await getZernioCommentAutomationLogs(zid, automationId, {
        status: req.query.status as "sent" | "failed" | "skipped" | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        skip: req.query.skip ? Number(req.query.skip) : undefined,
      });
      res.json(logs);
    } catch (err) {
      zernioErr(res, err);
    }
  });

  // ----- webhook admin + event stream -----

  // Register the receiver on every configured Zernio key (idempotent).
  router.post("/zernio/webhooks/register", requireAdmin, async (req, res) => {
    const secret = process.env.ZERNIO_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(503).json({ error: "ZERNIO_WEBHOOK_SECRET not configured" });
    }
    const base = process.env.PAPERCLIP_PUBLIC_URL;
    const url = req.body?.url ? String(req.body.url) : base ? `${base}/api/zernio/webhook` : null;
    if (!url) {
      return res.status(400).json({ error: "url required (PAPERCLIP_PUBLIC_URL unset)" });
    }
    try {
      const results = await registerZernioWebhookForAllKeys({ url, secret });
      res.json({ url, results });
    } catch (err) {
      zernioErr(res, err);
    }
  });

  router.get("/zernio/events", async (req, res) => {
    const type = req.query.type as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const where = type ? [eq(zernioWebhookEvents.eventType, type)] : [];
    const rows = await db
      .select()
      .from(zernioWebhookEvents)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(zernioWebhookEvents.receivedAt))
      .limit(limit);
    res.json({ events: rows });
  });

  // ----- captured leads -----

  router.get("/leads", async (req, res) => {
    const where = [];
    if (req.query.captureKind) where.push(eq(socialLeads.captureKind, String(req.query.captureKind)));
    if (req.query.zernioAccountId) where.push(eq(socialLeads.zernioAccountId, String(req.query.zernioAccountId)));
    if (req.query.synced === "true") where.push(sql`${socialLeads.brevoSyncedAt} IS NOT NULL`);
    if (req.query.synced === "false") where.push(sql`${socialLeads.brevoSyncedAt} IS NULL`);
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await db
      .select()
      .from(socialLeads)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(socialLeads.lastEventAt))
      .limit(limit);
    res.json({
      leads: rows,
      brevoConfigured: Boolean(process.env.BREVO_API_KEY && process.env.BREVO_FOUNDING_LIST_ID),
    });
  });

  // Force a Brevo sync pass now (same tick the socials:lead-sync cron runs).
  router.post("/leads/relay-now", requireAdmin, async (_req, res) => {
    try {
      const result = await runLeadRelayerTick(db);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "leads relay-now failed");
      res.status(500).json({ error: "lead relay failed" });
    }
  });

  // Force the automation-mirror + tagged-contacts sync now.
  router.post("/zernio/sync-now", requireAdmin, async (_req, res) => {
    try {
      const result = await runZernioEngagementSyncTick(db);
      res.json(result);
    } catch (err) {
      zernioErr(res, err);
    }
  });

  // ----- analytics (L6 / Goal B) — Zernio numbers ONLY, never x_engagement_log -----

  // Latest stored snapshots: totals view + per-account drill-down source.
  router.get("/zernio/analytics/summary", async (_req, res) => {
    try {
      const snapshots = await latestZernioSnapshots(db);
      res.json({ snapshots, source: "zernio" });
    } catch (err) {
      zernioErr(res, err);
    }
  });

  router.get("/zernio/analytics/accounts/:zid", async (req, res) => {
    const zid = req.params.zid as string;
    try {
      const snapshots = await latestZernioSnapshots(db, { zernioAccountId: zid });
      const posts = await db
        .select()
        .from(zernioPostAnalytics)
        .where(eq(zernioPostAnalytics.zernioAccountId, zid))
        .orderBy(desc(zernioPostAnalytics.publishedAt))
        .limit(100);
      res.json({ zernioAccountId: zid, snapshots, posts, source: "zernio" });
    } catch (err) {
      zernioErr(res, err);
    }
  });

  router.get("/zernio/analytics/posts", async (req, res) => {
    const where = [];
    if (req.query.zernioAccountId) {
      where.push(eq(zernioPostAnalytics.zernioAccountId, String(req.query.zernioAccountId)));
    }
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await db
      .select()
      .from(zernioPostAnalytics)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(zernioPostAnalytics.publishedAt))
      .limit(limit);
    res.json({ posts: rows, source: "zernio" });
  });

  router.get("/zernio/analytics/recommendations", async (_req, res) => {
    try {
      const recommendations = await buildZernioRecommendations(db);
      res.json({ recommendations, source: "zernio" });
    } catch (err) {
      zernioErr(res, err);
    }
  });

  // Live passthrough to any allowlisted analytics path (the 26 /v1/analytics
  // surfaces + follower/health/usage) for drill-downs we don't snapshot.
  router.get("/zernio/analytics/live/:metric", async (req, res) => {
    const metric = req.params.metric as string;
    if (!(metric in ZERNIO_ANALYTICS_PATHS)) {
      return res.status(400).json({ error: `unknown metric '${metric}'`, metrics: Object.keys(ZERNIO_ANALYTICS_PATHS) });
    }
    const zid = String(req.query.zernioAccountId ?? "");
    if (!zid) return res.status(400).json({ error: "zernioAccountId required" });
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) {
      if (k !== "zernioAccountId" && typeof v === "string") query[k] = v;
    }
    try {
      const data = await fetchZernioAnalytics(zid, metric, query);
      res.json({ metric, zernioAccountId: zid, data, source: "zernio" });
    } catch (err) {
      zernioErr(res, err);
    }
  });

  // Force an analytics ingest pass now (same tick as socials:zernio-analytics).
  router.post("/zernio/analytics/ingest-now", requireAdmin, async (_req, res) => {
    try {
      const result = await runZernioAnalyticsIngestTick(db);
      res.json(result);
    } catch (err) {
      zernioErr(res, err);
    }
  });

  // ----- Calendar -----
  router.get("/calendar", async (req, res) => {
    const fromStr = req.query.from as string | undefined;
    const toStr = req.query.to as string | undefined;
    const brand = req.query.brand as string | undefined;
    const platform = req.query.platform as string | undefined;
    const now = Date.now();
    const from = fromStr ? new Date(fromStr) : new Date(now - 7 * 24 * 3600 * 1000);
    const to = toStr ? new Date(toStr) : new Date(now + 14 * 24 * 3600 * 1000);
    const events = await loadCalendar(db, { from, to, brand, platform, companyId: COMPANY_ID });
    res.json({ from: from.toISOString(), to: to.toISOString(), events });
  });

  return router;
}
