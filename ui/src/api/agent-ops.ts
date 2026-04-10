import { api } from "./client";

export interface AgentOpsEntry {
  id: string;
  name: string;
  role: string;
  title: string | null;
  icon: string | null;
  status: string;
  adapterType: string | null;
  pauseReason: string | null;
  lastHeartbeatAt: string | null;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  lastRunStatus: string | null;
  lastRunFinishedAt: string | null;
  lastRunError: string | null;
  lastError: string | null;
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  activeRunCount: number;
  activeRunId: string | null;
  activeRunIssueTitle: string | null;
  activeRunIssueIdentifier: string | null;
  cronErrorCount: number;
}

export interface AttentionItem {
  agentId: string;
  agentName: string;
  type: string;
  message: string;
  timestamp: string | null;
}

export interface AgentOpsOverview {
  agents: AgentOpsEntry[];
  attentionRequired: AttentionItem[];
  summary: {
    total: number;
    running: number;
    idle: number;
    paused: number;
    error: number;
    pendingApproval: number;
  };
}

export const agentOpsApi = {
  overview: (companyId: string) =>
    api.get<AgentOpsOverview>(`/companies/${companyId}/agent-ops`),
};
