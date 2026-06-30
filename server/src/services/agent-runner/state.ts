// ---------------------------------------------------------------------------
// Coherent Ones University — agent runner in-memory run state.
//
// Holds the volatile counters/cooldowns the engine consults each tick:
//   - feed watermark (last-seen post createdAt) for the responsive poller
//   - per-real-member reply counts + last-reply time (responsive caps)
//   - per-post responder count (≤2 agents/post)
//   - per-agent post-line last-used time (72h anti-repeat)
//   - per-agent ambient post/comment counts + last consecutive-post tracking
//   - global ambient post/comment counts + responsive hourly counter
//
// DESIGN NOTE / DEVIATION (documented): the BUILD-SPEC Phase 3 envisioned
// DB-backed state (an `agent_runner_state` table). This task's STEP 5 instead
// specifies "state.ts (in-memory per-agent run state)" and "re-derive the feed
// watermark on restart from university_community_posts". We follow the task's
// in-memory design — it needs no new migration (none was in scope; 0136/0137
// are the only agent migrations) and the watermark is rebuilt from the posts
// table at startup so a restart never re-replies to already-seen posts. The
// tradeoff vs the spec's DB state: daily/cooldown counters reset on a process
// restart (the runner ships OFF by default, so this is inert until enabled,
// and the watermark — the one counter whose reset is actually uncanny — IS
// rebuilt from the DB). If durable counters are later required, promote these
// maps to a DB table behind a new migration.
//
// Counters are bucketed by UTC calendar day / clock hour and lazily rolled
// over, so "today" and "this hour" stay correct without a sweeper.
// ---------------------------------------------------------------------------

function utcDayKey(at: Date): string {
  return at.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function utcHourKey(at: Date): string {
  return at.toISOString().slice(0, 13); // YYYY-MM-DDTHH (UTC)
}

interface MemberReplyState {
  count: number; // replies to this member today
  lastReplyAt: number; // epoch ms of the most recent agent reply to this member
}

interface AgentDailyState {
  posts: number; // ambient posts today
  comments: number; // ambient comments today
  consecutivePosts: number; // consecutive ambient posts in the last 24h window
  lastPostAt: number; // epoch ms of this agent's last ambient post
}

export class AgentRunnerState {
  // The responsive feed watermark: only posts strictly newer than this are
  // candidates. Re-derived from the DB at startup (see engine bootstrap).
  private watermark: Date = new Date(0);

  private dayBucket: string = utcDayKey(new Date());
  private hourBucket: string = utcHourKey(new Date());

  // Global ambient counters (per UTC day).
  private globalAmbientPosts = 0;
  private globalAmbientComments = 0;

  // Global responsive counter (per UTC hour).
  private globalResponsiveThisHour = 0;

  // Per-real-member reply state (keyed by lowercased member email), per day.
  private memberReplies = new Map<string, MemberReplyState>();

  // Per-post responder count (how many agents have replied to a given post).
  private postResponders = new Map<string, number>();

  // Per-agent daily ambient state (keyed by persona key).
  private agentDaily = new Map<string, AgentDailyState>();

  // Per-agent post-line last-used (key `${personaKey}::${line}` -> epoch ms).
  private lineLastUsed = new Map<string, number>();

  /** Roll the day/hour buckets if the wall clock has crossed a boundary. */
  private rollBuckets(now: Date): void {
    const day = utcDayKey(now);
    if (day !== this.dayBucket) {
      this.dayBucket = day;
      this.globalAmbientPosts = 0;
      this.globalAmbientComments = 0;
      this.memberReplies.clear();
      this.agentDaily.clear();
      this.postResponders.clear();
    }
    const hour = utcHourKey(now);
    if (hour !== this.hourBucket) {
      this.hourBucket = hour;
      this.globalResponsiveThisHour = 0;
    }
  }

  // --- Watermark -----------------------------------------------------------

  getWatermark(): Date {
    return this.watermark;
  }

  setWatermark(at: Date): void {
    if (at.getTime() > this.watermark.getTime()) this.watermark = at;
  }

  // --- Global ambient ------------------------------------------------------

  globalAmbientPostCount(now = new Date()): number {
    this.rollBuckets(now);
    return this.globalAmbientPosts;
  }

  globalAmbientCommentCount(now = new Date()): number {
    this.rollBuckets(now);
    return this.globalAmbientComments;
  }

  // --- Global responsive ---------------------------------------------------

  globalResponsiveCount(now = new Date()): number {
    this.rollBuckets(now);
    return this.globalResponsiveThisHour;
  }

  // --- Per-agent ambient ---------------------------------------------------

  private agent(personaKey: string, now: Date): AgentDailyState {
    this.rollBuckets(now);
    let s = this.agentDaily.get(personaKey);
    if (!s) {
      s = { posts: 0, comments: 0, consecutivePosts: 0, lastPostAt: 0 };
      this.agentDaily.set(personaKey, s);
    }
    return s;
  }

  agentPostsToday(personaKey: string, now = new Date()): number {
    return this.agent(personaKey, now).posts;
  }

  agentConsecutivePosts(personaKey: string, now = new Date()): number {
    return this.agent(personaKey, now).consecutivePosts;
  }

  recordAmbientPost(personaKey: string, now = new Date()): void {
    const s = this.agent(personaKey, now);
    s.posts += 1;
    s.consecutivePosts += 1;
    s.lastPostAt = now.getTime();
    this.globalAmbientPosts += 1;
  }

  recordAmbientComment(personaKey: string, now = new Date()): void {
    const s = this.agent(personaKey, now);
    s.comments += 1;
    // A comment breaks the consecutive-post run (an interleaved action).
    s.consecutivePosts = 0;
    this.globalAmbientComments += 1;
  }

  // --- Responsive (per real member + per post) -----------------------------

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

  // --- Post-line anti-repeat (72h) ----------------------------------------

  msSinceLineUsed(personaKey: string, line: string, now = new Date()): number {
    const at = this.lineLastUsed.get(`${personaKey}::${line}`);
    if (at === undefined) return Number.POSITIVE_INFINITY;
    return now.getTime() - at;
  }

  recordLineUsed(personaKey: string, line: string, now = new Date()): void {
    this.lineLastUsed.set(`${personaKey}::${line}`, now.getTime());
  }
}
