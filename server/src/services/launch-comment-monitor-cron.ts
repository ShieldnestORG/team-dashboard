// ---------------------------------------------------------------------------
// Launch Comment Monitor cron registration.
//
// Cron: launch-monitor:poll-comments  — every 3 minutes.
// Owner agent: scribe (launch-adjacent marketing agent — same agent that
// owns tutorial distribution).
//
// Disabled by default. Registered only when LAUNCH_MONITOR_ENABLED=true.
// Discord webhook is optional (LAUNCH_MONITOR_DISCORD_WEBHOOK_URL).
// ---------------------------------------------------------------------------

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { commentReplies } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { pollAllPlatforms } from "./launch-comment-monitor.js";
import { logger } from "../middleware/logger.js";

export interface StartLaunchMonitorCronOpts {
  companyId: string;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

async function notifyDiscord(
  webhookUrl: string,
  db: Db,
  rowIds: string[],
): Promise<void> {
  if (rowIds.length === 0) return;
  for (const id of rowIds) {
    const [row] = await db.select().from(commentReplies).where(eq(commentReplies.id, id));
    if (!row) continue;
    const platformLabel =
      row.platform === "hn"
        ? "Hacker News"
        : row.platform === "reddit"
          ? "Reddit"
          : row.platform === "devto"
            ? "dev.to"
            : row.platform;
    const inboxUrl = `${process.env.TEAM_DASHBOARD_PUBLIC_URL ?? ""}/socials/launch-monitor`;
    const fields = [
      { name: "Author", value: row.author ?? "(unknown)", inline: true },
      {
        name: "Confidence",
        value: row.confidence ? String(row.confidence) : "—",
        inline: true,
      },
      {
        name: "Suggested reply",
        value: truncate(row.suggestedReply ?? "(needs custom)", 1000),
        inline: false,
      },
      {
        name: "Links",
        value: `[Open comment](${row.externalCommentUrl}) · [Inbox](${inboxUrl})`,
        inline: false,
      },
    ];
    const payload = {
      embeds: [
        {
          title: platformLabel,
          description: truncate(row.commentBody, 500),
          fields,
          timestamp: new Date().toISOString(),
        },
      ],
    };
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "Unknown");
        logger.warn(
          { status: res.status, err, rowId: id },
          "launch-comment-monitor: Discord webhook failed",
        );
      }
    } catch (err) {
      logger.warn({ err, rowId: id }, "launch-comment-monitor: Discord webhook threw");
    }
  }
}

export function startLaunchCommentMonitor(db: Db, opts: StartLaunchMonitorCronOpts): void {
  registerCronJob({
    jobName: "launch-monitor:poll-comments",
    schedule: "*/3 * * * *",
    ownerAgent: "scribe",
    sourceFile: "launch-comment-monitor-cron.ts",
    handler: async () => {
      try {
        const results = await pollAllPlatforms(db, opts.companyId);
        const newRowIds = results.flatMap((r) => r.newRowIds);
        const totalNew = newRowIds.length;
        if (totalNew > 0) {
          logger.info(
            { totalNew, results: results.map((r) => ({ p: r.platform, i: r.inserted })) },
            "launch-monitor: cycle complete (new rows)",
          );
          const webhookUrl = process.env.LAUNCH_MONITOR_DISCORD_WEBHOOK_URL;
          if (webhookUrl) {
            await notifyDiscord(webhookUrl, db, newRowIds);
          }
        }
      } catch (err) {
        logger.error({ err }, "launch-monitor: cycle failed");
      }
    },
  });
}
