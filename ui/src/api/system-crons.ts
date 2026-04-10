import { api } from "./client";

export interface SystemCronJob {
  jobName: string;
  schedule: string;
  scheduleOverride: string | null;
  ownerAgent: string;
  sourceFile: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  nextRunAt: string | null;
  runCount: number;
  errorCount: number;
  running: boolean;
}

export const systemCronsApi = {
  list: () => api.get<{ crons: SystemCronJob[] }>("/system-crons"),
  update: (jobName: string, body: { enabled?: boolean; scheduleOverride?: string | null }) =>
    api.patch<{ ok: boolean }>(`/system-crons/${encodeURIComponent(jobName)}`, body),
  trigger: (jobName: string) =>
    api.post<{ ok: boolean }>(`/system-crons/${encodeURIComponent(jobName)}/run`, {}),
};
