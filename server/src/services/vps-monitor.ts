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

export interface ServiceCost {
  monthlyCents: number;
  label: string;
  tier?: string;
}

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
  resources?: ServiceResources | null;
  cost?: ServiceCost | null;
}

export interface ServiceResources {
  cpuPercent: number | null;
  memMb: number | null;
  memPercent: number | null;
  detail?: string;
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

// ---------------------------------------------------------------------------
// Service cost mapping (monthly estimates in cents)
// ---------------------------------------------------------------------------

const SERVICE_COSTS: Record<string, ServiceCost> = {
  "Backend API":      { monthlyCents: 2800, label: "$28/mo", tier: "VPS_1 (31.220.61.12) — Contabo VPS L" },
  "Ollama LLM":       { monthlyCents: 1500, label: "$15/mo", tier: "VPS_2 (31.220.61.14) — Contabo VPS M" },
  "Firecrawl":        { monthlyCents: 0,    label: "free",   tier: "Self-hosted on VPS_2" },
  "Embedding Service":{ monthlyCents: 0,    label: "free",   tier: "Self-hosted on VPS_1" },
  "Database":         { monthlyCents: 0,    label: "free",   tier: "Neon free tier" },
};

// Infrastructure costs not tied to a health-checked service
export const INFRA_COSTS: Array<{ name: string; cost: ServiceCost }> = [
  { name: "VPS_1 (Backend)",     cost: { monthlyCents: 2800, label: "$28/mo", tier: "Contabo VPS L — 8 vCPU, 30GB RAM, 200GB NVMe" } },
  { name: "VPS_2 (Ollama)",      cost: { monthlyCents: 1500, label: "$15/mo", tier: "Contabo VPS M — 4 vCPU, 16GB RAM, 200GB NVMe" } },
  { name: "Neon PostgreSQL",     cost: { monthlyCents: 0,    label: "free",   tier: "Free tier — 0.5 GiB storage" } },
  { name: "Vercel (Frontend)",   cost: { monthlyCents: 0,    label: "free",   tier: "Hobby plan" } },
  { name: "GitHub",              cost: { monthlyCents: 0,    label: "free",   tier: "Free (private repo)" } },
  { name: "Anthropic API",       cost: { monthlyCents: 0,    label: "pay-per-use", tier: "Claude Haiku — tracked in Costs page" } },
  { name: "Gemini API",          cost: { monthlyCents: 0,    label: "pay-per-use", tier: "Imagen 3 + Veo 2 — tracked in Costs page" } },
  { name: "Grok/xAI API",        cost: { monthlyCents: 0,    label: "pay-per-use", tier: "grok-2-image — tracked in Costs page" } },
  { name: "X API (Twitter)",     cost: { monthlyCents: 0,    label: "pay-per-use", tier: "Basic tier — $1/day budget cap" } },
  { name: "Proton Mail (SMTP)",  cost: { monthlyCents: 0,    label: "free",   tier: "Included in Proton plan" } },
];

function getServiceChecks(): ServiceCheck[] {
  const port = process.env.PORT || "3100";
  const ollamaUrl = process.env.OLLAMA_URL || "http://172.17.0.1:11434";
  const embedUrl = process.env.EMBED_URL || "http://147.79.78.251:8000";

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
// Per-service resource collection
// ---------------------------------------------------------------------------

async function getDockerContainerStats(): Promise<ServiceResources | null> {
  try {
    const out = execSync(
      'docker stats --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}" $(docker ps -q -f "ancestor=ghcr.io/shieldnestorg/team-dashboard:latest" 2>/dev/null || docker ps -q --filter "publish=3200" 2>/dev/null) 2>/dev/null || echo ""',
      { timeout: 10_000, stdio: "pipe" },
    ).toString().trim();
    if (!out) return null;
    const [cpuStr, memStr, memPctStr] = out.split("|");
    const cpuPercent = parseFloat(cpuStr?.replace("%", "") ?? "");
    const memPercent = parseFloat(memPctStr?.replace("%", "") ?? "");
    // Parse mem like "245.3MiB / 31.1GiB"
    let memMb: number | null = null;
    const memMatch = memStr?.match(/([\d.]+)\s*(MiB|GiB|KiB)/);
    if (memMatch) {
      const val = parseFloat(memMatch[1]!);
      if (memMatch[2] === "GiB") memMb = Math.round(val * 1024);
      else if (memMatch[2] === "KiB") memMb = Math.round(val / 1024);
      else memMb = Math.round(val);
    }
    return {
      cpuPercent: isNaN(cpuPercent) ? null : Math.round(cpuPercent * 10) / 10,
      memMb,
      memPercent: isNaN(memPercent) ? null : Math.round(memPercent * 10) / 10,
    };
  } catch {
    return null;
  }
}

async function getOllamaResources(): Promise<ServiceResources | null> {
  const ollamaUrl = process.env.OLLAMA_URL || "http://172.17.0.1:11434";
  try {
    const resp = await fetch(`${ollamaUrl}/api/ps`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { models?: Array<{ name: string; size: number; size_vram?: number }> };
    const models = data.models ?? [];
    if (models.length === 0) return { cpuPercent: null, memMb: null, memPercent: null, detail: "idle (no models loaded)" };
    const totalBytes = models.reduce((sum, m) => sum + (m.size || 0), 0);
    const memMb = Math.round(totalBytes / 1_048_576);
    const names = models.map((m) => m.name).join(", ");
    return { cpuPercent: null, memMb, memPercent: null, detail: `models loaded: ${names} (${memMb}MB)` };
  } catch {
    return null;
  }
}

async function getEmbeddingResources(): Promise<ServiceResources | null> {
  // Embedding service runs on same VPS as backend — use process lookup
  try {
    const out = execSync(
      'ps aux | grep -E "[e]mbedding|[u]vicorn.*8000" | head -1 | awk \'{print $3 "|" $6}\'',
      { timeout: 5_000, stdio: "pipe" },
    ).toString().trim();
    if (!out) return null;
    const [cpuStr, rssKb] = out.split("|");
    return {
      cpuPercent: parseFloat(cpuStr ?? "0") || null,
      memMb: Math.round(parseInt(rssKb ?? "0", 10) / 1024) || null,
      memPercent: null,
    };
  } catch {
    return null;
  }
}

async function collectServiceResources(): Promise<Map<string, ServiceResources>> {
  const resources = new Map<string, ServiceResources>();
  const [docker, ollama, embedding] = await Promise.allSettled([
    getDockerContainerStats(),
    getOllamaResources(),
    getEmbeddingResources(),
  ]);
  if (docker.status === "fulfilled" && docker.value) resources.set("Backend API", docker.value);
  if (ollama.status === "fulfilled" && ollama.value) resources.set("Ollama LLM", ollama.value);
  if (embedding.status === "fulfilled" && embedding.value) resources.set("Embedding Service", embedding.value);
  return resources;
}

// ---------------------------------------------------------------------------
// Main check function
// ---------------------------------------------------------------------------

async function checkAllServices(db: Db): Promise<void> {
  const checks = getServiceChecks();

  // Run all HTTP checks + DB check + resource collection in parallel
  const [httpResults, resourceMap] = await Promise.all([
    Promise.allSettled([
      ...checks.map((svc) => checkService(svc)),
      checkDatabase(db),
    ]),
    collectServiceResources(),
  ]);

  const results = httpResults;

  for (const result of results) {
    if (result.status === "fulfilled") {
      const svc = result.value;
      const prev = previousStatus.get(svc.name);

      // Attach per-service resource data and costs
      svc.resources = resourceMap.get(svc.name) ?? null;
      svc.cost = SERVICE_COSTS[svc.name] ?? null;

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
