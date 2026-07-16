// ---------------------------------------------------------------------------
// Coherent Ones University — LLM wrapper for the agent runner.
//
// Primary: Anthropic /v1/messages (ports the prototype chat_ai.py call).
// Fallback: free Ollama Cloud (gemma4:31b) when Anthropic FAILS to respond
//   (HTTP error / network / timeout / parse) — added 2026-07-15 so a provider
//   cap or outage degrades to a real model instead of the room going dark.
//   A safety REFUSAL is NOT eligible for fallback (never launder a refusal
//   through a weaker model). On any failure this still returns null so the
//   caller uses a scripted line — never throws into the tick loop (Rule 10).
//
// Every Anthropic failure is also routed to noteProviderFailure (loud alert).
// The returned ClaudeResult.model reflects who actually served the call
// (e.g. "ollama:gemma4:31b"), so usage/cost logging is truthful.
// ---------------------------------------------------------------------------

import type { ClaudeResult } from "./types.js";
import { noteProviderFailure } from "../provider-alerts.js";
import { callOllamaChat, OLLAMA_MODEL } from "../ollama-client.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const TIMEOUT_MS = 20_000;
const MAX_TOKENS = 500;

// Default ON; set AGENT_OLLAMA_FALLBACK=false to disable the degrade-to-Ollama tier.
const OLLAMA_FALLBACK_ENABLED = process.env.AGENT_OLLAMA_FALLBACK !== "false";

interface AnthropicResponse {
  stop_reason?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

type AnthropicOutcome =
  | { kind: "ok"; result: ClaudeResult }
  | { kind: "refused" } // safety refusal — do NOT fall back to a weaker model
  | { kind: "failed" }; // HTTP/network/timeout/parse — eligible for Ollama fallback

/**
 * Public entry: try Anthropic, and on a genuine FAILURE (not a refusal) degrade
 * to the free Ollama fallback. Returns null only when both tiers fail or the
 * primary refused (→ caller uses a scripted line / stays silent).
 */
export async function callClaude(
  apiKey: string,
  model: string,
  system: string,
  userText: string,
): Promise<ClaudeResult | null> {
  const outcome = await attemptAnthropic(apiKey, model, system, userText);
  if (outcome.kind === "ok") return outcome.result;
  if (outcome.kind === "refused") return null; // respect the refusal — no fallback
  if (!OLLAMA_FALLBACK_ENABLED) return null;
  return attemptOllamaFallback(system, userText);
}

async function attemptAnthropic(
  apiKey: string,
  model: string,
  system: string,
  userText: string,
): Promise<AnthropicOutcome> {
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
        // Sonnet 5 runs ADAPTIVE thinking when `thinking` is omitted — for a
        // 500-token community reply that silently burns the output budget on
        // reasoning (risking truncated/empty text → pointless fallback).
        // Disable it explicitly; on the older allowed models omitted = off,
        // so only sonnet-5 needs the field (and e.g. haiku would reject it).
        ...(model === "claude-sonnet-5" ? { thinking: { type: "disabled" } } : {}),
      }),
    });

    if (!res.ok) {
      // Loud alert (deduped/day) so a usage cap / auth failure can't hide behind
      // the fallback the way it did for 8 days in the 2026-07 incident.
      const bodyText = await res.text().catch(() => "");
      noteProviderFailure({ provider: "anthropic", service: "agent-runner", status: res.status, bodyText });
      return { kind: "failed" };
    }

    const json = (await res.json()) as AnthropicResponse;

    // Safety refusal (HTTP 200, stop_reason "refusal") → no fallback.
    if (json.stop_reason === "refusal") return { kind: "refused" };

    const block = (json.content ?? []).find(
      (b) => b.type === "text" && typeof b.text === "string",
    );
    const text = block?.text?.trim();
    if (!text) return { kind: "failed" };

    return {
      kind: "ok",
      result: {
        text,
        model,
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      },
    };
  } catch (err) {
    // AbortError (timeout), network error, JSON parse error → eligible for fallback.
    noteProviderFailure({ provider: "anthropic", service: "agent-runner", error: err });
    return { kind: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function attemptOllamaFallback(
  system: string,
  userText: string,
): Promise<ClaudeResult | null> {
  try {
    const r = await callOllamaChat(
      [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
      { model: OLLAMA_MODEL, maxTokens: MAX_TOKENS, temperature: 0.7, timeoutMs: TIMEOUT_MS },
    );
    const text = stripAssistantPreamble(r.content);
    if (!text) return null;
    // Prefix so usage/cost logging shows the fallback provider (priced at $0 —
    // gemma4:31b is not in the Claude price map, so costUsd() returns 0).
    return {
      text,
      model: `ollama:${r.model}`,
      inputTokens: r.promptTokens,
      outputTokens: r.completionTokens,
    };
  } catch (err) {
    // Both tiers down → caller uses a scripted line / stays silent.
    noteProviderFailure({ provider: "ollama", service: "agent-runner", error: err });
    return null;
  }
}

/**
 * Trim the "assistant preamble" open models (gemma) tend to add — a leading
 * "Here are a few options:" line and wrapping ``` code fences — so a fallback
 * post reads like a member, not a chat assistant. Conservative: only strips an
 * obvious short lead-in line and surrounding fences.
 */
export function stripAssistantPreamble(raw: string): string {
  let t = raw.trim();
  const fence = t.match(/^```[a-z]*\s*\n([\s\S]*?)\n```$/i);
  if (fence) t = fence[1].trim();
  const nl = t.indexOf("\n");
  if (nl > 0) {
    const first = t.slice(0, nl).trim();
    if (first.length < 80 && /^(here (are|is|'?s)|sure|certainly|of course|absolutely)\b.*:?\s*$/i.test(first)) {
      t = t.slice(nl + 1).trim();
    }
  }
  return t.trim();
}
