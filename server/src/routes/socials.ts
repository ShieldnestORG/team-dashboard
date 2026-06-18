import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { socialAccounts, socialAutomations, socialPosts, platformCaps } from "@paperclipai/db";
import { loadCalendar } from "../services/socials/calendar.js";
import { syncSocialAutomations } from "../services/socials/cron-introspect.js";
import { runSocialRelayerTick } from "../services/social-relayer.js";
import { enqueueApprovedContent } from "../services/socials/content-bridge.js";
import { invalidatePlatformCapCache, listCounters } from "../services/socials/platform-caps.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

export function socialsRoutes(db: Db) {
  const router = Router();

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

  router.post("/accounts", async (req, res) => {
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

  router.patch("/accounts/:id", async (req, res) => {
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

  router.delete("/accounts/:id", async (req, res) => {
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

  router.post("/automations/sync", async (_req, res) => {
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
      })
      .from(socialPosts)
      .innerJoin(socialAccounts, eq(socialAccounts.id, socialPosts.socialAccountId))
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

    const inserted = await db
      .insert(socialPosts)
      .values({
        socialAccountId: String(body.socialAccountId),
        text: String(body.text),
        mediaUrls: Array.isArray(body.mediaUrls) ? body.mediaUrls.map(String) : [],
        altTexts: Array.isArray(body.altTexts) ? body.altTexts.map(String) : [],
        replyToUrl: body.replyToUrl ? String(body.replyToUrl) : null,
        scheduledAt,
        maxAttempts: typeof body.maxAttempts === "number" ? body.maxAttempts : 3,
        payload: body.payload && typeof body.payload === "object" ? body.payload : {},
      })
      .returning();
    res.status(201).json({ post: inserted[0] });
  });

  // Cancel a queued post (only if still scheduled).
  router.delete("/posts/:id", async (req, res) => {
    const id = req.params.id as string;
    const updated = await db
      .update(socialPosts)
      .set({ status: "canceled", updatedAt: sql`now()` })
      .where(and(eq(socialPosts.id, id), eq(socialPosts.status, "scheduled")))
      .returning();
    if (!updated[0]) return res.status(409).json({ error: "post is not in scheduled status" });
    res.json({ ok: true });
  });

  router.post("/posts/enqueue-from-content", async (req, res) => {
    const contentItemId = req.body?.contentItemId;
    if (typeof contentItemId !== "string" || !contentItemId) {
      return res.status(400).json({ error: "contentItemId required" });
    }
    try {
      const result = await enqueueApprovedContent(db, contentItemId);
      const status = result.enqueued ? 201 : 200;
      return res.status(status).json(result);
    } catch (err) {
      logger.error({ err, contentItemId }, "enqueue-from-content failed");
      return res.status(500).json({ error: "enqueue failed" });
    }
  });

  // Manual relayer tick for testing — runs one drain pass right now.
  router.post("/posts/relay-now", async (_req, res) => {
    try {
      const result = await runSocialRelayerTick(db);
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

  router.patch("/platform-caps/:platform", async (req, res) => {
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
