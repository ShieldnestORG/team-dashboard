import { api } from "./client.js";

export type Staleness = "ok" | "warn" | "critical";

export type IntegrationStatus = "live" | "dormant" | "paused" | "stub";

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

export const automationHealthApi = {
  get: () => api.get<AutomationHealthSnapshot>("/automation-health"),
};
