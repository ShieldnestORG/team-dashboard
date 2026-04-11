/**
 * Shared Ollama client — single source of truth for Ollama API configuration.
 *
 * Supports both self-hosted Ollama and Ollama Cloud API (with bearer auth).
 * All services should import from here instead of duplicating fetch logic.
 */

import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const OLLAMA_URL = process.env.OLLAMA_URL || "https://ollama.com/api";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:31b-cloud";
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
// /api/generate — text completion (used by content services)
// ---------------------------------------------------------------------------

export async function callOllamaGenerate(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: ollamaHeaders(),
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`Ollama error (${res.status}): ${errorText}`);
  }

  const data = await res.json() as { response: string };
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
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
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

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`Ollama API error (${res.status}): ${errorText}`);
  }

  const data = await res.json() as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
    model?: string;
  };

  return {
    content: data.message?.content || "",
    promptTokens: data.prompt_eval_count || 0,
    completionTokens: data.eval_count || 0,
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
