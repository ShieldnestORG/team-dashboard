// ---------------------------------------------------------------------------
// Tutorials Marketing Agent (Scribe) cron registration.
//
// Cron: tutorials:marketing-drafts  — disabled until Scribe agent row is
// seeded into the agents table and the pilot is validated. Registration
// in app.ts is left commented with a TODO.
//
// Owner agent: scribe.
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { tutorialsMarketingAgent } from "./tutorials-marketing-agent.js";
import { logger } from "../middleware/logger.js";

export interface StartScribeCronOpts {
  companyId: string;
  ownerAgentId: string;
  fetchTasks: () => Promise<
    Array<{
      companyId: string;
      ownerAgentId: string;
      channel:
        | "tutorials.devto"
        | "tutorials.hashnode"
        | "tutorials.youtube-long"
        | "tutorials.x-clip"
        | "paid-ads-creative.tutorials";
      source: { title: string; body: string; canonicalUrl?: string };
    }>
  >;
}

export function startTutorialsMarketingAgent(db: Db, opts: StartScribeCronOpts): void {
  const agent = tutorialsMarketingAgent(db);
  registerCronJob({
    jobName: "tutorials:marketing-drafts",
    // Daily at 09:00 UTC — gives the queue overnight to accumulate
    // tutorial source updates before drafting.
    schedule: "0 9 * * *",
    ownerAgent: "scribe",
    sourceFile: "tutorials-marketing-agent-cron.ts",
    handler: async () => {
      try {
        const tasks = await opts.fetchTasks();
        if (tasks.length === 0) return;
        await agent.runScribeDraftQueue({
          companyId: opts.companyId,
          ownerAgentId: opts.ownerAgentId,
          tasks,
        });
      } catch (err) {
        logger.error({ err }, "tutorials:marketing-drafts — cycle failed");
      }
    },
  });
}
