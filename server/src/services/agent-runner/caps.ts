// ---------------------------------------------------------------------------
// Coherent Ones University — agent runner volume + spend caps (hard limits).
//
// Pure predicate functions over AgentRunnerState (Rule 5: deterministic, code).
// The engine consults these before any post/comment/reply so the synthetic
// activity stays under the human-plausible ceilings the BUILD-SPEC Phase 3
// defines:
//   ambient    ≤ 22 posts/day global, ≤ 30 comments/day global,
//              ≤ 2 consecutive posts/agent/24h
//   responsive ≤ 3 replies/real-member/day, ≤ 2 agents/post, ≤ 5/hour global,
//              no 2nd reply to the same member within 4h
//   line       same scripted post_line not reused by an agent within 72h
//   spend      runner goes scripted-only once today's USD spend ≥ the budget
// ---------------------------------------------------------------------------

import type { AgentRunnerState } from "./state.js";

// Hard caps (BUILD-SPEC Phase 3). Centralized so they are auditable in one place.
export const CAPS = {
  ambientPostsPerDay: 22,
  ambientCommentsPerDay: 30,
  consecutivePostsPerAgent: 2,
  responsivePerMemberPerDay: 3,
  respondersPerPost: 2,
  responsivePerHour: 5,
  memberReplyCooldownMs: 4 * 60 * 60 * 1000, // 4h
  lineAntiRepeatMs: 72 * 60 * 60 * 1000, // 72h
} as const;

/** May any agent make another ambient POST right now (global + per-agent)? */
export function canAmbientPost(
  state: AgentRunnerState,
  personaKey: string,
  now = new Date(),
): boolean {
  if (state.globalAmbientPostCount(now) >= CAPS.ambientPostsPerDay) return false;
  if (state.agentConsecutivePosts(personaKey, now) >= CAPS.consecutivePostsPerAgent) {
    return false;
  }
  return true;
}

/** May any agent make another ambient COMMENT right now (global only)? */
export function canAmbientComment(
  state: AgentRunnerState,
  now = new Date(),
): boolean {
  return state.globalAmbientCommentCount(now) < CAPS.ambientCommentsPerDay;
}

/** Is the scripted post_line cool enough to reuse for this agent (72h)? */
export function canUseLine(
  state: AgentRunnerState,
  personaKey: string,
  line: string,
  now = new Date(),
): boolean {
  return state.msSinceLineUsed(personaKey, line, now) >= CAPS.lineAntiRepeatMs;
}

/** Global hourly responsive ceiling reached? */
export function responsiveHourlyExhausted(
  state: AgentRunnerState,
  now = new Date(),
): boolean {
  return state.globalResponsiveCount(now) >= CAPS.responsivePerHour;
}

/** Has this post already drawn the max number of agent responders? */
export function postRespondersExhausted(
  state: AgentRunnerState,
  postId: string,
): boolean {
  return state.postResponderCount(postId) >= CAPS.respondersPerPost;
}

/**
 * May an agent reply to THIS real member right now? Enforces the per-member
 * daily cap and the 4h per-member cooldown. (Per-post + hourly caps are checked
 * separately by the engine because they are not member-scoped.)
 */
export function canReplyToMember(
  state: AgentRunnerState,
  memberEmail: string,
  now = new Date(),
): boolean {
  if (state.memberRepliesToday(memberEmail, now) >= CAPS.responsivePerMemberPerDay) {
    return false;
  }
  if (state.msSinceLastReplyToMember(memberEmail, now) < CAPS.memberReplyCooldownMs) {
    return false;
  }
  return true;
}

/**
 * Is today's agent spend at/over the daily budget? When true the engine must
 * go scripted-only (no LLM calls) and file one budget_exceeded report/day.
 * `spentToday` is the FIXED reporting.spentTodayUsd(db) value (today's UTC sum,
 * not the all-time ledger). A non-positive/NaN budget disables the LLM path
 * entirely (treated as "exhausted") — fail safe toward cheaper, not pricier.
 */
export function budgetExhausted(spentToday: number, dailyBudgetUsd: number): boolean {
  if (!Number.isFinite(dailyBudgetUsd) || dailyBudgetUsd <= 0) return true;
  return spentToday >= dailyBudgetUsd;
}
