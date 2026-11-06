import { and, eq, gte, lte, max, desc, sql } from "drizzle-orm";
import { alertEvents, contentItems, type Db } from "@paperclipai/db";
import { sendAlert } from "./alerting.js";

// ---------------------------------------------------------------------------
// Blog publish health — alert when a publish target keeps failing.
//
// Why (2026-11-04): every coherencedaddy.com (cd) post failed with 401
// "Unauthorized" from 2026-04-27 to 2026-11-03 (425 posts) and nothing
// alerted for six months. Each attempt's outcome is already stored per target
// in content_items.publish_results; the alert:blog-publish-health cron reads
// it hourly.
//
// Rule: a target is failing when its last 5 attempts all failed, or when it
// had 2+ attempts in the last 24 h and none succeeded. (2+, not 1+: on the real
// history a 1-attempt version also fired once for a one-off tokns-app failure
// on 2026-08-14 that the next post fixed.)
//
// One alert per target per outage: once an alert email has gone out, a target
// stays quiet until it publishes successfully again. The check reads
// alert_events, so a restart does not re-send. A row whose email failed
// (email_sent = false) does not count, so a mail outage cannot silence it.
//
// Not covered: seo-engine.ts and slideshow blogs publish without writing a
// content_items row, so their attempts are not seen here.
// ---------------------------------------------------------------------------

export const BLOG_TARGETS = [
  { target: "cd", key: "cd", site: "coherencedaddy.com" },
  { target: "sn", key: "sn", site: "shieldnest.org" },
  { target: "tokns-app", key: "toknsApp", site: "app.tokns.fi" },
] as const;

export type BlogTargetInfo = (typeof BLOG_TARGETS)[number];

export const BLOG_PUBLISH_ALERT_RULE = {
  consecutiveFailures: 5,
  windowMs: 24 * 60 * 60 * 1000,
  minWindowAttempts: 2,
};

export type BlogPublishAlertRule = typeof BLOG_PUBLISH_ALERT_RULE;

export interface PublishAttempt {
  at: Date;
  success: boolean;
  error: string | null;
}

export interface TargetHealth {
  failing: boolean;
  consecutiveFailures: number;
  attemptsInWindow: number;
  successesInWindow: number;
  lastSuccessAt: Date | null;
  lastError: string | null;
}

/**
 * `attempts` is newest first and must reach back to the target's last success
 * (or its whole history if it never succeeded) and cover the last 24 h.
 * Attempts after `now` are ignored.
 */
export function evaluateTargetHealth(
  attempts: PublishAttempt[],
  now: Date,
  rule: BlogPublishAlertRule = BLOG_PUBLISH_ALERT_RULE,
): TargetHealth {
  const past = attempts.filter((a) => a.at.getTime() <= now.getTime());

  let consecutiveFailures = 0;
  let lastSuccessAt: Date | null = null;
  for (const a of past) {
    if (a.success) {
      lastSuccessAt = a.at;
      break;
    }
    consecutiveFailures++;
  }
  const lastError = past[0] && !past[0].success ? past[0].error : null;

  const windowStart = now.getTime() - rule.windowMs;
  const inWindow = past.filter((a) => a.at.getTime() > windowStart);
  const successesInWindow = inWindow.filter((a) => a.success).length;

  const failing =
    consecutiveFailures >= rule.consecutiveFailures ||
    (inWindow.length >= rule.minWindowAttempts && successesInWindow === 0);

  return {
    failing,
    consecutiveFailures,
    attemptsInWindow: inWindow.length,
    successesInWindow,
    lastSuccessAt,
    lastError,
  };
}

/** Alert unless an alert email for this target already went out after its last success. */
export function needsAlert(health: TargetHealth, lastEmailedAt: Date | null): boolean {
  if (!health.failing) return false;
  if (!lastEmailedAt) return true;
  return health.lastSuccessAt !== null && lastEmailedAt.getTime() < health.lastSuccessAt.getTime();
}

/** Stable per target: alert_events rows are matched on it for the once-per-outage check. */
export function alertSubject(t: BlogTargetInfo): string {
  return `Blog publish failing: ${t.target} (${t.site})`;
}

function fmt(d: Date | null): string {
  return d ? d.toISOString().replace(/\.\d{3}Z$/, "Z") : "none on record";
}

export function alertBody(
  t: BlogTargetInfo,
  h: TargetHealth,
  rule: BlogPublishAlertRule = BLOG_PUBLISH_ALERT_RULE,
): string {
  const err = h.lastError ? h.lastError.slice(0, 300) : "(no error text recorded)";
  return [
    `Blog posts are not reaching ${t.site} (publish target "${t.target}").`,
    "",
    `Failed attempts in a row: ${h.consecutiveFailures}`,
    `Last 24 h: ${h.attemptsInWindow} attempts, ${h.successesInWindow} succeeded`,
    `Last success: ${fmt(h.lastSuccessAt)}`,
    `Last error: ${err}`,
    "",
    `Rule: ${rule.consecutiveFailures} failed attempts in a row, or ${rule.minWindowAttempts}+ attempts in 24 h with none succeeding.`,
    `This is the only email for this outage. The next one comes only after ${t.target} publishes successfully and then starts failing again.`,
    "",
    `Each attempt is stored in content_items.publish_results.${t.key}; a failed post can be retried per target on the Content Review page. See docs/products/blog-distribution.md.`,
  ].join("\n");
}

const MAX_ROWS = 5000;

/** Attempts for one target, newest first, back to its last success and covering the window. */
async function loadAttempts(
  db: Db,
  key: string,
  now: Date,
  rule: BlogPublishAlertRule,
): Promise<PublishAttempt[]> {
  const leg = sql`(${contentItems.publishResults} -> ${key}::text)`;
  const hasLeg = sql`${leg} IS NOT NULL`;
  const succeeded = sql<boolean>`coalesce((${leg} ->> 'success') = 'true', false)`;

  const [last] = await db
    .select({ at: max(contentItems.createdAt) })
    .from(contentItems)
    .where(and(hasLeg, sql`(${leg} ->> 'success') = 'true'`, lte(contentItems.createdAt, now)));
  const lastSuccessAt = last?.at ? new Date(last.at) : null;

  const windowStart = new Date(now.getTime() - rule.windowMs);
  const conditions = [hasLeg, lte(contentItems.createdAt, now)];
  // Never succeeded → read the whole (small) history.
  if (lastSuccessAt) {
    conditions.push(gte(contentItems.createdAt, lastSuccessAt < windowStart ? lastSuccessAt : windowStart));
  }

  const rows = await db
    .select({
      at: contentItems.createdAt,
      success: succeeded,
      error: sql<string | null>`${leg} ->> 'error'`,
    })
    .from(contentItems)
    .where(and(...conditions))
    .orderBy(desc(contentItems.createdAt))
    .limit(MAX_ROWS);

  return rows.map((r) => ({ at: new Date(r.at), success: r.success === true, error: r.error ?? null }));
}

async function loadLastEmailedAt(db: Db, t: BlogTargetInfo): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(alertEvents.createdAt) })
    .from(alertEvents)
    .where(
      and(
        eq(alertEvents.type, "blog_publish_failing"),
        eq(alertEvents.subject, alertSubject(t)),
        eq(alertEvents.emailSent, true),
      ),
    );
  return row?.at ? new Date(row.at) : null;
}

export interface TargetCheckResult {
  target: BlogTargetInfo["target"];
  failing: boolean;
  consecutiveFailures: number;
  alerted: boolean;
}

/** Cron handler for alert:blog-publish-health. */
export async function checkBlogPublishHealth(
  db: Db,
  now: Date = new Date(),
  rule: BlogPublishAlertRule = BLOG_PUBLISH_ALERT_RULE,
): Promise<TargetCheckResult[]> {
  const results: TargetCheckResult[] = [];
  for (const t of BLOG_TARGETS) {
    const health = evaluateTargetHealth(await loadAttempts(db, t.key, now, rule), now, rule);
    let alerted = false;
    if (health.failing && needsAlert(health, await loadLastEmailedAt(db, t))) {
      await sendAlert("blog_publish_failing", alertSubject(t), alertBody(t, health, rule), {
        cooldownKey: `blog_publish_failing:${t.target}`,
      });
      alerted = true;
    }
    results.push({ target: t.target, failing: health.failing, consecutiveFailures: health.consecutiveFailures, alerted });
  }
  return results;
}
