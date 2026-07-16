/**
 * LLM provider router — user-switchable Ollama ↔ Claude API for content creation.
 *
 * Resolution order for the provider:
 *   1. explicit opts.provider (per-call override)
 *   2. instance setting `contentLlmProvider` (admin UI → Instance Settings → General)
 *   3. "ollama" (default)
 *
 * On primary-provider failure the call automatically falls back to the other
 * provider (same pattern as compliance-scanner's askOllama → askClaude), since
 * either side can be down independently. If the fallback provider is not
 * configured, the primary's error is rethrown. The result always reports which
 * provider + model actually served the call so callers can record it.
 *
 * The instance setting `contentLlmModel` (optional) overrides the model for the
 * provider selected by settings/default. It is NOT applied to the fallback
 * provider (model names are provider-specific); fallback uses that provider's
 * default model. A per-call opts.model behaves the same way.
 */

import { logger } from "../middleware/logger.js";
import { logApiUsage } from "./api-usage.js";
import {
  callAnthropicChat,
  callAnthropicGenerate,
  isAnthropicConfigured,
  ANTHROPIC_MODEL,
} from "./anthropic-client.js";
import {
  callOllamaChat,
  callOllamaGenerate,
  OLLAMA_MODEL,
  type OllamaChatMessage,
} from "./ollama-client.js";

export type LlmProvider = "ollama" | "claude";

// ---------------------------------------------------------------------------
// Settings access — provider registered at boot (app.ts), cached briefly so
// content generation doesn't hit the DB on every call.
// ---------------------------------------------------------------------------

export interface ContentLlmSettings {
  contentLlmProvider?: LlmProvider;
  contentLlmModel?: string;
}

type SettingsGetter = () => Promise<ContentLlmSettings>;

const SETTINGS_CACHE_TTL_MS = 30_000;

let settingsGetter: SettingsGetter | null = null;
let cachedSettings: ContentLlmSettings | null = null;
let cachedAt = 0;

/**
 * Register the instance-settings reader (called once at boot with
 * `() => instanceSettingsService(db).getGeneral()`). Passing null clears it
 * (tests). Also resets the settings cache.
 */
export function configureLlmSettingsProvider(getter: SettingsGetter | null): void {
  settingsGetter = getter;
  cachedSettings = null;
  cachedAt = 0;
}

/**
 * Drop the cached instance settings so the next content call re-reads them from
 * the DB. Call this whenever the content-LLM settings are written, so an admin's
 * provider/model flip takes effect immediately instead of up to
 * SETTINGS_CACHE_TTL_MS later. instance-settings.updateGeneral() invokes this;
 * the dependency runs one way (instance-settings → llm-client), no cycle.
 */
export function invalidateLlmSettingsCache(): void {
  cachedSettings = null;
  cachedAt = 0;
}

async function getContentLlmSettings(): Promise<ContentLlmSettings> {
  if (!settingsGetter) return {};
  const now = Date.now();
  if (cachedSettings && now - cachedAt < SETTINGS_CACHE_TTL_MS) {
    return cachedSettings;
  }
  try {
    cachedSettings = await settingsGetter();
    cachedAt = now;
    return cachedSettings;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "llm-client: failed to read instance settings — defaulting to ollama",
    );
    return cachedSettings ?? {};
  }
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

export interface LlmCallOptions {
  /** Per-call provider override — wins over the instance setting. */
  provider?: LlmProvider;
  /** Per-call model override — applied to the selected provider only. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

function isProviderConfigured(provider: LlmProvider): boolean {
  if (provider === "claude") return isAnthropicConfigured();
  // Ollama has baked-in defaults (OLLAMA_URL falls back to https://ollama.com),
  // but treat it as configured only when the operator set something explicitly —
  // the cloud default is unusable without an API key anyway.
  return Boolean(process.env.OLLAMA_URL || process.env.OLLAMA_API_KEY);
}

function otherProvider(provider: LlmProvider): LlmProvider {
  return provider === "ollama" ? "claude" : "ollama";
}

function defaultModel(provider: LlmProvider): string {
  return provider === "claude" ? ANTHROPIC_MODEL : OLLAMA_MODEL;
}

async function resolveCall(opts: LlmCallOptions): Promise<{
  primary: LlmProvider;
  model: string | undefined;
}> {
  if (opts.provider) {
    return { primary: opts.provider, model: opts.model };
  }
  const settings = await getContentLlmSettings();
  return {
    primary: settings.contentLlmProvider ?? "ollama",
    model: opts.model ?? settings.contentLlmModel,
  };
}

// ---------------------------------------------------------------------------
// Generate — single-prompt completion
// ---------------------------------------------------------------------------

export interface LlmGenerateResult {
  text: string;
  provider: LlmProvider;
  model: string;
}

async function generateWith(
  provider: LlmProvider,
  prompt: string,
  model: string | undefined,
  opts: LlmCallOptions,
): Promise<LlmGenerateResult> {
  if (provider === "claude") {
    const text = await callAnthropicGenerate(prompt, {
      model,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
    });
    return { text, provider, model: model || defaultModel("claude") };
  }
  const text = await callOllamaGenerate(prompt, { model, timeoutMs: opts.timeoutMs });
  const resolvedModel = model || defaultModel("ollama");
  // Free tier — the ollama: prefix prices at $0; logged so the rollup counts
  // call volume on the content path (generate returns no token usage).
  void logApiUsage({
    provider: "ollama",
    service: "llm-client",
    model: `ollama:${resolvedModel}`,
    inputTokens: 0,
    outputTokens: 0,
  });
  return { text, provider, model: resolvedModel };
}

export async function callLlmGenerate(
  prompt: string,
  opts: LlmCallOptions = {},
): Promise<LlmGenerateResult> {
  const { primary, model } = await resolveCall(opts);
  try {
    return await generateWith(primary, prompt, model, opts);
  } catch (primaryErr) {
    const fallback = otherProvider(primary);
    if (!isProviderConfigured(fallback)) {
      throw primaryErr;
    }
    logger.warn(
      {
        err: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
        primary,
        fallback,
      },
      "llm-client: primary provider failed — falling back",
    );
    // Fallback runs on its own default model — contentLlmModel/opts.model are
    // provider-specific and would be invalid on the other side.
    return generateWith(fallback, prompt, undefined, opts);
  }
}

// ---------------------------------------------------------------------------
// Chat — conversation-style
// ---------------------------------------------------------------------------

export type LlmChatMessage = OllamaChatMessage;

export interface LlmChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  provider: LlmProvider;
}

async function chatWith(
  provider: LlmProvider,
  messages: LlmChatMessage[],
  model: string | undefined,
  opts: LlmCallOptions,
): Promise<LlmChatResult> {
  if (provider === "claude") {
    // temperature intentionally not forwarded — current Claude models reject
    // non-default sampling params.
    const result = await callAnthropicChat(messages, {
      model,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
    });
    return { ...result, provider };
  }
  const result = await callOllamaChat(messages, {
    model,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
  });
  // Free tier — $0 via the ollama: prefix; chat DOES return token counts.
  // (agent-runner calls callOllamaChat directly and has its own ledger — this
  // site only sees content-path traffic, so there is no double count.)
  void logApiUsage({
    provider: "ollama",
    service: "llm-client",
    model: `ollama:${result.model}`,
    inputTokens: result.promptTokens ?? 0,
    outputTokens: result.completionTokens ?? 0,
  });
  return { ...result, provider };
}

export async function callLlmChat(
  messages: LlmChatMessage[],
  opts: LlmCallOptions = {},
): Promise<LlmChatResult> {
  const { primary, model } = await resolveCall(opts);
  try {
    return await chatWith(primary, messages, model, opts);
  } catch (primaryErr) {
    const fallback = otherProvider(primary);
    if (!isProviderConfigured(fallback)) {
      throw primaryErr;
    }
    logger.warn(
      {
        err: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
        primary,
        fallback,
      },
      "llm-client: primary provider failed — falling back",
    );
    return chatWith(fallback, messages, undefined, opts);
  }
}
