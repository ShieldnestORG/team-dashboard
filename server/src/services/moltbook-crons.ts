/**
 * Moltbook autonomous cron jobs — registered with the central cron registry.
 *
 * Jobs:
 *   moltbook:ingest   — every 20 min — fetch feed, embed, store
 *   moltbook:post     — 4x daily     — generate + publish a post via Ollama
 *   moltbook:engage   — every 30 min — comment on / upvote relevant posts
 *   moltbook:heartbeat — every 30 min — maintain presence
 */

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { ingestFeed, generatePost, engageFeed, heartbeat } from "./moltbook-engine.js";
import { logger } from "../middleware/logger.js";

export function startMoltbookCrons(db: Db): void {
  const tag = "moltbook-crons";

  registerCronJob({
    jobName: "moltbook:ingest",
    schedule: "*/20 * * * *",
    ownerAgent: "moltbook",
    sourceFile: "moltbook-crons.ts",
    handler: async () => {
      const result = await ingestFeed(db);
      logger.info({ ...result }, `[${tag}] ingest complete`);
      return result;
    },
  });

  registerCronJob({
    jobName: "moltbook:post",
    schedule: "0 9,13,17,21 * * *",
    ownerAgent: "moltbook",
    sourceFile: "moltbook-crons.ts",
    handler: async () => {
      const result = await generatePost(db);
      logger.info({ ...result }, `[${tag}] post generation complete`);
      return result;
    },
  });

  registerCronJob({
    jobName: "moltbook:engage",
    schedule: "*/30 * * * *",
    ownerAgent: "moltbook",
    sourceFile: "moltbook-crons.ts",
    handler: async () => {
      const result = await engageFeed(db);
      logger.info({ ...result }, `[${tag}] engagement complete`);
      return result;
    },
  });

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

  logger.info(`[${tag}] 4 jobs registered`);
}
