import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { knowledgeGraphApi, type GraphEdge, type KnowledgeTag, type GraphStats } from "../api/knowledge-graph";
import { agentMemoryApi } from "../api/agent-memory";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HowToGuide } from "../components/HowToGuide";
import {
  Network,
  Search,
  Tag,
  GitBranch,
  CheckCircle2,
  BarChart3,
  Brain,
  ArrowRight,
  Shield,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Relationship label colors
// ---------------------------------------------------------------------------

const REL_COLORS: Record<string, string> = {
  uses: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  built_on: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  competes_with: "bg-red-500/10 text-red-700 dark:text-red-300",
  partners_with: "bg-green-500/10 text-green-700 dark:text-green-300",
  fork_of: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  invested_in: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  maintains: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  integrates: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
};

function confidenceBar(confidence: number) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-muted">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Cards
// ---------------------------------------------------------------------------

function StatsCards({ stats }: { stats: GraphStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-purple-500" />
            <span className="text-sm text-muted-foreground">Tags</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{stats.totalTags}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-blue-500" />
            <span className="text-sm text-muted-foreground">Edges</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{stats.totalEdges}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-sm text-muted-foreground">Verified</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{stats.verifiedEdges}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-orange-500" />
            <span className="text-sm text-muted-foreground">Avg Confidence</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{(stats.avgConfidence * 100).toFixed(0)}%</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search Results
// ---------------------------------------------------------------------------

function SearchResults({
  results,
  onSelect,
}: {
  results: { directMatches: Array<{ type: string; id: string; name: string; similarity: number }>; graphExpanded: GraphEdge[] };
  onSelect: (type: string, id: string) => void;
}) {
  return (
    <div className="space-y-4">
      {results.directMatches.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Direct Matches</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {results.directMatches.map((m) => (
                <button
                  key={`${m.type}:${m.id}`}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => onSelect(m.type, m.id)}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {m.type}
                    </Badge>
                    <span className="font-medium">{m.name || m.id}</span>
                  </div>
                  {confidenceBar(m.similarity)}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {results.graphExpanded.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Graph-Expanded Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {results.graphExpanded.slice(0, 20).map((e, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm">
                  <button className="font-medium text-primary hover:underline" onClick={() => onSelect(e.sourceType, e.sourceId)}>
                    {e.sourceId}
                  </button>
                  <Badge className={REL_COLORS[e.relationship] ?? "bg-muted"}>
                    {e.relationship.replace(/_/g, " ")}
                  </Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <button className="font-medium text-primary hover:underline" onClick={() => onSelect(e.targetType, e.targetId)}>
                    {e.targetId}
                  </button>
                  {confidenceBar(e.confidence)}
                  {e.verified && <Shield className="h-3 w-3 text-green-500" />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entity Detail
// ---------------------------------------------------------------------------

function EntityDetail({
  type,
  slug,
  onNavigate,
}: {
  type: string;
  slug: string;
  onNavigate: (type: string, id: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["knowledge-graph", "entity", type, slug],
    queryFn: () => knowledgeGraphApi.getEntity(type, slug),
  });

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (!data) return <EmptyState icon={Network} message="Entity not found" />;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{type}</Badge>
          <CardTitle>{data.tagDetails?.name ?? slug}</CardTitle>
        </div>
        {data.tagDetails?.description && (
          <p className="text-sm text-muted-foreground">{data.tagDetails.description}</p>
        )}
        {data.tagDetails?.aliases && data.tagDetails.aliases.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {data.tagDetails.aliases.map((a) => (
              <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <h4 className="mb-2 text-sm font-medium text-muted-foreground">
          Relationships ({data.neighbors.length})
        </h4>
        {data.neighbors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No relationships found.</p>
        ) : (
          <div className="space-y-1">
            {data.neighbors.map((e, i) => {
              const isSource = e.sourceType === type && e.sourceId === slug;
              const otherType = isSource ? e.targetType : e.sourceType;
              const otherId = isSource ? e.targetId : e.sourceId;
              return (
                <div key={i} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm">
                  {!isSource && (
                    <button className="font-medium text-primary hover:underline" onClick={() => onNavigate(e.sourceType, e.sourceId)}>
                      {e.sourceId}
                    </button>
                  )}
                  <Badge className={REL_COLORS[e.relationship] ?? "bg-muted"}>
                    {e.relationship.replace(/_/g, " ")}
                  </Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <button className="font-medium text-primary hover:underline" onClick={() => onNavigate(otherType, otherId)}>
                    {otherId}
                  </button>
                  {confidenceBar(e.confidence)}
                  {e.verified && <Shield className="h-3 w-3 text-green-500" />}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Relationship Table
// ---------------------------------------------------------------------------

function RelationshipTable({ onSelect }: { onSelect: (type: string, id: string) => void }) {
  const [relFilter, setRelFilter] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["knowledge-graph", "relationships", relFilter],
    queryFn: () => knowledgeGraphApi.getRelationships({ relationship: relFilter || undefined, limit: 100 }),
  });

  const relationships = data?.relationships ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">All Relationships</CardTitle>
          <select
            className="rounded-md border bg-background px-2 py-1 text-xs"
            value={relFilter}
            onChange={(e) => setRelFilter(e.target.value)}
          >
            <option value="">All types</option>
            {Object.keys(REL_COLORS).map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <PageSkeleton variant="list" />
        ) : relationships.length === 0 ? (
          <EmptyState icon={GitBranch} message="No relationships yet. The Nexus agent will extract them from intel reports." />
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {relationships.map((e, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted">
                <Badge variant="outline" className="text-xs w-14 justify-center">{e.sourceType}</Badge>
                <button className="font-medium text-primary hover:underline truncate max-w-24" onClick={() => onSelect(e.sourceType, e.sourceId)}>
                  {e.sourceId}
                </button>
                <Badge className={`text-xs ${REL_COLORS[e.relationship] ?? "bg-muted"}`}>
                  {e.relationship.replace(/_/g, " ")}
                </Badge>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <Badge variant="outline" className="text-xs w-14 justify-center">{e.targetType}</Badge>
                <button className="font-medium text-primary hover:underline truncate max-w-24" onClick={() => onSelect(e.targetType, e.targetId)}>
                  {e.targetId}
                </button>
                <div className="ml-auto">{confidenceBar(e.confidence)}</div>
                {e.verified && <Shield className="h-3 w-3 text-green-500 shrink-0" />}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Memory Stats
// ---------------------------------------------------------------------------

function MemoryStats() {
  const { data, isLoading } = useQuery({
    queryKey: ["agent-memory", "stats"],
    queryFn: () => agentMemoryApi.getStats(),
  });

  if (isLoading || !data?.stats?.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-500" />
          <CardTitle className="text-sm font-medium">Agent Memory</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {data.stats.map((s) => (
            <div key={s.agentName} className="flex items-center justify-between rounded-md px-3 py-1.5 text-sm">
              <span className="font-medium">{s.agentName}</span>
              <div className="flex items-center gap-3 text-muted-foreground">
                <span>{s.count} facts</span>
                <span>{s.withEmbedding} embedded</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function KnowledgeGraph() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<{ type: string; id: string } | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Knowledge Graph" }]);
  }, [setBreadcrumbs]);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["knowledge-graph", "stats"],
    queryFn: () => knowledgeGraphApi.getStats(),
  });

  const { data: searchResults } = useQuery({
    queryKey: ["knowledge-graph", "search", activeSearch],
    queryFn: () => knowledgeGraphApi.search(activeSearch),
    enabled: activeSearch.length >= 2,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveSearch(search.trim());
    setSelectedEntity(null);
  };

  const handleSelect = (type: string, id: string) => {
    setSelectedEntity({ type, id });
    setActiveSearch("");
    setSearch("");
  };

  if (statsLoading) return <PageSkeleton variant="dashboard" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Knowledge Graph</h1>
        </div>
      </div>

      <HowToGuide
        sections={[
          {
            heading: "What This Page Shows",
            steps: [
              { title: "Structured relationships", description: "Typed edges between companies and technologies extracted from intel reports by the Nexus agent." },
              { title: "Knowledge tags", description: "A shared vocabulary of technologies, protocols, and ecosystems. Tags connect companies across directories." },
              { title: "Agent memory", description: "Persistent structured facts stored by agents across sessions, managed by the Recall agent." },
            ],
          },
          {
            heading: "How It Works",
            steps: [
              { title: "Nexus extracts relationships", description: "Every 3 hours, processes new intel reports through Ollama to find (company, relationship, technology) triples." },
              { title: "Weaver curates the graph", description: "Deduplicates tags, prunes low-confidence edges, auto-verifies strong evidence." },
              { title: "Oracle answers queries", description: "Multi-hop traversal via PostgreSQL recursive CTEs, combined with vector similarity for hybrid search." },
            ],
          },
        ]}
      />

      {stats && <StatsCards stats={stats} />}

      {/* Top connected + relationship distribution */}
      {stats && stats.topConnected.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Most Connected Entities</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {stats.topConnected.map((tc) => (
                  <button
                    key={`${tc.type}:${tc.id}`}
                    className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm hover:bg-muted"
                    onClick={() => handleSelect(tc.type, tc.id)}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{tc.type}</Badge>
                      <span className="font-medium">{tc.id}</span>
                    </div>
                    <span className="text-muted-foreground">{tc.edgeCount} edges</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Relationship Types</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {stats.relationshipCounts.map((rc) => (
                  <div key={rc.relationship} className="flex items-center justify-between rounded-md px-3 py-1.5 text-sm">
                    <Badge className={REL_COLORS[rc.relationship] ?? "bg-muted"}>
                      {rc.relationship.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-muted-foreground">{rc.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search */}
      <Card>
        <CardContent className="pt-4">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Search entities, technologies, companies..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Search
            </button>
          </form>
        </CardContent>
      </Card>

      {/* Search results */}
      {searchResults && <SearchResults results={searchResults} onSelect={handleSelect} />}

      {/* Entity detail */}
      {selectedEntity && (
        <EntityDetail
          type={selectedEntity.type}
          slug={selectedEntity.id}
          onNavigate={handleSelect}
        />
      )}

      {/* Relationships table + Memory stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <RelationshipTable onSelect={handleSelect} />
        </div>
        <div>
          <MemoryStats />
        </div>
      </div>
    </div>
  );
}
