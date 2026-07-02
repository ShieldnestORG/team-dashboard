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

import { and, asc, desc, eq, gt, isNull, like, not } from "drizzle-orm";
import {
  universityMembers,
  universityAgentConfig,
  universityCommunityPosts,
  universityCommunityComments,
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
  getCommentWatermark,
  hasCommentWatermark,
  setCommentWatermark,
} from "./comment-watermark.js";
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

// A compact, in-order thread snapshot for the comment-reply prompt: the root
// post plus its visible comments (chronological). Used only to build context;
// nothing member-specific is persisted.
interface ThreadContext {
  postId: string;
  postAuthorEmail: string;
  postBody: string;
  comments: Array<{ id: string; authorEmail: string; body: string; createdAt: Date }>;
}

const AGENT_EMAIL_LIKE = "agent+%@coherencedaddy.com";
// A stable 64-bit-ish constant for the single-runner advisory lock. Arbitrary
// but fixed so every replica contends for the same lock.
const ADVISORY_LOCK_KEY = 770_513_021;
const FEED_POLL_LIMIT = 25;
// Compact thread transcript sent to Claude: cap the prior comments we render so
// the context stays small (and the prompt cheap). Newest N in the thread.
const THREAD_CONTEXT_LIMIT = 12;
// Self-memory only: the responding agent's OWN recent posts, for voice
// consistency. We store NOTHING about the member (Tier 4 is hard-gated).
const SELF_MEMORY_LIMIT = 3;

const PERSONA_BY_KEY = new Map(AGENT_PERSONAS.map((p) => [p.key, p]));

/** Durable-key test for an agent-authored row (matches AGENT_EMAIL_LIKE). */
function isAgentAuthor(email: string): boolean {
  return email.toLowerCase().startsWith("agent+");
}

function sameEmail(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

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
   * SEED the COMMENT poller cursor at boot, but only when no durable cursor
   * exists yet. The cursor is now DURABLE (Tier 2's university_agent_watermark,
   * kind='comment') so on any normal restart we RESUME from the persisted value —
   * comments that arrived while the runner was down are still answered, not
   * skipped. On a first-ever boot (no durable row) we seed from the newest
   * existing comment so we never flood-reply the entire historical backlog. On
   * any failure we seed "now" (same fail-safe).
   */
  async initCommentWatermark(): Promise<void> {
    try {
      // Durable cursor already present: a prior run advanced it — resume, don't
      // reset (resetting to "newest" would skip the downtime gap).
      if (await hasCommentWatermark(this.deps.db)) return;
      const rows = await this.deps.db
        .select({ createdAt: universityCommunityComments.createdAt })
        .from(universityCommunityComments)
        .orderBy(desc(universityCommunityComments.createdAt))
        .limit(1);
      await setCommentWatermark(this.deps.db, rows[0]?.createdAt ?? new Date());
    } catch (err) {
      logger.error({ err }, "agent-runner: initCommentWatermark failed; starting from now");
      await setCommentWatermark(this.deps.db, new Date());
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

  /**
   * COMMENT POLLER — answer new threaded REPLIES by real members. The feed
   * poller (feedTick) only sees top-level posts; a member's comment/reply on a
   * post is invisible to it. This tick polls university_community_comments past a
   * durable comment cursor (comment-watermark.ts seam) oldest-first, builds a
   * thread-context prompt, and generates an in-character reply — preferring an
   * agent already present in the thread. All the same responsive caps apply.
   */
  async commentTick(): Promise<void> {
    if (!(await this.holdsAdvisoryLock())) return;
    const now = new Date();

    let agents: ActiveAgent[];
    try {
      agents = await this.loadActiveAgents();
    } catch (err) {
      logger.error({ err }, "agent-runner: loadActiveAgents (comment) failed");
      return;
    }

    const watermark = await getCommentWatermark(this.deps.db);

    let comments: Array<{
      id: string;
      postId: string;
      authorEmail: string;
      body: string;
      createdAt: Date;
    }> = [];
    try {
      comments = await this.deps.db
        .select({
          id: universityCommunityComments.id,
          postId: universityCommunityComments.postId,
          authorEmail: universityCommunityComments.authorEmail,
          body: universityCommunityComments.body,
          createdAt: universityCommunityComments.createdAt,
        })
        .from(universityCommunityComments)
        .where(
          and(
            eq(universityCommunityComments.status, "visible"),
            gt(universityCommunityComments.createdAt, watermark),
            // Never poll agent-authored comments — no agent-to-agent loops.
            not(like(universityCommunityComments.authorEmail, AGENT_EMAIL_LIKE)),
          ),
        )
        .orderBy(asc(universityCommunityComments.createdAt)) // oldest-first: advance the cursor monotonically
        .limit(FEED_POLL_LIMIT);
    } catch (err) {
      logger.error({ err }, "agent-runner: comment poll query failed");
      return;
    }

    const llmOk = agents.length > 0 ? await this.llmAllowed(now) : false;

    for (const comment of comments) {
      // Agent-authored + bot-challenge comments are fully ADJUDICATED without an
      // LLM reply — handle them and advance the durable cursor past them.
      // (Defense-in-depth: the query already excludes agent+ authors.)
      if (isAgentAuthor(comment.authorEmail)) {
        await setCommentWatermark(this.deps.db, comment.createdAt);
        continue;
      }
      // A bot challenge inside a thread → silence + one report/day/comment.
      if (isBotChallenge(comment.body)) {
        await reportAgentProblem(this.deps.db, {
          kind: "bot_challenge",
          severity: "warning",
          message: "A member comment reads as a bot challenge; agents stayed silent on this thread.",
          dedupeKey: `community-comment:${utcDate(now)}:${comment.id}`,
          context: { commentId: comment.id, postId: comment.postId },
        });
        await setCommentWatermark(this.deps.db, comment.createdAt);
        continue;
      }

      // Beyond here a reply may be warranted. If a TRANSIENT GLOBAL condition
      // blocks every reply this tick — all agents paused, LLM/daily-budget
      // unavailable, or the global hourly ceiling hit — STOP WITHOUT advancing
      // so the backlog is retried once capacity recovers. The comment cursor is
      // durable, so advancing past an un-repliable comment would drop it
      // permanently (unlike the volatile feed poller). Comments are oldest-first,
      // so breaking here preserves order and loses nothing.
      if (agents.length === 0) break;
      if (!llmOk) break;
      if (responsiveHourlyExhausted(this.state, now)) break;

      // Per-post (≤2 responders) and per-member (daily + 4h cooldown) declines
      // are durable decisions for THIS comment — advance past it, we will not
      // reply to it on a later tick either. Comment-replies COUNT toward the
      // SAME responsive caps as post-replies.
      await setCommentWatermark(this.deps.db, comment.createdAt);
      if (postRespondersExhausted(this.state, comment.postId)) continue;
      if (!canReplyToMember(this.state, comment.authorEmail, now)) continue;

      let thread: ThreadContext | null;
      try {
        thread = await this.loadThread(comment.postId);
      } catch (err) {
        logger.error({ err, postId: comment.postId }, "agent-runner: loadThread failed");
        continue;
      }
      if (!thread) continue;

      const responder = this.pickThreadResponder(agents, thread, comment, now);
      if (!responder) continue;

      await this.doThreadReply(responder, thread, comment, llmOk, now);
    }
  }

  /** Load the root post + its visible comments (chronological) for the prompt. */
  private async loadThread(postId: string): Promise<ThreadContext | null> {
    const [post] = await this.deps.db
      .select({
        id: universityCommunityPosts.id,
        authorEmail: universityCommunityPosts.authorEmail,
        body: universityCommunityPosts.body,
      })
      .from(universityCommunityPosts)
      .where(
        and(
          eq(universityCommunityPosts.id, postId),
          eq(universityCommunityPosts.status, "visible"),
        ),
      )
      .limit(1);
    if (!post) return null;

    // Newest THREAD_CONTEXT_LIMIT comments (so the target is always in-window on
    // long threads), then reversed to chronological order for the transcript.
    const rows = await this.deps.db
      .select({
        id: universityCommunityComments.id,
        authorEmail: universityCommunityComments.authorEmail,
        body: universityCommunityComments.body,
        createdAt: universityCommunityComments.createdAt,
      })
      .from(universityCommunityComments)
      .where(
        and(
          eq(universityCommunityComments.postId, postId),
          eq(universityCommunityComments.status, "visible"),
        ),
      )
      .orderBy(desc(universityCommunityComments.createdAt))
      .limit(THREAD_CONTEXT_LIMIT);

    return {
      postId: post.id,
      postAuthorEmail: post.authorEmail,
      postBody: post.body,
      comments: rows.reverse(),
    };
  }

  /**
   * Choose the agent to answer a threaded comment. GUARD: prefer an agent ALREADY
   * present in the thread (the post's author, or an agent that replied earlier)
   * so one voice carries the conversation; otherwise fall back to the intent-based
   * selectResponders/Wendell logic. Returns null when no eligible agent exists.
   */
  private pickThreadResponder(
    agents: ActiveAgent[],
    thread: ThreadContext,
    comment: { body: string },
    now: Date,
  ): ActiveAgent | null {
    const eligible = agents.filter((a) => this.isInHours(a, now));
    if (eligible.length === 0) return null;

    const present = new Set<string>();
    if (isAgentAuthor(thread.postAuthorEmail)) {
      present.add(thread.postAuthorEmail.toLowerCase());
    }
    for (const c of thread.comments) {
      if (isAgentAuthor(c.authorEmail)) present.add(c.authorEmail.toLowerCase());
    }
    const inThread = eligible.filter((a) => present.has(a.email.toLowerCase()));
    if (inThread.length > 0) {
      // Prefer the post's own author if eligible; else any present agent.
      const author = inThread.find((a) => sameEmail(a.email, thread.postAuthorEmail));
      return author ?? inThread[0]!;
    }

    // No agent in-thread yet: pick one intent-appropriate responder.
    const intent = classifyIntent(comment.body);
    const [persona] = selectResponders(eligible.map((a) => a.persona), intent, 1);
    if (!persona) return null;
    return eligible.find((a) => a.persona.key === persona.key) ?? null;
  }

  private async doThreadReply(
    agent: ActiveAgent,
    thread: ThreadContext,
    comment: { id: string; authorEmail: string; body: string },
    llmOk: boolean,
    now: Date,
  ): Promise<void> {
    // No LLM (budget blown / disabled): stay SILENT. A scripted persona line is a
    // non-sequitur as a threaded reply (same reasoning as doResponsiveReply).
    if (!llmOk) return;

    const memberHadEmoji = hasEmoji(comment.body);

    // Self-memory ONLY: the agent's own recent posts, for voice consistency. We
    // read/store NOTHING about the member (Tier 4 member-fact memory is gated).
    let selfPosts: string[] = [];
    try {
      const rows = await this.deps.db
        .select({ body: universityCommunityPosts.body })
        .from(universityCommunityPosts)
        .where(
          and(
            eq(universityCommunityPosts.status, "visible"),
            eq(universityCommunityPosts.authorEmail, agent.email),
          ),
        )
        .orderBy(desc(universityCommunityPosts.createdAt))
        .limit(SELF_MEMORY_LIMIT);
      selfPosts = rows.map((r) => r.body);
    } catch (err) {
      logger.error(
        { err, persona: agent.persona.key },
        "agent-runner: self-memory load failed (continuing without it)",
      );
    }

    const voice = agent.voiceNote ? ` ${agent.voiceNote}` : "";
    const system = this.threadSystemPrompt(
      agent,
      `You are replying inside an ongoing thread. Answer the most recent comment briefly and warmly, specific to what they said and consistent with the conversation so far.${voice}`,
      selfPosts,
    );
    const userText = this.buildThreadUserText(agent, thread, comment);

    const result = await callClaude(this.deps.apiKey, agent.model, system, userText);
    let body: string | null = null;
    let source: "llm" | "fallback" = "fallback";
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

    if (!body) return;

    try {
      await this.deps.community.createCommunityComment(agent.accountId, thread.postId, body);
      // Counts toward the SAME responsive caps as a post-reply (per-post ≤2
      // responders, per-member/day, hourly). Keyed to the commenting member.
      this.state.recordResponsiveReply(comment.authorEmail, thread.postId, now);
    } catch (err) {
      await this.reportActionError(agent, "thread_reply", err, now);
    }
  }

  /** Compact chronological transcript + the message to answer (as user text). */
  private buildThreadUserText(
    agent: ActiveAgent,
    thread: ThreadContext,
    target: { id: string; body: string },
  ): string {
    const lines: string[] = ["Here is a community thread:"];
    lines.push(`Original post: ${thread.postBody}`);
    for (const c of thread.comments) {
      if (c.id === target.id) continue; // the message to answer is shown separately below
      const who = sameEmail(c.authorEmail, agent.email) ? "You earlier" : "A member";
      lines.push(`${who}: ${c.body}`);
    }
    lines.push("");
    lines.push(`Now reply to this most recent comment: "${target.body}"`);
    return lines.join("\n");
  }

  /** systemPrompt + the agent's own recent posts (self-memory) for consistency. */
  private threadSystemPrompt(
    agent: ActiveAgent,
    task: string,
    selfPosts: string[],
  ): string {
    const base = this.systemPrompt(agent, task);
    if (selfPosts.length === 0) return base;
    const memory = [
      "For voice consistency, here are a few of YOUR OWN recent posts (don't repeat them, just stay in character):",
      ...selfPosts.map((p) => `- ${p}`),
    ].join(" ");
    return `${base} ${memory}`;
  }

  // --- prompt + report helpers --------------------------------------------

  private systemPrompt(agent: ActiveAgent, task: string): string {
    return [
      `You are ${agent.persona.name} (${agent.persona.handle}), a member of a small`,
      `self-help community (the Coherent Ones). Archetype: ${agent.persona.archetype}.`,
      `Your background: ${agent.persona.bio}`,
      task,
      "Rules: two to four short sentences; plain, human, lowercase-ok; no emoji unless the",
      "person you reply to used one; never give financial, medical, or legal advice; never",
      "mention being an AI, a bot, or a model.",
      "If anyone asks to move the conversation off-platform (DM, email, phone, another app, meeting up, socials), warmly keep it in-app — say something like \"i feel comfortable keeping our chats in here.\"",
      "Voice: don't coach or hand out advice or aphorisms. Share a personal first-person experience and what actually helped you — raw, specific, lowercase, like someone who has been through it (\"this had me for years\", \"what finally worked for me was ...\").",
      "Inventing a small personal backstory detail to make it relatable is fine; keep it plausible and consistent with your background above, and never claim professional credentials.",
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
