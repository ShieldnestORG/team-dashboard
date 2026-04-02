import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type {
  ToolRunContext,
  ToolResult,
  PluginContext,
  PluginJobContext,
  PluginWebhookInput,
} from "@paperclipai/plugin-sdk";
import type {
  TwitterConfig,
  TweetQueueData,
  MissionData,
  MissionStep,
  TargetData,
  ExtractedTweetData,
  ExtractedProfileData,
  ActionLogData,
  ExtensionSession,
  DailyAnalytics,
  ExtPollResponse,
  ExtResultPayload,
  ExtProgressPayload,
  ExtHeartbeatPayload,
} from "./types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getConfig(ctx: PluginContext): Promise<TwitterConfig> {
  const raw = await ctx.config.get();
  return {
    extensionSecret: (raw.extensionSecret as string) || "",
    defaultVenture: (raw.defaultVenture as string) || "coherencedaddy",
    maxQueueSize: (raw.maxQueueSize as number) || 100,
    enableAutoEngage: (raw.enableAutoEngage as boolean) || false,
  };
}

function validateExtensionAuth(
  headers: Record<string, string | string[]>,
  secret: string,
): boolean {
  if (!secret) return true; // No secret configured = open
  const auth = headers["authorization"] || headers["Authorization"];
  const token = typeof auth === "string" ? auth : Array.isArray(auth) ? auth[0] : "";
  return token === `Bearer ${secret}` || token === secret;
}

async function getDailyAnalytics(
  ctx: PluginContext,
  date: string,
): Promise<DailyAnalytics> {
  const stored = await ctx.state.get({
    scopeKind: "instance",
    namespace: "analytics",
    stateKey: `daily-${date}`,
  });
  if (stored) return stored as unknown as DailyAnalytics;
  return {
    date,
    postsSent: 0,
    postsQueued: 0,
    postsFailed: 0,
    likes: 0,
    reposts: 0,
    follows: 0,
    replies: 0,
    extractions: 0,
    profileExtractions: 0,
  };
}

async function saveDailyAnalytics(
  ctx: PluginContext,
  analytics: DailyAnalytics,
): Promise<void> {
  await ctx.state.set(
    {
      scopeKind: "instance",
      namespace: "analytics",
      stateKey: `daily-${analytics.date}`,
    },
    analytics as unknown as Record<string, unknown>,
  );
}

async function incrementAnalytics(
  ctx: PluginContext,
  field: keyof Omit<DailyAnalytics, "date">,
  amount = 1,
): Promise<void> {
  const analytics = await getDailyAnalytics(ctx, todayKey());
  (analytics[field] as number) += amount;
  await saveDailyAnalytics(ctx, analytics);
}

// ─── Module-level context (for onWebhook / onHealth which don't receive ctx) ─

let currentContext: PluginContext | null = null;

// ─── Plugin definition ────────────────────────────────────────────────────────

const plugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;
    ctx.logger.info("Twitter/X plugin v0.1.0 ready — extension bridge active");

    // ══════════════════════════════════════════════════════════════════════════
    // TOOLS — Agent-facing operations
    // ══════════════════════════════════════════════════════════════════════════

    // ── queue-post ────────────────────────────────────────────────────────────

    ctx.tools.register(
      "queue-post",
      {
        displayName: "Twitter: Queue Post",
        description: "Queue a tweet for the extension to post.",
        parametersSchema: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string", maxLength: 280 },
            mediaUrls: { type: "array", items: { type: "string" }, maxItems: 4 },
            hashtags: { type: "array", items: { type: "string" } },
            scheduledAt: { type: "string" },
            venture: { type: "string" },
          },
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as {
          text: string;
          mediaUrls?: string[];
          hashtags?: string[];
          scheduledAt?: string;
          venture?: string;
        };
        const config = await getConfig(ctx);

        // Check queue capacity
        const pending = await ctx.entities.list({
          entityType: "tweet-queue",
          limit: config.maxQueueSize + 1,
        });
        const pendingCount = pending.filter(
          (e) => (e.data as unknown as TweetQueueData).action === "POST" &&
            (e.status === "pending" || e.status === "claimed"),
        ).length;
        if (pendingCount >= config.maxQueueSize) {
          return { error: `Queue full (${pendingCount}/${config.maxQueueSize}). Wait for items to be posted or increase maxQueueSize.` };
        }

        const id = uuid();
        const data: TweetQueueData = {
          action: "POST",
          text: p.text,
          mediaUrls: p.mediaUrls,
          hashtags: p.hashtags,
          scheduledAt: p.scheduledAt,
          venture: p.venture || config.defaultVenture,
          queuedBy: runCtx.agentId,
          queuedAt: now(),
          retryCount: 0,
        };

        await ctx.entities.upsert({
          entityType: "tweet-queue",
          scopeKind: "instance",
          externalId: id,
          title: p.text.slice(0, 80),
          status: "pending",
          data: data as unknown as Record<string, unknown>,
        });

        await incrementAnalytics(ctx, "postsQueued");
        ctx.logger.info(`Queued post: ${id}`, { text: p.text.slice(0, 50) });

        return {
          content: `Queued tweet (id: ${id}). The extension will post it on its next poll cycle.${p.scheduledAt ? ` Scheduled for: ${p.scheduledAt}` : ""}`,
          data: { queueItemId: id, status: "pending" },
        };
      },
    );

    // ── queue-reply ───────────────────────────────────────────────────────────

    ctx.tools.register(
      "queue-reply",
      {
        displayName: "Twitter: Queue Reply",
        description: "Queue a reply to a specific tweet.",
        parametersSchema: {
          type: "object",
          required: ["replyToUrl", "text"],
          properties: {
            replyToUrl: { type: "string" },
            text: { type: "string", maxLength: 280 },
            venture: { type: "string" },
          },
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { replyToUrl: string; text: string; venture?: string };
        const config = await getConfig(ctx);
        const id = uuid();
        const data: TweetQueueData = {
          action: "REPLY",
          text: p.text,
          replyToUrl: p.replyToUrl,
          venture: p.venture || config.defaultVenture,
          queuedBy: runCtx.agentId,
          queuedAt: now(),
          retryCount: 0,
        };

        await ctx.entities.upsert({
          entityType: "tweet-queue",
          scopeKind: "instance",
          externalId: id,
          title: `Reply: ${p.text.slice(0, 60)}`,
          status: "pending",
          data: data as unknown as Record<string, unknown>,
        });

        return {
          content: `Queued reply (id: ${id}) to ${p.replyToUrl}`,
          data: { queueItemId: id, status: "pending" },
        };
      },
    );

    // ── queue-repost ──────────────────────────────────────────────────────────

    ctx.tools.register(
      "queue-repost",
      {
        displayName: "Twitter: Queue Repost",
        description: "Queue a repost of a specific tweet.",
        parametersSchema: {
          type: "object",
          required: ["repostUrl"],
          properties: {
            repostUrl: { type: "string" },
            venture: { type: "string" },
          },
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { repostUrl: string; venture?: string };
        const config = await getConfig(ctx);
        const id = uuid();
        const data: TweetQueueData = {
          action: "REPOST",
          repostUrl: p.repostUrl,
          venture: p.venture || config.defaultVenture,
          queuedBy: runCtx.agentId,
          queuedAt: now(),
          retryCount: 0,
        };

        await ctx.entities.upsert({
          entityType: "tweet-queue",
          scopeKind: "instance",
          externalId: id,
          title: `Repost: ${p.repostUrl}`,
          status: "pending",
          data: data as unknown as Record<string, unknown>,
        });

        return {
          content: `Queued repost (id: ${id}) of ${p.repostUrl}`,
          data: { queueItemId: id, status: "pending" },
        };
      },
    );

    // ── create-mission ────────────────────────────────────────────────────────

    ctx.tools.register(
      "create-mission",
      {
        displayName: "Twitter: Create Mission",
        description: "Define a multi-step engagement mission.",
        parametersSchema: {
          type: "object",
          required: ["steps"],
          properties: {
            name: { type: "string" },
            steps: {
              type: "array",
              items: {
                type: "object",
                required: ["action"],
                properties: {
                  action: { type: "string" },
                  params: { type: "object" },
                  expected_view: { type: "string" },
                },
              },
            },
          },
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { name?: string; steps: MissionStep[] };
        const config = await getConfig(ctx);
        const id = uuid();
        const initialStatus = config.enableAutoEngage ? "active" : "pending";

        const data: MissionData = {
          name: p.name,
          steps: p.steps,
          currentStep: 0,
          createdBy: runCtx.agentId,
          createdAt: now(),
          results: [],
        };

        await ctx.entities.upsert({
          entityType: "mission",
          scopeKind: "instance",
          externalId: id,
          title: p.name || `Mission (${p.steps.length} steps)`,
          status: initialStatus,
          data: data as unknown as Record<string, unknown>,
        });

        ctx.logger.info(`Created mission: ${id} with ${p.steps.length} steps`);

        return {
          content: `Created mission (id: ${id}, ${p.steps.length} steps, status: ${initialStatus}).${!config.enableAutoEngage ? " Auto-engage is off — mission is pending until manually activated." : ""}`,
          data: { missionId: id, status: initialStatus, stepCount: p.steps.length },
        };
      },
    );

    // ── add-target ────────────────────────────────────────────────────────────

    ctx.tools.register(
      "add-target",
      {
        displayName: "Twitter: Add Target",
        description: "Add a Twitter account to the engagement target list.",
        parametersSchema: {
          type: "object",
          required: ["handle"],
          properties: {
            handle: { type: "string" },
            displayName: { type: "string" },
            engageActions: { type: "array", items: { type: "string" } },
            venture: { type: "string" },
          },
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as {
          handle: string;
          displayName?: string;
          engageActions?: string[];
          venture?: string;
        };
        const config = await getConfig(ctx);
        const handle = p.handle.replace(/^@/, "");

        const data: TargetData = {
          handle,
          displayName: p.displayName,
          profileUrl: `https://x.com/${handle}`,
          engageActions: p.engageActions || ["LIKE"],
          addedBy: runCtx.agentId,
          addedAt: now(),
          engagementCount: 0,
          venture: p.venture || config.defaultVenture,
        };

        await ctx.entities.upsert({
          entityType: "target",
          scopeKind: "instance",
          externalId: handle.toLowerCase(),
          title: p.displayName || `@${handle}`,
          status: "active",
          data: data as unknown as Record<string, unknown>,
        });

        return {
          content: `Added target @${handle} with actions: ${data.engageActions.join(", ")}`,
          data: { handle, status: "active" },
        };
      },
    );

    // ── remove-target ─────────────────────────────────────────────────────────

    ctx.tools.register(
      "remove-target",
      {
        displayName: "Twitter: Remove Target",
        description: "Remove a target from the engagement list.",
        parametersSchema: {
          type: "object",
          required: ["handle"],
          properties: { handle: { type: "string" } },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { handle: string };
        const handle = p.handle.replace(/^@/, "").toLowerCase();

        const existing = await ctx.entities.list({
          entityType: "target",
          externalId: handle,
          limit: 1,
        });

        if (existing.length === 0) {
          return { error: `Target @${handle} not found.` };
        }

        await ctx.entities.upsert({
          entityType: "target",
          scopeKind: "instance",
          externalId: handle,
          title: existing[0].title || `@${handle}`,
          status: "removed",
          data: { ...existing[0].data, removedAt: now() },
        });

        return { content: `Removed target @${handle}` };
      },
    );

    // ── list-targets ──────────────────────────────────────────────────────────

    ctx.tools.register(
      "list-targets",
      {
        displayName: "Twitter: List Targets",
        description: "Query engagement targets.",
        parametersSchema: {
          type: "object",
          properties: {
            status: { type: "string", default: "active" },
            venture: { type: "string" },
            limit: { type: "number", default: 50 },
          },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { status?: string; venture?: string; limit?: number };
        const all = await ctx.entities.list({
          entityType: "target",
          limit: p.limit || 50,
        });

        let filtered = all;
        if (p.status) {
          filtered = filtered.filter((e) => e.status === p.status);
        }
        if (p.venture) {
          filtered = filtered.filter(
            (e) => (e.data as unknown as TargetData).venture === p.venture,
          );
        }

        const targets = filtered.map((e) => {
          const d = e.data as unknown as TargetData;
          return {
            handle: d.handle,
            displayName: d.displayName,
            engageActions: d.engageActions,
            engagementCount: d.engagementCount,
            venture: d.venture,
            status: e.status,
          };
        });

        return {
          content: `Found ${targets.length} targets:\n${targets.map((t) => `  @${t.handle} — ${t.engageActions.join(",")} (${t.engagementCount} engagements)`).join("\n")}`,
          data: { targets, total: targets.length },
        };
      },
    );

    // ── query-extracts ────────────────────────────────────────────────────────

    ctx.tools.register(
      "query-extracts",
      {
        displayName: "Twitter: Query Extracted Data",
        description: "Search extracted tweets and profiles.",
        parametersSchema: {
          type: "object",
          properties: {
            entityType: { type: "string", default: "extracted-tweet" },
            limit: { type: "number", default: 20 },
          },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { entityType?: string; limit?: number };
        const entityType = p.entityType || "extracted-tweet";

        const results = await ctx.entities.list({
          entityType,
          limit: p.limit || 20,
        });

        if (entityType === "extracted-tweet") {
          const tweets = results.map((e) => {
            const d = e.data as unknown as ExtractedTweetData;
            return {
              url: d.tweetUrl,
              author: d.authorHandle,
              text: d.text,
              likes: d.likes,
              reposts: d.reposts,
              extractedAt: d.extractedAt,
            };
          });
          return {
            content: `Found ${tweets.length} extracted tweets:\n${tweets.map((t) => `  @${t.author}: ${t.text?.slice(0, 100)}`).join("\n")}`,
            data: { tweets, total: tweets.length },
          };
        } else {
          const profiles = results.map((e) => {
            const d = e.data as unknown as ExtractedProfileData;
            return {
              handle: d.handle,
              displayName: d.displayName,
              bio: d.bio,
              followers: d.followers,
              following: d.following,
              verified: d.verified,
            };
          });
          return {
            content: `Found ${profiles.length} extracted profiles:\n${profiles.map((p) => `  @${p.handle} (${p.followers} followers)`).join("\n")}`,
            data: { profiles, total: profiles.length },
          };
        }
      },
    );

    // ── get-queue-status ──────────────────────────────────────────────────────

    ctx.tools.register(
      "get-queue-status",
      {
        displayName: "Twitter: Queue Status",
        description: "Check content queue depth.",
        parametersSchema: {
          type: "object",
          properties: { venture: { type: "string" } },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { venture?: string };
        const all = await ctx.entities.list({
          entityType: "tweet-queue",
          limit: 500,
        });

        let items = all;
        if (p.venture) {
          items = items.filter(
            (e) => (e.data as unknown as TweetQueueData).venture === p.venture,
          );
        }

        const counts = { pending: 0, claimed: 0, posted: 0, failed: 0, cancelled: 0 };
        for (const e of items) {
          const status = e.status as keyof typeof counts;
          if (status in counts) counts[status]++;
        }

        // Check extension health
        const session = await ctx.state.get({
          scopeKind: "instance",
          namespace: "extension-session",
          stateKey: "current",
        }) as unknown as ExtensionSession | null;

        const extensionOnline = session
          ? Date.now() - new Date(session.lastHeartbeat).getTime() < 2 * 60 * 1000
          : false;

        return {
          content: `Queue: ${counts.pending} pending, ${counts.claimed} claimed, ${counts.posted} posted, ${counts.failed} failed.\nExtension: ${extensionOnline ? "online" : "offline"}${session ? ` (bot ${session.botEnabled ? "enabled" : "disabled"})` : ""}`,
          data: { counts, extensionOnline, totalItems: items.length },
        };
      },
    );

    // ── get-analytics ─────────────────────────────────────────────────────────

    ctx.tools.register(
      "get-analytics",
      {
        displayName: "Twitter: Get Analytics",
        description: "Posting and engagement analytics.",
        parametersSchema: {
          type: "object",
          properties: { days: { type: "number", default: 7 } },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { days?: number };
        const days = p.days || 7;
        const results: DailyAnalytics[] = [];

        for (let i = 0; i < days; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          results.push(await getDailyAnalytics(ctx, key));
        }

        const totals = results.reduce(
          (acc, day) => ({
            postsSent: acc.postsSent + day.postsSent,
            postsQueued: acc.postsQueued + day.postsQueued,
            postsFailed: acc.postsFailed + day.postsFailed,
            likes: acc.likes + day.likes,
            reposts: acc.reposts + day.reposts,
            follows: acc.follows + day.follows,
            replies: acc.replies + day.replies,
            extractions: acc.extractions + day.extractions,
          }),
          { postsSent: 0, postsQueued: 0, postsFailed: 0, likes: 0, reposts: 0, follows: 0, replies: 0, extractions: 0 },
        );

        return {
          content: `Twitter analytics (last ${days} days):\n  Posts sent: ${totals.postsSent}\n  Posts queued: ${totals.postsQueued}\n  Posts failed: ${totals.postsFailed}\n  Likes: ${totals.likes}\n  Reposts: ${totals.reposts}\n  Follows: ${totals.follows}\n  Replies: ${totals.replies}\n  Extractions: ${totals.extractions}`,
          data: { totals, daily: results },
        };
      },
    );

    // ── claim-next-post (extension-facing) ──────────────────────────────────

    ctx.tools.register(
      "claim-next-post",
      {
        displayName: "Twitter: Claim Next Post",
        description: "Claim the next pending tweet from the queue. Returns the tweet content for the extension to post. Marks it as claimed.",
        parametersSchema: { type: "object", properties: {} },
      },
      async (): Promise<ToolResult> => {
        const queueItems = await ctx.entities.list({
          entityType: "tweet-queue",
          limit: 50,
        });

        const nowStr = now();
        const pending = queueItems
          .filter((e) => e.status === "pending")
          .filter((e) => {
            const d = e.data as unknown as TweetQueueData;
            return !d.scheduledAt || d.scheduledAt <= nowStr;
          })
          .sort((a, b) => {
            const aTime = (a.data as unknown as TweetQueueData).queuedAt || "";
            const bTime = (b.data as unknown as TweetQueueData).queuedAt || "";
            return aTime.localeCompare(bTime);
          });

        if (pending.length === 0) {
          return { content: "No pending tweets in queue", data: { empty: true } };
        }

        const item = pending[0];
        const d = item.data as unknown as TweetQueueData;

        // Mark as claimed
        await ctx.entities.upsert({
          entityType: "tweet-queue",
          scopeKind: "instance",
          externalId: item.externalId || "",
          title: item.title || "",
          status: "claimed",
          data: { ...item.data, claimedAt: now() },
        });

        // Build the full text with hashtags
        let text = d.text || "";
        if (d.hashtags && d.hashtags.length > 0) {
          const tags = d.hashtags.map((h: string) => h.startsWith("#") ? h : `#${h}`).join(" ");
          text += `\n\n${tags}`;
        }

        ctx.logger.info(`Claimed post: ${item.externalId}`, { text: text.slice(0, 50) });

        return {
          content: text,
          data: {
            id: item.externalId,
            text,
            action: d.action,
            mediaUrls: d.mediaUrls || [],
            hashtags: d.hashtags || [],
            replyToUrl: d.replyToUrl,
            repostUrl: d.repostUrl,
          },
        };
      },
    );

    // ── report-post-result (extension-facing) ─────────────────────────────

    ctx.tools.register(
      "report-post-result",
      {
        displayName: "Twitter: Report Post Result",
        description: "Report the result of a posted tweet back to the dashboard.",
        parametersSchema: {
          type: "object",
          required: ["queueItemId", "success"],
          properties: {
            queueItemId: { type: "string" },
            success: { type: "boolean" },
            tweetUrl: { type: "string" },
            error: { type: "string" },
          },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { queueItemId: string; success: boolean; tweetUrl?: string; error?: string };

        const items = await ctx.entities.list({
          entityType: "tweet-queue",
          externalId: p.queueItemId,
          limit: 1,
        });

        if (items.length === 0) {
          return { error: `Queue item ${p.queueItemId} not found` };
        }

        const item = items[0];
        await ctx.entities.upsert({
          entityType: "tweet-queue",
          scopeKind: "instance",
          externalId: item.externalId || "",
          title: item.title || "",
          status: p.success ? "posted" : "failed",
          data: {
            ...item.data,
            completedAt: now(),
            tweetUrl: p.tweetUrl,
            error: p.error,
          },
        });

        if (p.success) {
          await incrementAnalytics(ctx, "postsSent");
        } else {
          await incrementAnalytics(ctx, "postsFailed");
        }

        return {
          content: p.success ? `Posted successfully: ${p.tweetUrl || ""}` : `Failed: ${p.error || "unknown"}`,
          data: { status: p.success ? "posted" : "failed" },
        };
      },
    );

    // ══════════════════════════════════════════════════════════════════════════
    // JOBS — Scheduled maintenance
    // ══════════════════════════════════════════════════════════════════════════

    ctx.jobs.register("queue-cleanup", async (_job: PluginJobContext) => {
      ctx.logger.info("Running queue cleanup");
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const completed = await ctx.entities.list({
        entityType: "tweet-queue",
        limit: 500,
      });

      let archived = 0;
      for (const entity of completed) {
        const data = entity.data as unknown as TweetQueueData;
        if (
          (entity.status === "posted" || entity.status === "failed") &&
          data.completedAt &&
          data.completedAt < cutoff
        ) {
          await ctx.entities.upsert({
            entityType: "tweet-queue",
            scopeKind: "instance",
            externalId: entity.externalId || "",
            title: entity.title || "",
            status: "cancelled", // reuse as "archived"
            data: { ...entity.data, archivedAt: now() },
          });
          archived++;
        }
      }

      ctx.logger.info(`Queue cleanup: archived ${archived} items`);
    });

    ctx.jobs.register("analytics-rollup", async (_job: PluginJobContext) => {
      ctx.logger.info("Running analytics rollup");
      // Action logs from today are already counted incrementally.
      // This job could compute additional aggregates if needed.
      const today = todayKey();
      const analytics = await getDailyAnalytics(ctx, today);
      ctx.logger.info(`Daily analytics for ${today}`, analytics as unknown as Record<string, unknown>);
    });
  },

  // ══════════════════════════════════════════════════════════════════════════
  // WEBHOOKS — Extension communication endpoints
  // ══════════════════════════════════════════════════════════════════════════

  async onWebhook(input: PluginWebhookInput): Promise<void> {
    const ctx = currentContext;
    if (!ctx) throw new Error("Plugin not initialized");

    const config = await getConfig(ctx);

    // Validate extension auth
    if (!validateExtensionAuth(input.headers, config.extensionSecret)) {
      throw new Error("Unauthorized: invalid extension secret");
    }

    switch (input.endpointKey) {
      // ── ext-poll: Extension asks for next work item ──────────────────────
      case "ext-poll": {
        // Find oldest pending queue item
        const queueItems = await ctx.entities.list({
          entityType: "tweet-queue",
          limit: 50,
        });
        const pending = queueItems
          .filter((e) => e.status === "pending")
          .sort((a, b) => {
            const aTime = (a.data as unknown as TweetQueueData).queuedAt || "";
            const bTime = (b.data as unknown as TweetQueueData).queuedAt || "";
            return aTime.localeCompare(bTime);
          });

        // Check for scheduled items — only serve if scheduledAt <= now
        const nowStr = now();
        const ready = pending.find((e) => {
          const d = e.data as unknown as TweetQueueData;
          return !d.scheduledAt || d.scheduledAt <= nowStr;
        });

        let queueResponse: ExtPollResponse["queueItem"] = null;
        if (ready) {
          const d = ready.data as unknown as TweetQueueData;
          // Mark as claimed
          await ctx.entities.upsert({
            entityType: "tweet-queue",
            scopeKind: "instance",
            externalId: ready.externalId || "",
            title: ready.title || "",
            status: "claimed",
            data: { ...ready.data, claimedAt: now() },
          });
          queueResponse = {
            id: ready.externalId || ready.id,
            action: d.action,
            text: d.text,
            mediaUrls: d.mediaUrls,
            hashtags: d.hashtags,
            replyToUrl: d.replyToUrl,
            repostUrl: d.repostUrl,
          };
        }

        // Find active missions
        const missions = await ctx.entities.list({ entityType: "mission", limit: 10 });
        const activeMission = missions.find((e) => e.status === "active");
        let missionResponse: ExtPollResponse["mission"] = null;
        if (activeMission) {
          const md = activeMission.data as unknown as MissionData;
          missionResponse = {
            id: activeMission.externalId || activeMission.id,
            steps: md.steps,
            currentStep: md.currentStep,
          };
        }

        // Get active targets
        const targetEntities = await ctx.entities.list({ entityType: "target", limit: 100 });
        const targets = targetEntities
          .filter((e) => e.status === "active")
          .map((e) => {
            const td = e.data as unknown as TargetData;
            return { handle: td.handle, engageActions: td.engageActions };
          });

        // Store the response in state so the host webhook route can return it
        await ctx.state.set(
          { scopeKind: "instance", namespace: "webhook-response", stateKey: "ext-poll" },
          { queueItem: queueResponse, mission: missionResponse, targets } as unknown as Record<string, unknown>,
        );

        ctx.logger.info("ext-poll served", {
          hasQueue: !!queueResponse,
          hasMission: !!missionResponse,
          targetCount: targets.length,
        });
        break;
      }

      // ── ext-result: Extension reports action outcome ─────────────────────
      case "ext-result": {
        const payload = (input.parsedBody || JSON.parse(input.rawBody)) as ExtResultPayload;

        // Log the action
        const logData: ActionLogData = {
          action: payload.action || payload.type,
          targetUrl: payload.tweetUrl,
          queueItemId: payload.queueItemId,
          missionId: payload.missionId,
          performedAt: now(),
          durationMs: payload.durationMs,
          error: payload.error,
          extensionSessionId: payload.sessionId,
        };

        await ctx.entities.upsert({
          entityType: "action-log",
          scopeKind: "instance",
          externalId: uuid(),
          title: `${payload.action || payload.type}: ${payload.success ? "ok" : "fail"}`,
          status: payload.success ? "success" : "failed",
          data: logData as unknown as Record<string, unknown>,
        });

        // Update queue item if applicable
        if (payload.queueItemId) {
          const items = await ctx.entities.list({
            entityType: "tweet-queue",
            externalId: payload.queueItemId,
            limit: 1,
          });
          if (items.length > 0) {
            const item = items[0];
            await ctx.entities.upsert({
              entityType: "tweet-queue",
              scopeKind: "instance",
              externalId: item.externalId || "",
              title: item.title || "",
              status: payload.success ? "posted" : "failed",
              data: {
                ...item.data,
                completedAt: now(),
                tweetUrl: payload.tweetUrl,
                error: payload.error,
              },
            });

            if (payload.success) {
              await incrementAnalytics(ctx, "postsSent");
            } else {
              await incrementAnalytics(ctx, "postsFailed");
            }
          }
        }

        // Store extracted data if applicable
        if (payload.type === "extract" && payload.extractedData) {
          const extracted = payload.extractedData as Record<string, unknown>;
          if (Array.isArray(extracted)) {
            for (const tweet of extracted) {
              const t = tweet as Record<string, unknown>;
              await ctx.entities.upsert({
                entityType: "extracted-tweet",
                scopeKind: "instance",
                externalId: (t.tweetUrl as string) || uuid(),
                title: ((t.text as string) || "").slice(0, 80),
                status: "active",
                data: {
                  ...t,
                  extractedAt: now(),
                  missionId: payload.missionId,
                },
              });
            }
            await incrementAnalytics(ctx, "extractions", (extracted as unknown[]).length);
          }
        }

        if (payload.type === "profile" && payload.extractedData) {
          const profile = payload.extractedData as Record<string, unknown>;
          await ctx.entities.upsert({
            entityType: "extracted-profile",
            scopeKind: "instance",
            externalId: ((profile.handle as string) || "").toLowerCase() || uuid(),
            title: (profile.displayName as string) || `@${profile.handle as string}`,
            status: "active",
            data: { ...profile, extractedAt: now() },
          });
          await incrementAnalytics(ctx, "profileExtractions");
        }

        // Increment engagement counters
        if (payload.success && payload.action) {
          const actionMap: Record<string, keyof Omit<DailyAnalytics, "date">> = {
            LIKE: "likes",
            REPOST: "reposts",
            FOLLOW: "follows",
            REPLY: "replies",
          };
          const field = actionMap[payload.action];
          if (field) await incrementAnalytics(ctx, field);
        }

        ctx.logger.info(`ext-result: ${payload.type} ${payload.success ? "ok" : "fail"}`, {
          queueItemId: payload.queueItemId,
          missionId: payload.missionId,
        });
        break;
      }

      // ── ext-progress: Extension reports mission step progress ────────────
      case "ext-progress": {
        const payload = (input.parsedBody || JSON.parse(input.rawBody)) as ExtProgressPayload;

        const missions = await ctx.entities.list({
          entityType: "mission",
          externalId: payload.missionId,
          limit: 1,
        });

        if (missions.length > 0) {
          const mission = missions[0];
          const mData = mission.data as unknown as MissionData;
          mData.currentStep = payload.currentStep;
          if (payload.stepResult) {
            mData.results.push(payload.stepResult);
          }

          const isComplete = payload.currentStep >= mData.steps.length;
          if (isComplete) {
            mData.completedAt = now();
          }

          await ctx.entities.upsert({
            entityType: "mission",
            scopeKind: "instance",
            externalId: mission.externalId || "",
            title: mission.title || "",
            status: isComplete ? "completed" : "active",
            data: mData as unknown as Record<string, unknown>,
          });

          ctx.logger.info(`ext-progress: mission ${payload.missionId} step ${payload.currentStep}/${mData.steps.length}${isComplete ? " — COMPLETED" : ""}`);
        }
        break;
      }

      // ── ext-heartbeat: Extension reports its alive status ────────────────
      case "ext-heartbeat": {
        const payload = (input.parsedBody || JSON.parse(input.rawBody)) as ExtHeartbeatPayload;

        const session: ExtensionSession = {
          sessionId: payload.sessionId,
          lastHeartbeat: now(),
          botEnabled: payload.botEnabled,
          bearerToken: payload.bearerToken,
          csrfToken: payload.csrfToken,
          currentUrl: payload.currentUrl,
        };

        await ctx.state.set(
          { scopeKind: "instance", namespace: "extension-session", stateKey: "current" },
          session as unknown as Record<string, unknown>,
        );

        ctx.logger.info("ext-heartbeat", {
          sessionId: payload.sessionId,
          botEnabled: payload.botEnabled,
        });
        break;
      }

      default:
        throw new Error(`Unknown webhook endpoint: ${input.endpointKey}`);
    }
  },

  async onHealth() {
    const ctx = currentContext;
    if (!ctx) {
      return { status: "error" as const, message: "Plugin not initialized" };
    }

    const session = await ctx.state.get({
      scopeKind: "instance",
      namespace: "extension-session",
      stateKey: "current",
    }) as unknown as ExtensionSession | null;

    if (!session) {
      return {
        status: "degraded" as const,
        message: "No extension heartbeat received yet. Install and enable the x-Ext Chrome extension.",
      };
    }

    const ageMs = Date.now() - new Date(session.lastHeartbeat).getTime();
    if (ageMs < 2 * 60 * 1000) {
      return {
        status: "ok" as const,
        message: `Extension online (bot ${session.botEnabled ? "enabled" : "disabled"})`,
        details: { sessionId: session.sessionId, lastHeartbeat: session.lastHeartbeat },
      };
    } else if (ageMs < 10 * 60 * 1000) {
      return {
        status: "degraded" as const,
        message: `Extension heartbeat stale (${Math.round(ageMs / 60000)}min ago)`,
        details: { sessionId: session.sessionId, lastHeartbeat: session.lastHeartbeat },
      };
    } else {
      return {
        status: "error" as const,
        message: `Extension offline (last seen ${Math.round(ageMs / 60000)}min ago)`,
        details: { sessionId: session.sessionId, lastHeartbeat: session.lastHeartbeat },
      };
    }
  },
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

export default plugin;
runWorker(plugin, import.meta.url);
