/**
 * Moltbook plugin worker — Coherence Daddy agent.
 *
 * Safety layers:
 *   1. Content filter — blocks credentials, internal IPs, env vars, secrets
 *   2. Rate limiter — local tracking with safety multiplier + panic mode
 *   3. Daily budgets — configurable caps on posts/comments/votes
 *   4. Approval queue — content staged as "pending" before dispatch
 *   5. Domain lockdown — HTTP client rejects off-domain redirects
 *   6. Audit log — every API call recorded as plugin entity
 */

import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, ToolResult, PluginJobContext } from "@paperclipai/plugin-sdk";
import type { MoltbookConfig, ContentQueueData, ContentQueueAction } from "./types.js";
import { MoltbookRateLimiter } from "./rate-limiter.js";
import { MoltbookClient, type AuditEntry } from "./moltbook-client.js";

// ─── Content safety filter ──────────────────────────────────────────────────

const DEFAULT_BLOCKED_PATTERNS = [
  "[A-Za-z0-9_-]{20,}(?:key|token|secret)",
  "(?:31\\.220|168\\.231|147\\.79)\\.\\d+\\.\\d+",
  "(?:DATABASE_URL|ANTHROPIC_API_KEY|SMTP_|STRIPE_|DISCORD_TOKEN|GITHUB_TOKEN|GROK_API_KEY|GEMINI_API_KEY|CONTENT_API_KEY|INTEL_INGEST_KEY|EMBED_API_KEY|OLLAMA_API_KEY)",
  "sk-[a-zA-Z0-9]{20,}",
  "ghp_[a-zA-Z0-9]{20,}",
  "moltbook_[a-zA-Z0-9]{10,}",
  "Bearer\\s+[A-Za-z0-9._-]{20,}",
];

function isContentSafe(
  text: string,
  blockedPatterns: string[],
): { safe: boolean; reason?: string } {
  const patterns = blockedPatterns.length > 0 ? blockedPatterns : DEFAULT_BLOCKED_PATTERNS;

  for (const pattern of patterns) {
    try {
      const re = new RegExp(pattern, "i");
      const match = re.exec(text);
      if (match) {
        return {
          safe: false,
          reason: `Content blocked: matches safety pattern "${pattern}" near "${text.slice(Math.max(0, match.index - 10), match.index + 20).replace(/\n/g, " ")}..."`,
        };
      }
    } catch {
      // Invalid regex in config — skip it
    }
  }

  return { safe: true };
}

/** Check all text fields in an outbound content item. */
function validateOutboundContent(
  data: Record<string, unknown>,
  blockedPatterns: string[],
): { safe: boolean; reason?: string } {
  const textFields = ["title", "content", "text", "description", "display_name", "name"];
  for (const field of textFields) {
    const val = data[field];
    if (typeof val === "string" && val.length > 0) {
      const check = isContentSafe(val, blockedPatterns);
      if (!check.safe) return check;
    }
  }
  return { safe: true };
}

// ─── Verification challenge solver ──────────────────────────────────────────

const WORD_TO_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};

function parseNumberWords(text: string): number | null {
  const lower = text.toLowerCase().replace(/[^a-z0-9.\s-]/g, " ");
  const tokens = lower.split(/\s+/).filter(Boolean);

  for (const t of tokens) {
    const n = parseFloat(t);
    if (!isNaN(n)) return n;
  }

  let result = 0;
  let current = 0;
  let found = false;

  for (const t of tokens) {
    if (WORD_TO_NUM[t] !== undefined) {
      found = true;
      const val = WORD_TO_NUM[t]!;
      if (val === 100) {
        current = current === 0 ? 100 : current * 100;
      } else if (val === 1000) {
        current = current === 0 ? 1000 : current * 1000;
        result += current;
        current = 0;
      } else {
        current += val;
      }
    }
  }

  result += current;
  return found ? result : null;
}

export function solveChallenge(challenge: string): string | null {
  const numbers: number[] = [];
  const parts = challenge.split(/(?:and|plus|minus|times|multiplied|divided|adds?|subtracts?|slows?|speeds?|gains?|loses?|by|at|with|from|to)\b/i);

  for (const part of parts) {
    const num = parseNumberWords(part.trim());
    if (num !== null) numbers.push(num);
  }

  if (numbers.length < 2) return null;

  const lower = challenge.toLowerCase();
  let result: number;

  if (/(?:plus|adds?|gains?|speeds?|increases?|grows?)/.test(lower)) {
    result = numbers[0]! + numbers[1]!;
  } else if (/(?:minus|subtract|slows?|loses?|decreases?|drops?|reduces?)/.test(lower)) {
    result = numbers[0]! - numbers[1]!;
  } else if (/(?:times|multipli|doubles?)/.test(lower)) {
    result = numbers[0]! * numbers[1]!;
  } else if (/(?:divid|split|halv)/.test(lower)) {
    result = numbers[1] !== 0 ? numbers[0]! / numbers[1]! : 0;
  } else {
    result = numbers[0]! + numbers[1]!;
  }

  return result.toFixed(2);
}

// ─── Typed params helper ────────────────────────────────────────────────────

type P = Record<string, unknown>;
const p = (params: unknown): P => params as P;

// ─── Plugin definition ──────────────────────────────────────────────────────

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    ctx.logger.info("Moltbook plugin starting");

    // ─── Resolve config ───────────────────────────────────────────────────
    const rawConfig = await ctx.config.get();
    const config: MoltbookConfig = {
      apiKeyRef: (rawConfig.apiKeyRef as string) ?? "",
      agentName: (rawConfig.agentName as string) ?? "Coherence Daddy",
      agentDescription:
        (rawConfig.agentDescription as string) ??
        "Faith-driven technology for a more coherent world.",
      autoApproveContent: (rawConfig.autoApproveContent as boolean) ?? false,
      rateLimitMultiplier: (rawConfig.rateLimitMultiplier as number) ?? 0.5,
      maxPostsPerDay: (rawConfig.maxPostsPerDay as number) ?? 4,
      maxCommentsPerDay: (rawConfig.maxCommentsPerDay as number) ?? 20,
      maxVotesPerDay: (rawConfig.maxVotesPerDay as number) ?? 50,
      blockedPatterns: (rawConfig.blockedPatterns as string[]) ?? DEFAULT_BLOCKED_PATTERNS,
    };

    // ─── Initialize rate limiter ──────────────────────────────────────────
    const rateLimiter = new MoltbookRateLimiter({
      safetyMultiplier: config.rateLimitMultiplier,
      maxPostsPerDay: config.maxPostsPerDay,
      maxCommentsPerDay: config.maxCommentsPerDay,
      maxVotesPerDay: config.maxVotesPerDay,
    });

    // ─── Resolve API key ──────────────────────────────────────────────────
    let apiKey = "";
    if (config.apiKeyRef) {
      try {
        apiKey = await ctx.secrets.resolve(config.apiKeyRef);
      } catch {
        ctx.logger.warn("Could not resolve Moltbook API key — register first or check config");
      }
    }

    // ─── Audit logger ─────────────────────────────────────────────────────
    const auditCallback = async (entry: AuditEntry): Promise<void> => {
      try {
        await ctx.entities.upsert({
          entityType: "moltbook-audit",
          scopeKind: "instance",
          title: `${entry.method} ${entry.endpoint} → ${entry.responseStatus}`,
          status: entry.responseStatus < 400 ? "ok" : "error",
          data: entry as unknown as Record<string, unknown>,
        });
      } catch (err) {
        ctx.logger.warn("Failed to write audit entity", { error: String(err) });
      }
    };

    // ─── Initialize HTTP client ───────────────────────────────────────────
    const client = new MoltbookClient({
      http: ctx.http,
      apiKey,
      rateLimiter,
      onAudit: auditCallback,
      logger: ctx.logger,
    });

    // ─── Helper: queue content ────────────────────────────────────────────
    async function queueContent(
      action: ContentQueueAction,
      data: Partial<ContentQueueData>,
      agentId: string,
    ): Promise<ToolResult> {
      const queueItem: ContentQueueData = {
        action,
        ...data,
        queuedBy: agentId,
        queuedAt: new Date().toISOString(),
        retryCount: 0,
      };

      const status = config.autoApproveContent ? "approved" : "pending";

      await ctx.entities.upsert({
        entityType: "moltbook-content-queue",
        scopeKind: "instance",
        title: action === "post"
          ? `Post: ${data.title ?? "(untitled)"}`
          : action === "comment"
            ? `Comment on ${data.postId ?? "unknown"}`
            : `Vote ${data.voteDirection} on ${data.targetId ?? "unknown"}`,
        status,
        data: queueItem as unknown as Record<string, unknown>,
      });

      return {
        content: config.autoApproveContent
          ? `Content queued as "approved" — will be dispatched within 5 minutes.`
          : `Content queued as "pending" — awaiting manual approval. Use the content-dispatcher job or approve in the dashboard.`,
        data: { status, action },
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TOOLS
    // ═══════════════════════════════════════════════════════════════════════

    // ─── moltbook-register ────────────────────────────────────────────────
    ctx.tools.register(
      "moltbook-register",
      {
        displayName: "Moltbook: Register Agent",
        description: "Register Coherence Daddy on Moltbook. One-time operation.",
        parametersSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
          },
        },
      },
      async (params, runCtx) => {
        const args = p(params);
        const name = (args.name as string) || config.agentName;
        const description = (args.description as string) || config.agentDescription;

        const check = isContentSafe(description, config.blockedPatterns);
        if (!check.safe) {
          return { error: check.reason };
        }

        const resp = await client.register(name, description);
        if (!resp.success) {
          return { error: resp.error, content: resp.hint };
        }

        await ctx.state.set(
          { scopeKind: "instance", stateKey: "registration" },
          {
            registered: true,
            registeredAt: new Date().toISOString(),
            claimUrl: (resp.data as Record<string, unknown>)?.agent
              ? ((resp.data as Record<string, unknown>).agent as Record<string, unknown>).claim_url
              : undefined,
          },
        );

        return {
          content: [
            "Registration successful!",
            "",
            "IMPORTANT: Save the API key from the response as a secret reference.",
            "Share the claim URL with your human to activate the account.",
            "",
            "Next steps:",
            "1. Store the API key as MOLTBOOK_API_KEY in your secret provider",
            "2. Set apiKeyRef in plugin config to point to it",
            "3. Human visits the claim URL to verify",
          ].join("\n"),
          data: resp.data,
        };
      },
    );

    // ─── moltbook-status ──────────────────────────────────────────────────
    ctx.tools.register(
      "moltbook-status",
      {
        displayName: "Moltbook: Check Status",
        description: "Check agent claim/verification status and rate limit usage.",
        parametersSchema: { type: "object", properties: {} },
      },
      async () => {
        if (!apiKey) {
          return { content: "Not connected — no API key configured. Register first or set apiKeyRef in config." };
        }

        const resp = await client.getStatus();
        const stats = rateLimiter.getStats();

        return {
          content: [
            `Status: ${resp.success ? "Connected" : "Error"}`,
            `Panic mode: ${stats.isPanic ? "ACTIVE (budgets halved)" : "off"}`,
            `Effective multiplier: ${stats.effectiveMultiplier}x`,
            `Today's usage — Posts: ${stats.daily.posts}/${config.maxPostsPerDay}, Comments: ${stats.daily.comments}/${config.maxCommentsPerDay}, Votes: ${stats.daily.votes}/${config.maxVotesPerDay}`,
          ].join("\n"),
          data: { moltbookStatus: resp.data, rateLimiter: stats },
        };
      },
    );

    // ─── moltbook-post ────────────────────────────────────────────────────
    ctx.tools.register(
      "moltbook-post",
      {
        displayName: "Moltbook: Create Post",
        description: "Queue a post for a submolt. Safety-filtered and budget-checked.",
        parametersSchema: {
          type: "object",
          required: ["submolt_name", "title"],
          properties: {
            submolt_name: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
            url: { type: "string" },
            type: { type: "string" },
          },
        },
      },
      async (params, runCtx) => {
        const args = p(params);

        const check = validateOutboundContent(args, config.blockedPatterns);
        if (!check.safe) {
          return { error: `Content blocked by safety filter: ${check.reason}` };
        }

        const budget = rateLimiter.canUseDailyBudget("post");
        if (!budget.allowed) {
          return { error: `Daily post budget exhausted (${budget.limit} max). Try again tomorrow.` };
        }

        return queueContent("post", {
          submoltName: args.submolt_name as string,
          title: args.title as string,
          content: args.content as string | undefined,
          url: args.url as string | undefined,
          postType: (args.type as "text" | "link" | "image") ?? "text",
        }, runCtx.agentId);
      },
    );

    // ─── moltbook-comment ─────────────────────────────────────────────────
    ctx.tools.register(
      "moltbook-comment",
      {
        displayName: "Moltbook: Comment",
        description: "Queue a comment on a post. Safety-filtered.",
        parametersSchema: {
          type: "object",
          required: ["post_id", "content"],
          properties: {
            post_id: { type: "string" },
            content: { type: "string" },
            parent_id: { type: "string" },
          },
        },
      },
      async (params, runCtx) => {
        const args = p(params);

        const check = isContentSafe(args.content as string, config.blockedPatterns);
        if (!check.safe) {
          return { error: `Content blocked by safety filter: ${check.reason}` };
        }

        const budget = rateLimiter.canUseDailyBudget("comment");
        if (!budget.allowed) {
          return { error: `Daily comment budget exhausted (${budget.limit} max). Try again tomorrow.` };
        }

        return queueContent("comment", {
          postId: args.post_id as string,
          content: args.content as string,
          parentCommentId: args.parent_id as string | undefined,
        }, runCtx.agentId);
      },
    );

    // ─── moltbook-vote ────────────────────────────────────────────────────
    ctx.tools.register(
      "moltbook-vote",
      {
        displayName: "Moltbook: Vote",
        description: "Upvote or downvote a post or comment.",
        parametersSchema: {
          type: "object",
          required: ["target_id", "direction"],
          properties: {
            target_id: { type: "string" },
            direction: { type: "string" },
            target_type: { type: "string" },
          },
        },
      },
      async (params, runCtx) => {
        const args = p(params);

        const budget = rateLimiter.canUseDailyBudget("vote");
        if (!budget.allowed) {
          return { error: `Daily vote budget exhausted (${budget.limit} max). Try again tomorrow.` };
        }

        return queueContent("vote", {
          targetId: args.target_id as string,
          voteDirection: args.direction as "up" | "down",
          targetType: (args.target_type as "post" | "comment") ?? "post",
        }, runCtx.agentId);
      },
    );

    // ─── moltbook-feed (read-only) ────────────────────────────────────────
    ctx.tools.register(
      "moltbook-feed",
      {
        displayName: "Moltbook: Read Feed",
        description: "Read the Moltbook feed (hot/new/top/rising).",
        parametersSchema: {
          type: "object",
          properties: {
            sort: { type: "string" },
            limit: { type: "number" },
            filter: { type: "string" },
          },
        },
      },
      async (params) => {
        if (!apiKey) {
          return { error: "Not connected — no API key configured." };
        }

        const args = p(params);
        const sort = (args.sort as string) ?? "hot";
        const limit = (args.limit as number) ?? 25;
        const filter = args.filter as string | undefined;

        const resp = filter
          ? await client.getPersonalizedFeed(sort, limit, filter)
          : await client.getFeed(sort, limit);

        if (!resp.success) {
          return { error: resp.error, content: resp.hint };
        }

        return { content: `Feed (${sort}): ${JSON.stringify(resp.data)}`, data: resp.data };
      },
    );

    // ─── moltbook-search (read-only) ──────────────────────────────────────
    ctx.tools.register(
      "moltbook-search",
      {
        displayName: "Moltbook: Search",
        description: "Semantic search across Moltbook posts and comments.",
        parametersSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            type: { type: "string" },
            limit: { type: "number" },
          },
        },
      },
      async (params) => {
        if (!apiKey) {
          return { error: "Not connected — no API key configured." };
        }

        const args = p(params);
        const resp = await client.search(
          args.query as string,
          (args.type as string) ?? "all",
          (args.limit as number) ?? 20,
        );

        if (!resp.success) {
          return { error: resp.error, content: resp.hint };
        }

        return { content: `Search results: ${JSON.stringify(resp.data)}`, data: resp.data };
      },
    );

    // ─── moltbook-subscribe ───────────────────────────────────────────────
    ctx.tools.register(
      "moltbook-subscribe",
      {
        displayName: "Moltbook: Subscribe/Unsubscribe",
        description: "Subscribe to or unsubscribe from a submolt.",
        parametersSchema: {
          type: "object",
          required: ["submolt_name", "action"],
          properties: {
            submolt_name: { type: "string" },
            action: { type: "string" },
          },
        },
      },
      async (params) => {
        if (!apiKey) {
          return { error: "Not connected — no API key configured." };
        }

        const args = p(params);
        const name = args.submolt_name as string;
        const action = args.action as string;

        const resp = action === "unsubscribe"
          ? await client.unsubscribe(name)
          : await client.subscribe(name);

        return {
          content: resp.success
            ? `Successfully ${action}d ${action === "unsubscribe" ? "from" : "to"} r/${name}`
            : `Failed: ${resp.error}`,
          data: resp.data,
        };
      },
    );

    // ─── moltbook-create-submolt ──────────────────────────────────────────
    ctx.tools.register(
      "moltbook-create-submolt",
      {
        displayName: "Moltbook: Create Community",
        description: "Create a new submolt (community). Crypto content disabled by default.",
        parametersSchema: {
          type: "object",
          required: ["name", "display_name", "description"],
          properties: {
            name: { type: "string" },
            display_name: { type: "string" },
            description: { type: "string" },
            allow_crypto: { type: "boolean" },
          },
        },
      },
      async (params) => {
        if (!apiKey) {
          return { error: "Not connected — no API key configured." };
        }

        const args = p(params);

        const check = validateOutboundContent(args, config.blockedPatterns);
        if (!check.safe) {
          return { error: `Content blocked by safety filter: ${check.reason}` };
        }

        const resp = await client.createSubmolt({
          name: args.name,
          display_name: args.display_name,
          description: args.description,
          allow_crypto: args.allow_crypto ?? false,
        });

        if (!resp.success) {
          return { error: resp.error, content: resp.hint };
        }

        return {
          content: `Community r/${args.name as string} created successfully!`,
          data: resp.data,
        };
      },
    );

    // ─── moltbook-profile (read-only) ─────────────────────────────────────
    ctx.tools.register(
      "moltbook-profile",
      {
        displayName: "Moltbook: View Profile",
        description: "View your own or another agent's profile.",
        parametersSchema: {
          type: "object",
          properties: {
            agent_name: { type: "string" },
          },
        },
      },
      async (params) => {
        if (!apiKey) {
          return { error: "Not connected — no API key configured." };
        }

        const args = p(params);
        const name = args.agent_name as string | undefined;
        const resp = name
          ? await client.getAgentProfile(name)
          : await client.getMyProfile();

        if (!resp.success) {
          return { error: resp.error, content: resp.hint };
        }

        return {
          content: `Profile: ${JSON.stringify(resp.data)}`,
          data: resp.data,
        };
      },
    );

    // ─── moltbook-notifications ───────────────────────────────────────────
    ctx.tools.register(
      "moltbook-notifications",
      {
        displayName: "Moltbook: Notifications",
        description: "Check dashboard/notifications, or mark notifications as read.",
        parametersSchema: {
          type: "object",
          properties: {
            action: { type: "string" },
            post_id: { type: "string" },
          },
        },
      },
      async (params) => {
        if (!apiKey) {
          return { error: "Not connected — no API key configured." };
        }

        const args = p(params);
        const action = (args.action as string) ?? "check";

        if (action === "read-all") {
          const resp = await client.markNotificationsRead();
          return { content: resp.success ? "All notifications marked as read." : `Failed: ${resp.error}` };
        }

        if (action === "read-post") {
          const postId = args.post_id as string;
          if (!postId) return { error: "post_id is required for read-post action." };
          const resp = await client.markNotificationsRead(postId);
          return { content: resp.success ? `Notifications for post ${postId} marked as read.` : `Failed: ${resp.error}` };
        }

        const resp = await client.getDashboard();
        if (!resp.success) {
          return { error: resp.error, content: resp.hint };
        }

        return { content: `Dashboard: ${JSON.stringify(resp.data)}`, data: resp.data };
      },
    );

    // ═══════════════════════════════════════════════════════════════════════
    // JOBS
    // ═══════════════════════════════════════════════════════════════════════

    // ─── content-dispatcher (every 5 min) ─────────────────────────────────
    ctx.jobs.register("content-dispatcher", async (job: PluginJobContext) => {
      if (!apiKey) {
        ctx.logger.info("Content dispatcher skipped — no API key configured");
        return;
      }

      ctx.logger.info("Content dispatcher starting", { runId: job.runId, trigger: job.trigger });

      const items = await ctx.entities.list({
        entityType: "moltbook-content-queue",
        scopeKind: "instance",
        limit: 10,
      });

      const approved = items.filter((i) => i.status === "approved");
      if (approved.length === 0) {
        ctx.logger.info("No approved content to dispatch");
        return;
      }

      for (const item of approved) {
        const data = item.data as unknown as ContentQueueData;

        try {
          if (data.action === "post") {
            const budgetCheck = rateLimiter.canUseDailyBudget("post");
            if (!budgetCheck.allowed) {
              ctx.logger.warn("Post budget exhausted, skipping");
              continue;
            }

            const resp = await client.createPost({
              submolt_name: data.submoltName,
              title: data.title,
              content: data.content,
              url: data.url,
              type: data.postType ?? "text",
            });

            rateLimiter.recordDailyUsage("post");

            await ctx.entities.upsert({
              entityType: "moltbook-content-queue",
              scopeKind: "instance",
              externalId: item.externalId ?? undefined,
              title: item.title ?? undefined,
              status: resp.success ? "posted" : "failed",
              data: {
                ...data,
                postedAt: new Date().toISOString(),
                error: resp.success ? undefined : resp.error,
                moltbookResponseId: resp.data ? String((resp.data as Record<string, unknown>).id ?? "") : undefined,
              },
            });
          } else if (data.action === "comment") {
            const budgetCheck = rateLimiter.canUseDailyBudget("comment");
            if (!budgetCheck.allowed) continue;

            const resp = await client.createComment(
              data.postId!,
              data.content!,
              data.parentCommentId,
            );

            rateLimiter.recordDailyUsage("comment");

            await ctx.entities.upsert({
              entityType: "moltbook-content-queue",
              scopeKind: "instance",
              externalId: item.externalId ?? undefined,
              title: item.title ?? undefined,
              status: resp.success ? "posted" : "failed",
              data: {
                ...data,
                postedAt: new Date().toISOString(),
                error: resp.success ? undefined : resp.error,
              },
            });
          } else if (data.action === "vote") {
            const budgetCheck = rateLimiter.canUseDailyBudget("vote");
            if (!budgetCheck.allowed) continue;

            let resp;
            if (data.targetType === "comment") {
              resp = await client.upvoteComment(data.targetId!);
            } else if (data.voteDirection === "down") {
              resp = await client.downvotePost(data.targetId!);
            } else {
              resp = await client.upvotePost(data.targetId!);
            }

            rateLimiter.recordDailyUsage("vote");

            await ctx.entities.upsert({
              entityType: "moltbook-content-queue",
              scopeKind: "instance",
              externalId: item.externalId ?? undefined,
              title: item.title ?? undefined,
              status: resp.success ? "posted" : "failed",
              data: { ...data, postedAt: new Date().toISOString() },
            });
          }
        } catch (err) {
          ctx.logger.error("Dispatch error", { action: data.action, error: String(err) });
          await ctx.entities.upsert({
            entityType: "moltbook-content-queue",
            scopeKind: "instance",
            externalId: item.externalId ?? undefined,
            title: item.title ?? undefined,
            status: "failed",
            data: { ...data, error: String(err), retryCount: data.retryCount + 1 },
          });
        }
      }

      ctx.logger.info("Content dispatcher complete", { processed: approved.length });
    });

    // ─── heartbeat (every 30 min) ─────────────────────────────────────────
    ctx.jobs.register("heartbeat", async (job: PluginJobContext) => {
      ctx.logger.info("Heartbeat ping", { runId: job.runId });

      try {
        const resp = await ctx.http.fetch("https://www.moltbook.com/heartbeat.md", {
          method: "GET",
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        });

        await ctx.state.set(
          { scopeKind: "instance", stateKey: "last-heartbeat" },
          { at: new Date().toISOString(), status: resp.ok ? "ok" : "error" },
        );

        if (resp.ok) {
          ctx.logger.info("Heartbeat OK");
        } else {
          ctx.logger.warn("Heartbeat failed", { status: resp.status });
        }
      } catch (err) {
        ctx.logger.warn("Heartbeat error", { error: String(err) });
      }
    });

    // ─── daily-cleanup (midnight) ─────────────────────────────────────────
    ctx.jobs.register("daily-cleanup", async (job: PluginJobContext) => {
      ctx.logger.info("Daily cleanup starting", { runId: job.runId });

      const stats = rateLimiter.getStats();
      await ctx.entities.upsert({
        entityType: "moltbook-daily-analytics",
        scopeKind: "instance",
        externalId: stats.daily.date,
        title: `Analytics ${stats.daily.date}`,
        status: "archived",
        data: stats.daily as unknown as Record<string, unknown>,
      });

      rateLimiter.resetDaily();

      const allItems = await ctx.entities.list({
        entityType: "moltbook-content-queue",
        scopeKind: "instance",
        limit: 200,
      });

      const completedItems = allItems.filter(
        (i) => i.status === "posted" || i.status === "failed" || i.status === "rejected",
      );

      if (completedItems.length > 100) {
        const toArchive = completedItems.slice(100);
        for (const item of toArchive) {
          await ctx.entities.upsert({
            entityType: "moltbook-content-archive",
            scopeKind: "instance",
            externalId: item.id,
            title: item.title ?? undefined,
            status: "archived",
            data: item.data,
          });
        }
        ctx.logger.info("Archived old content items", { count: toArchive.length });
      }

      ctx.logger.info("Daily cleanup complete");
    });

    ctx.logger.info("Moltbook plugin ready", {
      agent: config.agentName,
      autoApprove: config.autoApproveContent,
      rateLimitMultiplier: config.rateLimitMultiplier,
      connected: !!apiKey,
    });
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
