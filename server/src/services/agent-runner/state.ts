// ---------------------------------------------------------------------------
// Coherent Ones University — agent runner run state (durable + volatile).
//
// This holds the counters/cooldowns the engine consults each tick. It is now a
// WRITE-THROUGH CACHE over Postgres for the AMBIENT posting ledger (the state
// whose in-memory reset on deploy/restart was the root cause of the duplicate-
// post bug): reads hydrate from DB on demand; writes persist immediately.
//
//   DURABLE (Postgres, survives restart):
//     - per-agent daily ambient post/comment counts + consecutive-post streak
//       (university_agent_daily_budget, one row per persona+UTC-day)
//     - global ambient post/comment counts (SUM over today's rows)
//     - the 72h post_line anti-repeat ledger (university_agent_line_usage)
//     - a general per-agent cursor store (university_agent_watermark), used by
//       the Tier 3 comment-poller for a durable 'comment' watermark
//
//   VOLATILE (in-memory, intentionally NOT persisted):
//     - the responsive feed watermark — already re-derived from
//       university_community_posts on boot (engine.initWatermark), so it needs
//       no table and MUST NOT be duplicated here
//     - responsive per-member reply counts/cooldowns, per-post responder count,
//       and the hourly responsive counter — all guarded by the DB-derived feed
//       watermark (a restart never re-sees an already-answered post), so their
//       reset is inert for the duplicate-post bug this task targets
//
// The ambient POST write is committed ATOMICALLY with the community post insert
// (recordAmbientPostTx, run inside createCommunityPost's transaction under a
// row lock) so a restart mid-tick can neither double-count nor re-post a line.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  universityAgentDailyBudget,
  universityAgentLineUsage,
  universityAgentWatermark,
  type Db,
} from "@paperclipai/db";

/** The drizzle transaction handle threaded from createCommunityPost. */
export type AgentRunnerTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Hard limits the atomic post-commit re-checks authoritatively under the row
 *  lock. Mirrors caps.ts CAPS; passed in so state has no dependency on caps. */
export interface AmbientPostLimits {
  postsPerDay: number;
  consecutivePerAgent: number;
  lineAntiRepeatMs: number;
}

/** Thrown by recordAmbientPostTx when a cap/dedup check fails under the lock,
 *  rolling back the post insert. The engine treats this as an expected skip
 *  (NOT a write error to report). */
export class AmbientPostRejected extends Error {
  constructor(readonly reason: "budget" | "consecutive" | "duplicate") {
    super(`ambient post rejected: ${reason}`);
    this.name = "AmbientPostRejected";
  }
}

function utcDayKey(at: Date): string {
  return at.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function utcHourKey(at: Date): string {
  return at.toISOString().slice(0, 13); // YYYY-MM-DDTHH (UTC)
}

function lineHash(line: string): string {
  return createHash("sha256").update(line).digest("hex");
}

interface MemberReplyState {
  count: number; // replies to this member today
  lastReplyAt: number; // epoch ms of the most recent agent reply to this member
}

// A cached per-(persona, day) daily row (the durable posting ledger).
interface DailyRow {
  postsCount: number;
  commentsCount: number;
  consecutivePosts: number;
}

export class AgentRunnerState {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  // --- Volatile (in-memory) responsive state -------------------------------

  // The responsive feed watermark: only posts strictly newer than this are
  // candidates. Re-derived from the DB at startup (see engine bootstrap).
  private watermark: Date = new Date(0);

  private dayBucket: string = utcDayKey(new Date());
  private hourBucket: string = utcHourKey(new Date());

  // Global responsive counter (per UTC hour).
  private globalResponsiveThisHour = 0;

  // Per-real-member reply state (keyed by lowercased member email), per day.
  private memberReplies = new Map<string, MemberReplyState>();

  // Per-post responder count (how many agents have replied to a given post).
  private postResponders = new Map<string, number>();

  // Write-through cache of the durable daily rows, keyed `${personaKey}::${day}`.
  private dailyCache = new Map<string, DailyRow>();

  /**
   * Roll the day/hour buckets if the wall clock has crossed a boundary. Clears
   * the in-memory responsive state on a new UTC day / hour. The DURABLE ambient
   * ledger is bucketed by its own `day` column and needs no clearing — but we
   * drop the daily CACHE on a day change so stale prior-day rows never leak.
   */
  private rollBuckets(now: Date): void {
    const day = utcDayKey(now);
    if (day !== this.dayBucket) {
      this.dayBucket = day;
      this.memberReplies.clear();
      this.postResponders.clear();
      this.dailyCache.clear();
    }
    const hour = utcHourKey(now);
    if (hour !== this.hourBucket) {
      this.hourBucket = hour;
      this.globalResponsiveThisHour = 0;
    }
  }

  // --- Watermark (volatile) ------------------------------------------------

  getWatermark(): Date {
    return this.watermark;
  }

  setWatermark(at: Date): void {
    if (at.getTime() > this.watermark.getTime()) this.watermark = at;
  }

  // --- Durable daily ledger (write-through cache) --------------------------

  /** Hydrate (and cache) the durable daily row for a persona, or a zero row. */
  private async loadDaily(personaKey: string, now: Date): Promise<DailyRow> {
    this.rollBuckets(now);
    const day = utcDayKey(now);
    const key = `${personaKey}::${day}`;
    const cached = this.dailyCache.get(key);
    if (cached) return cached;
    const rows = await this.db
      .select({
        postsCount: universityAgentDailyBudget.postsCount,
        commentsCount: universityAgentDailyBudget.commentsCount,
        consecutivePosts: universityAgentDailyBudget.consecutivePosts,
      })
      .from(universityAgentDailyBudget)
      .where(
        and(
          eq(universityAgentDailyBudget.agentPersonaKey, personaKey),
          eq(universityAgentDailyBudget.day, day),
        ),
      )
      .limit(1);
    const row: DailyRow = rows[0]
      ? {
          postsCount: rows[0].postsCount,
          commentsCount: rows[0].commentsCount,
          consecutivePosts: rows[0].consecutivePosts,
        }
      : { postsCount: 0, commentsCount: 0, consecutivePosts: 0 };
    this.dailyCache.set(key, row);
    return row;
  }

  /** Drop the cached daily row so the next read re-hydrates from DB. Called
   *  after a transactional post commit (which wrote via the tx, not the cache). */
  invalidateDaily(personaKey: string, now = new Date()): void {
    this.dailyCache.delete(`${personaKey}::${utcDayKey(now)}`);
  }

  // --- Global ambient (durable, summed over today) -------------------------

  private async globalSumToday(
    column:
      | typeof universityAgentDailyBudget.postsCount
      | typeof universityAgentDailyBudget.commentsCount,
    now: Date,
  ): Promise<number> {
    this.rollBuckets(now);
    const rows = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${column}), 0)::int` })
      .from(universityAgentDailyBudget)
      .where(eq(universityAgentDailyBudget.day, utcDayKey(now)));
    return rows[0]?.total ?? 0;
  }

  async globalAmbientPostCount(now = new Date()): Promise<number> {
    return this.globalSumToday(universityAgentDailyBudget.postsCount, now);
  }

  async globalAmbientCommentCount(now = new Date()): Promise<number> {
    return this.globalSumToday(universityAgentDailyBudget.commentsCount, now);
  }

  /** THIS persona's own ambient-comment count today (durable). Backs the
   *  per-agent daily comment cap so one chatty persona can't monopolize the
   *  global comment budget (the pre-2026-07-15 Felix failure mode). */
  async agentAmbientCommentCount(
    personaKey: string,
    now = new Date(),
  ): Promise<number> {
    return (await this.loadDaily(personaKey, now)).commentsCount;
  }

  // --- Global responsive (volatile) ----------------------------------------

  globalResponsiveCount(now = new Date()): number {
    this.rollBuckets(now);
    return this.globalResponsiveThisHour;
  }

  // --- Per-agent ambient (durable) -----------------------------------------

  async agentPostsToday(personaKey: string, now = new Date()): Promise<number> {
    return (await this.loadDaily(personaKey, now)).postsCount;
  }

  async agentConsecutivePosts(
    personaKey: string,
    now = new Date(),
  ): Promise<number> {
    return (await this.loadDaily(personaKey, now)).consecutivePosts;
  }

  /**
   * Commit an ambient POST's ledger writes ATOMICALLY, inside the same
   * transaction as the community post insert (createCommunityPost's tx). Runs
   * under a row lock (FOR UPDATE) on the per-(persona, day) budget row so a
   * restart mid-tick can neither double-count nor bypass a cap.
   *
   * Re-checks the daily post cap, the consecutive-post cap, and (for scripted
   * posts) the 72h line anti-repeat AUTHORITATIVELY under the lock; on failure
   * it throws AmbientPostRejected, which rolls the whole transaction back (no
   * post row, no ledger write). `line` is the scripted line to record for anti-
   * repeat, or null for an LLM-varied post (no line recorded).
   *
   * The caller MUST invalidateDaily(personaKey) after the outer transaction
   * commits so the write-through cache re-hydrates.
   */
  async recordAmbientPostTx(
    tx: AgentRunnerTx,
    personaKey: string,
    line: string | null,
    now: Date,
    limits: AmbientPostLimits,
  ): Promise<void> {
    const day = utcDayKey(now);

    // Ensure the row exists so the subsequent FOR UPDATE actually locks it.
    await tx
      .insert(universityAgentDailyBudget)
      .values({ agentPersonaKey: personaKey, day })
      .onConflictDoNothing();

    const [locked] = await tx
      .select({
        postsCount: universityAgentDailyBudget.postsCount,
        consecutivePosts: universityAgentDailyBudget.consecutivePosts,
      })
      .from(universityAgentDailyBudget)
      .where(
        and(
          eq(universityAgentDailyBudget.agentPersonaKey, personaKey),
          eq(universityAgentDailyBudget.day, day),
        ),
      )
      .for("update");

    const postsCount = locked?.postsCount ?? 0;
    const consecutivePosts = locked?.consecutivePosts ?? 0;

    if (postsCount >= limits.postsPerDay) {
      throw new AmbientPostRejected("budget");
    }
    if (consecutivePosts >= limits.consecutivePerAgent) {
      throw new AmbientPostRejected("consecutive");
    }

    if (line !== null) {
      const since = new Date(now.getTime() - limits.lineAntiRepeatMs);
      const [dup] = await tx
        .select({ id: universityAgentLineUsage.id })
        .from(universityAgentLineUsage)
        .where(
          and(
            eq(universityAgentLineUsage.agentPersonaKey, personaKey),
            eq(universityAgentLineUsage.lineHash, lineHash(line)),
            gte(universityAgentLineUsage.usedAt, since),
          ),
        )
        .limit(1);
      if (dup) throw new AmbientPostRejected("duplicate");
    }

    await tx
      .update(universityAgentDailyBudget)
      .set({
        postsCount: sql`${universityAgentDailyBudget.postsCount} + 1`,
        consecutivePosts: sql`${universityAgentDailyBudget.consecutivePosts} + 1`,
        lastPostAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(universityAgentDailyBudget.agentPersonaKey, personaKey),
          eq(universityAgentDailyBudget.day, day),
        ),
      );

    if (line !== null) {
      await tx.insert(universityAgentLineUsage).values({
        agentPersonaKey: personaKey,
        lineHash: lineHash(line),
        lineText: line,
        usedAt: now,
      });
    }
  }

  /**
   * Record an ambient COMMENT (durable). Bumps the daily comment count and, per
   * the old in-memory semantics, resets the consecutive-post streak to 0 (an
   * interleaved comment breaks the run). Not part of the post transaction — a
   * duplicate comment is not the bug this task targets — but still durable.
   */
  async recordAmbientComment(
    personaKey: string,
    now = new Date(),
  ): Promise<void> {
    const day = utcDayKey(now);
    await this.db
      .insert(universityAgentDailyBudget)
      .values({
        agentPersonaKey: personaKey,
        day,
        commentsCount: 1,
        consecutivePosts: 0,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          universityAgentDailyBudget.agentPersonaKey,
          universityAgentDailyBudget.day,
        ],
        set: {
          commentsCount: sql`${universityAgentDailyBudget.commentsCount} + 1`,
          consecutivePosts: 0,
          updatedAt: now,
        },
      });
    this.invalidateDaily(personaKey, now);
  }

  // --- Responsive (per real member + per post) — volatile ------------------

  memberRepliesToday(memberEmail: string, now = new Date()): number {
    this.rollBuckets(now);
    return this.memberReplies.get(memberEmail.toLowerCase())?.count ?? 0;
  }

  msSinceLastReplyToMember(memberEmail: string, now = new Date()): number {
    this.rollBuckets(now);
    const s = this.memberReplies.get(memberEmail.toLowerCase());
    if (!s || s.lastReplyAt === 0) return Number.POSITIVE_INFINITY;
    return now.getTime() - s.lastReplyAt;
  }

  postResponderCount(postId: string): number {
    return this.postResponders.get(postId) ?? 0;
  }

  recordResponsiveReply(
    memberEmail: string,
    postId: string,
    now = new Date(),
  ): void {
    const key = memberEmail.toLowerCase();
    const s = this.memberReplies.get(key) ?? { count: 0, lastReplyAt: 0 };
    s.count += 1;
    s.lastReplyAt = now.getTime();
    this.memberReplies.set(key, s);
    this.postResponders.set(postId, (this.postResponders.get(postId) ?? 0) + 1);
    this.globalResponsiveThisHour += 1;
  }

  // --- Post-line anti-repeat (72h) — durable -------------------------------

  async msSinceLineUsed(
    personaKey: string,
    line: string,
    now = new Date(),
  ): Promise<number> {
    const rows = await this.db
      .select({ usedAt: universityAgentLineUsage.usedAt })
      .from(universityAgentLineUsage)
      .where(
        and(
          eq(universityAgentLineUsage.agentPersonaKey, personaKey),
          eq(universityAgentLineUsage.lineHash, lineHash(line)),
        ),
      )
      .orderBy(desc(universityAgentLineUsage.usedAt))
      .limit(1);
    const at = rows[0]?.usedAt;
    if (!at) return Number.POSITIVE_INFINITY;
    return now.getTime() - at.getTime();
  }

  /** Record a scripted line use durably (standalone, non-transactional). The
   *  ambient post path records the line inside recordAmbientPostTx instead; this
   *  is retained for symmetry and direct callers/tests. */
  async recordLineUsed(
    personaKey: string,
    line: string,
    now = new Date(),
  ): Promise<void> {
    await this.db.insert(universityAgentLineUsage).values({
      agentPersonaKey: personaKey,
      lineHash: lineHash(line),
      lineText: line,
      usedAt: now,
    });
  }

  // --- General per-agent cursor store (durable) ----------------------------
  // Backs university_agent_watermark. Used by the Tier 3 comment-poller for a
  // durable 'comment' cursor; also usable for an 'ambient' cursor. Kept general
  // (kind-keyed) on purpose. NOT used to duplicate the responsive feed
  // watermark (that stays DB-derived on boot).

  async getCursor(
    personaKey: string,
    kind: string,
  ): Promise<{ lastSeenAt: Date | null; lastId: string | null } | null> {
    const [row] = await this.db
      .select({
        lastSeenAt: universityAgentWatermark.lastSeenAt,
        lastId: universityAgentWatermark.lastId,
      })
      .from(universityAgentWatermark)
      .where(
        and(
          eq(universityAgentWatermark.agentPersonaKey, personaKey),
          eq(universityAgentWatermark.kind, kind),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async setCursor(
    personaKey: string,
    kind: string,
    cursor: { lastSeenAt?: Date | null; lastId?: string | null },
    now = new Date(),
  ): Promise<void> {
    await this.db
      .insert(universityAgentWatermark)
      .values({
        agentPersonaKey: personaKey,
        kind,
        lastSeenAt: cursor.lastSeenAt ?? null,
        lastId: cursor.lastId ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          universityAgentWatermark.agentPersonaKey,
          universityAgentWatermark.kind,
        ],
        set: {
          lastSeenAt: cursor.lastSeenAt ?? null,
          lastId: cursor.lastId ?? null,
          updatedAt: now,
        },
      });
  }
}
