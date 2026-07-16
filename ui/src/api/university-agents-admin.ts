import { api } from "./client.js";

// ---------------------------------------------------------------------------
// University agents admin — typed client for /api/university-agents-admin
// (board-only). Mirrors server/src/routes/university-agents-admin.ts. This is
// the ADMIN surface to see + fine-tune the invisible AI community members.
// ---------------------------------------------------------------------------

export interface AgentConfig {
  model: string;
  postProbability: number;
  commentProbability: number;
  activeStartHour: number;
  activeEndHour: number;
  voiceNote: string | null;
}

export interface AgentRow {
  id: string;
  email: string;
  displayName: string | null;
  personaKey: string | null;
  paused: boolean;
  pausedAt: string | null;
  pauseReason: string | null;
  config: AgentConfig | null;
  costTodayUsd: number;
  unresolvedReports: number;
}

export interface AgentReport {
  id: string;
  memberId: string | null;
  agentPersonaKey: string | null;
  reportKind: string;
  severity: string;
  message: string;
  context: Record<string, unknown>;
  dedupeKey: string;
  isResolved: boolean;
  reportedAt: string;
  resolvedAt: string | null;
}

export interface AgentDetail {
  agent: {
    id: string;
    email: string;
    displayName: string | null;
    personaKey: string | null;
    paused: boolean;
    pausedAt: string | null;
    pauseReason: string | null;
  };
  config: AgentConfig | null;
  cost: { todayUsd: number; allTimeUsd: number };
  reports: AgentReport[];
}

export interface AgentCostSummary {
  todayUsd: number;
  weekUsd: number;
  monthUsd: number;
  byModel: Array<{ model: string; usd: number; calls: number }>;
}

export type AgentConfigUpdate = Partial<{
  model: string;
  postProbability: number;
  commentProbability: number;
  activeStartHour: number;
  activeEndHour: number;
  voiceNote: string | null;
}>;

export const universityAgentsAdminApi = {
  listAgents: () =>
    api.get<{ agents: AgentRow[] }>("/university-agents-admin/agents"),
  getAgent: (id: string) =>
    api.get<AgentDetail>(`/university-agents-admin/agents/${id}`),
  updateConfig: (id: string, update: AgentConfigUpdate) =>
    api.post<{ ok: true }>(`/university-agents-admin/agents/${id}/config`, update),
  toggle: (id: string, enabled: boolean, reason?: string) =>
    api.post<{ ok: true; enabled: boolean }>(
      `/university-agents-admin/agents/${id}/toggle`,
      { enabled, reason },
    ),
  resolveReport: (reportId: string) =>
    api.post<{ ok: true }>(
      `/university-agents-admin/agents/reports/${reportId}/resolve`,
      {},
    ),
  costSummary: () =>
    api.get<AgentCostSummary>("/university-agents-admin/agents/cost-summary"),
};
