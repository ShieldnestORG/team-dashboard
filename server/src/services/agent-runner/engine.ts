// ---------------------------------------------------------------------------
// Coherent Ones University — agent runner engine (the tick loop).
//
// Two periodic behaviors over the live community, both gated by hard caps
// (caps.ts), a content-safety gate (safety.ts), the daily spend ceiling
// (reporting.spentTodayUsd, FIXED), and per-agent admin config:
//
//   AMBIENT (small-talk): each enabled, in-hours agent may post a scripted
//     post_line (90%) or a Claude variation (10%), and may comment on ANOTHER
//     agent's recent post. Real-member posts are NEVER touched here — they go
//     through the responsive path so caps/gates apply.
//
//   RESPONSIVE (help): new visible posts authored by real members (author_email
//     NOT LIKE 'agent+%') newer than the watermark are classified (deterministic
//     intent) and answered by 0–2 eligible agents. A "are you a bot?" challenge
//     → silence + a bot_challenge report (never deny).
//
// Single-runner advisory lock guards against double-posting during rolling
// restarts; only the lock holder ticks. Startup jitter spreads first activity.
//
// EVERYTHING here is inert until the runner is started (index.ts), which only
// happens behind an env flag (default OFF). This module performs NO work at
// import time.
// ---------------------------------------------------------------------------

import { and, desc, eq, gt, isNull, like, not } from "drizzle-orm";
import {
  universityMembers,
  universityAgentConfig,
  universityCommunityPosts,
  type Db,
} from "@paperclipai/db";

// The reserved-connection type, derived structurally from the drizzle client so
// we don't need a direct `postgres` dependency in the server package. `$client`
// is the underlying postgres.js Sql; `.reserve()` resolves to a ReservedSql
// (a one-connection Sql with an extra `.release()`).
type ReservedConn = Awaited<ReturnType<Db["$client"]["reserve"]>>;
import { logger } from "../../middleware/logger.js";
import {
  AGENT_PERSONAS,
  agentEmail,
  type AgentPersona,
} from "./personas.js";
import { callClaude } from "./claude.js";
import { contentSafe, hasEmoji, isBotChallenge } from "./safety.js";
import { classifyIntent, selectResponders } from "./responder.js";
import { logAgentUsage, reportAgentProblem, spentTodayUsd } from "./reporting.js";
import {
  AgentRunnerState,
  AmbientPostRejected,
  type AgentRunnerTx,
} from "./state.js";
import {
  budgetExhausted,
  canAmbientComment,
  canAmbientPost,
  canReplyToMember,
  canUseLine,
  CAPS,
  postRespondersExhausted,
  responsiveHourlyExhausted,
} from "./caps.js";

// The community service surface the engine needs (in-process, by accountId).
// Structurally compatible with customerPortalService(db)'s return object — we
// take only the two write fns so the dep is minimal and obvious.
export interface CommunityWriter {
  createCommunityPost: (
    accountId: string,
    bodyRaw: string,
    postTypeRaw?: string | null,
    topicRaw?: string | null,
    opts?: {
      // Runs inside the SAME transaction as the post insert, after the row
      // exists. Throwing rolls the whole insert back (no post, no ledger write)
      // — the agent runner uses this to commit its durable posting ledger
      // atomically with the post so a restart mid-tick can't double-post.
      onInsertTx?: (
        tx: AgentRunnerTx,
        row: { id: string; authorEmail: string; createdAt: Date },
      ) => Promise<void>;
    },
  ) => Promise<{ id: string }>;
  createCommunityComment: (
    accountId: string,
    postId: string,
    bodyRaw: string,
  ) => Promise<{ id: string }>;
}

export interface EngineDeps {
  db: Db;
  community: CommunityWriter;
  apiKey: string;
  dailyBudgetUsd: number;
}

// One resolved, runnable agent: persona statics + live config + identity.
interface ActiveAgent {
  persona: AgentPersona;
  accountId: string;
  memberId: string;
  email: string;
  model: string;
  postProbability: number;
  commentProbability: number;
  activeStartHour: number;
  activeEndHour: number;
  voiceNote: string | null;
}

const AGENT_EMAIL_LIKE = "agent+%@coherencedaddy.com";
// A stable 64-bit-ish constant for the single-runner advisory lock. Arbitrary
// but fixed so every replica contends for the same lock.
const ADVISORY_LOCK_KEY = 770_513_021;
const FEED_POLL_LIMIT = 25;

const PERSONA_BY_KEY = new Map(AGENT_PERSONAS.map((p) => [p.key, p]));

/** Real local hour for an IANA timezone (DST-safe via Intl, not a fixed offset). */
function localHour(timezone: string, now: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    // "24" can appear for midnight in some environments; normalize to 0..23.
    const h = Number(fmt.format(now));
    return Number.isFinite(h) ? h % 24 : 12;
  } catch {
    return 12; // unknown tz → treat as mid-day (safe, in-hours-ish)
  }
}

/** Is `hour` within [start,end)? Wraps past midnight when start > end. */
function withinHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false; // empty window
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // wraps midnight
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Pick a uniformly random element, or undefined for an empty array. */
function sample<T>(arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

export class AgentEngine {
  private readonly deps: EngineDeps;
  private readonly state: AgentRunnerState;
  // Did we already file today's budget_exceeded report? Keyed by UTC date.
  private budgetReportDate: string | null = null;
  // Dedicated connection that holds the single-runner advisory lock for the
  // runner's lifetime. pg_try_advisory_lock is SESSION-scoped (pinned to one
  // backend connection), so the lock MUST live on a reserved connection we
  // control — never on an arbitrary pooled connection that can be reaped or
  // reused, which would silently drop the lock or skip ticks. Null until first
  // acquired; reset to null whenever the connection is found dead so the next
  // tick re-reserves and re-acquires.
  private lockConn: ReservedConn | null = null;

  constructor(deps: EngineDeps) {
    this.deps = deps;
    this.state = new AgentRunnerState(deps.db);
  }

  /**
   * Re-derive the responsive watermark from the DB so a restart never re-replies
   * to posts it already saw. Watermark = newest existing community post time
   * (we only answer posts strictly newer than this).
   */
  async initWatermark(): Promise<void> {
    try {
      const rows = await this.deps.db
        .select({ createdAt: universityCommunityPosts.createdAt })
        .from(universityCommunityPosts)
        .orderBy(desc(universityCommunityPosts.createdAt))
        .limit(1);
      const latest = rows[0]?.createdAt;
      if (latest) this.state.setWatermark(latest);
      else this.state.setWatermark(new Date());
    } catch (err) {
      // On failure start the watermark at "now" so we never flood-reply the
      // entire backlog; we simply begin answering from this moment forward.
      logger.error({ err }, "agent-runner: initWatermark failed; starting from now");
      this.state.setWatermark(new Date());
    }
  }

  /**
   * Acquire/confirm the single-runner advisory lock on a DEDICATED reserved
   * connection. Returns true only for the holder; non-holders skip the tick (no
   * double-posting during rolling restarts).
   *
   * Why a reserved connection: pg_try_advisory_lock takes a SESSION-level lock
   * bound to one specific backend connection. On a pool, a later tick can land
   * on a different connection (gets false, silently skips its own ticks) and an
   * idle/lifetime-reaped connection silently releases the lock on disconnect —
   * letting a second replica grab it (the exact double-post this lock prevents).
   * We therefore hold the lock on a connection we reserve out of the pool and
   * keep for the runner's lifetime, re-asserting liveness each tick.
   */
  private async holdsAdvisoryLock(): Promise<boolean> {
    // Already holding the lock on our reserved connection: re-assert it's alive
    // with a cheap round-trip. If the connection died, drop it and fall through
    // to re-reserve + re-acquire below.
    if (this.lockConn) {
      try {
        await this.lockConn`SELECT 1`;
        return true;
      } catch (err) {
        logger.error({ err }, "agent-runner: lock connection lost; re-acquiring");
        try {
          this.lockConn.release();
        } catch {
          // already gone — ignore
        }
        this.lockConn = null;
      }
    }

    // No live reserved connection: reserve one and try to take the lock ON IT.
    let conn: ReservedConn | null = null;
    try {
      conn = await this.deps.db.$client.reserve();
      const rows = (await conn`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked`) as unknown as Array<{
        locked: boolean;
      }>;
      if (rows[0]?.locked === true) {
        // Keep the connection reserved (out of the pool) so the session lock
        // can never be reaped/reused out from under us.
        this.lockConn = conn;
        return true;
      }
      // Another replica holds the lock — return this connection to the pool.
      conn.release();
      return false;
    } catch (err) {
      logger.error({ err }, "agent-runner: advisory lock acquire failed (skipping tick)");
      if (conn) {
        try {
          conn.release();
        } catch {
          // ignore
        }
      }
      return false;
    }
  }

  /**
   * Release the advisory lock and return its reserved connection to the pool.
   * Called on runner shutdown so a clean stop hands the lock to another replica
   * immediately rather than waiting for the connection to be reaped.
   */
  async releaseAdvisoryLock(): Promise<void> {
    if (!this.lockConn) return;
    const conn = this.lockConn;
    this.lockConn = null;
    try {
      await conn`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
    } catch (err) {
      logger.error({ err }, "agent-runner: advisory unlock failed on shutdown");
    } finally {
      try {
        conn.release();
      } catch {
        // ignore
      }
    }
  }

  /** Load enabled agents joined to live config; map persona statics + identity. */
  private async loadActiveAgents(): Promise<ActiveAgent[]> {
    const rows = await this.deps.db
      .select({
        memberId: universityMembers.id,
        accountId: universityMembers.accountId,
        email: universityMembers.email,
        personaKey: universityMembers.agentPersonaKey,
        model: universityAgentConfig.model,
        postProbability: universityAgentConfig.postProbability,
        commentProbability: universityAgentConfig.commentProbability,
        activeStartHour: universityAgentConfig.activeStartHour,
        activeEndHour: universityAgentConfig.activeEndHour,
        voiceNote: universityAgentConfig.voiceNote,
      })
      .from(universityMembers)
      .innerJoin(
        universityAgentConfig,
        eq(universityAgentConfig.memberId, universityMembers.id),
      )
      .where(
        and(
          eq(universityMembers.isAgent, true),
          isNull(universityMembers.agentPausedAt),
        ),
      );

    const active: ActiveAgent[] = [];
    for (const r of rows) {
      if (!r.personaKey || !r.accountId) continue; // unlinked/misconfigured → skip
      const persona = PERSONA_BY_KEY.get(r.personaKey);
      if (!persona) continue; // config for a persona we don't ship → skip
      active.push({
        persona,
        accountId: r.accountId,
        memberId: r.memberId,
        email: r.email,
        model: r.model,
        postProbability: Number(r.postProbability),
        commentProbability: Number(r.commentProbability),
        activeStartHour: r.activeStartHour,
        activeEndHour: r.activeEndHour,
        voiceNote: r.voiceNote,
      });
    }
    return active;
  }

  private isInHours(agent: ActiveAgent, now: Date): boolean {
    const hour = localHour(agent.persona.timezone, now);
    return withinHours(hour, agent.activeStartHour, agent.activeEndHour);
  }

  /** Is the LLM path available right now (budget not blown)? Files one report/day. */
  private async llmAllowed(now: Date): Promise<boolean> {
    const spent = await spentTodayUsd(this.deps.db);
    if (!budgetExhausted(spent, this.deps.dailyBudgetUsd)) return true;
    const today = utcDate(now);
    if (this.budgetReportDate !== today) {
      this.budgetReportDate = today;
      await reportAgentProblem(this.deps.db, {
        kind: "budget_exceeded",
        severity: "warning",
        message: `Agent daily spend ceiling reached ($${spent.toFixed(4)} >= $${this.deps.dailyBudgetUsd}); scripted-only for the rest of the UTC day.`,
        dedupeKey: `runner:${today}:budget`,
        context: { spent, budget: this.deps.dailyBudgetUsd },
      });
    }
    return false;
  }

  /**
   * AMBIENT TICK — each in-hours enabled agent may post and/or comment on
   * another agent's recent post, gated by caps + probabilities.
   */
  async ambientTick(): Promise<void> {
    if (!(await this.holdsAdvisoryLock())) return;
    const now = new Date();
    let agents: ActiveAgent[];
    try {
      agents = await this.loadActiveAgents();
    } catch (err) {
      logger.error({ err }, "agent-runner: loadActiveAgents (ambient) failed");
      return;
    }
    if (agents.length === 0) return;

    const llmOk = await this.llmAllowed(now);

    // Recent agent-authored posts that ambient comments may attach to. Real
    // members' posts are excluded here on purpose (they go via responsive).
    let recentAgentPosts: Array<{ id: string; authorEmail: string }> = [];
    try {
      recentAgentPosts = await this.deps.db
        .select({
          id: universityCommunityPosts.id,
          authorEmail: universityCommunityPosts.authorEmail,
        })
        .from(universityCommunityPosts)
        .where(
          and(
            eq(universityCommunityPosts.status, "visible"),
            like(universityCommunityPosts.authorEmail, AGENT_EMAIL_LIKE),
          ),
        )
        .orderBy(desc(universityCommunityPosts.createdAt))
        .limit(FEED_POLL_LIMIT);
    } catch (err) {
      logger.error({ err }, "agent-runner: load recent agent posts failed");
    }

    for (const agent of agents) {
      if (!this.isInHours(agent, now)) continue;

      // --- ambient POST ---
      if (
        Math.random() < agent.postProbability &&
        (await canAmbientPost(this.state, agent.persona.key, now))
      ) {
        await this.doAmbientPost(agent, llmOk, now);
      }

      // --- ambient COMMENT on another agent's post ---
      if (
        Math.random() < agent.commentProbability &&
        (await canAmbientComment(this.state, now))
      ) {
        const target = sample(
          recentAgentPosts.filter((p) => p.authorEmail !== agent.email),
        );
        if (target) await this.doAmbientComment(agent, target.id, now);
      }
    }
  }

  private async doAmbientPost(agent: ActiveAgent, llmOk: boolean, now: Date): Promise<void> {
    // 90% scripted (zero LLM cost), 10% Claude variation — and only LLM if the
    // budget allows. Anti-repeat picks a line not used by this agent in 72h.
    const fresh: string[] = [];
    for (const l of agent.persona.postLines) {
      if (await canUseLine(this.state, agent.persona.key, l, now)) fresh.push(l);
    }
    const scriptedLine = sample(fresh.length > 0 ? fresh : agent.persona.postLines);
    if (!scriptedLine) return;

    let body = scriptedLine;
    let source: "llm" | "fallback" = "fallback";
    const wantLlm = llmOk && Math.random() < 0.1;

    if (wantLlm) {
      const system = this.systemPrompt(agent, "Write ONE short, on-voice community post.");
      const result = await callClaude(this.deps.apiKey, agent.model, system, scriptedLine);
      if (result) {
        const gate = contentSafe(result.text, false);
        if (gate.ok) {
          body = result.text;
          source = "llm";
        } else {
          await this.reportSafetyBlock(agent, gate.reason ?? "blocked", now);
        }
        await logAgentUsage(this.deps.db, {
          memberId: agent.memberId,
          personaKey: agent.persona.key,
          model: agent.model,
          purpose: "variation",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          source,
        });
      }
    }

    // The scripted line to record for 72h anti-repeat (null for an LLM post, so
    // no line is burned). The budget increment + line write happen ATOMICALLY
    // with the post insert inside createCommunityPost's transaction, under a
    // row lock — an authoritative re-check of the caps that a restart mid-tick
    // (or a stale in-memory count) can't slip past.
    const lineToRecord = source === "fallback" ? scriptedLine : null;
    try {
      await this.deps.community.createCommunityPost(
        agent.accountId,
        body,
        "statement",
        null,
        {
          onInsertTx: (tx: AgentRunnerTx) =>
            this.state.recordAmbientPostTx(tx, agent.persona.key, lineToRecord, now, {
              postsPerDay: CAPS.ambientPostsPerDay,
              consecutivePerAgent: CAPS.consecutivePostsPerAgent,
              lineAntiRepeatMs: CAPS.lineAntiRepeatMs,
            }),
        },
      );
      // The tx wrote the ledger; drop the write-through cache so the next read
      // re-hydrates the incremented counts from the DB.
      this.state.invalidateDaily(agent.persona.key, now);
    } catch (err) {
      // A cap/dedup hit under the lock rolls the post back — an EXPECTED skip
      // (the durable state did its job), not a write failure to report.
      if (err instanceof AmbientPostRejected) return;
      await this.reportActionError(agent, "ambient_post", err, now);
    }
  }

  private async doAmbientComment(agent: ActiveAgent, postId: string, now: Date): Promise<void> {
    const line = sample(agent.persona.postLines);
    if (!line) return;
    try {
      await this.deps.community.createCommunityComment(agent.accountId, postId, line);
      await this.state.recordAmbientComment(agent.persona.key, now);
    } catch (err) {
      await this.reportActionError(agent, "ambient_comment", err, now);
    }
  }

  /**
   * FEED POLLER — answer new real-member posts. Bot-challenge → silence+report.
   */
  async feedTick(): Promise<void> {
    if (!(await this.holdsAdvisoryLock())) return;
    const now = new Date();

    let agents: ActiveAgent[];
    try {
      agents = await this.loadActiveAgents();
    } catch (err) {
      logger.error({ err }, "agent-runner: loadActiveAgents (feed) failed");
      return;
    }

    let posts: Array<{
      id: string;
      authorEmail: string;
      body: string;
      createdAt: Date;
    }> = [];
    try {
      posts = await this.deps.db
        .select({
          id: universityCommunityPosts.id,
          authorEmail: universityCommunityPosts.authorEmail,
          body: universityCommunityPosts.body,
          createdAt: universityCommunityPosts.createdAt,
        })
        .from(universityCommunityPosts)
        .where(
          and(
            eq(universityCommunityPosts.status, "visible"),
            gt(universityCommunityPosts.createdAt, this.state.getWatermark()),
            not(like(universityCommunityPosts.authorEmail, AGENT_EMAIL_LIKE)),
          ),
        )
        .orderBy(universityCommunityPosts.createdAt) // oldest-first so we advance the watermark monotonically
        .limit(FEED_POLL_LIMIT);
    } catch (err) {
      logger.error({ err }, "agent-runner: feed poll query failed");
      return;
    }

    const llmOk = agents.length > 0 ? await this.llmAllowed(now) : false;

    for (const post of posts) {
      // Always advance the watermark past this post, even if we don't reply, so
      // a single un-answerable post never blocks the poller.
      this.state.setWatermark(post.createdAt);

      // Bot challenge → silence + one report/day/post. Never reply.
      if (isBotChallenge(post.body)) {
        await reportAgentProblem(this.deps.db, {
          kind: "bot_challenge",
          severity: "warning",
          message: "A member message reads as a bot challenge; agents stayed silent on this thread.",
          dedupeKey: `community:${utcDate(now)}:${post.id}`,
          context: { postId: post.id },
        });
        continue;
      }

      if (agents.length === 0) continue;
      if (responsiveHourlyExhausted(this.state, now)) continue;
      if (postRespondersExhausted(this.state, post.id)) continue;
      if (!canReplyToMember(this.state, post.authorEmail, now)) continue;

      const intent = classifyIntent(post.body);
      // Eligible responders: in-hours agents only (caps applied per-action below).
      const eligible = agents.filter((a) => this.isInHours(a, now)).map((a) => a.persona);
      const chosen = selectResponders(eligible, intent);

      for (const persona of chosen) {
        if (responsiveHourlyExhausted(this.state, now)) break;
        if (postRespondersExhausted(this.state, post.id)) break;
        if (!canReplyToMember(this.state, post.authorEmail, now)) break;
        const agent = agents.find((a) => a.persona.key === persona.key);
        if (!agent) continue;
        await this.doResponsiveReply(agent, post, llmOk, now);
      }
    }
  }

  private async doResponsiveReply(
    agent: ActiveAgent,
    post: { id: string; authorEmail: string; body: string },
    llmOk: boolean,
    now: Date,
  ): Promise<void> {
    const memberHadEmoji = hasEmoji(post.body);
    let body: string | null = null;
    let source: "llm" | "fallback" = "fallback";

    if (llmOk) {
      const voice = agent.voiceNote ? ` ${agent.voiceNote}` : "";
      const system = this.systemPrompt(
        agent,
        `Reply briefly and warmly to a fellow member's post. Be specific to what they said.${voice}`,
      );
      const result = await callClaude(this.deps.apiKey, agent.model, system, post.body);
      if (result) {
        const gate = contentSafe(result.text, memberHadEmoji);
        if (gate.ok) {
          body = result.text;
          source = "llm";
        } else {
          await this.reportSafetyBlock(agent, gate.reason ?? "blocked", now);
        }
        await logAgentUsage(this.deps.db, {
          memberId: agent.memberId,
          personaKey: agent.persona.key,
          model: agent.model,
          purpose: "responsive_help",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          source,
        });
      }
    }

    // No valid LLM reply (safety-gated, or budget-exhausted / LLM didn't run):
    // stay SILENT. A scripted persona line is a non-sequitur as a *reply* — it
    // answers a real member's specific post with an unrelated ambient line (e.g.
    // "where are you from?" -> "Day 30!! 🎉"), which reads worse than no reply.
    // Ambient standalone posts still use scripted lines (doAmbientPost); only
    // responsive replies require a genuine, on-topic LLM answer.
    if (!body) return;

    try {
      await this.deps.community.createCommunityComment(agent.accountId, post.id, body);
      this.state.recordResponsiveReply(post.authorEmail, post.id, now);
    } catch (err) {
      await this.reportActionError(agent, "responsive_reply", err, now);
    }
  }

  // --- prompt + report helpers --------------------------------------------

  private systemPrompt(agent: ActiveAgent, task: string): string {
    return [
      `You are ${agent.persona.name} (${agent.persona.handle}), a member of a small`,
      `self-help community (the Coherent Ones). Archetype: ${agent.persona.archetype}.`,
      `Your background: ${agent.persona.bio}`,
      task,
      "Rules: at most two short sentences; plain, human, lowercase-ok; no emoji unless the",
      "person you reply to used one; never give financial, medical, or legal advice; never",
      "mention being an AI, a bot, or a model.",
      "If asked something about yourself that your background above doesn't cover, stay vague and deflect naturally — never invent specific facts.",
      "Just write the message text, nothing else.",
    ].join(" ");
  }

  private async reportSafetyBlock(agent: ActiveAgent, reason: string, now: Date): Promise<void> {
    await reportAgentProblem(this.deps.db, {
      memberId: agent.memberId,
      personaKey: agent.persona.key,
      kind: "safety_block",
      severity: "warning",
      message: `Agent LLM output was safety-gated (${reason}); fell back to a scripted line.`,
      dedupeKey: `${agent.persona.key}:${utcDate(now)}:${reason}`,
      context: { reason },
    });
  }

  private async reportActionError(
    agent: ActiveAgent,
    action: string,
    err: unknown,
    now: Date,
  ): Promise<void> {
    logger.error({ err, persona: agent.persona.key, action }, "agent-runner: community write failed");
    await reportAgentProblem(this.deps.db, {
      memberId: agent.memberId,
      personaKey: agent.persona.key,
      kind: "error",
      severity: "error",
      message: `Agent community write failed (${action}).`,
      dedupeKey: `${agent.persona.key}:${utcDate(now)}:${action}`,
      context: { action },
    });
  }
}
