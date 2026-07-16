/**
 * Shared Anthropic (Claude API) client — mirrors ollama-client.ts.
 *
 * Raw-fetch Messages API transport (same pattern as compliance-scanner.ts).
 * All services should import from here instead of duplicating fetch logic.
 *
 * Includes in-memory daily usage tracking (resets at midnight UTC).
 */

import { noteProviderFailure } from "./provider-alerts.js";
import { logApiUsage } from "./api-usage.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

/** Default model for content-quality work (marketing copy). Cheap-utility
 *  call sites elsewhere (e.g. compliance-scanner) keep their own haiku defaults. */
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

/** True when a Claude API key is available. */
export function isAnthropicConfigured(): boolean {
  return ANTHROPIC_API_KEY.length > 0;
}

function anthropicHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };
}

// ---------------------------------------------------------------------------
// Health state — tracks last success and consecutive failures for alerting
// ---------------------------------------------------------------------------

export interface AnthropicHealth {
  lastSuccess: Date | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastCheckedAt: Date | null;
}

export const anthropicHealth: AnthropicHealth = {
  lastSuccess: null,
  consecutiveFailures: 0,
  lastError: null,
  lastCheckedAt: null,
};

/** Call after a successful Anthropic API response to reset failure state. */
export function markAnthropicSuccess(): void {
  anthropicHealth.lastSuccess = new Date();
  anthropicHealth.consecutiveFailures = 0;
  anthropicHealth.lastError = null;
  anthropicHealth.lastCheckedAt = new Date();
}

/** Call after a failed Anthropic API request. */
export function markAnthropicFailure(error: string): void {
  anthropicHealth.consecutiveFailures++;
  anthropicHealth.lastError = error;
  anthropicHealth.lastCheckedAt = new Date();
}

// ---------------------------------------------------------------------------
// Usage tracking — in-memory daily bucket (resets at midnight UTC)
// ---------------------------------------------------------------------------

interface DailyUsage {
  date: string;                // YYYY-MM-DD UTC
  requests: number;            // total API calls
  inputTokens: number;         // usage.input_tokens sum
  outputTokens: number;        // usage.output_tokens sum
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

export interface AnthropicUsageStats {
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
export function getAnthropicUsageStats(): AnthropicUsageStats {
  const d = ensureToday();
  return {
    date: d.date,
    model: ANTHROPIC_MODEL,
    endpoint: ANTHROPIC_API_URL,
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
// Messages API transport
// ---------------------------------------------------------------------------

interface AnthropicMessagesResponse {
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function callMessagesApi(
  endpoint: "generate" | "chat",
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<AnthropicMessagesResponse> {
  if (!isAnthropicConfigured()) {
    const msg = "Anthropic API is not configured (ANTHROPIC_API_KEY missing)";
    recordError();
    markAnthropicFailure(msg);
    throw new Error(msg);
  }

  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: anthropicHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    recordError();
    markAnthropicFailure(err instanceof Error ? err.message : String(err));
    noteProviderFailure({ provider: "anthropic", service: "anthropic-client", error: err });
    throw err;
  }

  if (!res.ok) {
    recordError();
    const errorText = await res.text().catch(() => "Unknown error");
    const msg = `Anthropic API error (${res.status}): ${errorText.slice(0, 300)}`;
    markAnthropicFailure(msg);
    noteProviderFailure({ provider: "anthropic", service: "anthropic-client", status: res.status, bodyText: errorText });
    throw new Error(msg);
  }

  const data = await res.json() as AnthropicMessagesResponse;

  recordUsage(
    endpoint,
    data.usage?.input_tokens || 0,
    data.usage?.output_tokens || 0,
    Date.now() - start,
  );
  void logApiUsage({
    provider: "anthropic",
    service: "anthropic-client",
    model: data.model || String(body.model ?? ""),
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  });

  markAnthropicSuccess();
  return data;
}

function extractText(data: AnthropicMessagesResponse): string {
  return (data.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

// ---------------------------------------------------------------------------
// Generate — single-prompt completion (parallel to callOllamaGenerate)
// ---------------------------------------------------------------------------

export interface AnthropicGenerateOptions {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function callAnthropicGenerate(
  prompt: string,
  opts: AnthropicGenerateOptions = {},
): Promise<string> {
  const data = await callMessagesApi(
    "generate",
    {
      model: opts.model || ANTHROPIC_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      messages: [{ role: "user", content: prompt }],
    },
    opts.timeoutMs ?? 300_000,
  );
  return extractText(data).trim();
}

// ---------------------------------------------------------------------------
// Chat — conversation-style (parallel to callOllamaChat)
// ---------------------------------------------------------------------------

export interface AnthropicChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AnthropicChatOptions {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AnthropicChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export async function callAnthropicChat(
  messages: AnthropicChatMessage[],
  opts: AnthropicChatOptions = {},
): Promise<AnthropicChatResult> {
  const model = opts.model || ANTHROPIC_MODEL;

  // The Messages API takes system prompts as a top-level param, not a message role.
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: chatMessages.length > 0
      ? chatMessages
      : [{ role: "user", content: systemText }],
  };
  if (systemText && chatMessages.length > 0) {
    body.system = systemText;
  }

  const data = await callMessagesApi("chat", body, opts.timeoutMs ?? 300_000);

  return {
    content: extractText(data),
    promptTokens: data.usage?.input_tokens || 0,
    completionTokens: data.usage?.output_tokens || 0,
    model: data.model || model,
  };
}
