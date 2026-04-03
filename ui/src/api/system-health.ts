import { api } from "./client";

export interface EvalCaseResult {
  case: string;
  provider: string;
  pass: boolean;
  score: number;
}

export interface EvalRunRecord {
  id: string;
  ranAt: string;
  durationMs: number;
  totalTests: number;
  passed: number;
  failed: number;
  results: EvalCaseResult[];
  trigger: "cron" | "manual";
}

export interface SystemHealthOverview {
  grade: string;
  runs: {
    total: number;
    succeeded: number;
    active: number;
    successRate: number | null;
  };
  ladder: {
    available: boolean;
    pipeline: Record<string, Record<string, number>> | null;
    telemetry: {
      total: number;
      byType: Array<{ event_type: string; count: number }>;
      byDay: Array<{ day: string; count: number }>;
    } | null;
    recentEvents: Array<{
      id: string;
      project: string;
      event_type: string;
      event_data: Record<string, unknown>;
      created_at: string;
    }>;
  };
  evals: {
    latest: EvalRunRecord | null;
    history: EvalRunRecord[];
    passRate: number | null;
  };
}

export interface LadderResponse {
  available: boolean;
  pipeline: Record<string, Record<string, number>> | null;
  entries: Array<Record<string, unknown>>;
  telemetry: Record<string, unknown> | null;
  projects: string[];
  recentEvents: Array<Record<string, unknown>>;
}

export interface EvalsResponse {
  history: EvalRunRecord[];
  latest: EvalRunRecord | null;
}

export interface AlertRecord {
  id: string;
  type: string;
  subject: string;
  body: string;
  sentAt: string;
  emailSent: boolean;
  error?: string;
}

export interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  service?: string;
  metadata?: Record<string, unknown>;
}

export const systemHealthApi = {
  overview: () =>
    api.get<SystemHealthOverview>("/system-health/overview"),
  ladder: (project?: string) =>
    api.get<LadderResponse>(
      `/system-health/ladder${project ? `?project=${project}` : ""}`,
    ),
  evals: (limit?: number) =>
    api.get<EvalsResponse>(
      `/system-health/evals${limit ? `?limit=${limit}` : ""}`,
    ),
  alerts: () =>
    api.get<{ alerts: AlertRecord[] }>("/system-health/alerts"),
  logs: (level?: string, limit?: number) =>
    api.get<{ logs: LogEntry[] }>(
      `/system-health/logs?${new URLSearchParams({ ...(level ? { level } : {}), ...(limit ? { limit: String(limit) } : {}) })}`,
    ),
};
