/**
 * Automation Health aggregator — unified snapshot of cron registry, plugin
 * dormancy, external integrations, and advisory queue state.
 *
 * Backs the `/automation-health` admin dashboard. All reads are cheap and
 * side-effect free so the UI can poll this endpoint every 60s.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  plugins as pluginsTable,
  pluginConfig,
  repoUpdateSuggestions,
} from "@paperclipai/db";
import { getCronStatus, type CronJobState } from "./cron-registry.js";
import { parseCron } from "./cron.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Staleness = "ok" | "warn" | "critical";

export interface CronJobSnapshot {
  jobName: string;
  schedule: string;
  ownerAgent: string;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  runCount: number;
  errorCount: number;
  running: boolean;
  enabled: boolean;
  staleness: Staleness;
}

export interface CronSection {
  total: number;
  healthy: number;
  stale: number;
  erroring: number;
  disabled: number;
  jobs: CronJobSnapshot[];
}

export interface PluginSection {
  installed: Array<{
    id: string;
    name: string;
    version: string;
    status: string;
  }>;
  dormantManifests: string[];
}

export type IntegrationStatus = "live" | "dormant" | "paused" | "stub";

export interface IntegrationSnapshot {
  provider: string;
  envVar: string;
  configured: boolean;
  lastUsedAt: string | null;
  status: IntegrationStatus;
}

export interface AdvisorySection {
  pendingRepoUpdates: number;
  approvedRepoUpdates: number;
  needsRevision: number;
}

export interface AutomationHealthSnapshot {
  timestamp: string;
  crons: CronSection;
  plugins: PluginSection;
  integrations: IntegrationSnapshot[];
  advisory: AdvisorySection;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Staleness heuristic
// ---------------------------------------------------------------------------

/**
 * Estimate the expected interval between ticks for a cron expression.
 * Uses a coarse heuristic:
 *  - every-minute style (`*` minute field) → 1 minute
 *  - stepped minute (`* /N`) → N minutes  (walked via parseCron's array length)
 *  - fixed minute + `*` hour → 1 hour
 *  - fixed minute + fixed hour + `*` day (DOW unrestricted) → 1 day
 *  - fixed minute + fixed hour + `*` day + specific DOW → ceil(7/dowCount) days
 *    e.g. "0 10 * * 3,6" (Wed+Sat) → 4 days, "0 9 * * 1" (Mon only) → 7 days
 *  - else → 1 week
 * Returns milliseconds.
 */
function estimateIntervalMs(schedule: string): number {
  try {
    const parsed = parseCron(schedule);
    const minuteCount = parsed.minutes.length;
    const hourCount = parsed.hours.length;
    const domCount = parsed.daysOfMonth.length;
    const dowCount = parsed.daysOfWeek.length;

    // A wildcard minute field parses to all 60 values.
    if (minuteCount >= 60) return 60 * 1000;
    if (minuteCount > 1 && hourCount >= 24) {
      // e.g. "* /10 * * * *" → 60/10 = 6 ticks per hour → 10min
      return Math.max(1, Math.floor(60 / minuteCount)) * 60 * 1000;
    }
    if (hourCount >= 24) return 60 * 60 * 1000; // every hour
    if (domCount >= 28) {
      // DOM is "every day of the month" — but DOW may restrict actual run days.
      // If DOW is a subset of the week, true interval = ceil(7 / dowCount) days.
      if (dowCount < 7) {
        return Math.ceil(7 / dowCount) * 24 * 60 * 60 * 1000;
      }
      return 24 * 60 * 60 * 1000; // truly every day
    }
    return 7 * 24 * 60 * 60 * 1000; // weekly fallback
  } catch {
    return 24 * 60 * 60 * 1000;
  }
}

function computeStaleness(job: CronJobState, now: Date): Staleness {
  if (!job.enabled) return "ok";
  const intervalMs = estimateIntervalMs(
    job.scheduleOverride || job.schedule,
  );
  if (!job.lastRunAt) {
    // Never run yet — treat as warn if the expected interval is under a day,
    // critical if longer windows have already lapsed since startup.
    return intervalMs < 24 * 60 * 60 * 1000 ? "warn" : "ok";
  }
  const last = new Date(job.lastRunAt).getTime();
  const age = now.getTime() - last;
  if (age <= intervalMs * 1.5) return "ok";
  if (age <= intervalMs * 2.5) return "warn";
  return "critical";
}

// ---------------------------------------------------------------------------
// Plugin manifest dormancy
// ---------------------------------------------------------------------------

/**
 * Map from on-disk plugin package directory names to their declared manifest
 * `id`. Kept as a static registry so the aggregator doesn't have to dynamically
 * import each plugin package (which would drag their runtime deps in).
 */
const KNOWN_PLUGINS: Array<{ pkgDir: string; manifestId: string }> = [
  { pkgDir: "plugin-discord", manifestId: "coherencedaddy.discord" },
  { pkgDir: "plugin-twitter", manifestId: "coherencedaddy.twitter" },
  { pkgDir: "plugin-moltbook", manifestId: "coherencedaddy.moltbook" },
  { pkgDir: "plugin-firecrawl", manifestId: "coherencedaddy.firecrawl" },
];

async function detectDormantManifests(
  installedKeys: Set<string>,
): Promise<string[]> {
  // Try a few likely locations for the packages/plugins dir.
  const candidates = [
    path.resolve(process.cwd(), "packages/plugins"),
    path.resolve(process.cwd(), "../packages/plugins"),
    path.resolve(process.cwd(), "../../packages/plugins"),
  ];

  let pluginsDir: string | null = null;
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        pluginsDir = candidate;
        break;
      }
    } catch {
      // ignore
    }
  }

  const dormant: string[] = [];

  if (pluginsDir) {
    try {
      const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
      const onDisk = new Set(
        entries
          .filter((e) => e.isDirectory() && e.name.startsWith("plugin-"))
          .map((e) => e.name),
      );
      for (const { pkgDir, manifestId } of KNOWN_PLUGINS) {
        if (onDisk.has(pkgDir) && !installedKeys.has(manifestId)) {
          dormant.push(manifestId);
        }
      }
      return dormant;
    } catch (err) {
      logger.warn({ err, pluginsDir }, "automation-health: plugin dir scan failed");
    }
  }

  // Fallback: use the static KNOWN_PLUGINS list.
  for (const { manifestId } of KNOWN_PLUGINS) {
    if (!installedKeys.has(manifestId)) dormant.push(manifestId);
  }
  return dormant;
}

// ---------------------------------------------------------------------------
// Integration registry
// ---------------------------------------------------------------------------

interface IntegrationDef {
  provider: string;
  envVar: string;
  base: IntegrationStatus;
}

const INTEGRATIONS: IntegrationDef[] = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", base: "live" },
  { provider: "ollama", envVar: "OLLAMA_API_KEY", base: "live" },
  { provider: "firecrawl", envVar: "FIRECRAWL_EMBEDDING_API_KEY", base: "live" },
  { provider: "embeddings-bge-m3", envVar: "EMBED_API_KEY", base: "live" },
  { provider: "coingecko", envVar: "COIN_GECKO_API_KEY", base: "live" },
  { provider: "github", envVar: "GITHUB_TOKEN", base: "live" },
  { provider: "bing-news", envVar: "BING_NEWS_KEY", base: "live" },
  { provider: "smtp", envVar: "SMTP_HOST", base: "live" },
  { provider: "gemini", envVar: "GEMINI_API_KEY", base: "live" },
  { provider: "grok", envVar: "GROK_API_KEY", base: "live" },
  { provider: "canva", envVar: "CANVA_API_KEY", base: "paused" },
  { provider: "youtube", envVar: "YOUTUBE_CLIENT_ID", base: "live" },
  { provider: "tiktok", envVar: "TIKTOK_ACCESS_TOKEN", base: "stub" },
  { provider: "instagram", envVar: "INSTAGRAM_ACCESS_TOKEN", base: "stub" },
  { provider: "twitter-video", envVar: "TWITTER_API_KEY", base: "stub" },
  { provider: "x-api", envVar: "TWITTER_API_KEY", base: "live" },
  { provider: "discord", envVar: "DISCORD_TOKEN", base: "dormant" },
  { provider: "moltbook", envVar: "MOLTBOOK_API_KEY", base: "live" },
  { provider: "stripe", envVar: "STRIPE_SECRET_KEY", base: "stub" },
  { provider: "indexnow", envVar: "INDEXNOW_KEY", base: "live" },
  { provider: "database-neon", envVar: "DATABASE_URL", base: "live" },
];

async function buildIntegrations(): Promise<IntegrationSnapshot[]> {
  // Check whether a Stripe client file exists on disk — if it does, treat
  // stripe as live instead of stub. Another agent may be landing it in parallel.
  let stripeClientExists = false;
  const stripeCandidates = [
    path.resolve(process.cwd(), "server/src/services/stripe-client.ts"),
    path.resolve(process.cwd(), "src/services/stripe-client.ts"),
    path.resolve(process.cwd(), "../server/src/services/stripe-client.ts"),
  ];
  for (const candidate of stripeCandidates) {
    try {
      await fs.access(candidate);
      stripeClientExists = true;
      break;
    } catch {
      // ignore
    }
  }

  return INTEGRATIONS.map((def) => {
    const raw = process.env[def.envVar];
    const configured = typeof raw === "string" && raw.trim().length > 0;
    let status: IntegrationStatus = def.base;
    if (!configured) status = "dormant";
    if (def.provider === "stripe") {
      status = configured && stripeClientExists ? "live" : "stub";
    }
    return {
      provider: def.provider,
      envVar: def.envVar,
      configured,
      lastUsedAt: null,
      status,
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function getAutomationHealth(
  db: Db,
): Promise<AutomationHealthSnapshot> {
  const now = new Date();

  // --- Crons ---
  const cronJobs = getCronStatus();
  const twentyFourHoursAgo = now.getTime() - 24 * 60 * 60 * 1000;

  const jobSnapshots: CronJobSnapshot[] = cronJobs.map((job) => ({
    jobName: job.jobName,
    schedule: job.scheduleOverride || job.schedule,
    ownerAgent: job.ownerAgent,
    lastRunAt: job.lastRunAt,
    lastDurationMs: job.lastDurationMs,
    lastError: job.lastError,
    runCount: job.runCount,
    errorCount: job.errorCount,
    running: job.running,
    enabled: job.enabled,
    staleness: computeStaleness(job, now),
  }));

  const cronsSection: CronSection = {
    total: jobSnapshots.length,
    healthy: jobSnapshots.filter(
      (j) =>
        j.enabled &&
        !j.lastError &&
        j.staleness === "ok" &&
        j.lastRunAt !== null &&
        new Date(j.lastRunAt).getTime() >= twentyFourHoursAgo,
    ).length,
    stale: jobSnapshots.filter(
      (j) => j.staleness === "warn" || j.staleness === "critical",
    ).length,
    erroring: jobSnapshots.filter((j) => j.enabled && !!j.lastError).length,
    disabled: jobSnapshots.filter((j) => !j.enabled).length,
    jobs: jobSnapshots.sort((a, b) => {
      const order: Record<Staleness, number> = { critical: 0, warn: 1, ok: 2 };
      if (order[a.staleness] !== order[b.staleness]) {
        return order[a.staleness] - order[b.staleness];
      }
      return a.jobName.localeCompare(b.jobName);
    }),
  };

  // --- Plugins ---
  const installedRows = await db
    .select({
      id: pluginsTable.id,
      pluginKey: pluginsTable.pluginKey,
      packageName: pluginsTable.packageName,
      version: pluginsTable.version,
      status: pluginsTable.status,
    })
    .from(pluginsTable)
    .leftJoin(pluginConfig, sql`${pluginConfig.pluginId} = ${pluginsTable.id}`)
    .catch((err) => {
      logger.warn({ err }, "automation-health: plugin query failed");
      return [] as Array<{
        id: string;
        pluginKey: string;
        packageName: string;
        version: string;
        status: string;
      }>;
    });

  const installedKeys = new Set(installedRows.map((r) => r.pluginKey));
  const dormantManifests = await detectDormantManifests(installedKeys);

  const pluginsSection: PluginSection = {
    installed: installedRows.map((r) => ({
      id: r.pluginKey,
      name: r.packageName,
      version: r.version,
      status: r.status,
    })),
    dormantManifests,
  };

  // --- Integrations ---
  const integrations = await buildIntegrations();

  // --- Advisory queue ---
  let pendingRepoUpdates = 0;
  let approvedRepoUpdates = 0;
  let needsRevision = 0;
  try {
    const advisoryRows = await db
      .select({
        status: repoUpdateSuggestions.status,
        count: sql<number>`count(*)::int`,
      })
      .from(repoUpdateSuggestions)
      .groupBy(repoUpdateSuggestions.status);
    for (const row of advisoryRows) {
      if (row.status === "pending") pendingRepoUpdates = row.count;
      else if (row.status === "approved") approvedRepoUpdates = row.count;
      else if (row.status === "needs_revision") needsRevision = row.count;
    }
  } catch (err) {
    logger.warn({ err }, "automation-health: advisory query failed");
  }

  const advisory: AdvisorySection = {
    pendingRepoUpdates,
    approvedRepoUpdates,
    needsRevision,
  };

  // --- Warnings ---
  const warnings: string[] = [];

  if (process.env.YT_PIPELINE_ENABLED !== "true") {
    const ytJobs = jobSnapshots.filter((j) =>
      j.jobName.toLowerCase().startsWith("youtube:"),
    ).length;
    warnings.push(
      `YT_PIPELINE_ENABLED is unset — YouTube cron pipeline is dormant${
        ytJobs ? ` (${ytJobs} jobs affected)` : ""
      }`,
    );
  }

  for (const id of dormantManifests) {
    warnings.push(
      `Plugin manifest "${id}" exists on disk but is not registered in plugin_config`,
    );
  }

  const stripe = integrations.find((i) => i.provider === "stripe");
  if (stripe?.configured && stripe.status === "stub") {
    warnings.push(
      "STRIPE_SECRET_KEY is set but server/src/services/stripe-client.ts does not exist — Stripe integration is a stub",
    );
  }

  const criticalStale = jobSnapshots.filter(
    (j) => j.staleness === "critical" && j.enabled,
  );
  if (criticalStale.length > 0) {
    warnings.push(
      `${criticalStale.length} cron job${criticalStale.length === 1 ? "" : "s"} critically stale (missed multiple expected runs)`,
    );
  }

  const erroring = cronsSection.erroring;
  if (erroring > 0) {
    warnings.push(
      `${erroring} cron job${erroring === 1 ? "" : "s"} currently erroring on last run`,
    );
  }

  return {
    timestamp: now.toISOString(),
    crons: cronsSection,
    plugins: pluginsSection,
    integrations,
    advisory,
    warnings,
  };
}
