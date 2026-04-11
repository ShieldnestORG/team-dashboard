/**
 * Moltbook autonomous cron jobs — registered with the central cron registry.
 *
 * Jobs:
 *   moltbook:ingest      — every 15 min — fetch feed, embed, store
 *   moltbook:post        — 6x daily     — generate + publish a post via Ollama
 *   moltbook:engage      — every 20 min — comment on / upvote relevant posts
 *   moltbook:heartbeat   — every 30 min — maintain presence
 *   moltbook:performance — every 6 hours — check our posts' engagement, adjust tuning
 */

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { ingestFeed, generatePost, engageFeed, heartbeat, trackPerformance } from "./moltbook-engine.js";
import { logger } from "../middleware/logger.js";

export function startMoltbookCrons(db: Db): void {
  const tag = "moltbook-crons";

  // Ingest feed — every 15 min (Moltbook allows 60 reads/min, this uses ~2)
  registerCronJob({
    jobName: "moltbook:ingest",
    schedule: "*/15 * * * *",
    ownerAgent: "moltbook",
    sourceFile: "moltbook-crons.ts",
    handler: async () => {
      const result = await ingestFeed(db);
      logger.info({ ...result }, `[${tag}] ingest complete`);
      return result;
    },
  });

  // Post — 6x daily (Moltbook allows 1 post/30min ≈ 48/day, we use 6)
  // Spread across the day: 8am, 11am, 1pm, 4pm, 7pm, 10pm UTC
  registerCronJob({
    jobName: "moltbook:post",
    schedule: "0 8,11,13,16,19,22 * * *",
    ownerAgent: "moltbook",
    sourceFile: "moltbook-crons.ts",
    handler: async () => {
      const result = await generatePost(db);
      logger.info({ ...result }, `[${tag}] post generation complete`);
      return result;
    },
  });

  // Engage — every 20 min (comment + upvote based on relevance scoring)
  registerCronJob({
    jobName: "moltbook:engage",
    schedule: "*/20 * * * *",
    ownerAgent: "moltbook",
    sourceFile: "moltbook-crons.ts",
    handler: async () => {
      const result = await engageFeed(db);
      logger.info({ ...result }, `[${tag}] engagement complete`);
      return result;
    },
  });

  // Heartbeat — every 30 min
  registerCronJob({
    jobName: "moltbook:heartbeat",
    schedule: "*/30 * * * *",
    ownerAgent: "moltbook",
    sourceFile: "moltbook-crons.ts",
    handler: async () => {
      const ok = await heartbeat();
      return { ok };
    },
  });

  // Performance tracking — every 6 hours, checks our posts and adjusts tuning
  registerCronJob({
    jobName: "moltbook:performance",
    schedule: "0 */6 * * *",
    ownerAgent: "moltbook",
    sourceFile: "moltbook-crons.ts",
    handler: async () => {
      const result = await trackPerformance(db);
      logger.info({ ...result }, `[${tag}] performance tracking complete`);
      return result;
    },
  });

  logger.info(`[${tag}] 5 jobs registered`);
}
