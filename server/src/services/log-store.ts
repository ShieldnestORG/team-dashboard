import { writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";

export interface LogEntry {
  level: "info" | "warn" | "error" | "fatal";
  message: string;
  timestamp: string;
  service?: string;
  metadata?: Record<string, unknown>;
}

// In-memory ring buffer
const buffer: LogEntry[] = [];
const MAX_BUFFER = 1000;
const LOG_DIR = join(process.cwd(), "data", "logs");
const RETENTION_DAYS = 14;

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

function todayFilename(): string {
  const d = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(LOG_DIR, `server-${d}.log`);
}

export function appendLog(entry: LogEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();

  // Persist to file
  try {
    ensureLogDir();
    appendFileSync(todayFilename(), JSON.stringify(entry) + "\n");
  } catch {
    // Silently fail — don't crash server for log persistence issues
  }
}

export function getRecentLogs(opts?: { level?: string; limit?: number }): LogEntry[] {
  const limit = Math.min(opts?.limit ?? 100, 500);
  let filtered = [...buffer];

  if (opts?.level) {
    const levels = opts.level === "error" ? ["error", "fatal"] : opts.level === "warn" ? ["warn", "error", "fatal"] : ["info", "warn", "error", "fatal"];
    filtered = filtered.filter(e => levels.includes(e.level));
  }

  return filtered.slice(-limit).reverse(); // newest first
}

export function pruneOldLogs(): void {
  try {
    ensureLogDir();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = readdirSync(LOG_DIR).filter(f => f.startsWith("server-") && f.endsWith(".log"));

    for (const file of files) {
      const dateMatch = file.match(/server-(\d{4}-\d{2}-\d{2})\.log/);
      if (dateMatch) {
        const fileDate = new Date(dateMatch[1]).getTime();
        if (fileDate < cutoff) {
          unlinkSync(join(LOG_DIR, file));
        }
      }
    }
  } catch {
    // Silently fail
  }
}
