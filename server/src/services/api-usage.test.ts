// ---------------------------------------------------------------------------
// api-usage — success-path token/cost meter (Phase 2 of provider
// observability). Proves: Anthropic prices come from the shared agent-runner
// map (incl. dated model ids), everything unpriced is token-metered at $0
// with ONE warn per model per process, logApiUsage never throws, and a real
// instrumented call site (watchtower:claude) writes a usage row on success.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";

vi.mock("../middleware/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from "../middleware/logger.js";
import {
  _resetApiUsageForTests,
  computeCostUsd,
  logApiUsage,
  setApiUsageDb,
} from "./api-usage.js";

function fakeDb(rows: Array<Record<string, unknown>>, failWith?: Error): Db {
  return {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        if (failWith) return Promise.reject(failWith);
        rows.push(row);
        return Promise.resolve();
      },
    }),
  } as unknown as Db;
}

beforeEach(() => {
  _resetApiUsageForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("computeCostUsd", () => {
  it("prices Anthropic models from the shared agent-runner map", () => {
    // haiku-4-5: $1/$5 per Mtok
    expect(computeCostUsd("anthropic", "claude-haiku-4-5", 1_000_000, 1_000_000)).toBe(6);
    // sonnet-5: $3/$15 per Mtok
    expect(computeCostUsd("anthropic", "claude-sonnet-5", 500_000, 100_000)).toBe(3);
    // opus-4-8: $5/$25 per Mtok
    expect(computeCostUsd("anthropic", "claude-opus-4-8", 200_000, 40_000)).toBe(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("strips a date suffix from Anthropic model ids before the price lookup", () => {
    // The prod ANTHROPIC_MODEL default is dated (claude-haiku-4-5-20251001);
    // it is the same verified-price model, not an unknown.
    expect(computeCostUsd("anthropic", "claude-haiku-4-5-20251001", 1_000_000, 0)).toBe(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("prices ollama:* models at $0 without warning (free tier)", () => {
    expect(computeCostUsd("ollama", "ollama:gemma4:31b", 1_000_000, 1_000_000)).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("prices unknown models at $0 and warns ONCE per model per process", () => {
    expect(computeCostUsd("openai", "gpt-4o-mini", 1_000_000, 1_000_000)).toBe(0);
    expect(computeCostUsd("openai", "gpt-4o-mini", 500, 500)).toBe(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // A different unknown model gets its own single warn.
    expect(computeCostUsd("perplexity", "sonar", 100, 100)).toBe(0);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});

describe("logApiUsage", () => {
  it("inserts one row with tokens and the computed cost", async () => {
    const rows: Array<Record<string, unknown>> = [];
    setApiUsageDb(fakeDb(rows));

    await logApiUsage({
      provider: "anthropic",
      service: "seo-engine",
      model: "claude-haiku-4-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(rows).toEqual([
      {
        provider: "anthropic",
        service: "seo-engine",
        model: "claude-haiku-4-5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        costUsd: "6.000000",
      },
    ]);
  });

  it("NEVER rejects — a failed insert only warns", async () => {
    setApiUsageDb(fakeDb([], new Error("db down")));
    await expect(
      logApiUsage({
        provider: "xai",
        service: "youtube-tts",
        model: "grok-tts",
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("drops the event silently when no DB handle is set (pre-boot)", async () => {
    await expect(
      logApiUsage({
        provider: "anthropic",
        service: "anthropic-client",
        model: "claude-sonnet-5",
        inputTokens: 10,
        outputTokens: 10,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("success-path instrumentation (watchtower:claude)", () => {
  it("a successful mocked engine call writes a usage row", async () => {
    vi.stubEnv("WATCHTOWER_ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "brand answer" }],
          usage: { input_tokens: 11, output_tokens: 7 },
        }),
      })),
    );
    const rows: Array<Record<string, unknown>> = [];
    setApiUsageDb(fakeDb(rows));

    const { claudeAdapter } = await import("./watchtower-engines/claude.js");
    const res = await claudeAdapter.query({ prompt: "what is Coherence Daddy?" });
    expect(res.ok).toBe(true);

    // logApiUsage is fire-and-forget at the call site — flush the microtask.
    await new Promise((resolve) => setImmediate(resolve));

    expect(rows).toEqual([
      {
        provider: "anthropic",
        service: "watchtower:claude",
        model: "claude-haiku-4-5",
        inputTokens: 11,
        outputTokens: 7,
        costUsd: "0.000046", // 11/1M * $1 + 7/1M * $5
      },
    ]);
  });
});
