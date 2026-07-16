// ---------------------------------------------------------------------------
// Coherent Ones University — Anthropic /v1/messages wrapper for the agent runner.
// Ports the prototype chat_ai.py call. On ANY failure (HTTP error, refusal,
// timeout, transport, parse) returns null so the caller uses a scripted line —
// never throws into the tick loop (Rule 10).
// ---------------------------------------------------------------------------

import type { ClaudeResult } from "./types.js";
import { noteProviderFailure } from "../provider-alerts.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const TIMEOUT_MS = 20_000;
const MAX_TOKENS = 500;

interface AnthropicResponse {
  stop_reason?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Single-shot short-text Claude call. The system prompt asks for ONE short,
 * on-voice line; we read the first text block verbatim.
 *
 * Returns {text, model, inputTokens, outputTokens} or null on any failure
 * (the caller then falls back to a scripted persona line, logged source=fallback).
 */
export async function callClaude(
  apiKey: string,
  model: string,
  system: string,
  userText: string,
): Promise<ClaudeResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: userText }],
      }),
    });

    if (!res.ok) {
      // Loud alert (deduped/day) so a usage cap / auth failure can't hide behind
      // the scripted fallback the way it did for 8 days in the 2026-07 incident.
      const bodyText = await res.text().catch(() => "");
      noteProviderFailure({ provider: "anthropic", service: "agent-runner", status: res.status, bodyText });
      return null; // 4xx/5xx → scripted fallback
    }

    const json = (await res.json()) as AnthropicResponse;

    // Safety refusal (HTTP 200, stop_reason "refusal") → fallback.
    if (json.stop_reason === "refusal") return null;

    const block = (json.content ?? []).find(
      (b) => b.type === "text" && typeof b.text === "string",
    );
    const text = block?.text?.trim();
    if (!text) return null;

    return {
      text,
      model,
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
    };
  } catch (err) {
    // AbortError (timeout), network error, JSON parse error → fallback.
    noteProviderFailure({ provider: "anthropic", service: "agent-runner", error: err });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
