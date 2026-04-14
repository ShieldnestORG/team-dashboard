import { api } from "./client";

export interface AgentMemoryFact {
  id: number;
  agentName: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  similarity?: number;
}

export interface AgentMemoryStats {
  stats: Array<{ agentName: string; count: number; withEmbedding: number }>;
}

export const agentMemoryApi = {
  getStats: () => api.get<AgentMemoryStats>("/agent-memory/stats"),

  list: (agentName: string, limit = 50, offset = 0) =>
    api.get<{ memories: AgentMemoryFact[] }>(
      `/agent-memory/${agentName}?limit=${limit}&offset=${offset}`,
    ),

  search: (agentName: string, q: string, limit = 10) =>
    api.get<{ memories: AgentMemoryFact[] }>(
      `/agent-memory/${agentName}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  remember: (agentName: string, data: { subject: string; predicate: string; object: string; confidence?: number; source?: string; embed?: boolean }) =>
    api.post<{ memory: AgentMemoryFact }>(`/agent-memory/${agentName}`, data),

  forget: (agentName: string, id: number) =>
    api.delete<{ ok: boolean }>(`/agent-memory/${agentName}/${id}`),
};
