/**
 * KG Phase 1 (silent dependencies block) — production validation.
 *
 * Re-runnable any time. Reads DATABASE_URL from .env and SSHes into VPS1
 * for the Intel API spot-checks. Emits a markdown report to stdout.
 *
 * Run: npx tsx scripts/audit/kg-phase1-validation.ts
 *
 * Baseline (post-merge of PR #20, 2026-04-28T17:30 PDT):
 *   - company_relationships:        135 total
 *   - company_relationships verified: 87
 *   - flagged unverified:             48 (all H2: harvester slug overload)
 *   - relationships by type:        (recorded by this script's first run)
 *   - depends_on edges:               0 (SBOM parser hasn't run on a harvest yet)
 */

import { createRequire } from "module";
import * as fs from "fs";
import { execSync } from "child_process";

const require_ = createRequire("/Users/exe/Downloads/Claude/team-dashboard/packages/db/package.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgresRuntime: any = require_("postgres");

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
if (!DATABASE_URL) throw new Error("DATABASE_URL missing from .env");

const VPS1_HOST = "root@31.220.61.12";
const SPOT_CHECK_SLUGS = ["anthropic", "openai", "vercel", "stripe", "ethereum"];

// Baseline from 2026-04-28 post-merge spot-check.
const BASELINE = {
  total: 135,
  verified: 87,
  unverified: 48,
  depends_on: 0,
};

async function main() {
  const sql = postgresRuntime(DATABASE_URL, { ssl: "require" });
  const lines: string[] = [];
  const now = new Date().toISOString();
  lines.push(`# KG Phase 1 Validation — ${now}`);
  lines.push("");
  lines.push("Compares against the 2026-04-28 17:30 PDT post-merge baseline.");
  lines.push("");

  // --- Edge counts ---
  const counts = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE verified = true)::int AS verified,
      COUNT(*) FILTER (WHERE verified = false)::int AS unverified,
      COUNT(*) FILTER (WHERE relationship = 'depends_on')::int AS depends_on,
      COUNT(*) FILTER (WHERE relationship = 'depends_on' AND verified = true)::int AS depends_on_verified,
      COUNT(*) FILTER (WHERE relationship = 'uses' AND verified = true)::int AS uses_verified,
      COUNT(*) FILTER (WHERE relationship = 'integrates' AND verified = true)::int AS integrates_verified,
      COUNT(*) FILTER (WHERE relationship = 'maintains' AND verified = true)::int AS maintains_verified,
      COUNT(*) FILTER (WHERE relationship = 'built_on' AND verified = true)::int AS built_on_verified,
      COUNT(*) FILTER (WHERE created_at > '2026-04-28 17:30:00')::int AS new_since_baseline
    FROM company_relationships
  `;
  const c = counts[0];

  lines.push("## Edge counts");
  lines.push("");
  lines.push("| Metric | Now | Baseline | Δ |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| total | ${c.total} | ${BASELINE.total} | ${c.total - BASELINE.total} |`);
  lines.push(`| verified | ${c.verified} | ${BASELINE.verified} | ${c.verified - BASELINE.verified} |`);
  lines.push(`| unverified | ${c.unverified} | ${BASELINE.unverified} | ${c.unverified - BASELINE.unverified} |`);
  lines.push(`| depends_on (any) | ${c.depends_on} | ${BASELINE.depends_on} | ${c.depends_on - BASELINE.depends_on} |`);
  lines.push(`| new since baseline | ${c.new_since_baseline} | — | — |`);
  lines.push("");

  lines.push("### Verified edges by relationship (only verified counts toward Phase 1)");
  lines.push("");
  lines.push("| Relationship | Count |");
  lines.push("|---|---:|");
  lines.push(`| uses | ${c.uses_verified} |`);
  lines.push(`| integrates | ${c.integrates_verified} |`);
  lines.push(`| built_on | ${c.built_on_verified} |`);
  lines.push(`| maintains | ${c.maintains_verified} |`);
  lines.push(`| depends_on | ${c.depends_on_verified} |`);
  lines.push("");

  // --- Flags ---
  const flags: string[] = [];
  if (c.verified <= BASELINE.verified) {
    flags.push(`⚠️ verified count has NOT grown (${c.verified} ≤ ${BASELINE.verified}). Re-extraction under the patched prompt should be flipping flagged rows to verified.`);
  }
  if (c.depends_on === 0) {
    flags.push(`⚠️ Zero depends_on edges. SBOM parser hasn't run successfully on any harvested package.json/go.mod yet. Check intel:github + intel:harvest cron last-run times.`);
  }
  if (c.new_since_baseline === 0) {
    flags.push(`⚠️ Zero new edges since baseline. Either no harvester activity or extractor is failing silently.`);
  }
  lines.push("## Flags");
  lines.push("");
  if (flags.length === 0) {
    lines.push("✅ All thresholds met.");
  } else {
    for (const f of flags) lines.push(`- ${f}`);
  }
  lines.push("");

  // --- Spot-check Intel API ---
  lines.push("## Intel API spot-check");
  lines.push("");
  lines.push("| Slug | Status | Buckets | Notes |");
  lines.push("|---|---|---|---|");
  for (const slug of SPOT_CHECK_SLUGS) {
    try {
      const out = execSync(
        `ssh -o ConnectTimeout=5 ${VPS1_HOST} 'docker exec team-dashboard-server-1 curl -s http://localhost:3100/api/intel/company/${slug}'`,
        { encoding: "utf8", timeout: 10000 },
      );
      const json = JSON.parse(out);
      const hasField = "dependencies" in json;
      const deps = json.dependencies ?? {};
      const buckets = Object.entries(deps)
        .map(([k, v]) => `${k}=${(v as unknown[]).length}`)
        .join(", ") || "(empty)";
      const note = hasField ? "" : "FIELD MISSING";
      lines.push(`| ${slug} | ✓ | ${buckets} | ${note} |`);
    } catch (err) {
      lines.push(`| ${slug} | ❌ | — | ${(err as Error).message.slice(0, 60)} |`);
    }
  }
  lines.push("");

  // --- KG cron last-run state ---
  try {
    const cronJson = execSync(
      `ssh -o ConnectTimeout=5 ${VPS1_HOST} 'docker exec team-dashboard-server-1 curl -s http://localhost:3100/api/system-crons'`,
      { encoding: "utf8", timeout: 10000 },
    );
    const cronData = JSON.parse(cronJson);
    const kgJobs = (cronData.crons ?? []).filter((j: { jobName: string }) =>
      j.jobName.startsWith("kg:") || j.jobName.startsWith("intel:") || j.jobName.startsWith("memory:"),
    );
    lines.push("## KG / Intel cron last-run");
    lines.push("");
    lines.push("| Job | Last run | Duration | Last error | Run count |");
    lines.push("|---|---|---:|---|---:|");
    for (const j of kgJobs) {
      const errCell = j.lastError ? "❌ " + String(j.lastError).slice(0, 40) : "—";
      lines.push(`| ${j.jobName} | ${j.lastRunAt ?? "—"} | ${j.lastDurationMs ?? "—"}ms | ${errCell} | ${j.runCount ?? "—"} |`);
    }
    lines.push("");
  } catch (err) {
    lines.push(`## KG / Intel cron last-run\n\n(failed to fetch: ${(err as Error).message.slice(0, 80)})\n`);
  }

  await sql.end();
  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error("validation failed:", err);
  process.exit(1);
});
