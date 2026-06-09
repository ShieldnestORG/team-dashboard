/**
 * KG Extractor A/B Test — held-out batch validation for the
 * fix/kg-extractor-prompt branch. Read-only on production data.
 *
 * Picks 10 stress-test reports, runs OLD vs NEW EXTRACTION_PROMPT through
 * Ollama Cloud, dumps a side-by-side markdown report for human grading.
 *
 * Run: npx tsx scripts/audit/kg-extractor-ab-test.ts
 */

// Runtime postgres import via createRequire so we resolve from packages/db.
import { createRequire } from "module";
const require_ = createRequire("/Users/exe/Downloads/Claude/team-dashboard/packages/db/package.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgresRuntime: any = require_("postgres");
import * as fs from "fs";
import * as path from "path";

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
// Prompts
// ---------------------------------------------------------------------------

const OLD_PROMPT = `You are a knowledge graph extraction agent. Given an intel report about a blockchain/crypto/tech company, extract structured relationship triples.

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

Example output:
[{"source":"Osmosis","relationship":"built_on","target":"Cosmos SDK","confidence":0.95},{"source":"Osmosis","relationship":"integrates","target":"IBC Protocol","confidence":0.9}]

Intel report:
`;

const NEW_PROMPT = `You are a knowledge graph extraction agent. Given an intel report about a blockchain/crypto/tech company, extract structured relationship triples.

CRITICAL — SUBJECT SCOPING RULES (read before extracting):
1. Each report block is delimited by "---". Treat blocks as INDEPENDENT.
   Never emit a triple whose source comes from one block and whose target
   comes from a different block.
2. The bracketed slug at the start of each block (e.g. "[argo-cd]") is the
   ONLY allowed value for "source" in that block. Do not infer a different
   subject from text inside the block.
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
// Ollama call (mirrors callOllamaGenerate, with low temperature for determinism)
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
// Triple parsing (clone of parseTriples)
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

function key(t: Triple): string {
  return `${t.source.toLowerCase()}|${t.relationship}|${t.target.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Report selection
// ---------------------------------------------------------------------------

interface Report {
  id: number;
  company_slug: string;
  headline: string;
  body: string;
  source_url: string | null;
  category: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pickReports(sql: any): Promise<Report[]> {
  // Reports never used as evidence in any company_relationships row
  // evidence_report_ids is jsonb array of integers
  const usedRows = await sql<{ id: number }[]>`
    SELECT DISTINCT (jsonb_array_elements(evidence_report_ids))::text::int AS id
    FROM company_relationships
    WHERE jsonb_typeof(evidence_report_ids) = 'array'
      AND jsonb_array_length(evidence_report_ids) > 0
  `;
  const usedSet = new Set(usedRows.map((r) => r.id));
  console.log(`[pick] ${usedSet.size} report ids already used as evidence`);

  // Category A: known-overloaded slugs
  const aSlugs = ["aws-bedrock", "azure-openai-service", "argo-cd", "amazon-web-services"];
  const a = await sql<Report[]>`
    SELECT id, company_slug, headline, body, source_url, 'overloaded-slug'::text AS category
    FROM intel_reports
    WHERE company_slug = ANY(${aSlugs})
    ORDER BY captured_at DESC
    LIMIT 60
  `;

  // Category B: dependabot pattern
  const b = await sql<Report[]>`
    SELECT id, company_slug, headline, body, source_url, 'dependabot'::text AS category
    FROM intel_reports
    WHERE headline ILIKE '%chore(deps%' OR headline ILIKE '%bump %'
    ORDER BY captured_at DESC
    LIMIT 60
  `;

  // Category C: substantive prose
  const c = await sql<Report[]>`
    SELECT id, company_slug, headline, body, source_url, 'substantive-prose'::text AS category
    FROM intel_reports
    WHERE length(body) >= 500
      AND report_type != 'discovery'
      AND headline NOT ILIKE '%chore(deps%'
      AND headline NOT ILIKE '%bump %'
    ORDER BY captured_at DESC
    LIMIT 60
  `;

  const filterUnused = (rs: Report[]) => rs.filter((r) => !usedSet.has(r.id));
  const aF = filterUnused(a);
  const bF = filterUnused(b);
  const cF = filterUnused(c);
  console.log(`[pick] available unused — A:${aF.length} B:${bF.length} C:${cF.length}`);

  const picked: Report[] = [];
  const seen = new Set<number>();
  const take = (pool: Report[], n: number) => {
    for (const r of pool) {
      if (picked.length >= 10) break;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      picked.push(r);
      if (picked.filter((p) => p.category === pool[0]?.category).length >= n) break;
    }
  };
  take(aF, 4);
  take(bF, 4);
  take(cF, 2);
  // Pad if short
  for (const pool of [aF, bF, cF]) {
    if (picked.length >= 10) break;
    for (const r of pool) {
      if (picked.length >= 10) break;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      picked.push(r);
    }
  }
  return picked.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sql = postgresRuntime(DATABASE_URL, { max: 2, idle_timeout: 5 });
  const errors: string[] = [];

  try {
    const reports = await pickReports(sql);
    console.log(`\n[pick] selected ${reports.length} reports:`);
    for (const r of reports) {
      console.log(`  #${r.id} [${r.category}] [${r.company_slug}] ${r.headline.slice(0, 80)}`);
    }
    if (reports.length === 0) {
      throw new Error("No reports selected — aborting");
    }

    interface Run { report: Report; oldTriples: Triple[]; newTriples: Triple[]; oldRaw: string; newRaw: string; oldErr?: string; newErr?: string; }
    const runs: Run[] = [];

    for (const r of reports) {
      const block = `[${r.company_slug}] ${r.headline}\n${r.body.slice(0, 500)}`;
      console.log(`\n[run] report #${r.id}`);

      let oldRaw = ""; let newRaw = ""; let oldTriples: Triple[] = []; let newTriples: Triple[] = [];
      let oldErr: string | undefined; let newErr: string | undefined;

      try {
        oldRaw = await callOllama(OLD_PROMPT + block);
        oldTriples = parseTriples(oldRaw);
        console.log(`  OLD → ${oldTriples.length} triples`);
      } catch (e) {
        oldErr = (e as Error).message;
        errors.push(`#${r.id} OLD: ${oldErr}`);
        console.log(`  OLD ERR: ${oldErr}`);
      }

      try {
        newRaw = await callOllama(NEW_PROMPT + block);
        newTriples = parseTriples(newRaw);
        console.log(`  NEW → ${newTriples.length} triples`);
      } catch (e) {
        newErr = (e as Error).message;
        errors.push(`#${r.id} NEW: ${newErr}`);
        console.log(`  NEW ERR: ${newErr}`);
      }

      runs.push({ report: r, oldTriples, newTriples, oldRaw, newRaw, oldErr, newErr });
    }

    // ---- Markdown output ----
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const outPath = `/Users/exe/Downloads/Claude/team-dashboard/kg-extractor-ab-results-${date}.md`;
    const md: string[] = [];
    md.push(`# KG Extractor A/B Test — ${new Date().toISOString()}`);
    md.push(``);
    md.push(`- Branch: \`fix/kg-extractor-prompt\``);
    md.push(`- Model: \`${OLLAMA_MODEL}\` @ \`${OLLAMA_URL}\``);
    md.push(`- Temperature: 0.1`);
    md.push(`- Reports: ${reports.length}`);
    md.push(``);

    if (errors.length > 0) {
      md.push(`## Errors`);
      for (const e of errors) md.push(`- ${e}`);
      md.push(``);
    }

    md.push(`## Selected reports`);
    md.push(``);
    md.push(`| id | category | slug | headline | source_url |`);
    md.push(`|---|---|---|---|---|`);
    for (const r of reports) {
      const url = (r.source_url || "").slice(0, 60);
      const head = r.headline.replace(/\|/g, "\\|").slice(0, 80);
      md.push(`| ${r.id} | ${r.category} | ${r.company_slug} | ${head} | ${url} |`);
    }
    md.push(``);

    // Summary table
    let totOld = 0, totNew = 0, oldOnly = 0, newOnly = 0, both = 0;
    for (const run of runs) {
      const oldKeys = new Set(run.oldTriples.map(key));
      const newKeys = new Set(run.newTriples.map(key));
      totOld += oldKeys.size;
      totNew += newKeys.size;
      for (const k of oldKeys) if (newKeys.has(k)) both++; else oldOnly++;
      for (const k of newKeys) if (!oldKeys.has(k)) newOnly++;
    }
    md.push(`## Summary`);
    md.push(``);
    md.push(`| metric | count |`);
    md.push(`|---|---|`);
    md.push(`| OLD triples (total) | ${totOld} |`);
    md.push(`| NEW triples (total) | ${totNew} |`);
    md.push(`| OLD-only (regressions caught by patch) | ${oldOnly} |`);
    md.push(`| NEW-only (new emissions to vet) | ${newOnly} |`);
    md.push(`| In both | ${both} |`);
    md.push(``);

    md.push(`## Per-report side-by-side`);
    md.push(``);
    let gradeIdx = 0;
    interface GradeRow { reportId: number; side: "OLD" | "NEW"; idx: number; triple: string; }
    const gradeRows: GradeRow[] = [];

    for (const run of runs) {
      md.push(`### Report #${run.report.id} — \`${run.report.company_slug}\` (${run.report.category})`);
      md.push(``);
      md.push(`**Headline:** ${run.report.headline}`);
      md.push(``);
      md.push(`**Body (first 500 chars):**`);
      md.push(``);
      md.push("```");
      md.push(run.report.body.slice(0, 500));
      md.push("```");
      md.push(``);
      if (run.report.source_url) md.push(`**Source:** ${run.report.source_url}`);
      md.push(``);
      md.push(`#### OLD prompt → ${run.oldTriples.length} triples${run.oldErr ? ` (ERROR: ${run.oldErr})` : ""}`);
      md.push(``);
      if (run.oldTriples.length === 0) {
        md.push(`_(none)_`);
      } else {
        md.push(`| # | source | rel | target | conf |`);
        md.push(`|---|---|---|---|---|`);
        run.oldTriples.forEach((t, i) => {
          md.push(`| O${i + 1} | ${t.source} | ${t.relationship} | ${t.target} | ${t.confidence.toFixed(2)} |`);
          gradeRows.push({ reportId: run.report.id, side: "OLD", idx: i + 1, triple: `${t.source} —${t.relationship}→ ${t.target}` });
        });
      }
      md.push(``);
      md.push(`#### NEW prompt → ${run.newTriples.length} triples${run.newErr ? ` (ERROR: ${run.newErr})` : ""}`);
      md.push(``);
      if (run.newTriples.length === 0) {
        md.push(`_(none)_`);
      } else {
        md.push(`| # | source | rel | target | conf |`);
        md.push(`|---|---|---|---|---|`);
        run.newTriples.forEach((t, i) => {
          md.push(`| N${i + 1} | ${t.source} | ${t.relationship} | ${t.target} | ${t.confidence.toFixed(2)} |`);
          gradeRows.push({ reportId: run.report.id, side: "NEW", idx: i + 1, triple: `${t.source} —${t.relationship}→ ${t.target}` });
        });
      }
      md.push(``);
      // Diff
      const oldKeys = new Set(run.oldTriples.map(key));
      const newKeys = new Set(run.newTriples.map(key));
      const dropped = run.oldTriples.filter((t) => !newKeys.has(key(t)));
      const added = run.newTriples.filter((t) => !oldKeys.has(key(t)));
      if (dropped.length || added.length) {
        md.push(`**Diff:**`);
        for (const t of dropped) md.push(`- DROPPED (OLD-only): ${t.source} —${t.relationship}→ ${t.target}`);
        for (const t of added) md.push(`- ADDED (NEW-only): ${t.source} —${t.relationship}→ ${t.target}`);
        md.push(``);
      }
      gradeIdx++;
    }

    md.push(`## Operator grading`);
    md.push(``);
    md.push(`Mark each triple as correct / wrong / vacuous. Add notes inline.`);
    md.push(``);
    for (const g of gradeRows) {
      md.push(`- [ ] #${g.reportId} ${g.side} ${g.idx}: \`${g.triple}\` — _correct / wrong / vacuous_`);
    }
    // Pad to ~30 rows
    for (let i = gradeRows.length; i < 30; i++) {
      md.push(`- [ ] (spare ${i + 1}) — _correct / wrong / vacuous_`);
    }
    md.push(``);

    md.push(`## Raw responses (for debugging)`);
    md.push(``);
    for (const run of runs) {
      md.push(`### #${run.report.id}`);
      md.push(``);
      md.push(`OLD raw:`);
      md.push("```");
      md.push(run.oldRaw.slice(0, 2000));
      md.push("```");
      md.push(`NEW raw:`);
      md.push("```");
      md.push(run.newRaw.slice(0, 2000));
      md.push("```");
      md.push(``);
    }

    fs.writeFileSync(outPath, md.join("\n"));
    console.log(`\n[done] wrote ${outPath}`);
    console.log(`[done] OLD=${totOld} NEW=${totNew} oldOnly=${oldOnly} newOnly=${newOnly} both=${both}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
