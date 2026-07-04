import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { checkComposeForPlatform, isVideoRef, type ComposeMediaRef } from "@paperclipai/shared";
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
  funnels,
  inspirationItems,
  dailyBriefs,
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
  setZernioCommentAutomationActive,
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
  latestFollowerCounts,
  runZernioAnalyticsIngestTick,
} from "../services/socials/zernio-analytics.js";
import { enqueueApprovedContent } from "../services/socials/content-bridge.js";
import { invalidatePlatformCapCache, listCounters } from "../services/socials/platform-caps.js";
import {
  loadFunnelCatalog,
  ensureFunnelCatalogImported,
  computeFunnelCoverage,
  generateFunnelDraftsForAccount,
  approveFunnel,
  rejectFunnel,
  armFunnel,
  retireFunnel,
  isValidFunnelIdFormat,
  FunnelGuardError,
  type FunnelStyle,
} from "../services/socials/funnels-service.js";
import {
  runDailyBriefTick,
  validateInspirationUrl,
} from "../services/socials/daily-brief.js";
import { logger } from "../middleware/logger.js";
import { CAPTION_STYLES, CAPTION_STYLE_SYNC_META } from "../data/caption-styles.generated.js";
import type { StorageService } from "../storage/types.js";
import {
  sniffSocialMedia,
  maxBytesFor,
  SOCIAL_MEDIA_MAX_VIDEO_BYTES,
} from "../services/socials/media-upload.js";
import { isAlreadyPublicUrl } from "../storage/r2-staging.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

// ---------------------------------------------------------------------------
// Green-light board read model (Content Hub). Mirror-backed ONLY — this
// surface must never call Zernio itself (shared per-account rate limits with
// Mark's crons + the team's Claude account). The explicit "Refresh from
// Zernio" UI action uses GET /zernio/automations (live fetch + mirror refresh).
// ---------------------------------------------------------------------------

/** Mirror row fields the green-light derivation needs. */
export interface GreenlightAutomationRow {
  zernioAutomationId: string;
  zernioAccountId: string;
  name: string;
  keywords: string[];
  clickTag: string | null;
  isActive: boolean;
  stats: Record<string, unknown>;
  lastSyncedAt: Date | string | null;
}

export interface GreenlightRow {
  keyword: string;
  automationName: string;
  /**
   * Zernio's automation id — with the keyword, the only stable per-row
   * identity. Two automations on one account can share a keyword (per-post
   * SHIRT automations), so account+keyword is NOT unique.
   */
  zernioAutomationId: string;
  zernioAccountId: string;
  /** Handle of the connected account ("@coherencedaddy") or the raw id. */
  accountLabel: string;
  clickTag: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  /**
   * Zernio's stats JSONB is opaque (field names unverified) — values are
   * probed defensively and null means "not reported", never zero.
   */
  stats: {
    triggered: number | null;
    dmsSent: number | null;
    linkClicks: number | null;
  };
  tone: "green" | "amber" | "red";
  addonMissing: boolean;
}

/** Mirror rows older than this are "stale" → amber, not green. */
const GREENLIGHT_FRESH_MS = 2 * 60 * 60 * 1000; // 2h (sync cron is hourly)

/** Probe an opaque stats object for the first numeric value under any candidate key. */
export function probeStat(
  stats: Record<string, unknown> | null | undefined,
  candidates: string[],
): number | null {
  if (!stats || typeof stats !== "object") return null;
  for (const key of candidates) {
    const value = (stats as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

/**
 * Pure derivation: mirror rows → per-keyword green/amber/red rows.
 * green = active + synced recently + at least one stat reported;
 * amber = active but stale/no stats/addon-gated; red = inactive.
 */
export function deriveGreenlightRows(input: {
  automations: GreenlightAutomationRow[];
  handlesByZid: Map<string, string>;
  addonGatedZids: Set<string>;
  now?: Date;
}): GreenlightRow[] {
  const now = input.now ?? new Date();
  const rows: GreenlightRow[] = [];
  for (const automation of input.automations) {
    const syncedAt = automation.lastSyncedAt ? new Date(automation.lastSyncedAt) : null;
    const fresh =
      syncedAt !== null && now.getTime() - syncedAt.getTime() <= GREENLIGHT_FRESH_MS;
    const stats = {
      triggered: probeStat(automation.stats, [
        "triggered", "triggers", "triggerCount", "trigger_count", "totalTriggered", "comments", "commentCount",
      ]),
      dmsSent: probeStat(automation.stats, [
        "dmsSent", "dms_sent", "dmCount", "dm_count", "messagesSent", "messages_sent", "sent", "dms",
      ]),
      linkClicks: probeStat(automation.stats, [
        "linkClicks", "link_clicks", "clicks", "clickCount", "click_count", "linkClickCount",
      ]),
    };
    const hasStats =
      stats.triggered !== null || stats.dmsSent !== null || stats.linkClicks !== null;
    const addonMissing = input.addonGatedZids.has(automation.zernioAccountId);
    const tone: GreenlightRow["tone"] = !automation.isActive
      ? "red"
      : fresh && hasStats && !addonMissing
        ? "green"
        : "amber";
    const handle = input.handlesByZid.get(automation.zernioAccountId);
    const accountLabel = handle ? `@${handle.replace(/^@/, "")}` : automation.zernioAccountId;
    const keywords = automation.keywords.length > 0 ? automation.keywords : [automation.name];
    for (const keyword of keywords) {
      rows.push({
        keyword,
        automationName: automation.name,
        zernioAutomationId: automation.zernioAutomationId,
        zernioAccountId: automation.zernioAccountId,
        accountLabel,
        clickTag: automation.clickTag,
        isActive: automation.isActive,
        lastSyncedAt: syncedAt ? syncedAt.toISOString() : null,
        stats,
        tone,
        addonMissing,
      });
    }
  }
  return rows;
}

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

/**
 * Classify one POST /posts media entry as video or not, trusting the
 * magic-byte sniff POST /media already performed over the objectKey's
 * client-supplied filename extension. A public URL (already staged, or
 * pasted by hand) has no stored sniff result to check, so it falls back to
 * the extension heuristic — same as before. An internal objectKey is
 * resolved against the StorageService's own contentType metadata; only
 * when that's unavailable (e.g. local_disk dev storage doesn't persist
 * contentType, or the key can't be resolved at all) do we fall back to the
 * extension heuristic too, so this never turns a valid post into a 500.
 */
async function resolveIsVideoRef(storageService: StorageService, value: string): Promise<boolean> {
  if (isAlreadyPublicUrl(value)) return isVideoRef(value);
  try {
    const head = await storageService.headObject(COMPANY_ID, value);
    if (head.exists && head.contentType) return head.contentType.startsWith("video/");
  } catch {
    // Unresolvable/foreign objectKey — fall through to the extension guess;
    // the relayer's own resolveMediaUrls is the authoritative gate that will
    // fail loud on a truly bad objectKey before anything publishes.
  }
  return isVideoRef(value);
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
    // Latest follower-stats snapshot per account (cheap single query, no N+1).
    const followerCounts = await latestFollowerCounts(db);
    // Derive the publish-routing signal and avoid leaking the raw oauthRef.
    // An account posts via Zernio exactly when its oauthRef begins with
    // "zernio:" (see services/platform-publishers/zernio.ts parseZernioAccountId).
    const accounts = rows.map(({ oauthRef, ...rest }) => ({
      ...rest,
      routing: (oauthRef?.startsWith("zernio:") ? "zernio" : "native") as "zernio" | "native",
      // Absent (null) when no follower-stats snapshot exists yet — never 0.
      latestFollowerCount: rest.zernioAccountId ? followerCounts.get(rest.zernioAccountId) ?? null : null,
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

  // Funnel-control gate (migration 0146). Enabling only flips the local flag —
  // no automation is touched. Disabling flips the flag AND kills every live
  // Zernio-side automation for the account (local mirror isActive is NOT a DM
  // kill-switch; only a Zernio-side PATCH/DELETE stops the DM engine — see
  // setZernioCommentAutomationActive). Per-row try/catch: one Zernio failure
  // must not strand the rest un-killed.
  router.patch("/accounts/:id/funnels", requireAdmin, async (req, res) => {
    const id = req.params.id as string;
    const body = req.body ?? {};
    if (typeof body.enabled !== "boolean") {
      return res.status(400).json({ error: "enabled (boolean) required" });
    }
    const enabled = body.enabled as boolean;
    const found = await db
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.companyId, COMPANY_ID)))
      .limit(1);
    const account = found[0];
    if (!account) return res.status(404).json({ error: "not found" });

    await db
      .update(socialAccounts)
      .set({ funnelsEnabled: enabled, updatedAt: sql`now()` })
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.companyId, COMPANY_ID)));

    const killed: Array<{
      zernioAutomationId: string;
      name: string;
      mechanism?: string;
      ok: boolean;
      error?: string;
    }> = [];

    if (!enabled && account.zernioAccountId) {
      const liveRows = await db
        .select()
        .from(zernioCommentAutomations)
        .where(
          and(
            eq(zernioCommentAutomations.zernioAccountId, account.zernioAccountId),
            eq(zernioCommentAutomations.isActive, true),
          ),
        );
      for (const row of liveRows) {
        try {
          const result = await setZernioCommentAutomationActive(
            account.zernioAccountId,
            row.zernioAutomationId,
            false,
          );
          await db
            .update(zernioCommentAutomations)
            .set({ isActive: false, updatedAt: sql`now()` })
            .where(eq(zernioCommentAutomations.zernioAutomationId, row.zernioAutomationId));
          killed.push({
            zernioAutomationId: row.zernioAutomationId,
            name: row.name,
            mechanism: result.mechanism,
            ok: true,
          });
        } catch (err) {
          killed.push({
            zernioAutomationId: row.zernioAutomationId,
            name: row.name,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      logger.info(
        { accountId: id, zid: account.zernioAccountId, killed: killed.length },
        "account funnels disabled — live Zernio automations killed",
      );
    }

    res.json({ ok: true, funnelsEnabled: enabled, killed });
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

  // ----- Compose media upload -----
  // Stores the file via the company-scoped StorageService and hands back its
  // internal objectKey — Compose puts that straight into a post's mediaUrls,
  // and the relayer stages it to a public R2 URL at publish time (see
  // services/socials/media-upload.ts header for the full rationale). Sits
  // behind this router's board-actor gate above, so a marketing user (not
  // just an admin) can reach it.
  const mediaUpload = multer({
    storage: multer.memoryStorage(),
    // The real per-kind cap (image vs video) is enforced after sniffing the
    // bytes below; this is just multer's outer ceiling.
    limits: { fileSize: SOCIAL_MEDIA_MAX_VIDEO_BYTES, files: 1 },
  });

  router.post("/media", async (req, res) => {
    await new Promise<void>((resolve, reject) => {
      mediaUpload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    }).catch((err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(422).json({ error: `File exceeds ${SOCIAL_MEDIA_MAX_VIDEO_BYTES} bytes` });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    });
    if (res.headersSent) return;

    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      return res.status(400).json({ error: "Missing file field 'file'" });
    }
    if (file.buffer.length <= 0) {
      return res.status(422).json({ error: "File is empty" });
    }

    const sniffed = sniffSocialMedia(file.buffer, file.originalname || "");
    if ("error" in sniffed) {
      return res.status(422).json({ error: sniffed.error });
    }
    const maxBytes = maxBytesFor(sniffed.kind);
    if (file.buffer.length > maxBytes) {
      const limitMb = Math.floor(maxBytes / (1024 * 1024));
      const nextStep =
        sniffed.kind === "video"
          ? `trim it or export at a lower resolution in CapCut and try again`
          : `resize or compress it and try again`;
      return res.status(422).json({
        error: `This ${sniffed.kind === "video" ? "video" : "photo"} is over the ${limitMb}MB limit — ${nextStep}.`,
      });
    }

    const stored = await storageService.putFile({
      companyId: COMPANY_ID,
      namespace: "socials/compose",
      originalFilename: file.originalname || null,
      contentType: sniffed.contentType,
      body: file.buffer,
    });

    res.status(201).json({
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      isVideo: sniffed.kind === "video",
      originalFilename: stored.originalFilename,
    });
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
      .select({ id: socialAccounts.id, status: socialAccounts.status, platform: socialAccounts.platform })
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

    // Platform-requirement guard (media presence, video-required, caption
    // length, attachment count) — the SAME pure check Compose runs client-side
    // (@paperclipai/shared) before enabling submit. This is the real trust
    // boundary: it must reject here too, in plain English, so a bad post never
    // reaches the relayer only to fail later against Zernio.
    const mediaUrls: string[] = Array.isArray(body.mediaUrls) ? body.mediaUrls.map(String) : [];
    const media: ComposeMediaRef[] = await Promise.all(
      mediaUrls.map(async (value) => ({ value, isVideo: await resolveIsVideoRef(storageService, value) })),
    );
    const guardProblem = checkComposeForPlatform({
      platform: account[0].platform,
      textLength: String(body.text).length,
      media,
    });
    if (guardProblem) {
      return res.status(400).json({ error: guardProblem });
    }

    // Two-tier publishing: non-admin employees create DRAFTS that wait for an
    // admin to approve (status 'pending_approval' — the relayer only drains
    // 'scheduled'). Admins publish directly. Either way we attribute the author.
    const status = isAdminActor(req) ? "scheduled" : "pending_approval";

    // Optional funnel linkage (the "post the hook" flow — Funnels.tsx sends
    // this when a hook caption is queued from a funnel's post-hook picker).
    // Never let a bad/foreign id reject the whole post — validate format,
    // confirm the funnel exists AND belongs to this company, and silently
    // drop it otherwise (matches the rest of this route's tolerant parsing).
    const payload: Record<string, unknown> =
      body.payload && typeof body.payload === "object" ? { ...body.payload } : {};
    if ("funnelId" in payload) {
      const funnelId = payload.funnelId;
      let ok = false;
      if (isValidFunnelIdFormat(funnelId)) {
        const funnelRows = await db
          .select({ id: funnels.id })
          .from(funnels)
          .where(and(eq(funnels.id, funnelId), eq(funnels.companyId, COMPANY_ID)))
          .limit(1);
        ok = Boolean(funnelRows[0]);
      }
      if (ok) {
        payload.funnelId = funnelId;
      } else {
        delete payload.funnelId;
      }
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
        status,
        maxAttempts: typeof body.maxAttempts === "number" ? body.maxAttempts : 3,
        payload,
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

  // Green-light board (Content Hub): per-keyword green/amber/red + stats,
  // composed from the DB mirror + latest analytics snapshots. Mirror-backed
  // and fast — NO live Zernio call here (shared rate limits; the UI's
  // explicit "Refresh from Zernio now" button hits GET /zernio/automations
  // instead, which refreshes the mirror as a side effect). Board-actor read;
  // exposes zero mutations.
  router.get("/zernio/greenlight", async (_req, res) => {
    try {
      const automations = await db
        .select()
        .from(zernioCommentAutomations)
        .orderBy(zernioCommentAutomations.name);
      const accounts = await db
        .select({ handle: socialAccounts.handle, oauthRef: socialAccounts.oauthRef })
        .from(socialAccounts)
        .where(and(eq(socialAccounts.companyId, COMPANY_ID), eq(socialAccounts.archived, false)));
      const snapshots = await latestZernioSnapshots(db);

      // oauthRef "zernio:<id>" → handle, for plain-English account labels.
      const handlesByZid = new Map<string, string>();
      for (const account of accounts) {
        if (account.oauthRef?.startsWith("zernio:") && account.handle) {
          handlesByZid.set(account.oauthRef.slice("zernio:".length), account.handle);
        }
      }
      // Accounts whose latest analytics snapshots hit the 402 add-on gate —
      // surfaced as addonMissing rows, never rendered as zeros.
      const addonGatedZids = new Set<string>();
      for (const snapshot of snapshots) {
        if (snapshot.addonMissing && snapshot.zernioAccountId) {
          addonGatedZids.add(snapshot.zernioAccountId);
        }
      }

      const rows = deriveGreenlightRows({
        automations,
        handlesByZid,
        addonGatedZids,
      });
      res.json({ rows, source: "mirror", generatedAt: new Date().toISOString() });
    } catch (err) {
      zernioErr(res, err);
    }
  });

  // Caption preset menu for clip production (Content Hub picker + content
  // agents choosing a `caption_clip.py --style <name>` value). Committed data
  // synced from the tool's STYLES dict — see the generated module header for
  // the refresh path. Static and read-only: no DB, no video engine on VPS4.
  router.get("/caption-styles", (_req, res) => {
    res.json({
      styles: CAPTION_STYLES,
      meta: CAPTION_STYLE_SYNC_META,
      usage:
        "python3 tools/caption_clip.py <video> --style <name> " +
        "(tool lives in the 6-2026-new-youtube-automation repo, not on this server)",
    });
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
    // Funnel-control gate (migration 0146): an account whose funnels_enabled is
    // false may not get new DM automations. Fail-closed — a Zernio account with
    // no social_accounts row is treated as disabled (onboard + enable it first).
    const gateRows = await db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.zernioAccountId, input.zernioAccountId))
      .limit(1);
    if (!gateRows[0]?.funnelsEnabled) {
      return res
        .status(409)
        .json({ error: "funnels are disabled for this account — enable funnels first" });
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

  // Per-funnel on/off. This flips the ZERNIO-SIDE automation (the local mirror
  // isActive alone does not stop DMs) and dual-writes the mirror. Re-activating
  // requires the account's funnels_enabled gate to be ON. If Zernio has no
  // PATCH support the service falls back to DELETE (off) / re-CREATE from the
  // mirror row (on — the automation gets a NEW Zernio id, written back here).
  router.patch("/zernio/automations/:automationId", requireAdmin, async (req, res) => {
    const automationId = req.params.automationId as string;
    const body = req.body ?? {};
    if (typeof body.isActive !== "boolean") {
      return res.status(400).json({ error: "isActive (boolean) required" });
    }
    if (!body.zernioAccountId || typeof body.zernioAccountId !== "string") {
      return res.status(400).json({ error: "zernioAccountId required" });
    }
    const isActive = body.isActive as boolean;
    const mirrorRows = await db
      .select()
      .from(zernioCommentAutomations)
      .where(eq(zernioCommentAutomations.zernioAutomationId, automationId))
      .limit(1);
    const mirror = mirrorRows[0];
    if (!mirror) return res.status(404).json({ error: "automation not found" });
    // The mirror row's accountId is authoritative (Zernio listings are
    // workspace-wide; never trust caller-supplied account scoping over it).
    const zid = mirror.zernioAccountId || String(body.zernioAccountId);

    if (isActive) {
      // Funnel-control gate (migration 0146): fail-closed — no social_accounts
      // row for this Zernio account means the gate was never enabled.
      const gateRows = await db
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.zernioAccountId, zid))
        .limit(1);
      if (!gateRows[0]?.funnelsEnabled) {
        return res
          .status(409)
          .json({ error: "funnels are disabled for this account — enable funnels first" });
      }
    }

    try {
      const result = await setZernioCommentAutomationActive(zid, automationId, isActive, mirror);
      const mirrorPatch: Record<string, unknown> = { isActive, updatedAt: sql`now()` };
      if (result.mechanism === "recreate") {
        // Re-create minted a NEW Zernio automation id — repoint the mirror row
        // so attribution and future toggles track the live automation.
        mirrorPatch.zernioAutomationId = result.zernioAutomationId;
        mirrorPatch.lastSyncedAt = sql`now()`;
      }
      await db
        .update(zernioCommentAutomations)
        .set(mirrorPatch)
        .where(eq(zernioCommentAutomations.zernioAutomationId, automationId));
      res.json({
        ok: true,
        isActive,
        mechanism: result.mechanism,
        zernioAutomationId: result.zernioAutomationId,
      });
    } catch (err) {
      zernioErr(res, err);
    }
  });

  // ----- funnel catalog (checked-in snapshot, board-gated read) -----

  router.get("/funnels/catalog", (_req, res) => {
    const catalog = loadFunnelCatalog();
    res.json({
      snapshotDate: catalog.snapshotDate,
      source: catalog.source,
      funnels: catalog.funnels,
    });
  });

  // ----- Funnel Library (BUILD PHASE 2) -----
  // Working table (funnels): AI-drafted + admin-authored funnel rows, lazily
  // seeded from the catalog above. See funnels-service.ts for the full
  // draft -> ready -> live -> retired lifecycle and every guard.

  const funnelErr = (res: Response, err: unknown): void => {
    if (err instanceof FunnelGuardError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    zernioErr(res, err);
  };

  router.get("/funnels", async (req, res) => {
    await ensureFunnelCatalogImported(db);
    const accountHandle = req.query.accountHandle as string | undefined;
    const status = req.query.status as string | undefined;
    const where = [eq(funnels.companyId, COMPANY_ID)];
    if (accountHandle) where.push(eq(funnels.accountHandle, accountHandle));
    if (status) where.push(eq(funnels.status, status));
    const rows = await db
      .select()
      .from(funnels)
      .where(and(...where))
      .orderBy(desc(funnels.updatedAt));
    res.json({ funnels: rows });
  });

  // Per funnels-capable account (zernioAccountId set): counts by status +
  // the 5-ready target. Powers the coverage meter chips and the "Accounts at
  // 5+ ready" KPI tile.
  router.get("/funnels/coverage", async (_req, res) => {
    try {
      const coverage = await computeFunnelCoverage(db);
      res.json({ coverage });
    } catch (err) {
      logger.error({ err }, "funnels coverage failed");
      res.status(500).json({ error: "coverage failed" });
    }
  });

  // "Post the hook" status — every social_posts row linked to this funnel via
  // payload.funnelId (see POST /posts above), newest first. Powers the
  // library row's hook-post StatusBadges + the "nothing is telling people to
  // comment KEYWORD yet" amber callout on live funnels with none.
  router.get("/funnels/:id/posts", async (req, res) => {
    const id = req.params.id as string;
    const funnelRows = await db
      .select({ id: funnels.id })
      .from(funnels)
      .where(and(eq(funnels.id, id), eq(funnels.companyId, COMPANY_ID)))
      .limit(1);
    if (!funnelRows[0]) return res.status(404).json({ error: "funnel not found" });

    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = await db
      .select({
        id: socialPosts.id,
        socialAccountId: socialPosts.socialAccountId,
        text: socialPosts.text,
        status: socialPosts.status,
        scheduledAt: socialPosts.scheduledAt,
        postedAt: socialPosts.postedAt,
        postedUrl: socialPosts.postedUrl,
        createdAt: socialPosts.createdAt,
        platform: socialAccounts.platform,
        handle: socialAccounts.handle,
      })
      .from(socialPosts)
      .innerJoin(socialAccounts, eq(socialAccounts.id, socialPosts.socialAccountId))
      .where(sql`${socialPosts.payload} ->> 'funnelId' = ${id}`)
      .orderBy(desc(socialPosts.createdAt))
      .limit(limit);
    res.json({ posts: rows });
  });

  // Admin-authored funnel (draft by default) — distinct from AI drafting
  // (POST /funnels/generate below).
  router.post("/funnels", requireAdmin, async (req, res) => {
    const body = req.body ?? {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const accountHandle = typeof body.accountHandle === "string" ? body.accountHandle.trim() : "";
    if (!name || !accountHandle) {
      return res.status(400).json({ error: "name and accountHandle required" });
    }
    const style = body.style === "controversial" || body.style === "weird" ? body.style : "standard";
    const matchMode = body.matchMode === "exact" ? "exact" : "contains";
    const accountRows = await db
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.companyId, COMPANY_ID),
          eq(socialAccounts.handle, accountHandle),
          eq(socialAccounts.archived, false),
        ),
      )
      .limit(1);
    const inserted = await db
      .insert(funnels)
      .values({
        companyId: COMPANY_ID,
        name,
        accountHandle,
        socialAccountId: accountRows[0]?.id ?? null,
        keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : [],
        matchMode,
        dmMessage: typeof body.dmMessage === "string" ? body.dmMessage : "",
        destinationUrl: body.destinationUrl ? String(body.destinationUrl) : null,
        postHooks: Array.isArray(body.postHooks) ? body.postHooks.map(String) : [],
        style,
        tosRisk: body.tosRisk ? String(body.tosRisk) : null,
        notes: body.notes ? String(body.notes) : null,
        status: "draft",
        createdBy: actorUserId(req) ?? "admin",
      })
      .returning();
    res.status(201).json({ funnel: inserted[0] });
  });

  // Edit an editable (draft/ready) funnel. Live/retired rows are immutable
  // here — retire a live funnel before drafting its replacement.
  router.patch("/funnels/:id", requireAdmin, async (req, res) => {
    const id = req.params.id as string;
    const existing = await db
      .select()
      .from(funnels)
      .where(and(eq(funnels.id, id), eq(funnels.companyId, COMPANY_ID)))
      .limit(1);
    const row = existing[0];
    if (!row) return res.status(404).json({ error: "funnel not found" });
    if (row.status === "live" || row.status === "retired") {
      return res.status(409).json({ error: `cannot edit a '${row.status}' funnel` });
    }
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (Array.isArray(body.keywords)) patch.keywords = body.keywords.map(String);
    if (body.matchMode === "exact" || body.matchMode === "contains") patch.matchMode = body.matchMode;
    if (typeof body.dmMessage === "string") patch.dmMessage = body.dmMessage;
    if (body.destinationUrl === null || typeof body.destinationUrl === "string") {
      patch.destinationUrl = body.destinationUrl;
    }
    if (Array.isArray(body.postHooks)) patch.postHooks = body.postHooks.map(String);
    if (body.style === "standard" || body.style === "controversial" || body.style === "weird") {
      patch.style = body.style;
    }
    if (body.tosRisk === null || typeof body.tosRisk === "string") patch.tosRisk = body.tosRisk;
    if (body.notes === null || typeof body.notes === "string") patch.notes = body.notes;
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "no fields to update" });
    patch.updatedAt = sql`now()`;
    const updated = await db.update(funnels).set(patch).where(eq(funnels.id, id)).returning();
    res.json({ funnel: updated[0] });
  });

  router.post("/funnels/:id/approve", requireAdmin, async (req, res) => {
    try {
      const funnel = await approveFunnel(db, req.params.id as string, actorUserId(req));
      res.json({ funnel });
    } catch (err) {
      funnelErr(res, err);
    }
  });

  router.post("/funnels/:id/reject", requireAdmin, async (req, res) => {
    try {
      const funnel = await rejectFunnel(db, req.params.id as string);
      res.json({ funnel });
    } catch (err) {
      funnelErr(res, err);
    }
  });

  // Requires status='ready' + the account's funnels_enabled gate on; creates
  // the real Zernio comment automation (existing create function) and flips
  // status -> live. On a Zernio failure the row stays 'ready' — never
  // silently mark something live that Zernio rejected.
  router.post("/funnels/:id/arm", requireAdmin, async (req, res) => {
    try {
      const funnel = await armFunnel(db, req.params.id as string);
      res.json({ funnel });
    } catch (err) {
      funnelErr(res, err);
    }
  });

  // Requires status='ready' or 'live'; if live, deletes the Zernio automation
  // first (tolerating an already-gone 404) then flips status -> retired.
  router.post("/funnels/:id/retire", requireAdmin, async (req, res) => {
    try {
      const funnel = await retireFunnel(db, req.params.id as string);
      res.json({ funnel });
    } catch (err) {
      funnelErr(res, err);
    }
  });

  // AI-draft new funnels for one account (status='draft' — always awaits
  // human approval). Same generator the daily socials:funnel-topup cron
  // calls; see funnels-service.ts for the prompt + defensive parser.
  router.post("/funnels/generate", requireAdmin, async (req, res) => {
    const body = req.body ?? {};
    const accountHandle = typeof body.accountHandle === "string" ? body.accountHandle.trim() : "";
    if (!accountHandle) return res.status(400).json({ error: "accountHandle required" });
    const count = typeof body.count === "number" ? body.count : undefined;
    const styles = Array.isArray(body.styles)
      ? (body.styles.filter((s: unknown) => typeof s === "string") as FunnelStyle[])
      : undefined;
    try {
      const result = await generateFunnelDraftsForAccount(db, accountHandle, { count, styles });
      res.status(201).json(result);
    } catch (err) {
      logger.error({ err, accountHandle }, "funnels generate failed");
      res.status(502).json({ error: err instanceof Error ? err.message : "generation failed" });
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

  // ----- Inspiration board (Phase 3) -----
  // Paste-a-link board: any marketing user can add/read; only the item's
  // creator or an admin can delete/archive it. The daily-brief cron reviews
  // every 'new' row once a day and writes ai_comment (see services/socials/daily-brief.ts).

  router.get("/inspiration", async (req, res) => {
    const status = req.query.status as string | undefined;
    const where = [eq(inspirationItems.companyId, COMPANY_ID)];
    if (status) where.push(eq(inspirationItems.status, status));
    const rows = await db
      .select()
      .from(inspirationItems)
      .where(and(...where))
      .orderBy(desc(inspirationItems.createdAt));
    res.json({ items: rows });
  });

  router.post("/inspiration", async (req, res) => {
    const body = req.body ?? {};
    if (!validateInspirationUrl(body.url)) {
      return res.status(400).json({ error: "a valid http(s) url is required" });
    }
    const inserted = await db
      .insert(inspirationItems)
      .values({
        companyId: COMPANY_ID,
        url: String(body.url).trim(),
        note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
        addedByUserId: actorUserId(req),
      })
      .returning();
    res.status(201).json({ item: inserted[0] });
  });

  router.delete("/inspiration/:id", async (req, res) => {
    const id = req.params.id as string;
    const found = await db
      .select()
      .from(inspirationItems)
      .where(and(eq(inspirationItems.id, id), eq(inspirationItems.companyId, COMPANY_ID)))
      .limit(1);
    const item = found[0];
    if (!item) return res.status(404).json({ error: "not found" });
    if (!isAdminActor(req) && item.addedByUserId !== actorUserId(req)) {
      return res.status(403).json({ error: "only the item's creator or an admin can delete it" });
    }
    await db.delete(inspirationItems).where(eq(inspirationItems.id, id));
    res.json({ ok: true });
  });

  router.post("/inspiration/:id/archive", async (req, res) => {
    const id = req.params.id as string;
    const found = await db
      .select()
      .from(inspirationItems)
      .where(and(eq(inspirationItems.id, id), eq(inspirationItems.companyId, COMPANY_ID)))
      .limit(1);
    const item = found[0];
    if (!item) return res.status(404).json({ error: "not found" });
    if (!isAdminActor(req) && item.addedByUserId !== actorUserId(req)) {
      return res.status(403).json({ error: "only the item's creator or an admin can archive it" });
    }
    const updated = await db
      .update(inspirationItems)
      .set({ status: "archived" })
      .where(eq(inspirationItems.id, id))
      .returning();
    res.json({ item: updated[0] });
  });

  // ----- Daily AI Brief (Phase 3) -----
  // See services/socials/daily-brief.ts for the cron that writes these rows
  // (socials:daily-brief, daily 07:15, after socials:zernio-analytics 06:40).

  router.get("/briefs", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 90);
    const rows = await db
      .select({
        briefDate: dailyBriefs.briefDate,
        model: dailyBriefs.model,
        createdAt: dailyBriefs.createdAt,
      })
      .from(dailyBriefs)
      .where(eq(dailyBriefs.companyId, COMPANY_ID))
      .orderBy(desc(dailyBriefs.briefDate))
      .limit(limit);
    res.json({ briefs: rows });
  });

  router.get("/briefs/latest", async (_req, res) => {
    const rows = await db
      .select()
      .from(dailyBriefs)
      .where(eq(dailyBriefs.companyId, COMPANY_ID))
      .orderBy(desc(dailyBriefs.briefDate))
      .limit(1);
    if (!rows[0]) return res.status(404).json({ error: "no brief yet" });
    res.json({ brief: rows[0] });
  });

  router.get("/briefs/:date", async (req, res) => {
    const date = req.params.date as string;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }
    const rows = await db
      .select()
      .from(dailyBriefs)
      .where(and(eq(dailyBriefs.companyId, COMPANY_ID), eq(dailyBriefs.briefDate, date)))
      .limit(1);
    if (!rows[0]) return res.status(404).json({ error: "no brief for that date" });
    res.json({ brief: rows[0] });
  });

  // Force a brief run now (same tick the socials:daily-brief cron runs).
  router.post("/briefs/run-now", requireAdmin, async (_req, res) => {
    try {
      const result = await runDailyBriefTick(db);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "daily-brief run-now failed");
      res.status(500).json({ error: "brief run failed" });
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
