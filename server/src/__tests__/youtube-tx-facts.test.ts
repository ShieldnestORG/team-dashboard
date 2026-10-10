// ---------------------------------------------------------------------------
// TX facts pack + TX_CLAIM_OUTSIDE_FACTS rule.
//
// The fixtures are the real production c42a126f "How TX Reward Splits Work"
// (reconstructed from the fact-checker's quotes, which the ticket names as the
// failing lines) and a corrected rewrite built only from re-checked facts.
// The real script must FAIL the rule; the corrected one must pass.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ScriptData } from "../services/youtube/script-writer.js";
import { validateScript, type ValidationResult } from "../services/youtube/script-validator.js";
import { loadTxFacts, factsToPromptBlock } from "../services/youtube/tx-facts.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function load(name: string): ScriptData {
  const raw = JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as ScriptData & { _source?: string };
  delete raw._source;
  return raw;
}

function has(result: ValidationResult, code: string): boolean {
  return result.violations.some((v) => v.code === code);
}

const facts = loadTxFacts();

describe("loadTxFacts / factsToPromptBlock", () => {
  it("loads only re-checked, non-stale facts", () => {
    expect(facts.length).toBeGreaterThanOrEqual(4);
    // every loaded fact is verified (needsRecheck false) and dated 2026-10-10
    for (const f of facts) {
      expect(f.needsRecheck).not.toBe(true);
      expect(f.checkedAt).toBe("2026-10-10");
    }
  });

  it("the 5% community tax and PSE facts are present", () => {
    expect(facts.some((f) => f.statement.includes("5% community-pool tax"))).toBe(true);
    expect(facts.some((f) => f.statement.includes("PSE"))).toBe(true);
  });

  it("drops a fact older than 30 days with a logged warning", () => {
    const old = loadTxFacts(new Date("2026-11-15"));
    expect(old.length).toBe(0);
  });

  it("builds a FACTS prompt block", () => {
    const block = factsToPromptBlock(facts);
    expect(block.startsWith("FACTS (TX blockchain")).toBe(true);
    expect(block).toContain("5% community-pool tax");
  });
});

describe("TX_CLAIM_OUTSIDE_FACTS", () => {
  it("flags the real c42a126f script (two parties / exact / pool percentage)", () => {
    const result = validateScript(load("yt-script-2026-10-09-tx-reward-splits.json"), { txFacts: facts });
    expect(result.ok).toBe(false);
    expect(has(result, "TX_CLAIM_OUTSIDE_FACTS")).toBe(true);
    expect(result.violations.filter((v) => v.code === "TX_CLAIM_OUTSIDE_FACTS").length).toBeGreaterThanOrEqual(2);
  });

  it("accepts the corrected script", () => {
    const result = validateScript(load("yt-script-2026-10-09-tx-reward-splits-corrected.json"), { txFacts: facts });
    expect(result.ok, JSON.stringify(result.violations)).toBe(true);
  });

  it("does not run the rule when no facts are supplied", () => {
    const result = validateScript(load("yt-script-2026-10-09-tx-reward-splits.json"), {});
    expect(has(result, "TX_CLAIM_OUTSIDE_FACTS")).toBe(false);
  });

  it("flags a TX certainty word", () => {
    const s = load("yt-script-2026-10-09-tx-reward-splits-corrected.json");
    s.mainContent.sections[0].content = ["Staking rewards are always the same percentage of the pool."];
    const result = validateScript(s, { txFacts: facts });
    expect(has(result, "TX_CLAIM_OUTSIDE_FACTS")).toBe(true);
  });

  it("flags a TX number that is not in the pack", () => {
    const s = load("yt-script-2026-10-09-tx-reward-splits-corrected.json");
    s.mainContent.sections[0].content = ["Staking rewards pass through a 12% community-pool tax."];
    const result = validateScript(s, { txFacts: facts });
    expect(has(result, "TX_CLAIM_OUTSIDE_FACTS")).toBe(true);
  });
});
