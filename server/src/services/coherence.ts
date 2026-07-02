// ---------------------------------------------------------------------------
// Coherent Ones University — COHERENCE self-check service.
//
// Backs the /api/portal/university/coherence[-check] routes (routes stay
// validation + shape only), mirroring voice-budget.ts / university-sessions.ts:
// same `export function coherenceService(db) { ... }` factory shape, operating
// on `db` directly.
//
// A member self-rates three axes (body / focus / direction, each 0..100). The
// score is a FIXED weighting the frontend mirrors EXACTLY:
//   score = round(body*0.4 + focus*0.35 + direction*0.25)
// The score is computed here and stored, so history + trailing averages never
// recompute (and stay stable even if the weighting ever changed).
//
// Member identity is the SAME as the voice budget: rows key on the
// university_members id resolved by resolveVoiceMemberId (services/
// voice-budget.ts), so a member's coherence rows tie to the same member entity
// as their voice meter. The route resolves the memberId and passes it in.
// ---------------------------------------------------------------------------

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { universityCoherenceChecks } from "@paperclipai/db";

// Newest-first recentChecks cap + trailing-average window.
const RECENT_LIMIT = 7;
const TRAILING_DAYS = 7;

// FIXED coherence weighting — MUST match the frontend byte-for-byte. Pure and
// deterministic (Rule 5), so it is unit-tested directly without a DB.
export function coherenceScore(
  body: number,
  focus: number,
  direction: number,
): number {
  return Math.round(body * 0.4 + focus * 0.35 + direction * 0.25);
}

export interface CoherenceCheckInput {
  body: number;
  focus: number;
  direction: number;
}

export interface CoherenceSummary {
  // Most-recent score (0..100), or null if the member has no checks.
  current: number | null;
  // Mean score over the trailing 7 days (0..100, rounded), or null if none.
  average7: number | null;
  // Every check, chronological ASC (oldest first).
  history: { score: number; at: string }[];
  // Newest first, up to 7.
  recentChecks: {
    body: number;
    focus: number;
    direction: number;
    score: number;
    at: string;
  }[];
}

export function coherenceService(db: Db) {
  async function getCoherenceSummary(
    memberId: string,
  ): Promise<CoherenceSummary> {
    // All of the member's checks, oldest first (history is chronological ASC).
    const rows = await db
      .select({
        body: universityCoherenceChecks.body,
        focus: universityCoherenceChecks.focus,
        direction: universityCoherenceChecks.direction,
        score: universityCoherenceChecks.score,
        createdAt: universityCoherenceChecks.createdAt,
      })
      .from(universityCoherenceChecks)
      .where(eq(universityCoherenceChecks.memberId, memberId))
      .orderBy(universityCoherenceChecks.createdAt);

    const history = rows.map((r) => ({
      score: r.score,
      at: r.createdAt.toISOString(),
    }));

    // current = most-recent score (rows are ASC → last element).
    const current = rows.length ? rows[rows.length - 1].score : null;

    // average7 = mean score over the trailing 7 days (now − 7d), rounded to an
    // integer to match the 0..100 integer nature of the scores.
    const cutoff = Date.now() - TRAILING_DAYS * 86_400_000;
    const window = rows.filter((r) => r.createdAt.getTime() >= cutoff);
    const average7 = window.length
      ? Math.round(
          window.reduce((sum, r) => sum + r.score, 0) / window.length,
        )
      : null;

    // recentChecks = newest first, up to 7 (rows are ASC → tail, reversed).
    const recentChecks = rows
      .slice(-RECENT_LIMIT)
      .reverse()
      .map((r) => ({
        body: r.body,
        focus: r.focus,
        direction: r.direction,
        score: r.score,
        at: r.createdAt.toISOString(),
      }));

    return { current, average7, history, recentChecks };
  }

  async function logCoherenceCheck(
    memberId: string,
    input: CoherenceCheckInput,
  ): Promise<{ score: number } & CoherenceSummary> {
    const score = coherenceScore(input.body, input.focus, input.direction);
    await db.insert(universityCoherenceChecks).values({
      memberId,
      body: input.body,
      focus: input.focus,
      direction: input.direction,
      score,
    });
    const summary = await getCoherenceSummary(memberId);
    return { score, ...summary };
  }

  return { coherenceScore, getCoherenceSummary, logCoherenceCheck };
}

export type CoherenceService = ReturnType<typeof coherenceService>;
