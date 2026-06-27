// ---------------------------------------------------------------------------
// "What's Hot" digest cron cadence (plan §1.9). Because a run costs well under
// $1/month, the feed is NOT daily:
//   * Base: 2× per week (Mon + Thu) — fresh without flooding members.
//   * Bonus 3rd run (Wed): unlocked only when community engagement clears a
//     weekly threshold. Gamifies engagement at cents of marginal cost.
//
// EVERY cron run only BUILDS a `pending` digest. None of them send — a human
// approves before any blast (Rule 7). The send is a manual admin action.
// ---------------------------------------------------------------------------

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";
import { registerCronJob } from "../cron-registry.js";
import { buildAndStorePendingDigest } from "./build.js";

const DEFAULT_BONUS_THRESHOLD = Number(
  process.env.WHATS_HOT_BONUS_VOTE_THRESHOLD || "10",
);

export interface DigestCronDeps {
  /** Override the engagement counter (tests). */
  countEngagement?: (db: Db) => Promise<number>;
  /** Override the unlock threshold. */
  threshold?: number;
}

/** Community engagement in the last 7 days (idea votes). Fail-soft → 0. */
export async function recentEngagementCount(db: Db): Promise<number> {
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM university_community_idea_votes
      WHERE created_at > now() - interval '7 days'
    `);
    const r = result as unknown;
    const rows = Array.isArray(r)
      ? (r as Array<{ n: number }>)
      : ((r as { rows?: Array<{ n: number }> }).rows ?? []);
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "trends-digest: engagement count failed (treating as 0)",
    );
    return 0;
  }
}

/** Has the community unlocked the bonus mid-week run? */
export async function bonusRunUnlocked(
  db: Db,
  deps: DigestCronDeps = {},
): Promise<boolean> {
  const count = await (deps.countEngagement ?? recentEngagementCount)(db);
  const threshold = deps.threshold ?? DEFAULT_BONUS_THRESHOLD;
  return count >= threshold;
}

export function startTrendsDigestCrons(db?: Db, deps: DigestCronDeps = {}): void {
  if (!db) {
    logger.warn("trends-digest: no db provided — digest crons not started");
    return;
  }

  // Base cadence: Mon + Thu, 07:00 UTC. Builds a PENDING digest only.
  registerCronJob({
    jobName: "trends:digest:build",
    schedule: "0 7 * * 1,4",
    ownerAgent: "echo",
    sourceFile: "trends-digest/digest-crons.ts",
    handler: async () => buildAndStorePendingDigest(db),
  });

  // Community-unlocked bonus: Wed 07:00 UTC, only if engagement cleared the bar.
  registerCronJob({
    jobName: "trends:digest:bonus",
    schedule: "0 7 * * 3",
    ownerAgent: "echo",
    sourceFile: "trends-digest/digest-crons.ts",
    handler: async () => {
      if (!(await bonusRunUnlocked(db, deps))) {
        logger.info(
          "trends-digest: bonus run skipped — community engagement below threshold",
        );
        return { skipped: true };
      }
      logger.info("trends-digest: community unlocked the bonus run — building");
      return buildAndStorePendingDigest(db);
    },
  });

  logger.info({ count: 2 }, "Trends-digest cron jobs registered");
}
