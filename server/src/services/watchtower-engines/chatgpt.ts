// ---------------------------------------------------------------------------
// Watchtower engine adapter — ChatGPT (OpenAI).
//
// Model: gpt-4o-mini (cost-optimized; v1 doesn't need Responses API or
// browsing — we just want what the model says about the brand).
// Env: WATCHTOWER_OPENAI_API_KEY required.
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";
import { noteProviderFailure } from "../provider-alerts.js";
import { logApiUsage } from "../api-usage.js";
import type { EngineAdapter, EngineQuery, EngineResponse } from "./types.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 30_000;

export const chatgptAdapter: EngineAdapter = {
  id: "chatgpt",

  enabled(): boolean {
    return !!process.env.WATCHTOWER_OPENAI_API_KEY?.trim();
  },

  async query(q: EngineQuery): Promise<EngineResponse> {
    const apiKey = process.env.WATCHTOWER_OPENAI_API_KEY?.trim();
    const start = Date.now();
    if (!apiKey) {
      return {
        text: "",
        latencyMs: 0,
        ok: false,
        error: "WATCHTOWER_OPENAI_API_KEY missing",
      };
    }

    try {
      const res = await fetch(OPENAI_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: q.prompt }],
          // Keep it short — Watchtower only needs enough text to substring-
          // match a brand and capture a snippet.
          max_tokens: 600,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        logger.warn(
          { status: res.status, err: errText.slice(0, 200) },
          "watchtower:chatgpt non-2xx",
        );
        noteProviderFailure({
          provider: "openai",
          service: "watchtower:openai",
          status: res.status,
          bodyText: errText,
        });
        return {
          text: "",
          latencyMs,
          ok: false,
          error: `HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      void logApiUsage({
        provider: "openai",
        service: "watchtower:openai",
        model: MODEL,
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      });
      const text = data.choices?.[0]?.message?.content ?? "";
      return { text, latencyMs, ok: true };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "watchtower:chatgpt threw");
      noteProviderFailure({
        provider: "openai",
        service: "watchtower:openai",
        error: err,
      });
      return { text: "", latencyMs, ok: false, error: message };
    }
  },
};
