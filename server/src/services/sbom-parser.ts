/**
 * SBOM Deterministic Parser — owned by Nexus agent.
 *
 * Replaces the LLM for dependency extraction. Reads `package.json` and
 * `go.mod` directly and emits `depends_on` edges with explicit scope
 * (runtime | devDependency). Never trusts `company_slug` for SBOM
 * attribution — the source side of the edge is always a `owner/repo`
 * string derived from the URL the harvester already has.
 *
 * Design: docs/architecture/sbom-parser-design.md
 *
 * v1 scope: package.json + go.mod only. No transitive resolution, no
 * lockfile parsing, no license/CVE data. See design doc §7.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

export type DependencyScope = "runtime" | "devDependency";

export interface SbomEdge {
  /** "owner/repo" — never a company slug. */
  source: string;
  relationship: "depends_on";
  /** Bare package name (npm) or module path (Go). */
  target: string;
  scope: DependencyScope;
}

// ---------------------------------------------------------------------------
// Pure parsers (unit-testable)
// ---------------------------------------------------------------------------

/**
 * Parse a `package.json` text blob into dependency edges.
 *
 * - `dependencies` -> scope: "runtime"
 * - `devDependencies` -> scope: "devDependency"
 * - `peerDependencies` / `optionalDependencies` are ignored in v1.
 *
 * Returns [] for malformed input or missing fields. Scoped packages
 * (`@scope/pkg`) are preserved verbatim as the target.
 */
export function parsePackageJson(sourceRepo: string, text: string): SbomEdge[] {
  if (!sourceRepo || !text) return [];
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  if (!json || typeof json !== "object") return [];

  const obj = json as Record<string, unknown>;
  const edges: SbomEdge[] = [];

  const pull = (key: string, scope: DependencyScope) => {
    const block = obj[key];
    if (!block || typeof block !== "object") return;
    for (const name of Object.keys(block as Record<string, unknown>)) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      // npm allows @scope/name and bare names. Reject anything weird.
      if (!/^(@[^/\s]+\/)?[^\s@/][^\s]*$/.test(trimmed)) continue;
      edges.push({
        source: sourceRepo,
        relationship: "depends_on",
        target: trimmed,
        scope,
      });
    }
  };

  pull("dependencies", "runtime");
  pull("devDependencies", "devDependency");

  return edges;
}

/**
 * Parse a `go.mod` text blob into dependency edges.
 *
 * Go has no dev/runtime split at the manifest level — every `require` is
 * runtime. Lines marked `// indirect` would normally be `transitive`, but
 * v1 deliberately scopes them as `runtime` because go.mod conflates direct
 * and transitive (resolved by the toolchain). Treat as a known limitation.
 *
 * Handles both single-line `require foo v1.2.3` and block form
 * `require ( ... )`. Ignores `module`, `go`, `replace`, `exclude`,
 * `retract`, and comment-only lines.
 */
export function parseGoMod(sourceRepo: string, text: string): SbomEdge[] {
  if (!sourceRepo || !text) return [];
  const edges: SbomEdge[] = [];
  const lines = text.split(/\r?\n/);

  let inRequireBlock = false;
  for (const rawLine of lines) {
    // Strip line comments but keep the directive itself.
    const noComment = rawLine.replace(/\/\/.*$/, "").trim();
    if (!noComment) continue;

    if (inRequireBlock) {
      if (noComment === ")") { inRequireBlock = false; continue; }
      const m = noComment.match(/^([^\s]+)\s+v\S+/);
      if (m) edges.push(toGoEdge(sourceRepo, m[1]!));
      continue;
    }

    if (noComment.startsWith("require (")) {
      inRequireBlock = true;
      continue;
    }
    if (noComment.startsWith("require ")) {
      const m = noComment.match(/^require\s+([^\s]+)\s+v\S+/);
      if (m) edges.push(toGoEdge(sourceRepo, m[1]!));
    }
  }

  return edges;
}

function toGoEdge(sourceRepo: string, modulePath: string): SbomEdge {
  return {
    source: sourceRepo,
    relationship: "depends_on",
    target: modulePath,
    scope: "runtime",
  };
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Extract `owner/repo` from a github.com URL (release, commit, tree, etc.).
 * Returns null for anything we can't confidently parse.
 */
export function extractRepoFromGithubUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)/i);
  if (!m) return null;
  const owner = m[1]!;
  const repo = m[2]!.replace(/\.git$/, "");
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

// ---------------------------------------------------------------------------
// Manifest fetcher
// ---------------------------------------------------------------------------

const RAW_GITHUB = "https://raw.githubusercontent.com";

interface FetchedManifest {
  path: "package.json" | "go.mod";
  text: string;
}

/**
 * Best-effort fetch of root-level manifests. 404s are the common case and
 * return null silently. Network errors return null.
 */
export async function fetchManifests(
  sourceRepo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedManifest[]> {
  const out: FetchedManifest[] = [];
  for (const path of ["package.json", "go.mod"] as const) {
    try {
      const res = await fetchImpl(`${RAW_GITHUB}/${sourceRepo}/HEAD/${path}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.length > 0 && text.length < 1_000_000) {
        out.push({ path, text });
      }
    } catch {
      /* network error / timeout — skip */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public entry: parse + store
// ---------------------------------------------------------------------------

export interface SbomParseResult {
  edgesWritten: number;
  manifestsFound: number;
}

/**
 * Best-effort. Never throws — callers (the harvester) wrap with their own
 * try/catch but should never block on this.
 *
 * Skips the row entirely if `sourceRepo` is null. This is the structural
 * fix for the slug-overloading bug — we never invent a source side.
 */
export async function parseAndStoreSbom(
  db: Db,
  args: {
    sourceRepo: string | null;
    intelReportId: number;
    fetchImpl?: typeof fetch;
  },
): Promise<SbomParseResult> {
  const result: SbomParseResult = { edgesWritten: 0, manifestsFound: 0 };
  if (!args.sourceRepo) return result;

  const manifests = await fetchManifests(args.sourceRepo, args.fetchImpl);
  result.manifestsFound = manifests.length;
  if (manifests.length === 0) return result;

  const edges: SbomEdge[] = [];
  for (const m of manifests) {
    if (m.path === "package.json") edges.push(...parsePackageJson(args.sourceRepo, m.text));
    else if (m.path === "go.mod") edges.push(...parseGoMod(args.sourceRepo, m.text));
  }

  if (edges.length === 0) return result;

  const evidence = JSON.stringify([args.intelReportId]);
  for (const edge of edges) {
    try {
      await db.execute(sql`
        INSERT INTO company_relationships
          (source_type, source_id, relationship, target_type, target_id,
           confidence, evidence_report_ids, extracted_by, scope)
        VALUES
          ('repo', ${edge.source}, 'depends_on',
           'package', ${edge.target}, 1.0,
           ${evidence}::jsonb, 'sbom-parser', ${edge.scope})
        ON CONFLICT (source_type, source_id, relationship, target_type, target_id)
        DO UPDATE SET
          evidence_report_ids = (
            SELECT jsonb_agg(DISTINCT v)
            FROM jsonb_array_elements(
              company_relationships.evidence_report_ids || EXCLUDED.evidence_report_ids
            ) AS v
          ),
          scope = COALESCE(company_relationships.scope, EXCLUDED.scope),
          updated_at = NOW()
      `);
      result.edgesWritten++;
    } catch (err) {
      logger.warn({ err, edge }, "sbom-parser: failed to upsert depends_on edge");
    }
  }

  return result;
}
