import { api } from "./client";

export interface CausalEvent {
  id: string;
  kind: string | null;
  entityId: string;
  entityType: string;
  causedBy: string[] | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  runId: string | null;
  agentId: string | null;
  companyId: string;
}

export interface CausalEventNeighborhood {
  event: CausalEvent;
  ancestors: CausalEvent[];
  descendants: CausalEvent[];
}

export const causalEventsApi = {
  list: (filters?: { kind?: string; companyId?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.kind) params.set("kind", filters.kind);
    if (filters?.companyId) params.set("companyId", filters.companyId);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return api.get<{ events: CausalEvent[] }>(`/causal-events${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => api.get<CausalEventNeighborhood>(`/causal-events/${id}`),
  kinds: () => api.get<{ kinds: string[] }>(`/causal-events/kinds`),
};
