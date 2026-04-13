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
  DailyAnalytics,
} from "./types.js";
import {
  executePost,
  executeThread,
  checkXApiConnection,
  checkDailyBudget,
  jitteredDelay,
} from "./executor.js";
import { executeMission } from "./mission-executor.js";

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
    defaultVenture: (raw.defaultVenture as string) || "coherencedaddy",
    maxQueueSize: (raw.maxQueueSize as number) || 100,
    enableAutoEngage: (raw.enableAutoEngage as boolean) || false,
    maxPostsPerDay: (raw.maxPostsPerDay as number) || 8,
    minPostGapMinutes: (raw.minPostGapMinutes as number) || 30,
    maxPostGapMinutes: (raw.maxPostGapMinutes as number) || 120,
    postingWindowStart: (raw.postingWindowStart as number) ?? 6,
    postingWindowEnd: (raw.postingWindowEnd as number) ?? 24,
    cycleIntervalMin: (raw.cycleIntervalMin as number) || 12,
    cycleIntervalMax: (raw.cycleIntervalMax as number) || 25,
    dailyLikesLimit: (raw.dailyLikesLimit as number) || 40,
    dailyFollowsLimit: (raw.dailyFollowsLimit as number) || 15,
    dailyRepliesLimit: (raw.dailyRepliesLimit as number) || 20,
    dailyRepostsLimit: (raw.dailyRepostsLimit as number) || 10,
    breathingPauseMinActions: (raw.breathingPauseMinActions as number) || 5,
    breathingPauseMaxActions: (raw.breathingPauseMaxActions as number) || 10,
    breathingPauseMinSeconds: (raw.breathingPauseMinSeconds as number) || 30,
    breathingPauseMaxSeconds: (raw.breathingPauseMaxSeconds as number) || 90,
    xApiEnabled: (raw.xApiEnabled as boolean) || false,
    rateLimitMultiplier: (raw.rateLimitMultiplier as number) || 0.5,
  };
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

// ─── Shared context for lifecycle hooks ───────────────────────────────────────

let currentContext: PluginContext | null = null;

// ─── Plugin definition ────────────────────────────────────────────────────────

const plugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;
    ctx.logger.info("Twitter/X plugin v0.2.0 ready — X API v2 direct posting active");

    // ══════════════════════════════════════════════════════════════════════════
    // TOOLS — Agent-facing operations
    // ══════════════════════════════════════════════════════════════════════════

    // ── queue-post ────────────────────────────────────────────────────────────

    ctx.tools.register(
      "queue-post",
      {
        displayName: "Twitter: Queue Post",
        description: "Queue a tweet for posting via X API v2.",
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

        // ── Immediate execution if X API enabled and no future schedule ──────
        if (config.xApiEnabled && (!p.scheduledAt || new Date(p.scheduledAt) <= new Date())) {
          try {
            const result = await executePost(data);
            await ctx.entities.upsert({
              entityType: "tweet-queue",
              scopeKind: "instance",
              externalId: id,
              title: p.text.slice(0, 80),
              status: "posted",
              data: {
                ...data,
                completedAt: now(),
                tweetUrl: result.tweetUrl,
                tweetId: result.tweetId,
              } as unknown as Record<string, unknown>,
            });
            await incrementAnalytics(ctx, "postsSent");
            ctx.logger.info(`Posted immediately via X API: ${id}`, { tweetId: result.tweetId });

            return {
              content: `Posted immediately via X API (id: ${id}). Tweet: ${result.tweetUrl}`,
              data: { queueItemId: id, status: "posted", tweetUrl: result.tweetUrl, tweetId: result.tweetId },
            };
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            await ctx.entities.upsert({
              entityType: "tweet-queue",
              scopeKind: "instance",
              externalId: id,
              title: p.text.slice(0, 80),
              status: "failed",
              data: {
                ...data,
                completedAt: now(),
                error: errorMsg,
              } as unknown as Record<string, unknown>,
            });
            await incrementAnalytics(ctx, "postsFailed");
            ctx.logger.error(`Immediate post failed: ${errorMsg}`, { queueItemId: id });

            return {
              error: `Post queued but immediate execution failed: ${errorMsg}. Item marked as failed.`,
              data: { queueItemId: id, status: "failed", error: errorMsg },
            };
          }
        }

        ctx.logger.info(`Queued post: ${id}`, { text: p.text.slice(0, 50) });

        return {
          content: `Queued tweet (id: ${id}). Scheduled for: ${scheduledAt}. The post-dispatcher job will post it when the time arrives.`,
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

        // Immediate execution if X API enabled
        if (config.xApiEnabled) {
          try {
            const result = await executePost(data);
            await ctx.entities.upsert({
              entityType: "tweet-queue",
              scopeKind: "instance",
              externalId: id,
              title: `Reply: ${p.text.slice(0, 60)}`,
              status: "posted",
              data: {
                ...data,
                completedAt: now(),
                tweetUrl: result.tweetUrl,
                tweetId: result.tweetId,
              } as unknown as Record<string, unknown>,
            });
            await incrementAnalytics(ctx, "postsSent");
            return {
              content: `Reply posted via X API (id: ${id}) to ${p.replyToUrl}. Tweet: ${result.tweetUrl}`,
              data: { queueItemId: id, status: "posted", tweetUrl: result.tweetUrl },
            };
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            ctx.logger.error(`Reply failed: ${errorMsg}`, { queueItemId: id });
            // Fall through to queued state
          }
        }

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

        // Immediate execution if X API enabled
        if (config.xApiEnabled) {
          try {
            const result = await executePost(data);
            await ctx.entities.upsert({
              entityType: "tweet-queue",
              scopeKind: "instance",
              externalId: id,
              title: `Repost: ${p.repostUrl}`,
              status: "posted",
              data: {
                ...data,
                completedAt: now(),
                tweetUrl: result.tweetUrl,
                tweetId: result.tweetId,
              } as unknown as Record<string, unknown>,
            });
            await incrementAnalytics(ctx, "reposts");
            return {
              content: `Reposted via X API (id: ${id}): ${result.tweetUrl}`,
              data: { queueItemId: id, status: "posted", tweetUrl: result.tweetUrl },
            };
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            ctx.logger.error(`Repost failed: ${errorMsg}`, { queueItemId: id });
          }
        }

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
        description: "Define a multi-step engagement mission. API-compatible steps execute via X API v2; DOM-specific steps are logged as no-ops.",
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
          content: `Created mission (id: ${id}, ${p.steps.length} steps, status: ${initialStatus}).${!config.enableAutoEngage ? " Auto-engage is off — mission is pending until manually activated or engagement-cycle runs." : ""}`,
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
            content: `Found ${profiles.length} extracted profiles:\n${profiles.map((pr) => `  @${pr.handle} (${pr.followers} followers)`).join("\n")}`,
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
        description: "Check content queue depth and X API connection status.",
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

        // Check X API connection status
        const xApiStatus = await checkXApiConnection();
        const rateLimits = xApiStatus.rateLimits;

        const statusParts = [
          `Queue: ${counts.pending} pending, ${counts.posted} posted, ${counts.failed} failed.`,
          `X API: ${xApiStatus.connected ? `connected (@${xApiStatus.username})` : "not connected"}`,
        ];

        if (rateLimits) {
          const budget = rateLimits.dailyBudget;
          statusParts.push(
            `Rate limits — posts: ${budget.posts.used}/${budget.posts.limit}, likes: ${budget.likes.used}/${budget.likes.limit}, follows: ${budget.follows.used}/${budget.follows.limit}`,
          );
          if (rateLimits.panicMode) {
            statusParts.push("WARNING: panic mode active (429 received recently)");
          }
        }

        return {
          content: statusParts.join("\n"),
          data: { counts, xApiConnected: xApiStatus.connected, xApiUsername: xApiStatus.username, rateLimits, totalItems: items.length },
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
        description: "Queue a thread (multiple tweets posted in sequence via X API v2).",
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

        // Immediate execution if X API enabled
        if (config.xApiEnabled) {
          try {
            const result = await executeThread(p.tweets);
            await ctx.entities.upsert({
              entityType: "tweet-queue",
              scopeKind: "instance",
              externalId: id,
              title: `Thread (${p.tweets.length} tweets): ${p.tweets[0].slice(0, 50)}`,
              status: "posted",
              data: {
                ...data,
                threadTweets: p.tweets,
                completedAt: now(),
                tweetUrl: result.tweetUrl,
                tweetId: result.tweetId,
              } as unknown as Record<string, unknown>,
            });
            await incrementAnalytics(ctx, "postsSent");
            return {
              content: `Thread posted via X API (id: ${id}, ${p.tweets.length} tweets). Last tweet: ${result.tweetUrl}`,
              data: { queueItemId: id, status: "posted", tweetUrl: result.tweetUrl, tweetCount: p.tweets.length },
            };
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            ctx.logger.error(`Thread post failed: ${errorMsg}`, { queueItemId: id });
          }
        }

        return {
          content: `Queued thread (id: ${id}, ${p.tweets.length} tweets). Post-dispatcher will post on next cycle.`,
          data: { queueItemId: id, status: "pending", tweetCount: p.tweets.length },
        };
      },
    );

    // ── get-bot-config ────────────────────────────────────────────────────

    ctx.tools.register(
      "get-bot-config",
      {
        displayName: "Twitter: Get Bot Config",
        description: "Returns anti-bot behavior settings and X API rate limit status.",
        parametersSchema: { type: "object", properties: {} },
      },
      async (): Promise<ToolResult> => {
        const config = await getConfig(ctx);
        const xApiStatus = await checkXApiConnection();

        return {
          content: "Bot config loaded",
          data: {
            xApiEnabled: config.xApiEnabled,
            xApiConnected: xApiStatus.connected,
            xApiUsername: xApiStatus.username,
            rateLimitMultiplier: config.rateLimitMultiplier,
            rateLimits: xApiStatus.rateLimits,
            cycleIntervalMin: config.cycleIntervalMin,
            cycleIntervalMax: config.cycleIntervalMax,
            dailyLimits: {
              LIKE: config.dailyLikesLimit,
              FOLLOW: config.dailyFollowsLimit,
              REPLY: config.dailyRepliesLimit,
              REPOST: config.dailyRepostsLimit,
            },
            breathingPause: {
              minActions: config.breathingPauseMinActions,
              maxActions: config.breathingPauseMaxActions,
              minSeconds: config.breathingPauseMinSeconds,
              maxSeconds: config.breathingPauseMaxSeconds,
            },
          },
        };
      },
    );

    // ── get-media-drops ─────────────────────────────────────────────────────

    ctx.tools.register(
      "get-media-drops",
      {
        displayName: "Twitter: Get Media Drops",
        description:
          "Fetch available media drops (images/videos uploaded for posting). " +
          "Returns drops with captions, hashtags, and file URLs ready for queue-post. " +
          "After queuing a drop, call this tool's mark-used endpoint or PATCH the drop status to 'queued'.",
        parametersSchema: {
          type: "object",
          properties: {
            status: { type: "string", default: "available", description: "Filter by status: available, queued, posted" },
            platform: { type: "string", default: "twitter" },
            limit: { type: "number", default: 10 },
          },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { status?: string; platform?: string; limit?: number };
        const baseUrl = process.env.PAPERCLIP_API_URL || process.env.PAPERCLIP_PUBLIC_URL || "http://localhost:3100";
        const apiKey = process.env.CONTENT_API_KEY;
        if (!apiKey) {
          return { content: "CONTENT_API_KEY not set — cannot fetch media drops.", data: { error: true } };
        }

        const qs = new URLSearchParams();
        qs.set("status", p.status || "available");
        qs.set("platform", p.platform || "twitter");
        qs.set("limit", String(p.limit || 10));

        const resp = await fetch(`${baseUrl}/api/media/drops?${qs}`, {
          headers: { "Content-API-Key": apiKey },
        });

        if (!resp.ok) {
          return { content: `Failed to fetch media drops: ${resp.status}`, data: { error: true } };
        }

        const body = (await resp.json()) as {
          drops: Array<{
            id: string;
            caption: string | null;
            hashtags: string[] | null;
            platform: string;
            status: string;
            files: Array<{ index: number; filename: string; contentType: string; byteSize: number; url: string }>;
            createdAt: string;
          }>;
          total: number;
        };

        if (body.drops.length === 0) {
          return { content: "No media drops available.", data: { drops: [], total: 0 } };
        }

        const summary = body.drops.map((d) => {
          const fileList = d.files.map((f) => `  [${f.index}] ${f.filename} (${f.contentType}, ${Math.round(f.byteSize / 1024)}KB)`).join("\n");
          // Build absolute URLs for media access
          const mediaUrls = d.files.map((f) => `${baseUrl}${f.url}`);
          return {
            text: `Drop ${d.id}:\n  Caption: ${d.caption || "(none)"}\n  Hashtags: ${d.hashtags?.join(", ") || "(none)"}\n  Platform: ${d.platform}\n  Files:\n${fileList}`,
            data: { ...d, mediaUrls },
          };
        });

        return {
          content: `${body.total} media drop(s) found:\n\n${summary.map((s) => s.text).join("\n\n")}`,
          data: { drops: summary.map((s) => s.data), total: body.total },
        };
      },
    );

    // ══════════════════════════════════════════════════════════════════════════
    // JOBS — Scheduled execution
    // ══════════════════════════════════════════════════════════════════════════

    // ── post-dispatcher (every 2 minutes) ─────────────────────────────────

    ctx.jobs.register("post-dispatcher", async (_job: PluginJobContext) => {
      const config = await getConfig(ctx);
      if (!config.xApiEnabled) {
        ctx.logger.info("post-dispatcher: X API not enabled, skipping");
        return;
      }

      // Check posting window
      const currentHour = new Date().getHours();
      if (currentHour < config.postingWindowStart || currentHour >= config.postingWindowEnd) {
        ctx.logger.info(`post-dispatcher: outside posting window (${config.postingWindowStart}:00-${config.postingWindowEnd}:00)`);
        return;
      }

      // Check daily budget
      const budget = await checkDailyBudget("post");
      if (!budget.allowed) {
        ctx.logger.info("post-dispatcher: daily post budget exhausted");
        return;
      }

      // Get pending items ready for posting
      const nowStr = now();
      const queueItems = await ctx.entities.list({
        entityType: "tweet-queue",
        limit: 200,
      });

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
        return;
      }

      // Check minimum gap since last post
      const recentPosts = queueItems
        .filter((e) => e.status === "posted")
        .map((e) => (e.data as unknown as TweetQueueData).completedAt)
        .filter(Boolean)
        .sort()
        .reverse();
      if (recentPosts.length > 0) {
        const lastPostTime = new Date(recentPosts[0]!).getTime();
        const minGapMs = config.minPostGapMinutes * 60 * 1000;
        if (Date.now() - lastPostTime < minGapMs) {
          ctx.logger.info("post-dispatcher: too soon since last post, waiting");
          return;
        }
      }

      // Process first ready item
      const item = pending[0];
      const d = item.data as unknown as TweetQueueData;
      const threadTweets = (item.data as Record<string, unknown>).threadTweets as string[] | undefined;
      const isThread = d.text === "__THREAD__" && threadTweets && threadTweets.length > 0;

      try {
        let result;
        if (isThread) {
          result = await executeThread(threadTweets);
        } else {
          result = await executePost(d);
        }

        await ctx.entities.upsert({
          entityType: "tweet-queue",
          scopeKind: "instance",
          externalId: item.externalId || "",
          title: item.title || "",
          status: "posted",
          data: {
            ...item.data,
            completedAt: now(),
            tweetUrl: result.tweetUrl,
            tweetId: result.tweetId,
          },
        });
        await incrementAnalytics(ctx, "postsSent");
        ctx.logger.info(`post-dispatcher: posted ${item.externalId}`, { tweetUrl: result.tweetUrl });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const retryCount = d.retryCount || 0;

        if (retryCount < 3) {
          // Retry later
          await ctx.entities.upsert({
            entityType: "tweet-queue",
            scopeKind: "instance",
            externalId: item.externalId || "",
            title: item.title || "",
            status: "pending",
            data: { ...item.data, retryCount: retryCount + 1, lastError: errorMsg },
          });
          ctx.logger.warn(`post-dispatcher: failed (attempt ${retryCount + 1}/3): ${errorMsg}`);
        } else {
          // Max retries exceeded — mark as failed
          await ctx.entities.upsert({
            entityType: "tweet-queue",
            scopeKind: "instance",
            externalId: item.externalId || "",
            title: item.title || "",
            status: "failed",
            data: { ...item.data, completedAt: now(), error: errorMsg },
          });
          await incrementAnalytics(ctx, "postsFailed");
          ctx.logger.error(`post-dispatcher: permanently failed after 3 attempts: ${errorMsg}`);
        }
      }
    });

    // ── engagement-cycle (every 5 minutes) ────────────────────────────────

    ctx.jobs.register("engagement-cycle", async (_job: PluginJobContext) => {
      const config = await getConfig(ctx);
      if (!config.xApiEnabled || !config.enableAutoEngage) {
        return;
      }

      // First, execute any active missions
      const missions = await ctx.entities.list({ entityType: "mission", limit: 10 });
      const activeMission = missions.find((e) => e.status === "active");
      if (activeMission) {
        const mData = activeMission.data as unknown as MissionData;
        if (mData.currentStep < mData.steps.length) {
          ctx.logger.info(`engagement-cycle: executing mission ${activeMission.externalId}`);
          await executeMission(
            activeMission.externalId || activeMission.id,
            mData,
            ctx,
          );
          return; // Don't do target engagement in the same cycle as a mission
        }
      }

      // Target-based engagement
      const targets = await ctx.entities.list({ entityType: "target", limit: 100 });
      const activeTargets = targets.filter((e) => e.status === "active");

      if (activeTargets.length === 0) {
        return;
      }

      let actionsThisCycle = 0;
      const maxActionsPerCycle = Math.floor(
        randomBetween(config.breathingPauseMinActions, config.breathingPauseMaxActions),
      );

      for (const target of activeTargets) {
        if (actionsThisCycle >= maxActionsPerCycle) {
          ctx.logger.info(`engagement-cycle: breathing pause after ${actionsThisCycle} actions`);
          break;
        }

        const td = target.data as unknown as TargetData;

        for (const actionType of td.engageActions) {
          if (actionsThisCycle >= maxActionsPerCycle) break;

          // Map action type to budget check
          const budgetMap: Record<string, "like" | "follow" | "reply" | "post"> = {
            LIKE: "like",
            FOLLOW: "follow",
            REPLY: "reply",
            REPOST: "post",
          };
          const budgetAction = budgetMap[actionType];
          if (budgetAction) {
            const budget = await checkDailyBudget(budgetAction);
            if (!budget.allowed) {
              ctx.logger.info(`engagement-cycle: daily budget exhausted for ${actionType}`);
              continue;
            }
          }

          try {
            // For LIKE: fetch recent tweets from the target, like one
            if (actionType === "LIKE") {
              // We need the user ID to fetch tweets — try to look it up
              // For now, skip targets where we don't have a userId stored
              // The target data doesn't store userId by default, so we'll
              // need to do a best-effort approach
              ctx.logger.info(`engagement-cycle: LIKE for @${td.handle} — requires userId lookup (skipping for now)`);
              continue;
            }

            if (actionType === "FOLLOW") {
              // Similarly needs userId
              ctx.logger.info(`engagement-cycle: FOLLOW for @${td.handle} — requires userId lookup (skipping for now)`);
              continue;
            }

            if (actionType === "REPLY" || actionType === "REPOST") {
              ctx.logger.info(`engagement-cycle: ${actionType} for @${td.handle} — requires userId lookup (skipping for now)`);
              continue;
            }
          } catch (err) {
            ctx.logger.error(`engagement-cycle: error for @${td.handle} ${actionType}: ${err instanceof Error ? err.message : String(err)}`);
          }

          actionsThisCycle++;

          // Log the action
          await ctx.entities.upsert({
            entityType: "action-log",
            scopeKind: "instance",
            externalId: uuid(),
            title: `${actionType}: @${td.handle}`,
            status: "success",
            data: {
              action: actionType,
              targetUrl: td.profileUrl,
              performedAt: now(),
            } as unknown as Record<string, unknown>,
          });

          // Update target engagement count
          td.engagementCount++;
          td.lastEngagedAt = now();
          await ctx.entities.upsert({
            entityType: "target",
            scopeKind: "instance",
            externalId: target.externalId || "",
            title: target.title || "",
            status: "active",
            data: td as unknown as Record<string, unknown>,
          });

          // Jittered delay between actions
          await jitteredDelay(
            config.cycleIntervalMin * 1000,
            config.cycleIntervalMax * 1000,
          );
        }
      }

      if (actionsThisCycle > 0) {
        ctx.logger.info(`engagement-cycle: completed ${actionsThisCycle} actions`);
      }
    });

    // ── queue-cleanup (every 6 hours) ──────────────────────────────────────

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

    // ── analytics-rollup (daily at midnight) ──────────────────────────────

    ctx.jobs.register("analytics-rollup", async (_job: PluginJobContext) => {
      ctx.logger.info("Running analytics rollup");
      const today = todayKey();
      const analytics = await getDailyAnalytics(ctx, today);
      ctx.logger.info(`Daily analytics for ${today}`, analytics as unknown as Record<string, unknown>);
    });
  },

  async onHealth() {
    // Check X API connection health
    const xApiStatus = await checkXApiConnection();

    if (!xApiStatus.connected) {
      return {
        status: "degraded" as const,
        message: "X API not connected. Complete OAuth setup at /api/x-oauth/authorize to enable posting.",
      };
    }

    const rateLimits = xApiStatus.rateLimits;
    const isPanic = rateLimits?.panicMode;

    if (isPanic) {
      return {
        status: "degraded" as const,
        message: `X API connected (@${xApiStatus.username}) but in panic mode (429 received). Reduced rate limits active.`,
        details: { username: xApiStatus.username, rateLimits },
      };
    }

    return {
      status: "ok" as const,
      message: `X API connected (@${xApiStatus.username}). Direct posting active.`,
      details: { username: xApiStatus.username, rateLimits },
    };
  },

  // ── ext-heartbeat webhook handler ─────────────────────────────────────────
  async onWebhook(input: PluginWebhookInput) {
    if (input.endpointKey !== "ext-heartbeat") {
      return; // ignore unknown endpoints
    }

    const ctx = currentContext;
    if (!ctx) {
      return; // plugin not initialized yet
    }

    const body = (input.parsedBody ?? {}) as Record<string, unknown>;
    const sessionId = (body.sessionId as string) || "unknown";
    const botEnabled = Boolean(body.botEnabled);
    const currentUrl = (body.currentUrl as string) || "";

    const heartbeat = {
      sessionId,
      botEnabled,
      currentUrl,
      lastHeartbeatAt: new Date().toISOString(),
    };

    // Persist the latest heartbeat in plugin instance state
    await ctx.state.set(
      {
        scopeKind: "instance",
        namespace: "extension",
        stateKey: "ext-heartbeat",
      },
      heartbeat as unknown as Record<string, unknown>,
    );

    ctx.logger.info("ext-heartbeat received", { sessionId, botEnabled });
  },
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

export default plugin;
runWorker(plugin, import.meta.url);
