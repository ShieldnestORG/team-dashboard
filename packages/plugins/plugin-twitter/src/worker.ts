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

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")     // strip URLs
    .replace(/@\w+/g, "")               // strip @mentions
    .replace(/#\w+/g, "")               // strip #hashtags
    .replace(/[^\w\s]/g, " ")           // strip punctuation
    .replace(/\s+/g, " ")              // collapse whitespace
    .trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function getConfig(ctx: PluginContext): Promise<TwitterConfig> {
  const raw = await ctx.config.get();
  return {
    extensionSecret: (raw.extensionSecret as string) || "",
    defaultVenture: (raw.defaultVenture as string) || "coherencedaddy",
    maxQueueSize: (raw.maxQueueSize as number) || 100,
    enableAutoEngage: (raw.enableAutoEngage as boolean) || false,
    maxPostsPerDay: (raw.maxPostsPerDay as number) || 8,
    minPostGapMinutes: (raw.minPostGapMinutes as number) || 30,
    maxPostGapMinutes: (raw.maxPostGapMinutes as number) || 120,
    postingWindowStart: (raw.postingWindowStart as number) ?? 6,
    postingWindowEnd: (raw.postingWindowEnd as number) ?? 24,
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
        const allQueueItems = await ctx.entities.list({
          entityType: "tweet-queue",
          limit: 500,
        });
        const pendingCount = allQueueItems.filter(
          (e) => (e.data as unknown as TweetQueueData).action === "POST" &&
            (e.status === "pending" || e.status === "claimed"),
        ).length;
        if (pendingCount >= config.maxQueueSize) {
          return { error: `Queue full (${pendingCount}/${config.maxQueueSize}). Wait for items to be posted or increase maxQueueSize.` };
        }

        // ── Dedupe check ──────────────────────────────────────────────────────
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const normalizedNew = normalizeText(p.text);
        if (normalizedNew.length > 0) {
          const recentItems = allQueueItems.filter((e) => {
            const d = e.data as unknown as TweetQueueData;
            return (
              d.text &&
              (e.status === "pending" || e.status === "claimed" || e.status === "posted") &&
              d.queuedAt > sevenDaysAgo
            );
          });
          for (const item of recentItems) {
            const d = item.data as unknown as TweetQueueData;
            const normalizedOld = normalizeText(d.text || "");
            if (normalizedOld.length === 0) continue;
            if (normalizedOld === normalizedNew) {
              return { error: "Duplicate: identical tweet already posted or queued in the last 7 days." };
            }
            if (jaccardSimilarity(normalizedOld, normalizedNew) > 0.85) {
              return { error: "Duplicate: very similar tweet already posted or queued in the last 7 days. Rephrase with a different angle." };
            }
          }
        }

        // ── Daily limit check ─────────────────────────────────────────────────
        const today = todayKey();
        const todaysItems = allQueueItems.filter((e) => {
          const d = e.data as unknown as TweetQueueData;
          return (
            d.action === "POST" &&
            (e.status === "pending" || e.status === "claimed" || e.status === "posted") &&
            (d.scheduledAt?.startsWith(today) || d.queuedAt.startsWith(today))
          );
        });
        if (todaysItems.length >= config.maxPostsPerDay) {
          return { error: `Daily limit reached (${todaysItems.length}/${config.maxPostsPerDay}). Try again tomorrow or increase maxPostsPerDay.` };
        }

        // ── Auto-schedule if no scheduledAt provided ──────────────────────────
        let scheduledAt = p.scheduledAt;
        if (!scheduledAt) {
          // Find the latest scheduled/queued time among today's items
          const scheduledTimes = todaysItems
            .map((e) => {
              const d = e.data as unknown as TweetQueueData;
              return d.scheduledAt || d.queuedAt;
            })
            .sort();
          const lastTime = scheduledTimes.length > 0
            ? new Date(scheduledTimes[scheduledTimes.length - 1]!)
            : new Date();

          // Add random gap
          const gapMinutes = randomBetween(config.minPostGapMinutes, config.maxPostGapMinutes);
          const nextTime = new Date(Math.max(lastTime.getTime(), Date.now()) + gapMinutes * 60 * 1000);

          // Check if within posting window
          const hour = nextTime.getHours();
          if (hour >= config.postingWindowEnd || hour < config.postingWindowStart) {
            // Push to next day at window start + random 0-60min
            const nextDay = new Date(nextTime);
            nextDay.setDate(nextDay.getDate() + (hour >= config.postingWindowEnd ? 1 : 0));
            nextDay.setHours(config.postingWindowStart, Math.floor(Math.random() * 60), 0, 0);
            scheduledAt = nextDay.toISOString();
          } else {
            scheduledAt = nextTime.toISOString();
          }
        }

        const id = uuid();
        const data: TweetQueueData = {
          action: "POST",
          text: p.text,
          mediaUrls: p.mediaUrls,
          hashtags: p.hashtags,
          scheduledAt,
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
          content: `Queued tweet (id: ${id}). Scheduled for: ${scheduledAt}. The extension will post it when the time arrives.`,
          data: { queueItemId: id, status: "pending", scheduledAt },
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

    // ── generate-tweets (content pipeline) ─────────────────────────────────

    ctx.tools.register(
      "generate-tweets",
      {
        displayName: "Twitter: Generate Tweet Context",
        description:
          "Gather context for generating unique tweets. Returns recent posts (to avoid repetition), scraped data, and guidelines. Use the returned context to write original tweets, then call queue-post for each.",
        parametersSchema: {
          type: "object",
          required: ["topic"],
          properties: {
            topic: { type: "string" },
            count: { type: "number", default: 5 },
            venture: { type: "string" },
            style: { type: "string", enum: ["informative", "engaging", "promotional", "thread"], default: "engaging" },
          },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as {
          topic: string;
          count?: number;
          venture?: string;
          style?: string;
        };
        const config = await getConfig(ctx);
        const count = Math.min(Math.max(1, p.count || 5), 10);
        const style = p.style || "engaging";
        const venture = p.venture || config.defaultVenture;

        // Get recent posted tweets to avoid repetition
        const queueItems = await ctx.entities.list({
          entityType: "tweet-queue",
          limit: 200,
        });
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const recentTweets = queueItems
          .filter((e) => {
            const d = e.data as unknown as TweetQueueData;
            return (
              (e.status === "posted" || e.status === "pending") &&
              d.text &&
              d.queuedAt > sevenDaysAgo
            );
          })
          .map((e) => (e.data as unknown as TweetQueueData).text!)
          .slice(0, 20);

        // Note: Scraped context from Firecrawl should be fetched by the agent
        // directly (call Firecrawl query tool), then use the results alongside
        // this context to write tweets. Plugins cannot call other plugins' tools.
        const scrapedContext: string[] = [];

        // Venture-specific hashtag suggestions
        const hashtagMap: Record<string, string[]> = {
          coherencedaddy: ["#coherencedaddy", "#web3", "#blockchain"],
          tokns: ["#tokns", "#staking", "#DeFi", "#crypto"],
          shieldnest: ["#ShieldNest", "#privacy", "#web3dev"],
          smartnotes: ["#smartnotes", "#productivity", "#AI"],
          token: ["#CoherenceToken", "#crypto", "#tokenomics"],
          brand: ["#coherencedaddy", "#508c1a"],
        };

        const guidelines = [
          `Each tweet must be under 280 characters`,
          `Write ${count} unique tweets about: ${p.topic}`,
          `Style: ${style}`,
          `Never repeat phrasing from the recent tweets listed below`,
          `Vary sentence structure, opening words, and angle for each tweet`,
          `Do NOT use generic filler ("Exciting news!", "Stay tuned!") — be specific and valuable`,
          `Include a clear value proposition or insight in each tweet`,
          `After writing, call queue-post for each approved draft`,
        ];

        return {
          content: [
            `Context for generating ${count} ${style} tweets about "${p.topic}" for ${venture}:`,
            ``,
            `RECENT TWEETS (avoid repeating these):`,
            ...recentTweets.map((t, i) => `  ${i + 1}. ${t}`),
            recentTweets.length === 0 ? "  (none yet)" : "",
            ``,
            scrapedContext.length > 0 ? `SCRAPED CONTEXT:` : "",
            ...scrapedContext.map((s, i) => `  ${i + 1}. ${s}`),
            ``,
            `GUIDELINES:`,
            ...guidelines.map((g) => `  - ${g}`),
          ].filter(Boolean).join("\n"),
          data: {
            topic: p.topic,
            style,
            venture,
            count,
            recentTweets,
            scrapedContext,
            guidelines,
            suggestedHashtags: hashtagMap[venture] || ["#web3", "#blockchain"],
          },
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

    // ── queue-thread ───────────────────────────────────────────────────────

    ctx.tools.register(
      "queue-thread",
      {
        displayName: "Twitter: Queue Thread",
        description: "Queue a thread (multiple tweets posted in sequence). Each tweet is max 280 chars. The extension posts them as a connected thread.",
        parametersSchema: {
          type: "object",
          required: ["tweets"],
          properties: {
            tweets: {
              type: "array",
              items: { type: "string" },
              description: "Array of tweet texts for the thread, in order. Max 25 tweets.",
              maxItems: 25,
            },
            venture: { type: "string" },
          },
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { tweets: string[]; venture?: string };
        const config = await getConfig(ctx);
        const id = uuid();

        const data: TweetQueueData = {
          action: "POST",
          text: "__THREAD__",
          venture: p.venture || config.defaultVenture,
          queuedBy: runCtx.agentId,
          queuedAt: now(),
          retryCount: 0,
        };

        await ctx.entities.upsert({
          entityType: "tweet-queue",
          scopeKind: "instance",
          externalId: id,
          title: `Thread (${p.tweets.length} tweets): ${p.tweets[0].slice(0, 50)}`,
          status: "pending",
          data: { ...data, threadTweets: p.tweets } as unknown as Record<string, unknown>,
        });

        await incrementAnalytics(ctx, "postsQueued");
        return {
          content: `Queued thread (id: ${id}, ${p.tweets.length} tweets). Extension will post on next cycle.`,
          data: { queueItemId: id, status: "pending", tweetCount: p.tweets.length },
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
        const config = await getConfig(ctx);

        // ── Rate enforcement: posting window check ─────────────────────────
        const currentHour = new Date().getHours();
        if (currentHour < config.postingWindowStart || currentHour >= config.postingWindowEnd) {
          return {
            content: `Outside posting window (${config.postingWindowStart}:00-${config.postingWindowEnd}:00, current: ${currentHour}:00)`,
            data: { empty: true, reason: "outside_window" },
          };
        }

        const queueItems = await ctx.entities.list({
          entityType: "tweet-queue",
          limit: 200,
        });

        // ── Rate enforcement: daily limit check ────────────────────────────
        const todayStr = todayKey();
        const todaysPosted = queueItems.filter((e) => {
          const d = e.data as unknown as TweetQueueData;
          return (e.status === "posted" || e.status === "claimed") &&
            (d.completedAt?.startsWith(todayStr) || d.claimedAt?.startsWith(todayStr) || d.queuedAt?.startsWith(todayStr));
        });
        if (todaysPosted.length >= config.maxPostsPerDay) {
          return {
            content: `Daily post limit reached (${todaysPosted.length}/${config.maxPostsPerDay})`,
            data: { empty: true, reason: "daily_limit" },
          };
        }

        // ── Rate enforcement: minimum gap check ────────────────────────────
        const recentPosts = queueItems
          .filter((e) => e.status === "posted")
          .map((e) => (e.data as unknown as TweetQueueData).completedAt)
          .filter(Boolean)
          .sort()
          .reverse();
        if (recentPosts.length > 0) {
          const lastPostTime = new Date(recentPosts[0]!).getTime();
          const gapMs = Date.now() - lastPostTime;
          const minGapMs = config.minPostGapMinutes * 60 * 1000;
          if (gapMs < minGapMs) {
            const waitMin = Math.ceil((minGapMs - gapMs) / 60000);
            return {
              content: `Rate limited: ${waitMin}min until next post allowed (min gap: ${config.minPostGapMinutes}min)`,
              data: { empty: true, reason: "rate_limited", waitMinutes: waitMin },
            };
          }
        }

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

        // Check if this is a thread
        const threadTweets = (item.data as Record<string, unknown>).threadTweets as string[] | undefined;
        const isThread = d.text === "__THREAD__" && threadTweets && threadTweets.length > 0;

        // Build the full text with hashtags
        let text = d.text || "";
        if (!isThread && d.hashtags && d.hashtags.length > 0) {
          const tags = d.hashtags.map((h: string) => h.startsWith("#") ? h : `#${h}`).join(" ");
          text += `\n\n${tags}`;
        }

        ctx.logger.info(`Claimed ${isThread ? "thread" : "post"}: ${item.externalId}`);

        return {
          content: isThread ? threadTweets.join("\n---\n") : text,
          data: {
            id: item.externalId,
            text: isThread ? threadTweets[0] : text,
            action: d.action,
            isThread,
            threadTweets: isThread ? threadTweets : undefined,
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

    // ── claim-next-mission (extension auto-engage bridge) ───────────────────

    ctx.tools.register(
      "claim-next-mission",
      {
        displayName: "Twitter: Claim Next Mission",
        description: "Claim the next active mission for the extension to execute.",
        parametersSchema: { type: "object", properties: {} },
      },
      async (): Promise<ToolResult> => {
        const config = await getConfig(ctx);
        if (!config.enableAutoEngage) {
          return { content: "Auto-engage is disabled", data: { empty: true, reason: "auto_engage_disabled" } };
        }

        const missions = await ctx.entities.list({ entityType: "mission", limit: 50 });
        const active = missions
          .filter((e) => e.status === "active")
          .sort((a, b) => {
            const aTime = (a.data as unknown as MissionData).createdAt || "";
            const bTime = (b.data as unknown as MissionData).createdAt || "";
            return aTime.localeCompare(bTime);
          });

        if (active.length === 0) {
          return { content: "No active missions", data: { empty: true } };
        }

        const mission = active[0];
        const mData = mission.data as unknown as MissionData;

        if (!mData.startedAt) {
          mData.startedAt = now();
          await ctx.entities.upsert({
            entityType: "mission",
            scopeKind: "instance",
            externalId: mission.externalId || "",
            title: mission.title || "",
            status: "active",
            data: mData as unknown as Record<string, unknown>,
          });
        }

        ctx.logger.info(`Claimed mission: ${mission.externalId}`, { name: mData.name, steps: mData.steps.length });

        return {
          content: `Mission: ${mData.name || "Unnamed"} (${mData.steps.length} steps, at step ${mData.currentStep})`,
          data: {
            missionId: mission.externalId || mission.id,
            name: mData.name,
            steps: mData.steps,
            currentStep: mData.currentStep,
          },
        };
      },
    );

    // ── report-mission-result (extension auto-engage bridge) ────────────────

    ctx.tools.register(
      "report-mission-result",
      {
        displayName: "Twitter: Report Mission Result",
        description: "Report the completion or failure of a mission.",
        parametersSchema: {
          type: "object",
          required: ["missionId", "success"],
          properties: {
            missionId: { type: "string" },
            success: { type: "boolean" },
            currentStep: { type: "number" },
            error: { type: "string" },
          },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { missionId: string; success: boolean; currentStep?: number; error?: string };

        const missions = await ctx.entities.list({
          entityType: "mission",
          externalId: p.missionId,
          limit: 1,
        });

        if (missions.length === 0) {
          return { error: `Mission ${p.missionId} not found` };
        }

        const mission = missions[0];
        const mData = mission.data as unknown as MissionData;

        if (p.currentStep !== undefined) {
          mData.currentStep = p.currentStep;
        }

        const isComplete = p.success && mData.currentStep >= mData.steps.length;
        if (isComplete) {
          mData.completedAt = now();
        }

        await ctx.entities.upsert({
          entityType: "mission",
          scopeKind: "instance",
          externalId: mission.externalId || "",
          title: mission.title || "",
          status: isComplete ? "completed" : p.success ? "active" : "failed",
          data: { ...mData as unknown as Record<string, unknown>, error: p.error },
        });

        return {
          content: `Mission ${p.missionId}: step ${mData.currentStep}/${mData.steps.length}${isComplete ? " — COMPLETED" : ""}`,
          data: { missionId: p.missionId, status: isComplete ? "completed" : "active", currentStep: mData.currentStep },
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

        // ── Rate limit: enforce minimum gap between posts ──────────────────
        let rateLimited = false;
        if (ready) {
          const recentlyPosted = queueItems
            .filter((e) => e.status === "posted")
            .map((e) => (e.data as unknown as TweetQueueData).completedAt)
            .filter(Boolean)
            .sort()
            .reverse();
          if (recentlyPosted.length > 0) {
            const lastPostTime = new Date(recentlyPosted[0]!).getTime();
            const minGapMs = config.minPostGapMinutes * 60 * 1000;
            if (Date.now() - lastPostTime < minGapMs) {
              rateLimited = true;
              ctx.logger.info("ext-poll: rate limited, too soon since last post", {
                lastPost: recentlyPosted[0],
                minGapMinutes: config.minPostGapMinutes,
              });
            }
          }
        }

        if (ready && !rateLimited) {
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
