/**
 * VPS Health Monitor — periodic checks of all services with email alerts
 * on state transitions (up→down, down→up).
 */

import os from "os";
import { execSync } from "child_process";
import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { sendAlert } from "./alerting.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceStatus {
  name: string;
  url: string;
  status: "up" | "down" | "degraded" | "unknown";
  latencyMs: number | null;
  lastCheckedAt: string | null;
  lastUpAt: string | null;
  lastDownAt: string | null;
  error: string | null;
  consecutiveFailures: number;
}

export interface SystemMetrics {
  diskUsedPercent: number | null;
  diskFreeGb: number | null;
  memUsedPercent: number;
  memFreeGb: number;
  memTotalGb: number;
  cpuLoad1m: number;
  cpuLoad5m: number;
  uptimeHours: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const serviceStatuses = new Map<string, ServiceStatus>();
let latestMetrics: SystemMetrics | null = null;

// Track previous status for state transition alerts
const previousStatus = new Map<string, "up" | "down" | "degraded" | "unknown">();

// ---------------------------------------------------------------------------
// Service definitions
// ---------------------------------------------------------------------------

interface ServiceCheck {
  name: string;
  url: string;
  timeoutMs?: number;
}

function getServiceChecks(): ServiceCheck[] {
  const port = process.env.PORT || "3100";
  const ollamaUrl = process.env.OLLAMA_URL || "http://168.231.127.180:11434";
  const embedUrl = process.env.EMBED_URL || "http://31.220.61.12:8000";

  return [
    { name: "Backend API", url: `http://127.0.0.1:${port}/api/health/readiness` },
    { name: "Ollama LLM", url: `${ollamaUrl}/api/tags` },
    { name: "Firecrawl", url: "http://168.231.127.180:3002/", timeoutMs: 10_000 },
    { name: "Embedding Service", url: `${embedUrl}/health`, timeoutMs: 10_000 },
  ];
}

// ---------------------------------------------------------------------------
// Check functions
// ---------------------------------------------------------------------------

async function checkService(svc: ServiceCheck): Promise<ServiceStatus> {
  const existing = serviceStatuses.get(svc.name);
  const status: ServiceStatus = {
    name: svc.name,
    url: svc.url,
    status: "unknown",
    latencyMs: null,
    lastCheckedAt: new Date().toISOString(),
    lastUpAt: existing?.lastUpAt ?? null,
    lastDownAt: existing?.lastDownAt ?? null,
    error: null,
    consecutiveFailures: existing?.consecutiveFailures ?? 0,
  };

  const start = Date.now();
  try {
    const resp = await fetch(svc.url, {
      signal: AbortSignal.timeout(svc.timeoutMs ?? 8_000),
    });
    status.latencyMs = Date.now() - start;

    if (resp.ok) {
      status.status = "up";
      status.lastUpAt = status.lastCheckedAt;
      status.consecutiveFailures = 0;
    } else {
      status.status = "degraded";
      status.error = `HTTP ${resp.status}`;
      status.consecutiveFailures++;
    }
  } catch (err) {
    status.latencyMs = Date.now() - start;
    status.status = "down";
    status.error = err instanceof Error ? err.message : String(err);
    status.lastDownAt = status.lastCheckedAt;
    status.consecutiveFailures++;
  }

  return status;
}

async function checkDatabase(db: Db): Promise<ServiceStatus> {
  const existing = serviceStatuses.get("Database");
  const status: ServiceStatus = {
    name: "Database",
    url: "postgres (neon)",
    status: "unknown",
    latencyMs: null,
    lastCheckedAt: new Date().toISOString(),
    lastUpAt: existing?.lastUpAt ?? null,
    lastDownAt: existing?.lastDownAt ?? null,
    error: null,
    consecutiveFailures: existing?.consecutiveFailures ?? 0,
  };

  const start = Date.now();
  try {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    status.latencyMs = Date.now() - start;
    status.status = "up";
    status.lastUpAt = status.lastCheckedAt;
    status.consecutiveFailures = 0;
  } catch (err) {
    status.latencyMs = Date.now() - start;
    status.status = "down";
    status.error = err instanceof Error ? err.message : String(err);
    status.lastDownAt = status.lastCheckedAt;
    status.consecutiveFailures++;
  }

  return status;
}

function collectSystemMetrics(): SystemMetrics {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const loadAvg = os.loadavg();

  let diskUsedPercent: number | null = null;
  let diskFreeGb: number | null = null;

  try {
    const dfOutput = execSync("df -k / | tail -1", { timeout: 5000, stdio: "pipe" }).toString().trim();
    const parts = dfOutput.split(/\s+/);
    if (parts.length >= 4) {
      const totalK = parseInt(parts[1]!, 10);
      const usedK = parseInt(parts[2]!, 10);
      if (!isNaN(totalK) && !isNaN(usedK) && totalK > 0) {
        diskUsedPercent = Math.round((usedK / totalK) * 100);
        diskFreeGb = Math.round((totalK - usedK) / 1_048_576 * 10) / 10;
      }
    }
  } catch {
    // disk check may not work in all environments
  }

  return {
    diskUsedPercent,
    diskFreeGb,
    memUsedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    memFreeGb: Math.round((freeMem / 1_073_741_824) * 10) / 10,
    memTotalGb: Math.round((totalMem / 1_073_741_824) * 10) / 10,
    cpuLoad1m: Math.round(loadAvg[0]! * 100) / 100,
    cpuLoad5m: Math.round(loadAvg[1]! * 100) / 100,
    uptimeHours: Math.round(os.uptime() / 3600 * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Main check function
// ---------------------------------------------------------------------------

async function checkAllServices(db: Db): Promise<void> {
  const checks = getServiceChecks();

  // Run all HTTP checks in parallel + DB check
  const results = await Promise.allSettled([
    ...checks.map((svc) => checkService(svc)),
    checkDatabase(db),
  ]);

  for (const result of results) {
    if (result.status === "fulfilled") {
      const svc = result.value;
      const prev = previousStatus.get(svc.name);

      // Update state
      serviceStatuses.set(svc.name, svc);

      // State transition alerts
      if (prev && prev !== svc.status) {
        if (svc.status === "down" && prev !== "down") {
          await sendAlert(
            "service_down",
            `Service DOWN: ${svc.name}`,
            `${svc.name} at ${svc.url} is unreachable.\nError: ${svc.error}\nConsecutive failures: ${svc.consecutiveFailures}`,
          );
        } else if (svc.status === "up" && prev === "down") {
          await sendAlert(
            "service_recovered",
            `Service RECOVERED: ${svc.name}`,
            `${svc.name} at ${svc.url} is back online.\nLatency: ${svc.latencyMs}ms`,
          );
        }
      }

      previousStatus.set(svc.name, svc.status);
    }
  }

  // System metrics
  latestMetrics = collectSystemMetrics();

  // Threshold alerts
  if (latestMetrics.diskUsedPercent !== null && latestMetrics.diskUsedPercent > 90) {
    await sendAlert(
      "disk_warning",
      `Disk usage critical: ${latestMetrics.diskUsedPercent}%`,
      `Disk is ${latestMetrics.diskUsedPercent}% full. Free: ${latestMetrics.diskFreeGb}GB`,
    );
  }

  if (latestMetrics.memUsedPercent > 90) {
    await sendAlert(
      "memory_warning",
      `Memory usage critical: ${latestMetrics.memUsedPercent}%`,
      `Memory is ${latestMetrics.memUsedPercent}% used. Free: ${latestMetrics.memFreeGb}GB / ${latestMetrics.memTotalGb}GB total`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getServiceStatuses(): ServiceStatus[] {
  return Array.from(serviceStatuses.values());
}

export function getSystemMetrics(): SystemMetrics | null {
  return latestMetrics;
}

// ---------------------------------------------------------------------------
// Register as cron job
// ---------------------------------------------------------------------------

export function initVpsMonitor(db: Db): void {
  registerCronJob({
    jobName: "monitor:services",
    schedule: "*/3 * * * *",
    ownerAgent: "nova",
    sourceFile: "vps-monitor.ts",
    handler: () => checkAllServices(db),
  });

  // Run first check immediately
  void checkAllServices(db).catch((err) => {
    logger.error({ err }, "Initial VPS health check failed");
  });

  logger.info("VPS monitor initialized (checks every 3 min)");
}
