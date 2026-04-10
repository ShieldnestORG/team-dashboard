/**
 * Configure agent heartbeat intervals and adapter types.
 *
 * Usage:
 *   npx tsx scripts/configure-agent-heartbeats.ts
 *
 * Requires DATABASE_URL env var (or .env file with it).
 *
 * Sets heartbeat intervals so agents auto-wake to process assigned issues.
 * Sets adapter type to ollama_local for autonomous work without Claude API costs.
 */

import { eq, and, ne } from "drizzle-orm";
import { agents, createDb } from "@paperclipai/db";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID ?? "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

// Agent heartbeat configurations keyed by lowercase agent name
const HEARTBEAT_CONFIG: Record<string, { intervalSec: number; maxConcurrentRuns?: number }> = {
  // Data & infrastructure agents — faster loops
  echo:   { intervalSec: 600 },   // 10min — data pipeline monitoring
  nova:   { intervalSec: 900 },   // 15min — system health, eval review
  core:   { intervalSec: 1800 },  // 30min — backend dev issues
  sage:   { intervalSec: 1800 },  // 30min — content orchestration

  // Content personality agents — hourly loops
  blaze:  { intervalSec: 3600 },  // 1hr — hot-take content tasks
  cipher: { intervalSec: 3600 },  // 1hr — technical blog/reddit tasks
  spark:  { intervalSec: 3600 },  // 1hr — community engagement tasks
  prism:  { intervalSec: 3600 },  // 1hr — trend reporting tasks

  // Management agents — less frequent
  atlas:  { intervalSec: 7200 },  // 2hr — CEO triage, delegation
  river:  { intervalSec: 3600 },  // 1hr — PM sprint tracking

  // IC agents — wake on demand only (no interval)
  // flux, bridge, pixel, mermaid — leave at 0 (on-demand only)
};

// Default adapter type for agents doing autonomous work
const DEFAULT_ADAPTER = "ollama_local";

// Agents that should NOT have their adapter changed (keep current adapter, e.g. claude_local)
const KEEP_ADAPTER = new Set(["atlas", "nova"]);

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is required. Set it in .env or as an environment variable.");
    process.exit(1);
  }

  const db = createDb(dbUrl);

  const allAgents = await db
    .select()
    .from(agents)
    .where(and(eq(agents.companyId, COMPANY_ID), ne(agents.status, "terminated")));

  console.log(`Found ${allAgents.length} agents for company ${COMPANY_ID}\n`);

  let configured = 0;
  let skipped = 0;

  for (const agent of allAgents) {
    const name = agent.name.toLowerCase();
    const config = HEARTBEAT_CONFIG[name];

    if (!config) {
      console.log(`  [skip] ${agent.name} — no heartbeat config defined (on-demand only)`);
      skipped++;
      continue;
    }

    const existingConfig = asRecord(agent.runtimeConfig);
    const existingHeartbeat = asRecord(existingConfig.heartbeat);

    const newRuntimeConfig = {
      ...existingConfig,
      heartbeat: {
        ...existingHeartbeat,
        enabled: true,
        intervalSec: config.intervalSec,
        wakeOnDemand: true,
        maxConcurrentRuns: config.maxConcurrentRuns ?? 1,
      },
    };

    const updates: Record<string, unknown> = {
      runtimeConfig: newRuntimeConfig,
    };

    // Set adapter type for agents that should do autonomous work
    if (!KEEP_ADAPTER.has(name) && agent.adapterType !== DEFAULT_ADAPTER) {
      updates.adapterType = DEFAULT_ADAPTER;
    }

    await db
      .update(agents)
      .set(updates)
      .where(eq(agents.id, agent.id));

    const intervalLabel = config.intervalSec >= 3600
      ? `${config.intervalSec / 3600}hr`
      : `${config.intervalSec / 60}min`;

    const adapterNote = updates.adapterType ? ` (adapter → ${DEFAULT_ADAPTER})` : "";
    console.log(`  [done] ${agent.name} — heartbeat every ${intervalLabel}${adapterNote}`);
    configured++;
  }

  console.log(`\nConfigured: ${configured}, Skipped: ${skipped}`);
  console.log("Heartbeat scheduler will pick up changes on next tick (30s).");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
