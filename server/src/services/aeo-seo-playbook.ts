// ---------------------------------------------------------------------------
// AEO/SEO/AdSense Playbook loader + self-check.
//
// Source of truth for the rules is docs/products/aeo-seo-playbook-prd.md;
// the machine-readable mirror lives at content-templates/aeo-seo-rules.json
// and is consumed by the Content, Schema, and Sage agents (prompt injection
// + post-generation self-check) and by the admin review UI (planned).
//
// Rule IDs are permanent. Severity can change; never renumber.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Severity = "must" | "should" | "avoid";
export type Polarity = "do" | "dont";
export type Category = "SEO" | "CONTENT" | "AEO" | "SCHEMA" | "ADS";

export interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  polarity: Polarity;
  rule: string;
  why?: string;
}

interface RulesFile {
  $schema_version: number;
  categories: Record<string, string>;
  rules: Rule[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// services/ -> content-templates/ is a sibling after compile (dist/services, dist/content-templates).
const RULES_PATH = resolve(__dirname, "../content-templates/aeo-seo-rules.json");

let cached: RulesFile | null = null;

export function loadRules(): RulesFile {
  if (cached) return cached;
  const raw = readFileSync(RULES_PATH, "utf8");
  cached = JSON.parse(raw) as RulesFile;
  return cached;
}

export function getAllRules(): Rule[] {
  return loadRules().rules;
}

export function getRulesByCategory(...categories: Category[]): Rule[] {
  const set = new Set(categories);
  return loadRules().rules.filter((r) => set.has(r.category));
}

// Format Do / Don't lists for prompt injection. Keeps prompts readable and
// short — just the rule text, not the "why". The "why" is used by the admin
// review UI when explaining a violation to the operator.
export function formatRulesForPrompt(rules: Rule[]): string {
  const dos = rules.filter((r) => r.polarity === "do");
  const donts = rules.filter((r) => r.polarity === "dont");
  const fmt = (r: Rule) => `[${r.id}] ${r.rule}`;
  const parts: string[] = [];
  if (dos.length) parts.push(`DO:\n${dos.map(fmt).join("\n")}`);
  if (donts.length) parts.push(`DON'T:\n${donts.map(fmt).join("\n")}`);
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Deterministic self-check — regex-level checks for rules we can verify
// without a browser or external call. Returns violated rule IDs.
// ---------------------------------------------------------------------------

export interface SelfCheckInput {
  html: string;
  markdown?: string;
  title?: string;
  metaDescription?: string;
  primaryQuery?: string;
}

export interface SelfCheckResult {
  must: string[];
  should: string[];
  avoid: string[];
  all: string[];
}

const SLOP_PHRASES = [
  /let'?s dive in/i,
  /buckle up/i,
  /in today'?s fast[- ]paced world/i,
  /\bin conclusion\b/i,
  /unlock(?:ing)? the (?:power|secrets?) of/i,
  /game[- ]chang(?:er|ing)/i,
  /revolution(?:iz|ary)/i,
];

// Exported for testing.
export function countWords(text: string): number {
  const stripped = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return 0;
  return stripped.split(" ").length;
}

// Exported for testing.
export function countH1(html: string): number {
  const matches = html.match(/<h1[\s>]/gi);
  return matches ? matches.length : 0;
}

export function selfCheckContent(input: SelfCheckInput): SelfCheckResult {
  const violations = new Set<string>();
  const html = input.html || "";
  const text = `${input.markdown ?? ""}\n${html.replace(/<[^>]+>/g, " ")}`;

  // SEO-003: exactly one H1.
  const h1Count = countH1(html);
  if (h1Count !== 1) violations.add("SEO-003");

  // SEO-004: title length band.
  if (input.title) {
    const tlen = input.title.length;
    if (tlen < 40 || tlen > 70) violations.add("SEO-004");
  }

  // CONTENT-103: thin content.
  const words = countWords(html || text);
  if (words > 0 && words < 300) violations.add("CONTENT-103");

  // AEO-101: buried answer — first 150 chars of the prose shouldn't be
  // pure throat-clearing. Heuristic: if the opening matches a slop phrase,
  // mark AEO-101.
  const opening = text.trim().slice(0, 300);
  if (/^\s*(in today'?s|let'?s|welcome to|imagine)/i.test(opening)) {
    violations.add("AEO-101");
  }

  // AEO-106: slop phrases anywhere.
  for (const rx of SLOP_PHRASES) {
    if (rx.test(text)) {
      violations.add("AEO-106");
      break;
    }
  }

  // CONTENT-102: naive keyword stuffing — primary query mentioned > 2% of words.
  if (input.primaryQuery && words > 50) {
    const needle = input.primaryQuery.toLowerCase();
    const hay = text.toLowerCase();
    let count = 0;
    let idx = 0;
    while ((idx = hay.indexOf(needle, idx)) !== -1) {
      count += 1;
      idx += needle.length;
    }
    if (count / words > 0.02) violations.add("CONTENT-102");
  }

  return groupBySeverity(Array.from(violations));
}

// Validate a JSON-LD object against a handful of SCHEMA-* rules we can check
// structurally without a Rich Results API call.
export function selfCheckJsonLd(jsonLd: unknown): SelfCheckResult {
  const violations = new Set<string>();
  if (!jsonLd || typeof jsonLd !== "object") {
    violations.add("SCHEMA-001");
    return groupBySeverity(Array.from(violations));
  }
  const obj = jsonLd as Record<string, unknown>;

  // SCHEMA-001: must have @context and @type.
  if (obj["@context"] !== "https://schema.org" && obj["@context"] !== "http://schema.org") {
    violations.add("SCHEMA-001");
  }
  if (typeof obj["@type"] !== "string") violations.add("SCHEMA-001");

  // SCHEMA-007: if there's an `author` field, prefer Person object over string.
  if ("author" in obj && typeof obj.author === "string") {
    violations.add("SCHEMA-007");
  }

  // SCHEMA-008: ISO 8601 for datePublished / dateModified.
  const iso = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  for (const key of ["datePublished", "dateModified"]) {
    const val = obj[key];
    if (val !== undefined && (typeof val !== "string" || !iso.test(val))) {
      violations.add("SCHEMA-008");
    }
  }

  return groupBySeverity(Array.from(violations));
}

function groupBySeverity(ids: string[]): SelfCheckResult {
  const byId = new Map(getAllRules().map((r) => [r.id, r]));
  const out: SelfCheckResult = { must: [], should: [], avoid: [], all: ids };
  for (const id of ids) {
    const rule = byId.get(id);
    if (!rule) continue;
    out[rule.severity].push(id);
  }
  return out;
}
