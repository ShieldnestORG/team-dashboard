import { api } from "./client";

export interface EventConstraint {
  id: string;
  companyId: string | null;
  kind: string;
  pattern: { of: string; require: string };
  maxLagMs: number;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastViolationAt: string | null;
  violationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventConstraintInput {
  kind: string;
  pattern: { of: string; require: string };
  maxLagMs?: number;
  enabled?: boolean;
  companyId?: string | null;
}

export interface EventConstraintPatch {
  kind?: string;
  pattern?: { of: string; require: string };
  maxLagMs?: number;
  enabled?: boolean;
}

export const eventConstraintsApi = {
  list: (filters?: { companyId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.companyId) params.set("companyId", filters.companyId);
    const qs = params.toString();
    return api.get<{ constraints: EventConstraint[] }>(
      `/event-constraints${qs ? `?${qs}` : ""}`,
    );
  },
  create: (body: EventConstraintInput) =>
    api.post<{ constraint: EventConstraint }>(`/event-constraints`, body),
  update: (id: string, body: EventConstraintPatch) =>
    api.patch<{ constraint: EventConstraint }>(`/event-constraints/${id}`, body),
  remove: (id: string) => api.delete<void>(`/event-constraints/${id}`),
};
