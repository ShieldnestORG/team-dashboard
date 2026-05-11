// ---------------------------------------------------------------------------
// Watchtower engine adapter tests — mocked global fetch, no live API calls.
// Covers the five v1 engines: enabled() guard + happy-path response shape
// + non-2xx error path returning ok=false instead of throwing.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatgptAdapter } from "../services/watchtower-engines/chatgpt.js";
import { claudeAdapter } from "../services/watchtower-engines/claude.js";
import { perplexityAdapter } from "../services/watchtower-engines/perplexity.js";
import { geminiAdapter } from "../services/watchtower-engines/gemini.js";
import { grokAdapter } from "../services/watchtower-engines/grok.js";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Wipe the keys we care about so each test sets exactly what it needs.
  delete process.env.WATCHTOWER_OPENAI_API_KEY;
  delete process.env.WATCHTOWER_ANTHROPIC_API_KEY;
  delete process.env.WATCHTOWER_PERPLEXITY_API_KEY;
  delete process.env.WATCHTOWER_GEMINI_API_KEY;
  delete process.env.WATCHTOWER_GROK_API_KEY;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

function mockFetchOnce(body: unknown, status = 200): void {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("chatgpt adapter", () => {
  it("enabled() reflects WATCHTOWER_OPENAI_API_KEY presence", () => {
    expect(chatgptAdapter.enabled()).toBe(false);
    process.env.WATCHTOWER_OPENAI_API_KEY = "sk-test";
    expect(chatgptAdapter.enabled()).toBe(true);
  });

  it("returns parsed text on 200", async () => {
    process.env.WATCHTOWER_OPENAI_API_KEY = "sk-test";
    mockFetchOnce({
      choices: [{ message: { content: "watchtower works" } }],
    });
    const r = await chatgptAdapter.query({ prompt: "hi" });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("watchtower works");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns ok=false on non-2xx without throwing", async () => {
    process.env.WATCHTOWER_OPENAI_API_KEY = "sk-test";
    mockFetchOnce({ error: "boom" }, 500);
    const r = await chatgptAdapter.query({ prompt: "hi" });
    expect(r.ok).toBe(false);
    expect(r.text).toBe("");
    expect(r.error).toContain("HTTP 500");
  });

  it("returns ok=false when key missing (no fetch attempted)", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const r = await chatgptAdapter.query({ prompt: "hi" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("WATCHTOWER_OPENAI_API_KEY missing");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("claude adapter", () => {
  it("enabled() reflects WATCHTOWER_ANTHROPIC_API_KEY presence", () => {
    expect(claudeAdapter.enabled()).toBe(false);
    process.env.WATCHTOWER_ANTHROPIC_API_KEY = "sk-ant";
    expect(claudeAdapter.enabled()).toBe(true);
  });

  it("joins multi-block text content on 200", async () => {
    process.env.WATCHTOWER_ANTHROPIC_API_KEY = "sk-ant";
    mockFetchOnce({
      content: [
        { type: "text", text: "first block." },
        { type: "text", text: "second block." },
      ],
    });
    const r = await claudeAdapter.query({ prompt: "hi" });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("first block.");
    expect(r.text).toContain("second block.");
  });

  it("returns ok=false on non-2xx", async () => {
    process.env.WATCHTOWER_ANTHROPIC_API_KEY = "sk-ant";
    mockFetchOnce({ error: "rate" }, 429);
    const r = await claudeAdapter.query({ prompt: "hi" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("HTTP 429");
  });
});

describe("perplexity adapter", () => {
  it("enabled() reflects WATCHTOWER_PERPLEXITY_API_KEY presence", () => {
    expect(perplexityAdapter.enabled()).toBe(false);
    process.env.WATCHTOWER_PERPLEXITY_API_KEY = "pplx";
    expect(perplexityAdapter.enabled()).toBe(true);
  });

  it("returns choices[0].message.content on 200", async () => {
    process.env.WATCHTOWER_PERPLEXITY_API_KEY = "pplx";
    mockFetchOnce({
      choices: [{ message: { content: "answer text" } }],
    });
    const r = await perplexityAdapter.query({ prompt: "hi" });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("answer text");
  });
});

describe("gemini adapter", () => {
  it("enabled() reflects WATCHTOWER_GEMINI_API_KEY presence", () => {
    expect(geminiAdapter.enabled()).toBe(false);
    process.env.WATCHTOWER_GEMINI_API_KEY = "gem";
    expect(geminiAdapter.enabled()).toBe(true);
  });

  it("returns concatenated parts text on 200", async () => {
    process.env.WATCHTOWER_GEMINI_API_KEY = "gem";
    mockFetchOnce({
      candidates: [
        {
          content: {
            parts: [{ text: "part one " }, { text: "part two" }],
          },
        },
      ],
    });
    const r = await geminiAdapter.query({ prompt: "hi" });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("part one part two");
  });

  it("when WATCHTOWER_GEMINI_API_KEY missing, enabled() is false (skip path)", () => {
    expect(geminiAdapter.enabled()).toBe(false);
  });
});

describe("grok adapter", () => {
  it("enabled() reflects WATCHTOWER_GROK_API_KEY presence", () => {
    expect(grokAdapter.enabled()).toBe(false);
    process.env.WATCHTOWER_GROK_API_KEY = "xai-test";
    expect(grokAdapter.enabled()).toBe(true);
  });

  it("returns parsed text on 200", async () => {
    process.env.WATCHTOWER_GROK_API_KEY = "xai-test";
    mockFetchOnce({
      choices: [{ message: { content: "watchtower works" } }],
    });
    const r = await grokAdapter.query({ prompt: "hi" });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("watchtower works");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns ok=false on non-2xx without throwing", async () => {
    process.env.WATCHTOWER_GROK_API_KEY = "xai-test";
    mockFetchOnce({ error: "boom" }, 500);
    const r = await grokAdapter.query({ prompt: "hi" });
    expect(r.ok).toBe(false);
    expect(r.text).toBe("");
    expect(r.error).toContain("HTTP 500");
  });

  it("returns ok=false when key missing (no fetch attempted)", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const r = await grokAdapter.query({ prompt: "hi" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("WATCHTOWER_GROK_API_KEY missing");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
