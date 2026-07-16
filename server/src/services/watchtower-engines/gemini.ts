// ---------------------------------------------------------------------------
// Watchtower engine adapter — Gemini.
//
// Model: gemini-2.5-flash. Uses the v1beta `generateContent` REST API.
// gemini-2.0-flash was dropped from Google's free tier (the API now returns
// 429 "limit: 0" for generate_content_free_tier_requests on that model);
// gemini-2.5-flash is still free-tier eligible and works on the same key.
// Override with WATCHTOWER_GEMINI_MODEL without a redeploy.
// Env: WATCHTOWER_GEMINI_API_KEY OPTIONAL — if missing, the adapter reports
// `enabled() === false` and the watchtower-monitor skips it without
// crashing the run (this is the documented "skip with warning" path).
// WATCHTOWER_GEMINI_MODEL OPTIONAL — overrides the default model.
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";
import { noteProviderFailure } from "../provider-alerts.js";
import { logApiUsage } from "../api-usage.js";
import type { EngineAdapter, EngineQuery, EngineResponse } from "./types.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 30_000;

function resolveModel(): string {
  return process.env.WATCHTOWER_GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

function endpoint(apiKey: string, model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

export const geminiAdapter: EngineAdapter = {
  id: "gemini",

  enabled(): boolean {
    return !!process.env.WATCHTOWER_GEMINI_API_KEY?.trim();
  },

  async query(q: EngineQuery): Promise<EngineResponse> {
    const apiKey = process.env.WATCHTOWER_GEMINI_API_KEY?.trim();
    const model = resolveModel();
    const start = Date.now();

    if (!apiKey) {
      return {
        text: "",
        latencyMs: 0,
        ok: false,
        error: "WATCHTOWER_GEMINI_API_KEY missing",
      };
    }

    try {
      const res = await fetch(endpoint(apiKey, model), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: q.prompt }] }],
          generationConfig: { maxOutputTokens: 600, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        logger.warn(
          { status: res.status, err: errText.slice(0, 200) },
          "watchtower:gemini non-2xx",
        );
        noteProviderFailure({
          provider: "gemini",
          service: "watchtower:gemini",
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
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      void logApiUsage({
        provider: "gemini",
        service: "watchtower:gemini",
        model,
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      });
      const text =
        data.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? "")
          .join("")
          .trim() ?? "";
      return { text, latencyMs, ok: true };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "watchtower:gemini threw");
      noteProviderFailure({
        provider: "gemini",
        service: "watchtower:gemini",
        error: err,
      });
      return { text: "", latencyMs, ok: false, error: message };
    }
  },
};
