// ---------------------------------------------------------------------------
// Rizz Comment Monitor cron registration.
//
// Cron: rizz-monitor:poll-comments  — every 15 minutes.
// Owner agent: rizz.
//
// Registered only when RIZZ_COMMENT_MONITOR_ENABLED=true. The cron registry
// also exposes a per-job enabled toggle via the dashboard — week-1 manual
// mode = leave the env var off OR toggle it disabled in the UI.
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { pollTiktokMentions } from "./rizz-comment-monitor.js";
import { logger } from "../middleware/logger.js";

export interface StartRizzCommentMonitorCronOpts {
  companyId: string;
  ownHandle: string;
  videoLimit?: number;
}

export function startRizzCommentMonitorCron(
  db: Db,
  opts: StartRizzCommentMonitorCronOpts,
): void {
  registerCronJob({
    jobName: "rizz-monitor:poll-comments",
    schedule: "*/15 * * * *",
    ownerAgent: "rizz",
    sourceFile: "rizz-comment-monitor-cron.ts",
    handler: async () => {
      try {
        const result = await pollTiktokMentions(db, {
          companyId: opts.companyId,
          ownHandle: opts.ownHandle,
          videoLimit: opts.videoLimit ?? 10,
        });
        if (result.inserted > 0 || result.uniqueHandlesFound > 0) {
          logger.info(
            {
              videos: result.videosScanned,
              comments: result.commentsScanned,
              found: result.uniqueHandlesFound,
              inserted: result.inserted,
              handles: result.insertedHandles,
            },
            "rizz-monitor: cycle complete",
          );
        }
      } catch (err) {
        logger.error({ err }, "rizz-monitor: cycle failed");
      }
    },
  });
}
