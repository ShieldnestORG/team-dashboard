import { api } from "./client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphStats {
  totalTags: number;
  totalEdges: number;
  verifiedEdges: number;
  avgConfidence: number;
  topConnected: Array<{ type: string; id: string; edgeCount: number }>;
  relationshipCounts: Array<{ relationship: string; count: number }>;
}

export interface GraphEdge {
  sourceType: string;
  sourceId: string;
  relationship: string;
  targetType: string;
  targetId: string;
  confidence: number;
  verified: boolean;
  depth: number;
}

export interface KnowledgeTag {
  id: number;
  slug: string;
  name: string;
  tag_type: string;
  description: string | null;
  aliases: string[];
  created_at: string;
}

export interface GraphVisualization {
  nodes: Array<{ type: string; id: string }>;
  edges: Array<{
    source: string;
    target: string;
    relationship: string;
    confidence: number;
    verified: boolean;
  }>;
}

export interface HybridSearchResult {
  directMatches: Array<{ type: string; id: string; name: string; similarity: number }>;
  graphExpanded: GraphEdge[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const knowledgeGraphApi = {
  getStats: () => api.get<GraphStats>("/knowledge-graph/stats"),

  search: (q: string, limit = 20) =>
    api.get<HybridSearchResult>(`/knowledge-graph/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  getEntity: (type: string, slug: string) =>
    api.get<{ type: string; id: string; neighbors: GraphEdge[]; tagDetails: KnowledgeTag | null }>(
      `/knowledge-graph/entity/${type}/${slug}`,
    ),

  traverse: (type: string, slug: string, depth = 2) =>
    api.get<{ edges: GraphEdge[] }>(
      `/knowledge-graph/traverse/${type}/${slug}?depth=${depth}`,
    ),

  getRelationships: (params?: {
    sourceId?: string;
    targetId?: string;
    relationship?: string;
    minConfidence?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.sourceId) qs.set("sourceId", params.sourceId);
    if (params?.targetId) qs.set("targetId", params.targetId);
    if (params?.relationship) qs.set("relationship", params.relationship);
    if (params?.minConfidence) qs.set("minConfidence", String(params.minConfidence));
    if (params?.limit) qs.set("limit", String(params.limit));
    return api.get<{ relationships: GraphEdge[] }>(`/knowledge-graph/relationships?${qs}`);
  },

  getTags: (search?: string, type?: string) => {
    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    if (type) qs.set("type", type);
    return api.get<{ tags: KnowledgeTag[] }>(`/knowledge-graph/tags?${qs}`);
  },

  getVisualization: (limit = 100) =>
    api.get<GraphVisualization>(`/knowledge-graph/visualization?limit=${limit}`),
};
