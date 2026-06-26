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
import { customerAccounts, watchtowerSubscriptions } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { runSubscription } from "./watchtower-monitor.js";
import {
  buildDashboardRunUrl,
  buildManageSubscriptionUrl,
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
  /** Subscriptions that ran but had no resolvable recipient — digest skipped to prevent leaking. */
  skippedNoRecipient: number;
}

/**
 * Mask an email for log output: `user@example.com` → `us***@example.com`.
 * Keeps the domain intact for ops debugging without leaking the local-part.
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "***";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

/**
 * Resolve the digest recipient email for a single subscription row.
 *
 * Resolution order:
 *   1. `account_id` → `customer_accounts.email` (the normal paid path).
 *   2. the subscription's own captured `email` (e.g. promo clients inserted
 *      without a customer_accounts row — see watchtower_subscriptions.email,
 *      documented as the recipient fallback).
 *
 * Returns `null` when neither resolves. The cron treats `null` as "skip this
 * subscription's digest". The fallback is the subscription's OWN email, not a
 * shared ops env address — so it does not reintroduce the cross-customer leak
 * the account-only path guarded against (one env address receiving every
 * customer's mentions).
 */
export async function resolveWatchtowerRecipient(
  db: Db,
  subscription: { id: string; accountId: string | null; email?: string | null },
): Promise<string | null> {
  if (subscription.accountId) {
    const [account] = await db
      .select({ email: customerAccounts.email })
      .from(customerAccounts)
      .where(eq(customerAccounts.id, subscription.accountId));

    const email = account?.email?.trim().toLowerCase();
    if (email) return email;
  }

  const subEmail = subscription.email?.trim().toLowerCase();
  return subEmail || null;
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
  let skippedNoRecipient = 0;

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

        const recipient = await resolveWatchtowerRecipient(db, sub);
        if (!recipient) {
          skippedNoRecipient += 1;
          logger.warn(
            {
              subscriptionId: sub.id,
              brand: sub.brandName,
              accountId: sub.accountId,
              action: "skipped-no-account",
            },
            "watchtower: digest skipped — no account/email resolvable for subscription (refusing to fall back to shared ops env to prevent cross-customer leak)",
          );
          continue;
        }

        await sendDigest(recipient, sub.brandName, result, sub.createdAt);
        logger.info(
          {
            subscriptionId: sub.id,
            recipientEmail: maskEmail(recipient),
            action: "sent",
          },
          "watchtower: digest dispatched",
        );
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

  return { processed, totalMentions, errors, skippedNoRecipient };
}

async function sendDigest(
  to: string,
  brand: string,
  result: Awaited<ReturnType<typeof runSubscription>>,
  subscriptionCreatedAt: Date,
): Promise<void> {
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
    dashboardUrl: buildDashboardRunUrl(result.runId),
    manageSubscriptionUrl: buildManageSubscriptionUrl(),
    // Present only for trackRank subscriptions (migration 0119); omitted
    // otherwise so the digest payload is unchanged for existing customers.
    ...(summary.rank && summary.rank.length > 0 ? { rank: summary.rank } : {}),
    // Present only when the accuracy judge (migration 0123) flagged
    // contradictions; omitted otherwise so the payload is unchanged for
    // subscriptions without ground truth.
    ...(summary.accuracyAlerts && summary.accuracyAlerts.length > 0
      ? { accuracyAlerts: summary.accuracyAlerts }
      : {}),
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
