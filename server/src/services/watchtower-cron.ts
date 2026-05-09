// ---------------------------------------------------------------------------
// Watchtower weekly cron registration.
//
// Job:    watchtower:weekly-runs
// When:   Every Monday at 09:00 UTC.
// Owner:  watchtower (the brand-mention monitor product agent).
//
// On tick: select every active+weekly subscription, fan out runs with
// concurrency 5, then queue a per-subscription digest email via the
// storefront callback. Engine env vars are checked inside each adapter;
// missing keys produce a single warning log per run, not a crash.
// ---------------------------------------------------------------------------

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { watchtowerSubscriptions } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { runSubscription } from "./watchtower-monitor.js";
import {
  sendWatchtowerDigest,
  type WatchtowerWeeklyDigestData,
} from "./watchtower-email-callback.js";
import { logger } from "../middleware/logger.js";

const WEEKLY_SCHEDULE = "0 9 * * 1"; // Monday 09:00 UTC
const FANOUT_CONCURRENCY = 5;

export interface WatchtowerWeeklyRunsResult {
  processed: number;
  totalMentions: number;
  errors: number;
}

/**
 * Exported for tests — does the same work the cron handler does, returns
 * a summary. Tests inject a `db` against an embedded Postgres.
 */
export async function runWeeklyWatchtowerJobs(
  db: Db,
): Promise<WatchtowerWeeklyRunsResult> {
  const subs = await db
    .select()
    .from(watchtowerSubscriptions)
    .where(
      and(
        eq(watchtowerSubscriptions.status, "active"),
        eq(watchtowerSubscriptions.frequency, "weekly"),
      ),
    );

  let processed = 0;
  let totalMentions = 0;
  let errors = 0;

  let cursor = 0;
  const workers = Array.from({
    length: Math.min(FANOUT_CONCURRENCY, subs.length || 1),
  }).map(async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= subs.length) return;
      const sub = subs[idx]!;
      try {
        const result = await runSubscription(db, sub.id);
        processed += 1;
        totalMentions += result.mentionCount;

        await maybeSendDigest(sub.brandName, result, sub.createdAt);
      } catch (err) {
        errors += 1;
        logger.error(
          { err, subscriptionId: sub.id, brand: sub.brandName },
          "watchtower: subscription run failed",
        );
      }
    }
  });
  await Promise.all(workers);

  return { processed, totalMentions, errors };
}

async function maybeSendDigest(
  brand: string,
  result: Awaited<ReturnType<typeof runSubscription>>,
  subscriptionCreatedAt: Date,
): Promise<void> {
  // v1: accounts table isn't yet wired through Stripe → user lookup.
  // Honor a single broadcast address (`WATCHTOWER_DIGEST_EMAIL`) so the
  // operator gets every weekly digest until Worker A's portal lands the
  // per-account email join.
  const to = process.env.WATCHTOWER_DIGEST_EMAIL?.trim();
  if (!to) {
    logger.info(
      { brand, runId: result.runId, mentions: result.mentionCount },
      "watchtower: digest send skipped (WATCHTOWER_DIGEST_EMAIL unset)",
    );
    return;
  }

  const summary = result.summary;
  const totalEngines = Object.keys(summary.byEngine).length;
  const portal = process.env.TEAM_DASHBOARD_PUBLIC_URL ?? "";
  const reportUrl = portal
    ? `${portal.replace(/\/$/, "")}/api/watchtower/runs/${result.runId}`
    : "";

  const data: WatchtowerWeeklyDigestData = {
    brand,
    weekStartISO: subscriptionCreatedAt.toISOString(),
    totalMentions: result.mentionCount,
    totalPrompts: result.totalPrompts,
    totalEngines,
    topExcerpts: summary.topExcerpts.slice(0, 3),
    reportUrl,
  };

  await sendWatchtowerDigest({
    kind: "watchtower_weekly_digest",
    to,
    data,
    messageId: `watchtower:${result.runId}`,
  });
}

export function startWatchtowerCron(db: Db): void {
  registerCronJob({
    jobName: "watchtower:weekly-runs",
    schedule: WEEKLY_SCHEDULE,
    ownerAgent: "watchtower",
    sourceFile: "watchtower-cron.ts",
    handler: async () => {
      try {
        const summary = await runWeeklyWatchtowerJobs(db);
        logger.info(
          summary,
          "watchtower: weekly cycle complete",
        );
      } catch (err) {
        logger.error({ err }, "watchtower: weekly cycle failed");
        throw err;
      }
    },
  });
}
