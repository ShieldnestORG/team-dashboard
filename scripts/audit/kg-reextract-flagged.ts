/**
 * KG Re-extract Flagged Triples — validates that the patched extractor
 * (fix/kg-extractor-prompt @ 6305dfd5) does NOT re-emit the 6 known-bad triples
 * flagged in the 2026-04-27 subject-bleed audit.
 *
 * Read-only on production. No DELETE / UPDATE.
 * Single-block runs (chunk size = 1) for clean attribution.
 *
 * Run: npx tsx scripts/audit/kg-reextract-flagged.ts
 */

import { createRequire } from "module";
const require_ = createRequire("/Users/exe/Downloads/Claude/team-dashboard/packages/db/package.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgresRuntime: any = require_("postgres");
import * as fs from "fs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ENV_PATH = "/Users/exe/Downloads/Claude/team-dashboard/.env";
function loadEnv(): Record<string, string> {
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2]!;
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}
const ENV = loadEnv();
const DATABASE_URL = ENV.DATABASE_URL!;
const OLLAMA_URL = ENV.OLLAMA_URL || "https://ollama.com";
const OLLAMA_MODEL = ENV.OLLAMA_MODEL || "gemma4:31b";
const OLLAMA_API_KEY = ENV.OLLAMA_API_KEY || "";

if (!DATABASE_URL) throw new Error("DATABASE_URL missing");

// ---------------------------------------------------------------------------
// Patched prompt — mirrors server/src/services/relationship-extractor.ts
// EXTRACTION_PROMPT on branch fix/kg-extractor-prompt @ 6305dfd5
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `You are a knowledge graph extraction agent. Given an intel report about a blockchain/crypto/tech company, extract structured relationship triples.

CRITICAL — SUBJECT SCOPING RULES (read before extracting):
1. Each report block is delimited by "---". Treat blocks as INDEPENDENT.
   Never emit a triple whose source comes from one block and whose target
   comes from a different block.
2. The bracketed slug at the start of each block (e.g. "[argo-cd]") identifies
   which subject this block is about — it is the ONLY allowed subject for that
   block. Do not infer a different subject from text inside the block. However,
   in the emitted "source" field, prefer the canonical display name (e.g.
   "Argo CD", "Amazon Bedrock") over the slug whenever the block's prose makes
   the proper name clear; fall back to the slug only when the proper name is
   unavailable.
3. If the block is a price snapshot, chain-metrics JSON, or otherwise has no
   prose describing what the subject uses/integrates/etc., emit nothing for
   that block.
4. Dependabot / version-bump commits ("chore(deps): bump X", "chore(deps-dev):
   bump X", "Updated to use nodeNN", "bump library/...") are NOT relationship
   evidence. Skip them. They surface transitive deps and dev-tooling, not
   product architecture.
5. Frontend build tooling (Vite, PostCSS, Webpack, Rollup, Tailwind, esbuild)
   inside a sibling /ui or /web subdirectory describes the UI subproject, not
   the parent product. Do not emit "<backend product> uses <frontend tool>"
   edges.
6. Reject anything that isn't a real named product/company/library:
   version numbers (node24, v3.0.1), file paths, PR titles, commit SHAs.

Output ONLY a JSON array of objects with these fields:
- "source": the name of the source entity (company or technology)
- "relationship": one of: uses, built_on, competes_with, partners_with, fork_of, invested_in, maintains, integrates
- "target": the name of the target entity (company or technology)
- "confidence": a float 0.0-1.0 indicating how confident you are

Rules:
- Extract only factual relationships explicitly stated or strongly implied
- Use canonical names (e.g., "Cosmos SDK" not "the Cosmos framework")
- Do not extract speculative or uncertain relationships below 0.3 confidence
- Return an empty array [] if no relationships are found
- Output ONLY valid JSON, no markdown or explanation

Positive example:
Block: "[osmosis] Osmosis upgrades to Cosmos SDK v0.50 — also enabled IBC v8."
Output: [{"source":"Osmosis","relationship":"built_on","target":"Cosmos SDK","confidence":0.95},
         {"source":"Osmosis","relationship":"integrates","target":"IBC Protocol","confidence":0.9}]

NEGATIVE examples (DO NOT emit these):
- Block "[argo-cd] chore(deps-dev): bump postcss from 8.5.6 to 8.5.10 in /ui"
  → emit []. PostCSS is dev-tooling for the UI subdir; this is a Dependabot bump.
- Block "[aws-bedrock] released v3.0.1 ... upgraded to Vite 8 ..."
  Source: github.com/aws/graph-explorer
  → emit []. The release belongs to aws/graph-explorer, not Bedrock; the slug
  is wrong but you cannot re-attribute it. Skip rather than misattribute.
- Block "[azure-openai] Updated to use node24"
  → emit []. node24 = Node.js 24 runtime version, not an entity.

Intel report:
`;

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

async function callOllama(prompt: string): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OLLAMA_API_KEY) headers["Authorization"] = `Bearer ${OLLAMA_API_KEY}`;
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.1 },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = (await res.json()) as { response?: string };
  return (data.response || "").trim();
}

// ---------------------------------------------------------------------------
// Triple parsing
// ---------------------------------------------------------------------------

const VALID = new Set([
  "uses", "built_on", "competes_with", "partners_with",
  "fork_of", "invested_in", "maintains", "integrates",
]);

interface Triple {
  source: string; relationship: string; target: string; confidence: number;
}

function parseTriples(response: string): Triple[] {
  const m = response.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]) as unknown[];
    const out: Triple[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const t = item as Record<string, unknown>;
      if (!("source" in t) || !("relationship" in t) || !("target" in t)) continue;
      const rel = String(t.relationship).toLowerCase().replace(/\s+/g, "_");
      if (!VALID.has(rel)) continue;
      const conf = typeof t.confidence === "number" ? t.confidence : 0.5;
      if (conf < 0.3) continue;
      out.push({
        source: String(t.source).trim(),
        relationship: rel,
        target: String(t.target).trim(),
        confidence: Math.min(1, Math.max(0, conf)),
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Slug normalization for verdict comparison
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Flagged rows
// ---------------------------------------------------------------------------

interface FlaggedRow {
  id: number;
  source_id: string;
  target_id: string;
  evidence_report_ids: number[];
}

interface IntelReport {
  id: number;
  company_slug: string;
  headline: string;
  body: string;
  source_url: string | null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sql = postgresRuntime(DATABASE_URL, { max: 2, idle_timeout: 5 });
  const errors: string[] = [];

  try {
    const flagged = await sql<FlaggedRow[]>`
      SELECT id,
             source_id,
             target_id,
             COALESCE(evidence_report_ids, '[]'::jsonb) AS evidence_report_ids
      FROM company_relationships
      WHERE id IN (30, 38, 40, 67, 82, 197)
      ORDER BY id
    `;
    console.log(`[load] ${flagged.length} flagged rows`);
    if (flagged.length !== 6) {
      console.warn(`[warn] expected 6 rows, got ${flagged.length}`);
    }

    interface RowResult {
      flagged: FlaggedRow;
      reports: IntelReport[];
      perBlock: { reportId: number; sourceUrl: string | null; triples: Triple[]; raw: string; err?: string }[];
      allTriples: Triple[];
      verdict: "DROPPED" | "STILL EMITTED" | "REPLACED";
      verdictNote: string;
    }

    const results: RowResult[] = [];

    for (const row of flagged) {
      console.log(`\n[row #${row.id}] ${row.source_id} -> ${row.target_id} (${row.evidence_report_ids.length} evidence)`);
      const reports = await sql<IntelReport[]>`
        SELECT id, company_slug, headline, body, source_url
        FROM intel_reports
        WHERE id = ANY(${row.evidence_report_ids})
        ORDER BY id
      `;
      console.log(`  fetched ${reports.length}/${row.evidence_report_ids.length} evidence reports`);

      const perBlock: RowResult["perBlock"] = [];
      const allTriples: Triple[] = [];

      for (const r of reports) {
        // Single-block run (chunk size = 1) — same shape as production
        // combinedText: bracketed slug + headline + body (truncated like AB script)
        const block = `[${r.company_slug}] ${r.headline}\n${r.body.slice(0, 500)}`;
        let raw = "";
        let triples: Triple[] = [];
        let err: string | undefined;
        try {
          raw = await callOllama(EXTRACTION_PROMPT + block);
          triples = parseTriples(raw);
          console.log(`    report #${r.id} → ${triples.length} triples`);
        } catch (e) {
          err = (e as Error).message;
          errors.push(`row#${row.id} report#${r.id}: ${err}`);
          console.log(`    report #${r.id} ERR: ${err}`);
        }
        perBlock.push({ reportId: r.id, sourceUrl: r.source_url, triples, raw, err });
        allTriples.push(...triples);
      }

      // Verdict logic
      const targetSlug = slugify(row.target_id);
      const sourceSlug = slugify(row.source_id);

      const stillEmitted = allTriples.find((t) =>
        slugify(t.source) === sourceSlug && slugify(t.target) === targetSlug
      );

      let verdict: RowResult["verdict"];
      let verdictNote = "";
      if (stillEmitted) {
        verdict = "STILL EMITTED";
        verdictNote = `re-emitted ${stillEmitted.source} —${stillEmitted.relationship}→ ${stillEmitted.target} (conf ${stillEmitted.confidence.toFixed(2)})`;
      } else {
        // Look for related/replacement: same source-slug to ANY target, or any
        // triple where target slug matches but source differs (plausible re-attribution).
        const sameSourceDifferentTarget = allTriples.filter((t) => slugify(t.source) === sourceSlug);
        const sameTargetDifferentSource = allTriples.filter((t) => slugify(t.target) === targetSlug);
        if (sameSourceDifferentTarget.length > 0 || sameTargetDifferentSource.length > 0) {
          verdict = "REPLACED";
          const parts: string[] = [];
          if (sameSourceDifferentTarget.length > 0) {
            parts.push(`same-source: ${sameSourceDifferentTarget.slice(0, 3).map((t) => `${t.source} —${t.relationship}→ ${t.target}`).join("; ")}`);
          }
          if (sameTargetDifferentSource.length > 0) {
            parts.push(`same-target: ${sameTargetDifferentSource.slice(0, 3).map((t) => `${t.source} —${t.relationship}→ ${t.target}`).join("; ")}`);
          }
          verdictNote = parts.join(" | ");
        } else {
          verdict = "DROPPED";
          verdictNote = allTriples.length === 0 ? "extractor emitted nothing" : `${allTriples.length} unrelated triples`;
        }
      }

      console.log(`  VERDICT: ${verdict} — ${verdictNote}`);
      results.push({ flagged: row, reports, perBlock, allTriples, verdict, verdictNote });
    }

    // ---- Markdown output ----
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const outPath = `/Users/exe/Downloads/Claude/team-dashboard/kg-reextract-flagged-results-${date}.md`;
    const md: string[] = [];

    md.push(`# KG Re-extract Flagged Triples — ${new Date().toISOString()}`);
    md.push(``);
    md.push(`- Branch: \`fix/kg-extractor-prompt\` @ \`6305dfd5\``);
    md.push(`- Model: \`${OLLAMA_MODEL}\` @ \`${OLLAMA_URL}\``);
    md.push(`- Temperature: 0.1`);
    md.push(`- Mode: single-block runs (chunk size = 1)`);
    md.push(`- Read-only: no DB writes`);
    md.push(``);

    // Summary table
    const counts = { DROPPED: 0, "STILL EMITTED": 0, REPLACED: 0 };
    for (const r of results) counts[r.verdict]++;

    md.push(`## Summary`);
    md.push(``);
    md.push(`| verdict | count |`);
    md.push(`|---|---|`);
    md.push(`| DROPPED | ${counts.DROPPED} |`);
    md.push(`| STILL EMITTED | ${counts["STILL EMITTED"]} |`);
    md.push(`| REPLACED | ${counts.REPLACED} |`);
    md.push(``);
    md.push(`| row id | original triple | verdict | note |`);
    md.push(`|---|---|---|---|`);
    for (const r of results) {
      md.push(`| ${r.flagged.id} | ${r.flagged.source_id} → ${r.flagged.target_id} | **${r.verdict}** | ${r.verdictNote.replace(/\|/g, "\\|").slice(0, 200)} |`);
    }
    md.push(``);

    if (errors.length > 0) {
      md.push(`## Errors`);
      md.push(``);
      for (const e of errors) md.push(`- ${e}`);
      md.push(``);
    }

    md.push(`## Per-row detail`);
    md.push(``);

    for (const r of results) {
      md.push(`### Row #${r.flagged.id} — \`${r.flagged.source_id}\` → \`${r.flagged.target_id}\``);
      md.push(``);
      md.push(`**Verdict: ${r.verdict}** — ${r.verdictNote}`);
      md.push(``);
      md.push(`**Evidence report ids:** ${r.flagged.evidence_report_ids.join(", ")}`);
      md.push(``);
      md.push(`**Reports fetched:** ${r.reports.length}/${r.flagged.evidence_report_ids.length}`);
      md.push(``);

      md.push(`#### Per-evidence runs`);
      md.push(``);
      for (const b of r.perBlock) {
        const rep = r.reports.find((x) => x.id === b.reportId)!;
        md.push(`- **report #${b.reportId}** [${rep.company_slug}] — \`${b.sourceUrl || "(no url)"}\``);
        md.push(`  - headline: ${rep.headline.slice(0, 120)}`);
        if (b.err) {
          md.push(`  - ERROR: ${b.err}`);
        } else if (b.triples.length === 0) {
          md.push(`  - emitted: _(none)_`);
        } else {
          md.push(`  - emitted ${b.triples.length}:`);
          for (const t of b.triples) {
            md.push(`    - ${t.source} —${t.relationship}→ ${t.target} (${t.confidence.toFixed(2)})`);
          }
        }
      }
      md.push(``);

      md.push(`#### All triples emitted across this row's evidence (${r.allTriples.length})`);
      md.push(``);
      if (r.allTriples.length === 0) {
        md.push(`_(none)_`);
      } else {
        md.push(`| source | rel | target | conf |`);
        md.push(`|---|---|---|---|`);
        for (const t of r.allTriples) {
          md.push(`| ${t.source} | ${t.relationship} | ${t.target} | ${t.confidence.toFixed(2)} |`);
        }
      }
      md.push(``);
    }

    md.push(`## Raw responses`);
    md.push(``);
    for (const r of results) {
      md.push(`### Row #${r.flagged.id}`);
      md.push(``);
      for (const b of r.perBlock) {
        md.push(`#### report #${b.reportId}`);
        md.push("```");
        md.push(b.raw.slice(0, 1500) || "(empty)");
        md.push("```");
      }
      md.push(``);
    }

    fs.writeFileSync(outPath, md.join("\n"));
    console.log(`\n[done] wrote ${outPath}`);
    console.log(`[done] DROPPED=${counts.DROPPED} STILL_EMITTED=${counts["STILL EMITTED"]} REPLACED=${counts.REPLACED}`);
    if (errors.length > 0) console.log(`[done] errors=${errors.length}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
