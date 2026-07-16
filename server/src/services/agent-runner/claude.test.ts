// ---------------------------------------------------------------------------
// agent-runner callClaude — Anthropic → free-Ollama fallback ladder.
// Proves: a provider FAILURE degrades to Ollama (tagged as the ollama model so
// cost logs $0), a safety REFUSAL never falls back, and a clean success skips
// Ollama entirely. Guards the 2026-07 "room goes dark on a cap" regression.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../ollama-client.js", () => ({
  OLLAMA_MODEL: "gemma4:31b",
  callOllamaChat: vi.fn(),
}));
vi.mock("../provider-alerts.js", () => ({ noteProviderFailure: vi.fn() }));

import { callClaude, stripAssistantPreamble } from "./claude.js";
import { callOllamaChat } from "../ollama-client.js";

const okOllama = { content: "a warm fallback line", promptTokens: 5, completionTokens: 6, model: "gemma4:31b" };

function stubFetch(impl: () => unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => impl()));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("callClaude fallback ladder", () => {
  it("degrades to free Ollama when Anthropic returns an HTTP error (the cap case)", async () => {
    stubFetch(() => ({ ok: false, status: 400, text: async () => "usage limit reached" }));
    vi.mocked(callOllamaChat).mockResolvedValue(okOllama);

    const r = await callClaude("k", "claude-sonnet-5", "sys", "hi");
    expect(callOllamaChat).toHaveBeenCalledOnce();
    expect(r).toEqual({ text: "a warm fallback line", model: "ollama:gemma4:31b", inputTokens: 5, outputTokens: 6 });
  });

  it("NEVER falls back on a safety refusal (returns null, Ollama untouched)", async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ stop_reason: "refusal" }) }));
    const r = await callClaude("k", "claude-sonnet-5", "sys", "hi");
    expect(r).toBeNull();
    expect(callOllamaChat).not.toHaveBeenCalled();
  });

  it("returns the Claude result and skips Ollama on success", async () => {
    stubFetch(() => ({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "a real claude line" }], usage: { input_tokens: 3, output_tokens: 4 } }),
    }));
    const r = await callClaude("k", "claude-sonnet-5", "sys", "hi");
    expect(r).toEqual({ text: "a real claude line", model: "claude-sonnet-5", inputTokens: 3, outputTokens: 4 });
    expect(callOllamaChat).not.toHaveBeenCalled();
  });

  it("returns null when BOTH tiers fail", async () => {
    stubFetch(() => ({ ok: false, status: 429, text: async () => "rate limited" }));
    vi.mocked(callOllamaChat).mockRejectedValue(new Error("ollama down"));
    expect(await callClaude("k", "claude-sonnet-5", "sys", "hi")).toBeNull();
  });
});

describe("stripAssistantPreamble", () => {
  it("drops a leading 'Here are...' lead-in line", () => {
    expect(stripAssistantPreamble("Here are a few options:\nStreak of six today.")).toBe("Streak of six today.");
  });
  it("unwraps a fenced code block", () => {
    expect(stripAssistantPreamble('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("leaves a clean member-style post untouched", () => {
    const s = "day three and i still don't know what i'm doing, but i showed up.";
    expect(stripAssistantPreamble(s)).toBe(s);
  });
});
