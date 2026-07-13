// ---------------------------------------------------------------------------
// Watchtower engine adapter — Claude (Anthropic).
//
// Model choice: claude-haiku-4-5. Watchtower asks short Q&A-style prompts
// against a brand. Haiku 4.5 returns the answer pattern we care about
// (positioning sentences, recommendation-style phrasing) at ~1/12th the
// cost of Sonnet 4.5 — cheap enough that we can run all 25 prompts × all
// engines without breaking the $49/mo unit economics. If output quality
// drops we'll switch to Sonnet via WATCHTOWER_CLAUDE_MODEL override.
//
// Reuses the existing fetch() pattern from launch-comment-monitor (no
// shared SDK client elsewhere in the repo as of this commit).
//
// Env: WATCHTOWER_ANTHROPIC_API_KEY required.
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";
import type { EngineAdapter, EngineQuery, EngineResponse } from "./types.js";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 30_000;

export const claudeAdapter: EngineAdapter = {
  id: "claude",

  enabled(): boolean {
    return !!process.env.WATCHTOWER_ANTHROPIC_API_KEY?.trim();
  },

  async query(q: EngineQuery): Promise<EngineResponse> {
    const apiKey = process.env.WATCHTOWER_ANTHROPIC_API_KEY?.trim();
    const model = process.env.WATCHTOWER_CLAUDE_MODEL?.trim() || DEFAULT_MODEL;
    const start = Date.now();

    if (!apiKey) {
      return {
        text: "",
        latencyMs: 0,
        ok: false,
        error: "WATCHTOWER_ANTHROPIC_API_KEY missing",
      };
    }

    try {
      const res = await fetch(ANTHROPIC_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 600,
          messages: [{ role: "user", content: q.prompt }],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        logger.warn(
          { status: res.status, err: errText.slice(0, 200) },
          "watchtower:claude non-2xx",
        );
        return {
          text: "",
          latencyMs,
          ok: false,
          error: `HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as {
        content?: Array<{ type: string; text: string }>;
      };
      const text = data.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim() ?? "";
      return { text, latencyMs, ok: true };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "watchtower:claude threw");
      return { text: "", latencyMs, ok: false, error: message };
    }
  },
};
