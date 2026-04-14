/**
 * Advisory PR drafter for approved SEO audit suggestions.
 *
 * v1 strategy (Option A in PRD §6.1):
 *   The advisor's `proposedPatch` is a snippet, not a full-file diff, so we
 *   do NOT mutate the real source file. Instead we:
 *     1. Branch off the repo's default branch.
 *     2. Commit a single marker file `.seo-audit/SUGGESTION-<short-id>.md`
 *        containing the full suggestion, rationale, and proposed patch.
 *     3. Open a PR whose description is a complete human-readable rendering
 *        of the suggestion plus a big NEVER-auto-merge warning.
 *
 * The PR is the artifact. A human reviews the marker file + description,
 * hand-applies the actual change, and merges. Option B (Ollama-merged real
 * diff) is noted as a future follow-up.
 *
 * Safety:
 *   - GITHUB_TOKEN must be present or we throw before any API call.
 *   - `repo` must be in the hard-coded allowlist.
 *   - Suggestion must be in `approved` status.
 *   - PR body must contain the exact DO-NOT-merge disclaimer string.
 *   - We NEVER call any merge endpoint. Ever.
 */

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { repoUpdateSuggestions } from "@paperclipai/db";
import {
  createBranch,
  createPullRequest,
  getDefaultBranch,
  updateFileOnBranch,
} from "./github-client.js";

export const SAGE_REPO_ALLOWLIST = [
  "ShieldnestORG/coherencedaddy",
  "ShieldnestORG/team-dashboard",
  "ShieldnestORG/v1_shieldnest_org",
  "ShieldnestORG/shieldnest_landing_page",
] as const;

export const PR_DISCLAIMER =
  "Auto-drafted by Sage (SEO/AEO Audit Advisor). Human review required — DO NOT merge without verifying.";

type Suggestion = typeof repoUpdateSuggestions.$inferSelect;

export interface DraftPrResult {
  suggestion: Suggestion;
  pr: { number: number; url: string };
}

function sanitizeBranchSegment(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "item";
}

function hostOf(urlString: string): string {
  try {
    return new URL(urlString).host;
  } catch {
    return urlString.slice(0, 40);
  }
}

function severityEmoji(severity: string): string {
  switch (severity) {
    case "critical":
      return "[CRITICAL]";
    case "high":
      return "[HIGH]";
    case "medium":
      return "[MEDIUM]";
    case "low":
      return "[LOW]";
    default:
      return `[${severity.toUpperCase()}]`;
  }
}

function renderMarkerFile(s: Suggestion): string {
  const lines: string[] = [];
  lines.push(`# SEO Audit Suggestion — ${s.checklistItem}`);
  lines.push("");
  lines.push(`- **ID:** ${s.id}`);
  lines.push(`- **Severity:** ${s.severity}`);
  lines.push(`- **Site:** ${s.siteUrl}`);
  lines.push(`- **Repo:** ${s.repo}`);
  if (s.filePath) lines.push(`- **File:** \`${s.filePath}\``);
  if (s.auditRunId) lines.push(`- **Audit run:** ${s.auditRunId}`);
  lines.push(`- **Created:** ${s.createdAt.toISOString?.() ?? String(s.createdAt)}`);
  lines.push("");
  lines.push("## Issue");
  lines.push("");
  lines.push(s.issue);
  lines.push("");
  if (s.rationale) {
    lines.push("## Rationale");
    lines.push("");
    lines.push(s.rationale);
    lines.push("");
  }
  if (s.proposedPatch) {
    lines.push("## Proposed patch");
    lines.push("");
    lines.push("```" + (s.language || ""));
    lines.push(s.proposedPatch);
    lines.push("```");
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push(PR_DISCLAIMER);
  return lines.join("\n");
}

function renderPrBody(s: Suggestion, siteHost: string): string {
  const lines: string[] = [];
  lines.push(`## ${severityEmoji(s.severity)} ${s.checklistItem}`);
  lines.push("");
  lines.push(`Sage's SEO/AEO audit flagged a failure on **${siteHost}**.`);
  lines.push("");
  lines.push("### Issue");
  lines.push("");
  lines.push(s.issue);
  lines.push("");
  if (s.rationale) {
    lines.push("### Rationale");
    lines.push("");
    lines.push(s.rationale);
    lines.push("");
  }
  if (s.proposedPatch) {
    lines.push("### Proposed patch");
    lines.push("");
    lines.push("```" + (s.language || ""));
    lines.push(s.proposedPatch);
    lines.push("```");
    lines.push("");
  }
  lines.push("### Meta");
  lines.push("");
  lines.push(`- **Site:** ${s.siteUrl}`);
  if (s.filePath) lines.push(`- **Target file:** \`${s.filePath}\``);
  lines.push(`- **Severity:** ${s.severity}`);
  lines.push(`- **Admin queue:** \`/repo-updates/${s.id}\``);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`> ${PR_DISCLAIMER}`);
  lines.push("");
  lines.push(
    "This PR is a draft artifact only. The `proposedPatch` is a snippet — a human reviewer must manually apply the change to the real source file(s), verify the fix locally, and merge.",
  );
  return lines.join("\n");
}

function packPrIntoAdminResponse(
  existing: string | null,
  pr: { number: number; url: string },
): string {
  const stamp = `PR: ${pr.url} | number: ${pr.number}`;
  if (!existing || !existing.trim()) return stamp;
  return `${existing}\n\n${stamp}`;
}

export function parsePrFromAdminResponse(
  adminResponse: string | null,
): { number: number; url: string } | null {
  if (!adminResponse) return null;
  const m = adminResponse.match(/PR:\s*(\S+)\s*\|\s*number:\s*(\d+)/);
  if (!m) return null;
  return { url: m[1]!, number: Number(m[2]) };
}

export async function draftPrForSuggestion(
  db: Db,
  suggestionId: string,
): Promise<DraftPrResult> {
  // Fail loud if the token is missing — before any network call.
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN not configured");
  }

  const [row] = await db
    .select()
    .from(repoUpdateSuggestions)
    .where(eq(repoUpdateSuggestions.id, suggestionId))
    .limit(1);
  if (!row) throw new Error("Suggestion not found");
  if (row.status !== "approved") {
    throw new Error(
      `Suggestion must be in 'approved' status to draft a PR (current: ${row.status})`,
    );
  }
  if (!row.repo) throw new Error("Suggestion has no repo");
  if (!(SAGE_REPO_ALLOWLIST as readonly string[]).includes(row.repo)) {
    throw new Error("Repo not in Sage's allowlist");
  }

  const shortId = row.id.slice(0, 8);
  const checklistSlug = sanitizeBranchSegment(row.checklistItem);
  const branchName = `sage/repo-update-${shortId}-${checklistSlug}`;

  const siteHost = hostOf(row.siteUrl);
  const titleBase = `Sage SEO audit: ${row.checklistItem} on ${siteHost}`;
  const title = titleBase.length > 70 ? `${titleBase.slice(0, 67)}...` : titleBase;

  const markerPath = `.seo-audit/SUGGESTION-${shortId}.md`;
  const markerContent = renderMarkerFile(row);
  const body = renderPrBody(row, siteHost);
  // Hard guarantee the disclaimer text is in the body.
  if (!body.includes(PR_DISCLAIMER)) {
    throw new Error("PR body is missing the required Sage disclaimer");
  }

  const defaultBranch = await getDefaultBranch(row.repo);
  await createBranch(row.repo, { baseBranch: defaultBranch, newBranchName: branchName });
  await updateFileOnBranch(row.repo, {
    branchName,
    filePath: markerPath,
    content: markerContent,
    commitMessage: `chore(seo-audit): draft suggestion ${shortId} — ${row.checklistItem}`,
  });
  const pr = await createPullRequest(row.repo, {
    headBranch: branchName,
    baseBranch: defaultBranch,
    title,
    body,
  });

  const [updated] = await db
    .update(repoUpdateSuggestions)
    .set({
      status: "pr_drafted",
      adminResponse: packPrIntoAdminResponse(row.adminResponse, pr),
      updatedAt: new Date(),
    })
    .where(eq(repoUpdateSuggestions.id, row.id))
    .returning();

  return { suggestion: updated!, pr };
}
