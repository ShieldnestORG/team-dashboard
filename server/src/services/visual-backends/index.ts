import type { VisualBackend, VisualCapability } from "./types.js";
import { geminiBackend } from "./gemini.js";
import { grokBackend } from "./grok.js";
import { logger } from "../../middleware/logger.js";

interface BackendEntry {
  backend: VisualBackend;
  envKey: string;
}

const ALL_BACKENDS: BackendEntry[] = [
  { backend: geminiBackend, envKey: "GEMINI_API_KEY" },
  { backend: grokBackend, envKey: "GROK_API_KEY" },
];

function isEnabled(entry: BackendEntry): boolean {
  return !!process.env[entry.envKey];
}

export function getAvailableBackends(): VisualBackend[] {
  return ALL_BACKENDS.filter(isEnabled).map((e) => e.backend);
}

export function getBackend(name: string): VisualBackend | undefined {
  const entry = ALL_BACKENDS.find(
    (e) => e.backend.name === name && isEnabled(e),
  );
  return entry?.backend;
}

export function pickBackend(capability: VisualCapability): VisualBackend | undefined {
  const available = getAvailableBackends().filter((b) =>
    b.capabilities.includes(capability),
  );
  if (available.length === 0) return undefined;
  if (capability === "video") {
    return available.find((b) => b.name === "gemini") || available[0];
  }
  return available[0];
}

export function getBackendSummary(): Array<{
  name: string;
  capabilities: VisualCapability[];
  enabled: boolean;
}> {
  return ALL_BACKENDS.map((entry) => ({
    name: entry.backend.name,
    capabilities: entry.backend.capabilities,
    enabled: isEnabled(entry),
  }));
}

export function logAvailableBackends(): void {
  const available = getAvailableBackends();
  if (available.length === 0) {
    logger.warn("No visual generation backends configured (set GEMINI_API_KEY or GROK_API_KEY)");
  } else {
    logger.info(
      { backends: available.map((b) => b.name) },
      `Visual generation backends available: ${available.map((b) => b.name).join(", ")}`,
    );
  }
}

export type { VisualBackend, VisualCapability, VisualGenerationOpts, VisualJobResult } from "./types.js";
