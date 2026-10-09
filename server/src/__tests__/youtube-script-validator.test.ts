import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { ScriptData } from "../services/youtube/script-writer.js";
import { validateScript, formatViolations, type ValidationResult } from "../services/youtube/script-validator.js";

function loadFixture(name: string): ScriptData {
  const base = name.endsWith(".json") ? name.slice(0, -".json".length) : name;
  return JSON.parse(readFileSync(new URL(`./fixtures/${base}.json`, import.meta.url), "utf8")) as ScriptData;
}

function cloneGood(): ScriptData {
  return structuredClone(loadFixture("yt-script-good-mindset.json"));
}

function has(result: ValidationResult, code: string, field?: string): boolean {
  return result.violations.some((v) => v.code === code && (field === undefined || v.field === field));
}

function setContent(script: ScriptData, sectionIndex: number, lineIndex: number, text: string): void {
  script.mainContent.sections[sectionIndex].content[lineIndex] = text;
}

const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(" ");

describe("validateScript — fixtures", () => {
  it("accepts the good mindset script", () => {
    const result = validateScript(loadFixture("yt-script-good-mindset.json"));
    expect(result.ok, formatViolations(result)).toBe(true);
    expect(result.violations, formatViolations(result)).toEqual([]);
  });

  it("flags the real 2026-10-06 bad script", () => {
    const result = validateScript(loadFixture("yt-script-2026-10-06.json"));
    expect(result.ok).toBe(false);
    for (const code of [
      "GREETING",
      "OPENER_FILLER",
      "INVENTED",
      "PRONUNCIATION_NOTE",
      "ADVICE_OR_HYPE",
      "TITLE_TOO_LONG",
    ]) {
      expect(has(result, code), `expected ${code} in ${formatViolations(result)}`).toBe(true);
    }
  });
});

describe("rules 1–9 on spoken strings", () => {
  it("1 GREETING", () => {
    const s = cloneGood();
    s.introduction.greeting = "Hey everyone.";
    const r = validateScript(s);
    expect(has(r, "GREETING", "introduction.greeting")).toBe(true);
  });

  it("2 OPENER_FILLER", () => {
    const s = cloneGood();
    s.hook.text = "Welcome back to the channel.";
    const r = validateScript(s);
    expect(has(r, "OPENER_FILLER", "hook.text")).toBe(true);
  });

  it("3 INVENTED", () => {
    const s = cloneGood();
    setContent(s, 0, 0, "We tested this for weeks.");
    const r = validateScript(s);
    expect(has(r, "INVENTED", "mainContent.sections[0].content[0]")).toBe(true);
  });

  it("4 PRONUNCIATION_NOTE", () => {
    const s = cloneGood();
    setContent(s, 0, 0, "DeFi, pronounced de-fi, is useful.");
    const r = validateScript(s);
    expect(has(r, "PRONUNCIATION_NOTE", "mainContent.sections[0].content[0]")).toBe(true);
  });

  it("5 ADVICE_OR_HYPE", () => {
    const s = cloneGood();
    setContent(s, 0, 0, "This will moon, guaranteed.");
    const r = validateScript(s);
    expect(has(r, "ADVICE_OR_HYPE", "mainContent.sections[0].content[0]")).toBe(true);
  });

  it("6 BANNED_PHRASE", () => {
    const s = cloneGood();
    setContent(s, 0, 0, "This is a game-changer in today's fast-paced world.");
    const r = validateScript(s);
    expect(has(r, "BANNED_PHRASE", "mainContent.sections[0].content[0]")).toBe(true);
  });

  it("7 UNSUPPORTED_CLAIM", () => {
    const s = cloneGood();
    setContent(s, 0, 0, "This is the top encrypted anonymous wallet.");
    const r = validateScript(s);
    expect(has(r, "UNSUPPORTED_CLAIM", "mainContent.sections[0].content[0]")).toBe(true);
  });

  it("8 EVNTRACE_MENTION", () => {
    const s = cloneGood();
    setContent(s, 0, 0, "Check out evntrace.com for more.");
    const r = validateScript(s);
    expect(has(r, "EVNTRACE_MENTION", "mainContent.sections[0].content[0]")).toBe(true);
  });

  it("9 NOT_SPEAKABLE", () => {
    const s = cloneGood();
    setContent(s, 0, 0, "Visit https://example.com or [click here].");
    const r = validateScript(s);
    expect(has(r, "NOT_SPEAKABLE", "mainContent.sections[0].content[0]")).toBe(true);
  });
});

describe("title rules 13–16", () => {
  it("13 TITLE_FALSE_CLAIM + 14 TITLE_INCOME_PROMISE", () => {
    const s = cloneGood();
    s.title = "I Tested 5 Crypto Passive Income Methods for 90 Days - Here's Which One Actually Paid My Rent";
    const r = validateScript(s);
    expect(has(r, "TITLE_FALSE_CLAIM", "title")).toBe(true);
    expect(has(r, "TITLE_INCOME_PROMISE", "title")).toBe(true);
  });

  it("13 TITLE_FALSE_CLAIM alone", () => {
    const s = cloneGood();
    s.title = "We surveyed 100 experts about crypto.";
    const r = validateScript(s);
    expect(has(r, "TITLE_FALSE_CLAIM", "title")).toBe(true);
  });

  it("14 TITLE_INCOME_PROMISE alone", () => {
    const s = cloneGood();
    s.title = "Make $5,000 per day passive income that works.";
    const r = validateScript(s);
    expect(has(r, "TITLE_INCOME_PROMISE", "title")).toBe(true);
  });

  it("15 TITLE_JUNK", () => {
    const s = cloneGood();
    s.title = "Ultimate Why the TX Ecosystem Is Next - Toknsfi";
    const r = validateScript(s);
    expect(has(r, "TITLE_JUNK", "title")).toBe(true);
  });

  it("16 COUNT_MISMATCH when the count is not delivered", () => {
    const s = cloneGood();
    s.title = "Five habits that stick";
    const r = validateScript(s);
    expect(has(r, "COUNT_MISMATCH", "title")).toBe(true);
  });

  it("16 no COUNT_MISMATCH when the count matches lines", () => {
    const s = cloneGood();
    s.title = "Six habits that stick";
    const r = validateScript(s);
    expect(has(r, "COUNT_MISMATCH", "title")).toBe(false);
  });
});

describe("LINE_TOO_LONG", () => {
  it("31-word line is a violation", () => {
    const s = cloneGood();
    setContent(s, 0, 0, words(31));
    const r = validateScript(s);
    expect(has(r, "LINE_TOO_LONG", "mainContent.sections[0].content[0]")).toBe(true);
  });

  it("25-word line is only a warning", () => {
    const s = cloneGood();
    setContent(s, 0, 0, words(25));
    const r = validateScript(s);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((v) => v.code === "LINE_TOO_LONG" && v.field === "mainContent.sections[0].content[0]")).toBe(true);
  });
});

describe("ONSCREEN_SHAPE", () => {
  it("onScreen shorter than content", () => {
    const s = cloneGood();
    s.mainContent.sections[0].onScreen = ["Only one"];
    const r = validateScript(s);
    expect(has(r, "ONSCREEN_SHAPE", "mainContent.sections[0].onScreen")).toBe(true);
  });

  it("8-word onScreen entry", () => {
    const s = cloneGood();
    s.mainContent.sections[0].onScreen = ["ok entry", words(8)];
    const r = validateScript(s);
    expect(has(r, "ONSCREEN_SHAPE", "mainContent.sections[0].onScreen")).toBe(true);
  });

  it("a script with no onScreen field passes rule 11", () => {
    const s = cloneGood();
    for (const section of s.mainContent.sections) {
      delete (section as { onScreen?: unknown }).onScreen;
    }
    const r = validateScript(s);
    expect(has(r, "ONSCREEN_SHAPE")).toBe(false);
  });
});
