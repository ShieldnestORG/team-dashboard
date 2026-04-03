import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

const STORE_PATH = join(process.cwd(), "data", "eval-results.json");

export interface EvalCaseResult {
  case: string;
  provider: string;
  pass: boolean;
  score: number;
}

export interface EvalRunRecord {
  id: string;
  ranAt: string;
  durationMs: number;
  totalTests: number;
  passed: number;
  failed: number;
  results: EvalCaseResult[];
  trigger: "cron" | "manual";
}

function ensureDir() {
  const dir = dirname(STORE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function getEvalHistory(limit = 30): EvalRunRecord[] {
  if (!existsSync(STORE_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    return (data as EvalRunRecord[]).slice(-limit);
  } catch {
    return [];
  }
}

export function getLatestEval(): EvalRunRecord | null {
  const history = getEvalHistory(1);
  return history.length > 0 ? history[history.length - 1] : null;
}

export function appendEvalResult(
  record: Omit<EvalRunRecord, "id">,
): EvalRunRecord {
  ensureDir();
  const history = getEvalHistory(500);
  const full: EvalRunRecord = { id: randomUUID(), ...record };
  history.push(full);
  writeFileSync(STORE_PATH, JSON.stringify(history, null, 2));
  return full;
}
