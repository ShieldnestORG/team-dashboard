/**
 * YouTube Pipeline — TX facts pack
 *
 * The nightly script writer may only state TX mechanics that come from a
 * verified, dated, sourced fact (Rule 1). This module loads the pack, drops
 * facts that are unverified (needsRecheck) or stale (> 30 days), and builds the
 * FACTS block the model is shown. A fact never fed to the model is a fact the
 * script must not say — the writer says less rather than something stale.
 *
 * Facts are refreshed by hand today; refreshing them from the chain is a later
 * ticket (tx/tools/tx_facts_check.py in the TX repo is the model for it).
 */

import { readFileSync } from "node:fs";
import { logger } from "../../middleware/logger.js";

export interface TxFact {
  statement: string;
  value: string;
  /** Exact numeric spellings this fact permits in a script (percentages, durations, bare numbers). */
  numbers?: string[];
  source: string;
  /** ISO date, e.g. "2026-10-10". */
  checkedAt: string;
  /** Unverified facts are never shown to the model. */
  needsRecheck?: boolean;
}

const FACTS_URL = new URL("./facts/tx-facts.json", import.meta.url);
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Load the pack, drop unverified and stale facts, log what was dropped.
 * Reads the file each call so a hand-refreshed pack is picked up on the next
 * production without a redeploy.
 */
export function loadTxFacts(now: Date = new Date()): TxFact[] {
  let all: TxFact[] = [];
  try {
    const raw = JSON.parse(readFileSync(FACTS_URL, "utf8")) as { facts?: TxFact[] };
    all = Array.isArray(raw.facts) ? raw.facts : [];
  } catch (err) {
    logger.error({ err }, "TX facts pack failed to load — no TX facts will be shown");
    return [];
  }

  const fresh: TxFact[] = [];
  for (const fact of all) {
    if (fact.needsRecheck) continue; // unverified — never shown to the model
    const checkedAt = new Date(fact.checkedAt).getTime();
    if (!Number.isFinite(checkedAt) || now.getTime() - checkedAt > STALE_AFTER_MS) {
      logger.warn({ statement: fact.statement, checkedAt: fact.checkedAt }, "TX fact dropped: older than 30 days");
      continue;
    }
    fresh.push(fact);
  }
  return fresh;
}

/** The FACTS block appended to the user prompt. Empty string when there are no facts. */
export function factsToPromptBlock(facts: TxFact[]): string {
  if (facts.length === 0) return "";
  const lines = facts.map(
    (f) => `- ${f.statement} (${f.value}) [${f.source}, checked ${f.checkedAt}]`,
  );
  return `FACTS (TX blockchain — use only these for mechanics; no other numbers, percentages or durations):\n${lines.join("\n")}`;
}
