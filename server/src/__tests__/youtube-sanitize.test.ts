// ---------------------------------------------------------------------------
// sanitizeScript + applyPronunciationFixes: the narrator must never read a
// pronunciation note aloud ("DeFi, pronounced DFI"), never mention evntrace
// outside the one fixed line, and always welcome viewers to Coherence Daddy.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EVNTRACE_CTA_LINE,
  applyPronunciationFixes,
  formatScriptPlainText,
  sanitizeScript,
  type ScriptData,
} from "../services/youtube/script-writer.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "yt-script-2026-10-06.json");

function baseScript(): ScriptData {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as ScriptData;
}

/** A copy of the fixture whose first section line is `line`. */
function withLine(line: string): ScriptData {
  const s = baseScript();
  s.mainContent.sections[0].content = [line];
  return s;
}
const firstLine = (s: ScriptData) => s.mainContent.sections[0].content[0];

describe("sanitizeScript: pronunciation asides", () => {
  const cases: Array<[string, string, string]> = [
    ["em dashes + quotes", 'For beginners, DeFi—pronounced "de-fi"—allows you to earn yield.', "For beginners, DeFi allows you to earn yield."],
    ["parentheses", "Today DeFi (pronounced dee-fye) lets you earn yield.", "Today DeFi lets you earn yield."],
    ["commas + quotes with inner comma", 'Today DeFi, pronounced "dee-fi," allows you to earn yield.', "Today DeFi allows you to earn yield."],
    ["spaced en dashes, no quotes", "Today DeFi – pronounced de-fi – lets you earn yield.", "Today DeFi lets you earn yield."],
  ];
  for (const [name, input, expected] of cases) {
    it(`strips the aside: ${name}`, () => {
      const out = firstLine(sanitizeScript(withLine(input)));
      expect(out).toBe(expected);
      expect(out).not.toMatch(/pronounced/i);
      expect(out).not.toMatch(/ {2}|,,| ,/);
    });
  }

  it("cleans the real fixture line", () => {
    const s = sanitizeScript(baseScript());
    const line = s.mainContent.sections[1].content[1];
    expect(line).toBe("For beginners, DeFi allows you to earn yield through staking or providing liquidity.");
  });

  it("leaves text without an aside byte-for-byte alone", () => {
    const line = "Stop chasing every new memecoin. To build long-term wealth, you need a tiered structure.";
    expect(firstLine(sanitizeScript(withLine(line)))).toBe(line);
  });

  it("does not mutate its input", () => {
    const input = withLine('DeFi—pronounced "de-fi"—allows yield.');
    sanitizeScript(input);
    expect(firstLine(input)).toContain("pronounced");
  });
});

describe("sanitizeScript: evntrace", () => {
  it("drops only the sentence that mentions evntrace (any case), keeps the rest", () => {
    const out = firstLine(
      sanitizeScript(withLine("Build slowly. Evntrace is great for forensics, see evntrace.com. Stay patient.")),
    );
    expect(out).toBe("Build slowly. Stay patient.");
    expect(out.toLowerCase()).not.toContain("evntrace");
  });

  it("removes a line that was only an evntrace sentence", () => {
    const s = baseScript();
    s.mainContent.sections[0].content = ["Keep going.", "Check out EVNTRACE today!"];
    expect(sanitizeScript(s).mainContent.sections[0].content).toEqual(["Keep going."]);
  });

  it("the only evntrace mention left in the narration is the fixed line", () => {
    const s = baseScript();
    s.callToAction.comment = "Comment below. Visit evntrace.com for more.";
    const text = formatScriptPlainText(sanitizeScript(s));
    expect(text.match(/evntrace/gi)).toHaveLength(1);
    expect(text.trimEnd().endsWith(EVNTRACE_CTA_LINE)).toBe(true);
  });
});

describe("sanitizeScript: greeting", () => {
  it("forces a greeting that does not name Coherence Daddy", () => {
    const out = sanitizeScript(baseScript()); // fixture says "Welcome back to Tokns.fi."
    expect(out.introduction.greeting).toBe("What's up everyone, welcome back to Coherence Daddy.");
  });

  it("leaves an already-correct greeting untouched (case-insensitive match)", () => {
    const s = baseScript();
    s.introduction.greeting = "Hey, it's the coherence daddy channel!";
    expect(sanitizeScript(s).introduction.greeting).toBe("Hey, it's the coherence daddy channel!");
  });
});

describe("applyPronunciationFixes: evntrace", () => {
  it('says "evntrace.com" as "event trace dot com"', () => {
    expect(applyPronunciationFixes("check out evntrace.com")).toBe("check out event trace dot com");
  });

  it('says a bare "evntrace" (any case) as "event trace"', () => {
    expect(applyPronunciationFixes("Evntrace and EVNTRACE")).toBe("event trace and event trace");
  });
});
