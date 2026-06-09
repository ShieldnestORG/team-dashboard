/**
 * KG Cleanup — DRY RUN. Read-only audit of company_relationships rows that
 * pre-date the fix/kg-extractor-prompt + fix/kg-harvester-slug-attribution
 * patches and are likely contaminated by:
 *   - subject bleed from /ui or /web subdirs
 *   - harvester slug overloading
 *   - Dependabot / version-bump noise
 *   - non-entity targets (versions, runtimes, SHAs)
 *
 * Emits a markdown report with action recommendations and SQL it does NOT run.
 *
 * Run: npx tsx scripts/audit/kg-cleanup-dry-run.ts
 */

import { createRequire } from "module";
const require_ = createRequire("/Users/exe/Downloads/Claude/team-dashboard/packages/db/package.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgresRuntime: any = require_("postgres");
import * as fs from "fs";

// ---------------------------------------------------------------------------
// Env
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
if (!DATABASE_URL) throw new Error("DATABASE_URL missing");

// ---------------------------------------------------------------------------
// Heuristic config
// ---------------------------------------------------------------------------

// H1 — known frontend/dev tool targets that should never be a backend "uses"
const FRONTEND_TARGETS = new Set([
  "vite", "postcss", "webpack", "rollup", "tailwind", "tailwindcss",
  "esbuild", "snyk", "lefthook", "eslint", "prettier", "babel",
]);

// H1 — sources that are backend / cloud-service products. Prefix matches plus
// some known names.
const BACKEND_SOURCE_PREFIXES = ["aws-", "azure-", "gcp-", "amazon-", "google-cloud-"];
const BACKEND_SOURCE_LITERALS = new Set([
  "amazon-bedrock", "aws-bedrock", "azure-openai-service", "azure-openai",
  "amazon-web-services", "google-cloud-platform", "openai", "anthropic",
  "cohere", "vertex-ai", "sagemaker",
]);

// H3 — non-entity target patterns
const RX_VERSION = /^v?\d+(\.\d+){1,3}$/;
const RX_NODE = /^node\d+$/i;
const RX_SHA = /^[a-f0-9]{7,40}$/;

// H4 — Dependabot / bump headline patterns
const HEADLINE_BAD_NEEDLES = ["chore(deps", "updated to use", "bump "];

// H5 — known chain slugs (allowlist; intentionally small)
const KNOWN_CHAINS = new Set([
  "ethereum", "cosmos", "osmosis", "bitcoin", "solana", "polkadot",
  "polygon", "avalanche", "near", "sui", "aptos", "celestia", "injective",
]);

// H2 helpers — strip common org/vendor prefixes when comparing slug ↔ repo name
function canonicalRepoName(slug: string): string {
  return slug
    .replace(/^amazon-/, "")
    .replace(/^aws-/, "")
    .replace(/^azure-/, "")
    .replace(/^google-/, "")
    .replace(/^gcp-/, "")
    .replace(/-service$/, "")
    .toLowerCase();
}

function ghRepoFromUrl(url: string | null): { org: string; repo: string } | null {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!m) return null;
  return { org: m[1]!.toLowerCase(), repo: m[2]!.replace(/\.git$/i, "").toLowerCase() };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Edge {
  id: number;
  source_type: string;
  source_id: string;
  relationship: string;
  target_type: string;
  target_id: string;
  confidence: number;
  evidence_report_ids: number[];
  metadata: Record<string, unknown>;
  verified: boolean;
}

interface Report {
  id: number;
  headline: string | null;
  source_url: string | null;
}

type HeuristicId = "H1" | "H2" | "H3" | "H4" | "H5";

interface Hit {
  hid: HeuristicId;
  reason: string;
}

interface Flagged {
  edge: Edge;
  hits: Hit[];
  evidenceExcerpt: string;
  recommendation: "flag" | "flag+review" | "delete-candidate";
}

// ---------------------------------------------------------------------------
// Already-flagged ids per the 2026-04-27 audit
// ---------------------------------------------------------------------------
const ALREADY_FLAGGED = new Set([30, 38, 40, 67, 82, 197]);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sql = postgresRuntime(DATABASE_URL, { max: 2, idle_timeout: 5 });
  try {
    const edgesRaw = await sql<Edge[]>`
      SELECT id, source_type, source_id, relationship, target_type, target_id,
             confidence, evidence_report_ids, metadata, verified
      FROM company_relationships
      ORDER BY id ASC
    `;
    const edges: Edge[] = edgesRaw.map((e) => ({
      ...e,
      evidence_report_ids: Array.isArray(e.evidence_report_ids)
        ? (e.evidence_report_ids as unknown as number[]).map((n) => Number(n))
        : [],
      metadata: (e.metadata as Record<string, unknown>) ?? {},
    }));
    console.log(`[scan] loaded ${edges.length} edges`);

    // Pull all referenced reports in one shot
    const refIds = Array.from(new Set(edges.flatMap((e) => e.evidence_report_ids)));
    let reports: Report[] = [];
    if (refIds.length > 0) {
      reports = await sql<Report[]>`
        SELECT id, headline, source_url
        FROM intel_reports
        WHERE id = ANY(${refIds})
      `;
    }
    const reportById = new Map<number, Report>(reports.map((r) => [r.id, r]));
    console.log(`[scan] loaded ${reports.length} referenced intel_reports`);

    // -----------------------------------------------------------------------
    // Apply heuristics
    // -----------------------------------------------------------------------
    const flagged: Flagged[] = [];
    const heurCounts: Record<HeuristicId, number> = { H1: 0, H2: 0, H3: 0, H4: 0, H5: 0 };

    for (const e of edges) {
      const hits: Hit[] = [];
      const src = e.source_id.toLowerCase();
      const tgt = e.target_id.toLowerCase();
      const evidenceReports = e.evidence_report_ids
        .map((id) => reportById.get(id))
        .filter((r): r is Report => !!r);

      // -- H1
      const isBackendSource =
        BACKEND_SOURCE_LITERALS.has(src) ||
        BACKEND_SOURCE_PREFIXES.some((p) => src.startsWith(p));
      if (isBackendSource && FRONTEND_TARGETS.has(tgt)) {
        hits.push({
          hid: "H1",
          reason: `backend/cloud source "${src}" → frontend tool "${tgt}" (likely /ui subject bleed)`,
        });
      }

      // -- H2
      if (evidenceReports.length > 0) {
        const canon = canonicalRepoName(src);
        let mismatch: { url: string; repo: string } | null = null;
        let anyGh = false;
        for (const r of evidenceReports) {
          const gh = ghRepoFromUrl(r.source_url);
          if (!gh) continue;
          anyGh = true;
          // Match if repo contains canonical slug or canonical contains repo
          const repoLc = gh.repo;
          const orgLc = gh.org;
          const ok =
            repoLc.includes(canon) ||
            canon.includes(repoLc) ||
            orgLc.includes(canon) ||
            canon.includes(orgLc);
          if (ok) { mismatch = null; break; }
          mismatch = { url: r.source_url || "", repo: `${gh.org}/${gh.repo}` };
        }
        if (anyGh && mismatch) {
          hits.push({
            hid: "H2",
            reason: `slug "${src}" (canon "${canon}") not found in evidence repo "${mismatch.repo}"`,
          });
        }
      }

      // -- H3
      if (
        tgt.length < 3 ||
        RX_VERSION.test(tgt) ||
        RX_NODE.test(tgt) ||
        RX_SHA.test(tgt)
      ) {
        let why = "target too short";
        if (RX_VERSION.test(tgt)) why = "target is a version string";
        else if (RX_NODE.test(tgt)) why = "target is a node runtime version";
        else if (RX_SHA.test(tgt)) why = "target looks like a commit SHA";
        hits.push({ hid: "H3", reason: `${why}: "${tgt}"` });
      }

      // -- H4
      let h4Excerpt = "";
      for (const r of evidenceReports) {
        const h = (r.headline || "").toLowerCase();
        if (HEADLINE_BAD_NEEDLES.some((n) => h.includes(n))) {
          h4Excerpt = r.headline || "";
          hits.push({
            hid: "H4",
            reason: `evidence headline matches dependabot/bump pattern: "${(r.headline || "").slice(0, 80)}"`,
          });
          break;
        }
      }

      // -- H5 (validator-name-as-maintainer). We do not have a reliable
      // validator allowlist; we apply a conservative heuristic: source is a
      // single short proper-noun-shaped slug (no hyphens, < 16 chars,
      // alphabetic), relationship is "maintains", and target is a known chain.
      if (
        e.relationship === "maintains" &&
        KNOWN_CHAINS.has(tgt) &&
        /^[a-z][a-z0-9]{1,15}$/.test(src) &&
        !KNOWN_CHAINS.has(src) &&
        !src.includes("-")
      ) {
        hits.push({
          hid: "H5",
          reason: `single-word source "${src}" maintains chain "${tgt}" — possible validator-name leak`,
        });
      }

      if (hits.length === 0) continue;
      for (const h of hits) heurCounts[h.hid]++;

      // Recommendation
      let rec: Flagged["recommendation"];
      const ids = new Set(hits.map((h) => h.hid));
      if (ids.has("H3") || hits.length >= 2) rec = "delete-candidate";
      else if (ids.has("H2")) rec = "flag+review";
      else rec = "flag";

      // Evidence excerpt — first headline if available
      let excerpt = h4Excerpt;
      if (!excerpt && evidenceReports.length > 0) {
        excerpt = (evidenceReports[0]!.headline || "").slice(0, 120);
      }
      if (!excerpt) excerpt = "(no evidence rows resolved)";

      flagged.push({ edge: e, hits, evidenceExcerpt: excerpt, recommendation: rec });
    }

    // -----------------------------------------------------------------------
    // Render markdown
    // -----------------------------------------------------------------------
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const outPath = `/Users/exe/Downloads/Claude/team-dashboard/kg-cleanup-dry-run-${date}.md`;

    const md: string[] = [];
    md.push(`# KG Cleanup — Dry Run ${new Date().toISOString()}`);
    md.push(``);
    md.push(`- Branch: \`fix/kg-extractor-prompt\``);
    md.push(`- Mode: READ-ONLY. No rows modified.`);
    md.push(`- Population: ${edges.length} edges`);
    md.push(`- Referenced intel_reports loaded: ${reports.length}`);
    md.push(`- Already flagged in audit-2026-04-27: ${[...ALREADY_FLAGGED].join(", ")}`);
    md.push(``);

    md.push(`## Heuristic summary`);
    md.push(``);
    md.push(`| heuristic | description | hits |`);
    md.push(`|---|---|---|`);
    md.push(`| H1 | backend source → frontend tool target (subject bleed) | ${heurCounts.H1} |`);
    md.push(`| H2 | source slug not present in evidence GitHub repo (slug overloading) | ${heurCounts.H2} |`);
    md.push(`| H3 | target is a version/runtime/SHA/non-entity | ${heurCounts.H3} |`);
    md.push(`| H4 | evidence headline is dependabot/bump | ${heurCounts.H4} |`);
    md.push(`| H5 | single-word source "maintains" a known chain (validator leak) | ${heurCounts.H5} |`);
    md.push(`| **TOTAL UNIQUE ROWS FLAGGED** | | **${flagged.length}** |`);
    md.push(``);

    const recCounts = { flag: 0, "flag+review": 0, "delete-candidate": 0 };
    for (const f of flagged) recCounts[f.recommendation]++;
    md.push(`## Action bucket counts`);
    md.push(``);
    md.push(`| recommendation | count |`);
    md.push(`|---|---|`);
    md.push(`| flag | ${recCounts.flag} |`);
    md.push(`| flag+review | ${recCounts["flag+review"]} |`);
    md.push(`| delete-candidate | ${recCounts["delete-candidate"]} |`);
    md.push(``);

    md.push(`## Detailed findings`);
    md.push(``);
    md.push(`| id | src | rel | tgt | conf | verified | already_flagged_reason | heuristics | evidence | action |`);
    md.push(`|---|---|---|---|---|---|---|---|---|---|`);
    const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
    for (const f of flagged) {
      const e = f.edge;
      const prevReason =
        typeof e.metadata.flagged_reason === "string"
          ? (e.metadata.flagged_reason as string)
          : "";
      const heurStr = f.hits.map((h) => `${h.hid}: ${h.reason}`).join("; ");
      md.push(
        `| ${e.id} | ${e.source_id} | ${e.relationship} | ${e.target_id} | ${e.confidence.toFixed(2)} | ${e.verified} | ${esc(prevReason).slice(0, 40)} | ${esc(heurStr).slice(0, 200)} | ${esc(f.evidenceExcerpt).slice(0, 100)} | ${f.recommendation} |`,
      );
    }
    md.push(``);

    // Buckets
    const bucketFlag = flagged.filter((f) => f.recommendation === "flag" || f.recommendation === "flag+review");
    const bucketDelete = flagged.filter((f) => f.recommendation === "delete-candidate");
    const bucketAlready = flagged.filter((f) => ALREADY_FLAGGED.has(f.edge.id));

    md.push(`## Buckets`);
    md.push(``);
    md.push(`### Flag for re-review (would set metadata.flagged_reason + verified=false)`);
    md.push(``);
    if (bucketFlag.length === 0) md.push(`_(none)_`);
    else for (const f of bucketFlag) {
      md.push(`- #${f.edge.id} \`${f.edge.source_id} —${f.edge.relationship}→ ${f.edge.target_id}\` (${f.hits.map((h) => h.hid).join("+")})`);
    }
    md.push(``);

    md.push(`### Delete candidates (DESTRUCTIVE — operator review required)`);
    md.push(``);
    if (bucketDelete.length === 0) md.push(`_(none)_`);
    else for (const f of bucketDelete) {
      md.push(`- #${f.edge.id} \`${f.edge.source_id} —${f.edge.relationship}→ ${f.edge.target_id}\` (${f.hits.map((h) => h.hid).join("+")}) — ${f.evidenceExcerpt.slice(0, 80)}`);
    }
    md.push(``);

    md.push(`### Already flagged in audit-2026-04-27-subject-bleed`);
    md.push(``);
    if (bucketAlready.length === 0) md.push(`_(none of the previously flagged 6 ids re-surfaced via heuristics; see notes)_`);
    else for (const f of bucketAlready) {
      md.push(`- #${f.edge.id} \`${f.edge.source_id} —${f.edge.relationship}→ ${f.edge.target_id}\` — re-detected via ${f.hits.map((h) => h.hid).join("+")}`);
    }
    const missingFromHeuristics = [...ALREADY_FLAGGED].filter((id) => !flagged.some((f) => f.edge.id === id));
    if (missingFromHeuristics.length > 0) {
      md.push(``);
      md.push(`Previously-flagged ids NOT re-detected by heuristics (operator should still trust the manual flag): ${missingFromHeuristics.join(", ")}`);
    }
    md.push(``);

    // -----------------------------------------------------------------------
    // SQL the operator can run after review (NOT executed here)
    // -----------------------------------------------------------------------
    md.push(`## Proposed SQL (NOT executed)`);
    md.push(``);
    md.push("```sql");
    md.push(`-- A. Flag suspect rows (safe — additive metadata only).`);
    md.push(`-- Sets metadata.flagged_reason and verified=false. Review the list first.`);
    if (bucketFlag.length === 0) {
      md.push(`-- (no rows to flag)`);
    } else {
      const ids = bucketFlag.map((f) => f.edge.id).join(", ");
      md.push(`UPDATE company_relationships`);
      md.push(`SET metadata = metadata || jsonb_build_object(`);
      md.push(`      'flagged_reason', 'kg-cleanup-dry-run-${date} heuristic match',`);
      md.push(`      'flagged_at', to_jsonb(NOW())`);
      md.push(`    ),`);
      md.push(`    verified = false,`);
      md.push(`    updated_at = NOW()`);
      md.push(`WHERE id IN (${ids});`);
    }
    md.push(``);
    md.push(`-- B. Delete obvious garbage (DESTRUCTIVE — review the list above first).`);
    if (bucketDelete.length === 0) {
      md.push(`-- (no rows in delete bucket)`);
    } else {
      const ids = bucketDelete.map((f) => f.edge.id).join(", ");
      md.push(`DELETE FROM company_relationships WHERE id IN (${ids});`);
    }
    md.push("```");
    md.push(``);

    md.push(`## Notes / known limitations`);
    md.push(``);
    md.push(`- H2 uses simple substring matching with prefix-stripping ("amazon-", "aws-", "azure-"). False positives are possible when the canonical product name differs from the GitHub repo path (e.g. "azure-openai-service" vs "openai/openai-cookbook"). Operator should eyeball every H2-only hit before deleting.`);
    md.push(`- H5 has no validator allowlist available in this dataset; the proxy heuristic (single-word source + known-chain target + "maintains") is intentionally conservative. A 0-hit count means we lack the data, not necessarily that the bug class is absent.`);
    md.push(`- H3 is the highest-precision heuristic — version strings, "node24", and SHAs are essentially never valid relationship targets.`);
    md.push(`- The 6 manually flagged ids may not all re-surface via heuristics if their pattern is too narrow (e.g. row 30 may be a one-off the heuristics don't model). Trust the manual flag in those cases.`);
    md.push(``);

    fs.writeFileSync(outPath, md.join("\n"));
    console.log(`\n[done] wrote ${outPath}`);
    console.log(`[done] flagged ${flagged.length} / ${edges.length} edges`);
    console.log(`[done] H1=${heurCounts.H1} H2=${heurCounts.H2} H3=${heurCounts.H3} H4=${heurCounts.H4} H5=${heurCounts.H5}`);
    console.log(`[done] flag=${recCounts.flag} flag+review=${recCounts["flag+review"]} delete=${recCounts["delete-candidate"]}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
