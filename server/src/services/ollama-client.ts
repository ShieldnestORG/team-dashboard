/**
 * Shared Ollama client — single source of truth for Ollama API configuration.
 *
 * Supports both self-hosted Ollama and Ollama Cloud API (with bearer auth).
 * All services should import from here instead of duplicating fetch logic.
 *
 * Includes in-memory daily usage tracking (resets at midnight UTC).
 */

import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const OLLAMA_URL = process.env.OLLAMA_URL || "https://ollama.com";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:31b";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";

/** Returns headers with auth if OLLAMA_API_KEY is set. */
export function ollamaHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OLLAMA_API_KEY) {
    headers["Authorization"] = `Bearer ${OLLAMA_API_KEY}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Usage tracking — in-memory daily bucket (resets at midnight UTC)
// ---------------------------------------------------------------------------

interface DailyUsage {
  date: string;                // YYYY-MM-DD UTC
  requests: number;            // total API calls
  inputTokens: number;         // prompt_eval_count sum
  outputTokens: number;        // eval_count sum
  errors: number;              // failed requests
  totalDurationMs: number;     // cumulative response time
  byEndpoint: {
    generate: { requests: number; inputTokens: number; outputTokens: number };
    chat: { requests: number; inputTokens: number; outputTokens: number };
  };
}

function freshUsage(date: string): DailyUsage {
  return {
    date,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    errors: 0,
    totalDurationMs: 0,
    byEndpoint: {
      generate: { requests: 0, inputTokens: 0, outputTokens: 0 },
      chat: { requests: 0, inputTokens: 0, outputTokens: 0 },
    },
  };
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

let daily: DailyUsage = freshUsage(todayUTC());

function ensureToday(): DailyUsage {
  const today = todayUTC();
  if (daily.date !== today) {
    daily = freshUsage(today);
  }
  return daily;
}

function recordUsage(
  endpoint: "generate" | "chat",
  inputTokens: number,
  outputTokens: number,
  durationMs: number,
): void {
  const d = ensureToday();
  d.requests++;
  d.inputTokens += inputTokens;
  d.outputTokens += outputTokens;
  d.totalDurationMs += durationMs;
  d.byEndpoint[endpoint].requests++;
  d.byEndpoint[endpoint].inputTokens += inputTokens;
  d.byEndpoint[endpoint].outputTokens += outputTokens;
}

function recordError(): void {
  ensureToday().errors++;
}

export interface OllamaUsageStats {
  date: string;
  model: string;
  endpoint: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  errors: number;
  avgLatencyMs: number;
  byEndpoint: DailyUsage["byEndpoint"];
}

/** Returns current daily usage stats for the system health API. */
export function getOllamaUsageStats(): OllamaUsageStats {
  const d = ensureToday();
  return {
    date: d.date,
    model: OLLAMA_MODEL,
    endpoint: OLLAMA_URL,
    requests: d.requests,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    totalTokens: d.inputTokens + d.outputTokens,
    errors: d.errors,
    avgLatencyMs: d.requests > 0 ? Math.round(d.totalDurationMs / d.requests) : 0,
    byEndpoint: d.byEndpoint,
  };
}

// ---------------------------------------------------------------------------
// /api/generate — text completion (used by content services)
// ---------------------------------------------------------------------------

export async function callOllamaGenerate(prompt: string): Promise<string> {
  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: ollamaHeaders(),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
      }),
    });
  } catch (err) {
    recordError();
    throw err;
  }

  if (!res.ok) {
    recordError();
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`Ollama error (${res.status}): ${errorText}`);
  }

  const data = await res.json() as {
    response: string;
    prompt_eval_count?: number;
    eval_count?: number;
  };

  recordUsage(
    "generate",
    data.prompt_eval_count || 0,
    data.eval_count || 0,
    Date.now() - start,
  );

  return data.response.trim();
}

// ---------------------------------------------------------------------------
// /api/chat — conversation-style (used by agent adapter)
// ---------------------------------------------------------------------------

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface OllamaChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export async function callOllamaChat(
  messages: OllamaChatMessage[],
  opts: OllamaChatOptions = {},
): Promise<OllamaChatResult> {
  const model = opts.model || OLLAMA_MODEL;
  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: ollamaHeaders(),
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: opts.temperature ?? 0.7,
          num_predict: opts.maxTokens ?? 4096,
        },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000),
    });
  } catch (err) {
    recordError();
    throw err;
  }

  if (!res.ok) {
    recordError();
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`Ollama API error (${res.status}): ${errorText}`);
  }

  const data = await res.json() as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
    model?: string;
  };

  const inputTokens = data.prompt_eval_count || 0;
  const outputTokens = data.eval_count || 0;

  recordUsage("chat", inputTokens, outputTokens, Date.now() - start);

  return {
    content: data.message?.content || "",
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    model: data.model || model,
  };
}

// ---------------------------------------------------------------------------
// /api/tags — list available models (used by adapter + health checks)
// ---------------------------------------------------------------------------

export interface OllamaModelInfo {
  name: string;
  details?: { parameter_size?: string };
}

export async function listOllamaModels(timeoutMs = 8000): Promise<OllamaModelInfo[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      headers: ollamaHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const data = await res.json() as { models?: OllamaModelInfo[] };
      return data.models || [];
    }
  } catch {
    logger.debug("Failed to list Ollama models");
  }
  return [];
}
