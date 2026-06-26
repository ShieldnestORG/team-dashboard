// ---------------------------------------------------------------------------
// Grounded "why it's hot" generator — Rule 2 ("the model only writes grounded
// prose"). The model's ENTIRE job is a 1-2 sentence restatement of the fetched
// source text. It is never asked for a number (Rule 1 stays code's job), and
// its output is run back through the number guard before it ships: if it
// smuggled in any figure the source didn't state, the line is rejected and a
// deterministic, model-free templated line is used instead. The feed therefore
// NEVER blocks on the model and NEVER ships a model-invented number.
//
// Model order: Ollama (free, local VPS) → Claude Haiku (if ANTHROPIC_API_KEY)
// → deterministic template. Mirrors the existing seo-engine fallback pattern.
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";
import { callOllamaGenerate } from "../ollama-client.js";
import { findUngroundedNumbers } from "./number-guard.js";
import type { GroundedProse, SourceRef } from "./types.js";

export interface WhyItsHotInput {
  /** The fetched headline/topic (not model text). */
  title: string;
  category: string;
  /** Fetched text the prose must restate — the ONLY facts the model may use. */
  sourceText: string;
  /** The primary source attached to the line. */
  source: SourceRef;
  /**
   * Code-inserted stat values that ARE allowed to appear in the prose even
   * though they may not be in `sourceText` verbatim (e.g. the HN score we
   * surface as a stat). (Rule 1)
   */
  allowedNumbers?: Array<string | number>;
}

/** Injectable text model: (system, user) → prose. Throws on failure. */
export type ProseModel = (system: string, user: string) => Promise<string>;

export interface GenerateOpts {
  /** Override the model chain (used by tests). Defaults to Ollama → Claude. */
  models?: ProseModel[];
}

const SYSTEM_PROMPT =
  "You write a single 1-2 sentence note on why a topic is currently " +
  "noteworthy, for a calm faith-community newsletter. STRICT RULES: " +
  "(1) Restate ONLY facts contained in the SOURCE TEXT. " +
  "(2) Never introduce a number, statistic, price, percentage, market cap, " +
  "count, or ranking that is not already written in the SOURCE TEXT — if the " +
  "source has no numbers, use none. " +
  "(3) No hype and no superlatives ('biggest', '#1', 'largest') unless the " +
  "SOURCE TEXT states them. " +
  "(4) Plain and factual. Reply with ONLY the sentence(s) — no preamble, no " +
  "markdown, no quotes.";

function buildUser(input: WhyItsHotInput): string {
  return [
    `TOPIC: ${input.title}`,
    `CATEGORY: ${input.category}`,
    "",
    "SOURCE TEXT (the only facts you may use):",
    input.sourceText.trim() || "(no additional source text)",
  ].join("\n");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Trim model output to at most `max` sentences and strip wrapping junk. */
export function clampSentences(text: string, max = 2): string {
  const cleaned = text
    .trim()
    .replace(/^["'`*\s]+|["'`*\s]+$/g, "")
    .replace(/\s+/g, " ");
  const sentences = cleaned.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [cleaned];
  return sentences
    .slice(0, max)
    .map((s) => s.trim())
    .join(" ")
    .trim();
}

/**
 * Deterministic, model-free line. Grounded by construction: it only restates
 * the fetched title, category, and source publisher — no figures, no claims.
 */
export function templatedLine(input: WhyItsHotInput): string {
  const where =
    input.source.publisher || hostOf(input.source.url) || "its source";
  return `${input.title} is drawing attention in ${input.category}, per ${where}.`;
}

/** Ollama adapter: fold system+user into the single-prompt API. */
const ollamaModel: ProseModel = async (system, user) =>
  callOllamaGenerate(`${system}\n\n${user}`);

// Claude Haiku adapter — same Anthropic transport the rest of the codebase
// inlines (seo-engine, watchtower judge). Only used if a key is configured.
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const claudeModel: ProseModel = async (system, user) => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model =
    process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001";
  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = (await res.json()) as {
    content?: Array<{ type: string; text: string }>;
  };
  return (
    data.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n") ?? ""
  );
};

function defaultModels(): ProseModel[] {
  const models: ProseModel[] = [ollamaModel];
  if (process.env.ANTHROPIC_API_KEY?.trim()) models.push(claudeModel);
  return models;
}

/**
 * Produce a grounded "why it's hot" line. Tries each model in order; the first
 * model whose output passes the number guard wins. If every model fails or is
 * rejected, returns the deterministic templated line with `fallback: true`.
 * Always resolves — never throws, never blocks the feed.
 */
export async function generateWhyItsHot(
  input: WhyItsHotInput,
  opts: GenerateOpts = {},
): Promise<GroundedProse> {
  const models = opts.models ?? defaultModels();
  const user = buildUser(input);
  const allowed = input.allowedNumbers ?? [];

  for (const model of models) {
    let raw: string;
    try {
      raw = await model(SYSTEM_PROMPT, user);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "trends-digest:why-its-hot model failed (trying next / fallback)",
      );
      continue;
    }
    const text = clampSentences(raw, 2);
    if (!text) continue;

    const ungrounded = findUngroundedNumbers(text, input.sourceText, allowed);
    if (ungrounded.length > 0) {
      logger.warn(
        { ungrounded, title: input.title },
        "trends-digest:why-its-hot rejected — model introduced ungrounded number(s)",
      );
      continue;
    }
    return { text, sources: [input.source], fallback: false };
  }

  return {
    text: templatedLine(input),
    sources: [input.source],
    fallback: true,
  };
}
