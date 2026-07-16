// ---------------------------------------------------------------------------
// Watchtower accuracy judge — Haiku one-shot ground-truth comparator.
//
// When a subscription supplies free-text `ground_truth` ("what's actually
// true about this brand"), the weekly run compares each engine answer against
// it and flags statements that CONTRADICT or MISLEAD about the brand —
// the AEO equivalent of a hallucination alert. Output rides inside the
// existing `watchtower_runs.summary` jsonb (RunSummary.accuracyAlerts), so
// there is no schema change for the verdict itself (only the input
// `ground_truth` column, migration 0123).
//
// This is a DIFFERENT call shape from the EngineAdapter brand-mention query
// (system prompt + structured JSON output), so it deliberately does NOT
// implement the EngineAdapter interface — it copies claude.ts's fetch
// transport (endpoint, model default, api-key env, anthropic-version) only.
//
// Cost/latency discipline (CLAUDE.md unit economics + Rule on bounding):
//   * Only called for subscriptions WITH ground truth (skipped entirely
//     otherwise — zero added cost for the common case).
//   * Only judges cells where the engine actually answered (non-empty text).
//   * Fail-soft: any error (missing key, non-2xx, parse failure, timeout)
//     yields ZERO alerts for that cell and never throws — mirrors
//     runRankCheck's never-sink-the-run contract.
//
// Env: WATCHTOWER_ANTHROPIC_API_KEY required (same key as claude.ts). Model
// overridable via WATCHTOWER_ACCURACY_JUDGE_MODEL, else WATCHTOWER_CLAUDE_MODEL,
// else the Haiku default.
// ---------------------------------------------------------------------------

import { logger } from "../middleware/logger.js";
import { noteProviderFailure } from "./provider-alerts.js";
import { logApiUsage } from "./api-usage.js";
import type { EngineId } from "./watchtower-engines/types.js";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 30_000;
// Bounded concurrency so a ground-truth subscription's judge fan-out doesn't
// stack on top of the engine fan-out and blow the cron's wall-clock budget.
const JUDGE_CONCURRENCY = 4;
// Hard cap on judged cells per run — defence-in-depth against a future
// prompt-cap bump. 25 prompts × 5 engines = 125; we keep well above that but
// still bounded so the judge can never run unboundedly.
const MAX_JUDGED_CELLS = 200;

/** One flagged statement. Mirrors the digest contract's accuracyAlerts entry. */
export interface AccuracyAlert {
  engine: string; // EngineId: chatgpt | claude | perplexity | gemini | grok
  prompt: string; // the prompt whose answer contradicted ground truth
  claim: string; // the specific incorrect statement the judge extracted
  correction: string; // what the ground truth actually says
  severity: "high" | "low"; // high = factual contradiction, low = misleading/incomplete
}

/** A single engine answer to judge against ground truth. */
export interface JudgeCell {
  engine: EngineId | string;
  prompt: string;
  /** The engine's answer text. Empty/whitespace cells are skipped. */
  answer: string;
}

const SYSTEM_PROMPT =
  "You are a fact-checking judge for a brand-monitoring product. You are " +
  "given GROUND TRUTH about a brand (what the brand says is true about " +
  "itself) and an AI assistant's ANSWER to a user prompt. Your job: find " +
  "statements in the ANSWER that CONTRADICT or MISLEAD about the brand " +
  "relative to the GROUND TRUTH. Only flag statements about THIS brand — " +
  "ignore claims about competitors or general topics. Do NOT flag an answer " +
  "merely for omitting information; only flag misleading framing (low) or " +
  "direct factual contradiction (high). The ground truth may be truncated; " +
  'if the answer simply goes beyond it, that is NOT a contradiction. Reply ' +
  "with ONLY a JSON object, no prose, no markdown fences: " +
  '{"alerts":[{"claim":"<incorrect statement from the answer>",' +
  '"correction":"<what the ground truth actually says>",' +
  '"severity":"high"|"low"}]}. ' +
  "Return an empty array when nothing in the answer contradicts the ground truth.";

interface JudgeRaw {
  alerts?: Array<{
    claim?: unknown;
    correction?: unknown;
    severity?: unknown;
  }>;
}

function buildUserMessage(
  brandName: string,
  groundTruth: string,
  prompt: string,
  answer: string,
): string {
  return [
    `BRAND: ${brandName}`,
    "",
    "GROUND TRUTH (what is true about the brand):",
    groundTruth,
    "",
    `USER PROMPT: ${prompt}`,
    "",
    "AI ASSISTANT ANSWER:",
    answer,
  ].join("\n");
}

/**
 * Extract a JSON object from a model response that may include stray prose
 * or markdown fences. Returns null when no parseable object is found.
 */
function parseJudgeJson(text: string): JudgeRaw | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Fast path: whole response is JSON.
  try {
    return JSON.parse(trimmed) as JudgeRaw;
  } catch {
    // fall through to brace extraction
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  try {
    return JSON.parse(trimmed.slice(first, last + 1)) as JudgeRaw;
  } catch {
    return null;
  }
}

/**
 * Judge a single engine answer against ground truth. Never throws — returns
 * [] on any error (missing key, non-2xx, timeout, unparseable output).
 */
async function judgeCell(
  brandName: string,
  groundTruth: string,
  cell: JudgeCell,
): Promise<AccuracyAlert[]> {
  const apiKey = process.env.WATCHTOWER_ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    // Logged once at the run level (see judgeRunAccuracy); silent here to
    // avoid one warn per cell.
    return [];
  }
  const model =
    process.env.WATCHTOWER_ACCURACY_JUDGE_MODEL?.trim() ||
    process.env.WATCHTOWER_CLAUDE_MODEL?.trim() ||
    DEFAULT_MODEL;

  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildUserMessage(
              brandName,
              groundTruth,
              cell.prompt,
              cell.answer,
            ),
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      noteProviderFailure({
        provider: "anthropic",
        service: "watchtower-accuracy-judge",
        status: res.status,
        bodyText: errText,
      });
      logger.warn(
        { status: res.status, err: errText.slice(0, 200), engine: cell.engine },
        "watchtower:accuracy-judge non-2xx (fail-soft, no alert)",
      );
      return [];
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    void logApiUsage({
      provider: "anthropic",
      service: "watchtower-accuracy-judge",
      model,
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
    });
    const text =
      data.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim() ?? "";

    const parsed = parseJudgeJson(text);
    if (!parsed || !Array.isArray(parsed.alerts)) return [];

    const alerts: AccuracyAlert[] = [];
    for (const a of parsed.alerts) {
      const claim = typeof a?.claim === "string" ? a.claim.trim() : "";
      const correction =
        typeof a?.correction === "string" ? a.correction.trim() : "";
      // Skip junk rows the model occasionally emits (empty claim).
      if (!claim) continue;
      const severity: "high" | "low" = a?.severity === "high" ? "high" : "low";
      alerts.push({
        engine: cell.engine,
        prompt: cell.prompt,
        claim,
        correction,
        severity,
      });
    }
    return alerts;
  } catch (err) {
    noteProviderFailure({
      provider: "anthropic",
      service: "watchtower-accuracy-judge",
      error: err,
    });
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: message, engine: cell.engine },
      "watchtower:accuracy-judge threw (fail-soft, no alert)",
    );
    return [];
  }
}

/**
 * Judge every answered cell of a run against the subscription's ground truth.
 *
 * Contract:
 *   - Returns [] (and does NO network calls) when groundTruth is blank.
 *   - Skips cells with empty/whitespace answers (engine error or skip).
 *   - Bounded concurrency; bounded total judged cells.
 *   - Never throws — a judge outage degrades to "no accuracy alerts", never a
 *     failed run (mirrors runRankCheck).
 *
 * Aggregates alerts across cells, high-severity first, for the digest.
 */
export async function judgeRunAccuracy(
  brandName: string,
  groundTruth: string | null | undefined,
  cells: JudgeCell[],
): Promise<AccuracyAlert[]> {
  const truth = (groundTruth ?? "").trim();
  if (!truth) return [];

  const apiKey = process.env.WATCHTOWER_ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    logger.warn(
      { brand: brandName },
      "watchtower:accuracy-judge skipped — WATCHTOWER_ANTHROPIC_API_KEY missing (ground truth set but no key)",
    );
    return [];
  }

  const judgeable = cells
    .filter((c) => typeof c.answer === "string" && c.answer.trim().length > 0)
    .slice(0, MAX_JUDGED_CELLS);

  if (judgeable.length === 0) return [];

  const collected: AccuracyAlert[] = [];
  let cursor = 0;
  const workers = Array.from({
    length: Math.min(JUDGE_CONCURRENCY, judgeable.length),
  }).map(async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= judgeable.length) return;
      const cellAlerts = await judgeCell(brandName, truth, judgeable[idx]!);
      for (const alert of cellAlerts) collected.push(alert);
    }
  });
  await Promise.all(workers);

  // High-severity contradictions surface first in the digest.
  collected.sort(
    (a, b) =>
      (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1),
  );
  return collected;
}
