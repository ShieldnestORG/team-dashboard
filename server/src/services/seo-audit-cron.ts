/**
 * Weekly SEO/AEO audit cron — owned by Sage (CMO).
 *
 * Runs every Sunday at 8:17 AM local time, audits every monitored site,
 * persists advisory suggestions to `repo_update_suggestions`, and sends ONE
 * digest email summarizing the new findings. Nothing is auto-pushed.
 */

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { auditUrl } from "./seo-audit.js";
import { persistAuditFailures, formatDigest } from "./repo-update-advisor.js";
import { sendAlert } from "./alerting.js";
import { logger } from "../middleware/logger.js";

const MONITORED_URLS = [
  "https://coherencedaddy.com",
  "https://freetools.coherencedaddy.com",
  "https://directory.coherencedaddy.com",
  "https://token.coherencedaddy.com",
  "https://law.coherencedaddy.com",
  "https://optimize-me.coherencedaddy.com",
  "https://app.tokns.fi",
  "https://shieldnest.org",
];

async function runWeeklyAudit(db: Db): Promise<void> {
  const runId = `cron-${Date.now()}`;
  const batches: Array<{ url: string; created: Awaited<ReturnType<typeof persistAuditFailures>> }> = [];

  for (const url of MONITORED_URLS) {
    try {
      const audit = await auditUrl(url);
      const created = await persistAuditFailures(db, audit, runId);
      batches.push({ url, created });
    } catch (err) {
      logger.error({ err, url }, "SEO audit failed for site");
      batches.push({ url, created: [] });
    }
  }

  const totalNew = batches.reduce((n, b) => n + b.created.length, 0);
  if (totalNew === 0) {
    logger.info({ runId }, "SEO audit: all monitored sites passed, no digest sent");
    return;
  }

  const body = formatDigest(batches);
  await sendAlert("service_down", `SEO/AEO Audit — ${totalNew} new suggestions`, body);
  logger.info({ runId, totalNew }, "SEO audit digest sent to admin");
}

export function startSeoAuditCron(db: Db): void {
  registerCronJob({
    jobName: "content:seo-audit",
    schedule: "17 8 * * 0", // Sunday 8:17 AM local time
    ownerAgent: "sage",
    sourceFile: "seo-audit-cron.ts",
    handler: () => runWeeklyAudit(db),
  });
  logger.info("SEO audit cron registered (content:seo-audit)");
}
