// ---------------------------------------------------------------------------
// Watchtower engine adapter — Gemini.
//
// Model: gemini-2.0-flash. Uses the v1beta `generateContent` REST API.
// Env: GEMINI_API_KEY OPTIONAL — if missing, the adapter reports
// `enabled() === false` and the watchtower-monitor skips it without
// crashing the run (this is the documented "skip with warning" path).
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";
import type { EngineAdapter, EngineQuery, EngineResponse } from "./types.js";

const MODEL = "gemini-2.0-flash";
const TIMEOUT_MS = 30_000;

function endpoint(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

export const geminiAdapter: EngineAdapter = {
  id: "gemini",

  enabled(): boolean {
    return !!process.env.GEMINI_API_KEY?.trim();
  },

  async query(q: EngineQuery): Promise<EngineResponse> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const start = Date.now();

    if (!apiKey) {
      return {
        text: "",
        latencyMs: 0,
        ok: false,
        error: "GEMINI_API_KEY missing",
      };
    }

    try {
      const res = await fetch(endpoint(apiKey), {
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
      };
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
      return { text: "", latencyMs, ok: false, error: message };
    }
  },
};
