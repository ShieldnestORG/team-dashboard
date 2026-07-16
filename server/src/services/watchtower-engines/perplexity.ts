// ---------------------------------------------------------------------------
// Watchtower engine adapter — Perplexity.
//
// Model: `sonar` — Perplexity's cheapest answer-engine model. We use chat
// completions API (OpenAI-compatible) at api.perplexity.ai.
// Env: WATCHTOWER_PERPLEXITY_API_KEY required.
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";
import { noteProviderFailure } from "../provider-alerts.js";
import type { EngineAdapter, EngineQuery, EngineResponse } from "./types.js";

const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";
const MODEL = "sonar";
const TIMEOUT_MS = 30_000;

export const perplexityAdapter: EngineAdapter = {
  id: "perplexity",

  enabled(): boolean {
    return !!process.env.WATCHTOWER_PERPLEXITY_API_KEY?.trim();
  },

  async query(q: EngineQuery): Promise<EngineResponse> {
    const apiKey = process.env.WATCHTOWER_PERPLEXITY_API_KEY?.trim();
    const start = Date.now();

    if (!apiKey) {
      return {
        text: "",
        latencyMs: 0,
        ok: false,
        error: "WATCHTOWER_PERPLEXITY_API_KEY missing",
      };
    }

    try {
      const res = await fetch(PERPLEXITY_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: q.prompt }],
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
          "watchtower:perplexity non-2xx",
        );
        noteProviderFailure({
          provider: "perplexity",
          service: "watchtower:perplexity",
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
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      return { text, latencyMs, ok: true };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "watchtower:perplexity threw");
      noteProviderFailure({
        provider: "perplexity",
        service: "watchtower:perplexity",
        error: err,
      });
      return { text: "", latencyMs, ok: false, error: message };
    }
  },
};
