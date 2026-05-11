// ---------------------------------------------------------------------------
// Watchtower engine adapter — Grok (xAI).
//
// Model: grok-2-1212 (xAI's cheap flagship; v1 doesn't need live search or
// vision — we just want what the model says about the brand).
// Env: WATCHTOWER_GROK_API_KEY required.
// API: OpenAI-compatible chat/completions surface, so the request/response
// shape mirrors the chatgpt adapter exactly.
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";
import type { EngineAdapter, EngineQuery, EngineResponse } from "./types.js";

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const MODEL = "grok-2-1212";
const TIMEOUT_MS = 30_000;

export const grokAdapter: EngineAdapter = {
  id: "grok",

  enabled(): boolean {
    return !!process.env.WATCHTOWER_GROK_API_KEY?.trim();
  },

  async query(q: EngineQuery): Promise<EngineResponse> {
    const apiKey = process.env.WATCHTOWER_GROK_API_KEY?.trim();
    const start = Date.now();
    if (!apiKey) {
      return {
        text: "",
        latencyMs: 0,
        ok: false,
        error: "WATCHTOWER_GROK_API_KEY missing",
      };
    }

    try {
      const res = await fetch(XAI_ENDPOINT, {
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
          "watchtower:grok non-2xx",
        );
        return {
          text: "",
          latencyMs,
          ok: false,
          error: `HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      return { text, latencyMs, ok: true };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "watchtower:grok threw");
      return { text: "", latencyMs, ok: false, error: message };
    }
  },
};
