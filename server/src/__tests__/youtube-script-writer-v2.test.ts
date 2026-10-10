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
  process.env.YT_MIN_SCRIPT_WORDS = "0"; // fixtures are short on purpose; the length rule has its own test below
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

  it("rejects after 4 failed repairs (no template fallback)", async () => {
    mockChat.mockResolvedValue({ content: JSON.stringify(BAD_FIXTURE) } as never);
    await expect(generateScript(strategy())).rejects.toThrow(/script_validation/);
    expect(mockChat).toHaveBeenCalledTimes(5);
  });

  // 2026-10-10: on VPS4, 13 of 15 TX scripts passed and nearly every pass used the last of 3 attempts
  // (TOO_SHORT first, then the TX facts rule); 2 failed outright = no video that night. A try costs ~6 s.
  it("a script that only comes right on the fifth try is still returned", async () => {
    mockChat
      .mockResolvedValueOnce({ content: JSON.stringify(BAD_FIXTURE) } as never)
      .mockResolvedValueOnce({ content: JSON.stringify(BAD_FIXTURE) } as never)
      .mockResolvedValueOnce({ content: JSON.stringify(BAD_FIXTURE) } as never)
      .mockResolvedValueOnce({ content: JSON.stringify(BAD_FIXTURE) } as never)
      .mockResolvedValueOnce({ content: JSON.stringify(GOOD_FIXTURE) } as never);
    const script = await generateScript(strategy());
    expect(mockChat).toHaveBeenCalledTimes(5);
    expect(script.validation?.attempts).toBe(5);
    expect(script.title).toBe(GOOD_FIXTURE.title);
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
describe("length rule (YT_MIN_SCRIPT_WORDS)", () => {
  it("sends a too-short script back with TOO_SHORT, then accepts it once long enough", async () => {
    process.env.YT_MIN_SCRIPT_WORDS = "150";
    const good = JSON.parse(readFileSync(new URL("./fixtures/yt-script-good-mindset.json", import.meta.url), "utf8"));
    const short = structuredClone(good);
    short.mainContent.sections = short.mainContent.sections.slice(0, 2).map((sec: { content: string[] }) => ({ ...sec, content: sec.content.slice(0, 1), onScreen: undefined }));
    short.title = "Discipline beats motivation: small habits that stick";
    const long = structuredClone(good);
    long.mainContent.sections.push({ type: "step", title: "Forgive the miss", content: ["Missing one day is normal, so plan the restart before the miss ever happens.", "The habit survives when the second day matters more than the first slip."], onScreen: ["Plan the restart", "Never miss twice"], visuals: [], duration: 0 });
    long.title = "Discipline beats motivation: four small habits that make it stick";
    mockChat.mockReset();
    mockChat.mockResolvedValueOnce({ content: JSON.stringify(short) } as never).mockResolvedValueOnce({ content: JSON.stringify(long) } as never);
    const result = await generateScript(strategy());
    expect(mockChat).toHaveBeenCalledTimes(2);
    const repair = mockChat.mock.calls[1][0];
    expect(String(repair[repair.length - 1].content)).toMatch(/TOO_SHORT/);
    expect(result.validation?.violations).toContain("TOO_SHORT");
  });

  it("YT_MIN_SCRIPT_WORDS=0 turns the rule off", async () => {
    process.env.YT_MIN_SCRIPT_WORDS = "0";
    const good = readFileSync(new URL("./fixtures/yt-script-good-mindset.json", import.meta.url), "utf8");
    mockChat.mockReset();
    mockChat.mockResolvedValueOnce({ content: good } as never);
    const result = await generateScript(strategy());
    expect(result.validation?.attempts).toBe(1);
  });
});
