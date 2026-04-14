import { api } from "./client.js";

export interface RepoUpdateSuggestion {
  id: string;
  repo: string;
  siteUrl: string;
  filePath: string | null;
  checklistItem: string;
  severity: string;
  issue: string;
  rationale: string | null;
  proposedPatch: string | null;
  language: string;
  status: string;
  adminResponse: string | null;
  auditRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepoUpdateStats {
  total: number;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
}

export const repoUpdatesApi = {
  list: (status?: string) =>
    api.get<{ suggestions: RepoUpdateSuggestion[] }>(
      `/repo-updates${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  get: (id: string) => api.get<{ suggestion: RepoUpdateSuggestion }>(`/repo-updates/${id}`),
  approve: (id: string, adminResponse?: string) =>
    api.post<{ suggestion: RepoUpdateSuggestion }>(`/repo-updates/${id}/approve`, {
      adminResponse,
    }),
  reject: (id: string, reason?: string) =>
    api.post<{ suggestion: RepoUpdateSuggestion }>(`/repo-updates/${id}/reject`, { reason }),
  reply: (id: string, message: string) =>
    api.post<{ suggestion: RepoUpdateSuggestion }>(`/repo-updates/${id}/reply`, { message }),
  runAudit: (url: string) =>
    api.post<{ audit: unknown; created: RepoUpdateSuggestion[] }>(
      "/repo-updates/run-audit",
      { url },
    ),
  draftPr: (id: string) =>
    api.post<{
      suggestion: RepoUpdateSuggestion;
      pr: { number: number; url: string };
    }>(`/repo-updates/${id}/draft-pr`, {}),
  stats: () => api.get<RepoUpdateStats>("/repo-updates/stats/summary"),
};

/**
 * Extract a PR reference that was packed into the `admin_response` field by
 * the PR worker (format: "PR: <url> | number: <n>"). Returns null if no PR
 * link is present. Kept in sync with server/src/services/repo-update-pr-worker.ts.
 */
export function parsePrFromAdminResponse(
  adminResponse: string | null,
): { number: number; url: string } | null {
  if (!adminResponse) return null;
  const m = adminResponse.match(/PR:\s*(\S+)\s*\|\s*number:\s*(\d+)/);
  if (!m) return null;
  return { url: m[1]!, number: Number(m[2]) };
}
