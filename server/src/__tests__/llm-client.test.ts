import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callLlmChat,
  callLlmGenerate,
  configureLlmSettingsProvider,
  invalidateLlmSettingsCache,
} from "../services/llm-client.js";

const mockOllama = vi.hoisted(() => ({
  callOllamaGenerate: vi.fn(),
  callOllamaChat: vi.fn(),
}));

const mockAnthropic = vi.hoisted(() => ({
  callAnthropicGenerate: vi.fn(),
  callAnthropicChat: vi.fn(),
  isAnthropicConfigured: vi.fn(),
}));

vi.mock("../services/ollama-client.js", () => ({
  callOllamaGenerate: mockOllama.callOllamaGenerate,
  callOllamaChat: mockOllama.callOllamaChat,
  OLLAMA_MODEL: "gemma-test",
}));

vi.mock("../services/anthropic-client.js", () => ({
  callAnthropicGenerate: mockAnthropic.callAnthropicGenerate,
  callAnthropicChat: mockAnthropic.callAnthropicChat,
  isAnthropicConfigured: mockAnthropic.isAnthropicConfigured,
  ANTHROPIC_MODEL: "claude-test",
}));

const ENV_KEYS = ["OLLAMA_URL", "OLLAMA_API_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe("llm-client provider routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    // Ollama counts as configured for fallback purposes by default.
    process.env.OLLAMA_URL = "http://ollama.test";
    configureLlmSettingsProvider(null);
    mockOllama.callOllamaGenerate.mockResolvedValue("ollama text");
    mockOllama.callOllamaChat.mockResolvedValue({
      content: "ollama chat",
      promptTokens: 1,
      completionTokens: 2,
      model: "gemma-test",
    });
    mockAnthropic.callAnthropicGenerate.mockResolvedValue("claude text");
    mockAnthropic.callAnthropicChat.mockResolvedValue({
      content: "claude chat",
      promptTokens: 3,
      completionTokens: 4,
      model: "claude-test",
    });
    mockAnthropic.isAnthropicConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    configureLlmSettingsProvider(null);
  });

  it("defaults to ollama when no settings provider is registered", async () => {
    const result = await callLlmGenerate("hello");
    expect(mockOllama.callOllamaGenerate).toHaveBeenCalledWith("hello", { model: undefined });
    expect(mockAnthropic.callAnthropicGenerate).not.toHaveBeenCalled();
    expect(result).toEqual({ text: "ollama text", provider: "ollama", model: "gemma-test" });
  });

  it("respects the contentLlmProvider instance setting", async () => {
    configureLlmSettingsProvider(async () => ({ contentLlmProvider: "claude" }));
    const result = await callLlmGenerate("hello");
    expect(mockAnthropic.callAnthropicGenerate).toHaveBeenCalledOnce();
    expect(mockOllama.callOllamaGenerate).not.toHaveBeenCalled();
    expect(result.provider).toBe("claude");
    expect(result.model).toBe("claude-test");
  });

  it("applies the contentLlmModel setting to the selected provider", async () => {
    configureLlmSettingsProvider(async () => ({
      contentLlmProvider: "claude",
      contentLlmModel: "claude-custom",
    }));
    const result = await callLlmGenerate("hello");
    expect(mockAnthropic.callAnthropicGenerate).toHaveBeenCalledWith("hello", {
      model: "claude-custom",
      maxTokens: undefined,
      timeoutMs: undefined,
    });
    expect(result.model).toBe("claude-custom");
  });

  it("lets a per-call provider override win over the instance setting", async () => {
    configureLlmSettingsProvider(async () => ({ contentLlmProvider: "claude" }));
    const result = await callLlmGenerate("hello", { provider: "ollama" });
    expect(mockOllama.callOllamaGenerate).toHaveBeenCalledOnce();
    expect(mockAnthropic.callAnthropicGenerate).not.toHaveBeenCalled();
    expect(result.provider).toBe("ollama");
  });

  it("falls back to claude when ollama fails and claude is configured", async () => {
    mockOllama.callOllamaGenerate.mockRejectedValue(new Error("Ollama error (502): funnel down"));
    const result = await callLlmGenerate("hello");
    expect(mockAnthropic.callAnthropicGenerate).toHaveBeenCalledOnce();
    expect(result).toEqual({ text: "claude text", provider: "claude", model: "claude-test" });
  });

  it("falls back to ollama when claude fails and ollama is configured", async () => {
    configureLlmSettingsProvider(async () => ({ contentLlmProvider: "claude" }));
    mockAnthropic.callAnthropicGenerate.mockRejectedValue(new Error("Anthropic API error (529)"));
    const result = await callLlmGenerate("hello");
    expect(mockOllama.callOllamaGenerate).toHaveBeenCalledOnce();
    expect(result.provider).toBe("ollama");
  });

  it("does not apply the model override to the fallback provider", async () => {
    configureLlmSettingsProvider(async () => ({
      contentLlmProvider: "claude",
      contentLlmModel: "claude-custom",
    }));
    mockAnthropic.callAnthropicGenerate.mockRejectedValue(new Error("boom"));
    const result = await callLlmGenerate("hello");
    expect(mockOllama.callOllamaGenerate).toHaveBeenCalledWith("hello", { model: undefined });
    expect(result.model).toBe("gemma-test");
  });

  it("rethrows the primary error when the fallback provider is unconfigured", async () => {
    mockAnthropic.isAnthropicConfigured.mockReturnValue(false);
    mockOllama.callOllamaGenerate.mockRejectedValue(new Error("Ollama error (502): funnel down"));
    await expect(callLlmGenerate("hello")).rejects.toThrow("Ollama error (502): funnel down");
    expect(mockAnthropic.callAnthropicGenerate).not.toHaveBeenCalled();
  });

  it("rethrows the primary error when claude fails and ollama env is unset", async () => {
    delete process.env.OLLAMA_URL;
    delete process.env.OLLAMA_API_KEY;
    configureLlmSettingsProvider(async () => ({ contentLlmProvider: "claude" }));
    mockAnthropic.callAnthropicGenerate.mockRejectedValue(new Error("Anthropic API error (401)"));
    await expect(callLlmGenerate("hello")).rejects.toThrow("Anthropic API error (401)");
    expect(mockOllama.callOllamaGenerate).not.toHaveBeenCalled();
  });

  it("caches settings reads across calls", async () => {
    const getter = vi.fn().mockResolvedValue({ contentLlmProvider: "ollama" as const });
    configureLlmSettingsProvider(getter);
    await callLlmGenerate("one");
    await callLlmGenerate("two");
    expect(getter).toHaveBeenCalledOnce();
  });

  it("invalidateLlmSettingsCache forces a re-read so an admin provider flip takes effect at once", async () => {
    // Simulates the admin writing Instance Settings → General: the write path
    // (instance-settings.updateGeneral) calls invalidateLlmSettingsCache(), and
    // the very next content call must see the new provider, not the 30s-stale one.
    const getter = vi
      .fn()
      .mockResolvedValueOnce({ contentLlmProvider: "ollama" as const })
      .mockResolvedValueOnce({ contentLlmProvider: "claude" as const });
    configureLlmSettingsProvider(getter);

    const first = await callLlmGenerate("before");
    expect(first.provider).toBe("ollama");
    expect(getter).toHaveBeenCalledOnce();

    // Without this, the cached ollama setting would still serve for up to 30s.
    invalidateLlmSettingsCache();

    const second = await callLlmGenerate("after");
    expect(getter).toHaveBeenCalledTimes(2);
    expect(second.provider).toBe("claude");
    expect(mockAnthropic.callAnthropicGenerate).toHaveBeenCalledOnce();
  });

  describe("callLlmChat", () => {
    const messages = [{ role: "user" as const, content: "hi" }];

    it("routes chat to the configured provider and reports it", async () => {
      configureLlmSettingsProvider(async () => ({ contentLlmProvider: "claude" }));
      const result = await callLlmChat(messages, { temperature: 0.7, maxTokens: 100 });
      expect(mockAnthropic.callAnthropicChat).toHaveBeenCalledWith(messages, {
        model: undefined,
        maxTokens: 100,
        timeoutMs: undefined,
      });
      expect(result.provider).toBe("claude");
      expect(result.content).toBe("claude chat");
    });

    it("falls back on chat failures too", async () => {
      mockOllama.callOllamaChat.mockRejectedValue(new Error("Ollama API error (502)"));
      const result = await callLlmChat(messages);
      expect(mockAnthropic.callAnthropicChat).toHaveBeenCalledOnce();
      expect(result.provider).toBe("claude");
    });
  });
});
