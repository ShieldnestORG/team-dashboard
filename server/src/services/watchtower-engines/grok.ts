// ---------------------------------------------------------------------------
// Watchtower engine adapter — Grok (xAI).
//
// Model: grok-4.20-0309-non-reasoning (xAI's current cheap, fast text model;
// v1 doesn't need live search, vision, or reasoning — we just want what the
// model says about the brand, and the non-reasoning variant avoids the
// reasoning-token cost/latency that risks the 30s timeout). The old
// grok-2-1212 was retired by xAI and 400'd ("Model not found"). Override with
// WATCHTOWER_GROK_MODEL (e.g. grok-4.3) without a redeploy.
// Env: WATCHTOWER_GROK_API_KEY required; WATCHTOWER_GROK_MODEL optional.
// API: OpenAI-compatible chat/completions surface, so the request/response
// shape mirrors the chatgpt adapter exactly.
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";
import { noteProviderFailure } from "../provider-alerts.js";
import { logApiUsage } from "../api-usage.js";
import type { EngineAdapter, EngineQuery, EngineResponse } from "./types.js";

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "grok-4.20-0309-non-reasoning";
const TIMEOUT_MS = 30_000;

export const grokAdapter: EngineAdapter = {
  id: "grok",

  enabled(): boolean {
    return !!process.env.WATCHTOWER_GROK_API_KEY?.trim();
  },

  async query(q: EngineQuery): Promise<EngineResponse> {
    const apiKey = process.env.WATCHTOWER_GROK_API_KEY?.trim();
    const model = process.env.WATCHTOWER_GROK_MODEL?.trim() || DEFAULT_MODEL;
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
          model,
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
        noteProviderFailure({
          provider: "xai",
          service: "watchtower:grok",
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
        provider: "xai",
        service: "watchtower:grok",
        model,
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      });
      const text = data.choices?.[0]?.message?.content ?? "";
      return { text, latencyMs, ok: true };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "watchtower:grok threw");
      noteProviderFailure({
        provider: "xai",
        service: "watchtower:grok",
        error: err,
      });
      return { text: "", latencyMs, ok: false, error: message };
    }
  },
};
