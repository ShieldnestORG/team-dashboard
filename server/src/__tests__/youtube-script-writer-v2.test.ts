// ---------------------------------------------------------------------------
// Script writer v2: model-generated scripts with validate-and-repair, no
// template fallback, the fixed "This is Coherence Daddy." greeting, and the
// system-added disclosure / not-advice lines.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/ollama-client.js", () => ({ callOllamaChat: vi.fn() }));
vi.mock("../middleware/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  DISCLOSURE_LINE,
  NOT_ADVICE_LINE,
  formatScriptPlainText,
  generateScript,
  needsDisclosure,
  needsNotAdvice,
  sanitizeScript,
  type ScriptData,
} from "../services/youtube/script-writer.js";
import { callOllamaChat } from "../services/ollama-client.js";

const mockChat = vi.mocked(callOllamaChat);

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const BAD_FIXTURE = JSON.parse(readFileSync(join(FIXTURES, "yt-script-2026-10-06.json"), "utf8")) as ScriptData;
const GOOD_FIXTURE = JSON.parse(readFileSync(join(FIXTURES, "yt-script-good-mindset.json"), "utf8")) as ScriptData;

function strategy(overrides: Record<string, unknown> = {}) {
  return {
    topic: "discipline over motivation",
    angle: "three small habits",
    pillar: "motivation",
    contentType: "Explainer",
    targetAudience: "people building habits",
    keywords: ["discipline", "habits"],
    estimatedViews: 1000,
    bestPublishTime: "2026-10-08T09:00:00Z",
    ...overrides,
  } as never;
}

beforeEach(() => {
  mockChat.mockReset();
});

describe("generateScript v2", () => {
  it("repairs a rule-breaking script and returns the good one", async () => {
    mockChat
      .mockResolvedValueOnce({ content: JSON.stringify(BAD_FIXTURE) } as never)
      .mockResolvedValueOnce({ content: JSON.stringify(GOOD_FIXTURE) } as never);

    const script = await generateScript(strategy());

    expect(mockChat).toHaveBeenCalledTimes(2);
    const repairMessages = mockChat.mock.calls[1][0];
    const lastMessage = repairMessages[repairMessages.length - 1].content as string;
    expect(lastMessage).toMatch(/GREETING|OPENER_FILLER|INVENTED/);
    expect(script.title).toBe(GOOD_FIXTURE.title);
    expect(script.validation?.attempts).toBe(2);
    expect(script.introduction.greeting).toBe("This is Coherence Daddy.");
  });

  it("rejects after 2 failed repairs (no template fallback)", async () => {
    mockChat.mockResolvedValue({ content: JSON.stringify(BAD_FIXTURE) } as never);
    await expect(generateScript(strategy())).rejects.toThrow(/script_validation/);
    expect(mockChat).toHaveBeenCalledTimes(3);
  });

  it("rejects with script_generation when the model fails twice", async () => {
    mockChat.mockRejectedValue(new Error("boom"));
    await expect(generateScript(strategy())).rejects.toThrow(/script_generation/);
  });
});

describe("needsDisclosure / needsNotAdvice", () => {
  it("needsDisclosure is true for a TX script, false for the good mindset fixture", () => {
    const tx = sanitizeScript(JSON.parse(JSON.stringify(GOOD_FIXTURE)) as ScriptData);
    tx.mainContent.sections[0].content = ["Here is how TX staking works."];
    expect(needsDisclosure(tx)).toBe(true);
    expect(needsDisclosure(GOOD_FIXTURE)).toBe(false);
  });

  it("needsNotAdvice is true for bitcoin, false for the good mindset fixture", () => {
    const crypto = sanitizeScript(JSON.parse(JSON.stringify(GOOD_FIXTURE)) as ScriptData);
    crypto.mainContent.sections[0].content = ["Say you buy a little bitcoin every month."];
    expect(needsNotAdvice(crypto)).toBe(true);
    expect(needsNotAdvice(GOOD_FIXTURE)).toBe(false);
  });
});

describe("formatScriptPlainText: system-added lines", () => {
  it("adds both lines to a TX script in the right places", () => {
    const tx = sanitizeScript(JSON.parse(JSON.stringify(GOOD_FIXTURE)) as ScriptData);
    tx.mainContent.sections[0].content = ["Here is how TX staking works."];
    const text = formatScriptPlainText(tx);
    const hookEnd = text.indexOf(tx.hook.text) + tx.hook.text.length;
    expect(text.slice(hookEnd).trimStart().startsWith(DISCLOSURE_LINE)).toBe(true);
    const subIndex = text.indexOf(tx.callToAction.subscribe);
    const before = text.slice(0, subIndex).trimEnd();
    expect(before.endsWith(NOT_ADVICE_LINE)).toBe(true);
    expect(text.trimEnd().endsWith("Also, check out evntrace.com.")).toBe(true);
  });

  it("adds neither line to the good mindset fixture", () => {
    const text = formatScriptPlainText(sanitizeScript(GOOD_FIXTURE));
    expect(text).not.toContain(DISCLOSURE_LINE);
    expect(text).not.toContain(NOT_ADVICE_LINE);
  });
});