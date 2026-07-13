// ---------------------------------------------------------------------------
// answer-check service — funnel-top wedge for paid Watchtower.
//
// Wraps `runPromptOneShot` with persistence to `answer_check_runs`. Three
// public entry points form the funnel:
//
//   runAnswerCheck()    → execute the one-shot, persist row, return result
//   attachEmailToRun()  → email captured post-result, fire HTML report
//   markUpsellClicked() → attribution stamp when the visitor clicks the
//                          $49 Watchtower upsell CTA
//
// Cost guardrail: this is a public, unauthenticated endpoint. Each call
// fans out to ALL five engines once (~5 LLM calls, ~$0.007–0.008 per call;
// Grok dominates the total). At ~5 requests/day per visitor that's ~$0.04
// daily exposure. The per-IP rate limit is enforced upstream in the route.
// Engine-level errors are captured per-row, never bubbled, so a flaky
// Gemini key doesn't 500 the whole tool.
// ---------------------------------------------------------------------------

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { answerCheckRuns } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import {
  runPromptOneShot,
  type OneShotResult,
  type PerEngineOutput,
} from "./watchtower-monitor.js";
import {
  sendAnswerCheckReport,
  type AnswerCheckReportData,
} from "./watchtower-email-callback.js";

export interface RunAnswerCheckInput {
  brandName: string;
  domain: string | null;
  prompt: string;
  ip: string | null;
}

export interface AnswerCheckRunResponse {
  runId: string;
  brandName: string;
  domain: string | null;
  prompt: string;
  mentionCount: number;
  enginesUsed: string[];
  skippedEngines: string[];
  perEngine: Array<{
    engine: string;
    ok: boolean;
    error?: string;
    mentioned: boolean;
    sentiment: string;
    excerpt: string | null;
    latencyMs: number;
  }>;
}

export async function runAnswerCheck(
  db: Db,
  input: RunAnswerCheckInput,
): Promise<AnswerCheckRunResponse> {
  const result: OneShotResult = await runPromptOneShot({
    brandName: input.brandName,
    domain: input.domain,
    prompt: input.prompt,
  });

  const [row] = await db
    .insert(answerCheckRuns)
    .values({
      brandName: input.brandName,
      domain: input.domain,
      prompt: input.prompt,
      ip: input.ip,
      perEngine: serializePerEngine(result.perEngine),
      mentionCount: result.mentionCount,
      enginesUsed: result.enginesUsed,
    })
    .returning({ id: answerCheckRuns.id });

  if (!row) {
    throw new Error("answer-check: failed to insert run row");
  }

  return {
    runId: row.id,
    brandName: result.brandName,
    domain: result.domain,
    prompt: result.prompt,
    mentionCount: result.mentionCount,
    enginesUsed: result.enginesUsed,
    skippedEngines: result.skippedEngines,
    perEngine: result.perEngine.map((p) => ({
      engine: p.engine,
      ok: p.ok,
      error: p.error,
      mentioned: p.mentioned,
      sentiment: p.sentiment,
      excerpt: p.excerpt,
      latencyMs: p.latencyMs,
    })),
  };
}

export interface AttachEmailInput {
  runId: string;
  email: string;
  upgradeUrl: string;
}

export async function attachEmailToRun(
  db: Db,
  input: AttachEmailInput,
): Promise<{ ok: boolean; reason?: string }> {
  const [row] = await db
    .select()
    .from(answerCheckRuns)
    .where(eq(answerCheckRuns.id, input.runId));

  if (!row) {
    return { ok: false, reason: "not_found" };
  }

  if (row.emailedAt) {
    return { ok: true, reason: "already_sent" };
  }

  await db
    .update(answerCheckRuns)
    .set({ email: input.email, emailedAt: new Date() })
    .where(eq(answerCheckRuns.id, input.runId));

  const perEngineRaw = Array.isArray(row.perEngine)
    ? (row.perEngine as Array<Record<string, unknown>>)
    : [];

  const data: AnswerCheckReportData = {
    brand: row.brandName,
    domain: row.domain ?? null,
    prompt: row.prompt,
    mentionCount: row.mentionCount,
    enginesUsed: row.enginesUsed,
    perEngine: perEngineRaw.map((p) => ({
      engine: String(p.engine ?? ""),
      ok: Boolean(p.ok),
      mentioned: Boolean(p.mentioned),
      sentiment: String(p.sentiment ?? "unknown"),
      excerpt: typeof p.excerpt === "string" ? p.excerpt : null,
    })),
    upgradeUrl: input.upgradeUrl,
  };

  try {
    await sendAnswerCheckReport({
      kind: "answer_check_report",
      to: input.email,
      data,
      messageId: input.runId,
    });
  } catch (err) {
    logger.error(
      { err, runId: input.runId },
      "answer-check: email callback threw",
    );
  }

  return { ok: true };
}

export async function markUpsellClicked(
  db: Db,
  runId: string,
): Promise<void> {
  await db
    .update(answerCheckRuns)
    .set({ upsellClickedAt: new Date() })
    .where(eq(answerCheckRuns.id, runId));
}

function serializePerEngine(perEngine: PerEngineOutput[]): unknown {
  // Trim raw response text to keep DB row small. The full response isn't
  // useful in the free tool — we already extracted the excerpt.
  return perEngine.map((p) => ({
    engine: p.engine,
    ok: p.ok,
    error: p.error,
    mentioned: p.mentioned,
    sentiment: p.sentiment,
    excerpt: p.excerpt,
    latencyMs: p.latencyMs,
    text: (p.text ?? "").slice(0, 2_000),
  }));
}
