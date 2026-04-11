import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRoutesApi, type ApiRouteGroup } from "../api/api-routes";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Globe,
  Search,
  Activity,
  Lock,
  Unlock,
  Key,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Circle,
  Zap,
  Server,
  Database,
  Plug,
  Radio,
  Eye,
  Settings,
} from "lucide-react";

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  core: { label: "Core", icon: Server, color: "text-blue-500" },
  content: { label: "Content", icon: Zap, color: "text-purple-500" },
  intel: { label: "Intel", icon: Database, color: "text-emerald-500" },
  integrations: { label: "Integrations", icon: Plug, color: "text-orange-500" },
  public: { label: "Public", icon: Eye, color: "text-green-500" },
  system: { label: "System", icon: Settings, color: "text-gray-500" },
  plugins: { label: "Plugins", icon: Radio, color: "text-pink-500" },
};

const AUTH_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: React.ElementType }> = {
  public: { label: "Public", variant: "outline", icon: Unlock },
  authenticated: { label: "Auth", variant: "default", icon: Lock },
  "content-key": { label: "Content Key", variant: "secondary", icon: Key },
  "ingest-key": { label: "Ingest Key", variant: "secondary", icon: Key },
};

function StatusDot({ status }: { status?: "up" | "down" | "degraded" }) {
  if (!status) return <Circle className="h-3 w-3 text-muted-foreground/40" />;
  if (status === "up") return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  if (status === "degraded") return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
  return <XCircle className="h-3.5 w-3.5 text-red-500" />;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

export function ApiDashboard() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "API Routes" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.apiRoutes,
    queryFn: () => apiRoutesApi.list(true),
    refetchInterval: 60_000,
  });

  const pingMutation = useMutation({
    mutationFn: (prefix: string) => apiRoutesApi.ping(prefix),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.apiRoutes });
    },
  });

  const filtered = useMemo(() => {
    if (!data?.routes) return [];
    let routes = data.routes;
    if (filterCategory) {
      routes = routes.filter((r) => r.category === filterCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      routes = routes.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.prefix.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      );
    }
    return routes;
  }, [data?.routes, search, filterCategory]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ApiRouteGroup[]>();
    for (const route of filtered) {
      const existing = groups.get(route.category) ?? [];
      existing.push(route);
      groups.set(route.category, existing);
    }
    return groups;
  }, [filtered]);

  if (isLoading) return <PageSkeleton variant="dashboard" />;

  const stats = data?.stats;

  return (
    <div className="space-y-6">
      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-2">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                <Globe className="h-3.5 w-3.5" />
                Route Groups
              </div>
              <div className="text-2xl font-bold">{stats.totalGroups}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                <Activity className="h-3.5 w-3.5" />
                Total Endpoints
              </div>
              <div className="text-2xl font-bold">{stats.totalEndpoints}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                Healthy
              </div>
              <div className="text-2xl font-bold text-green-600">
                {stats.upCount}
                <span className="text-sm text-muted-foreground font-normal ml-1">/ {stats.totalGroups}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                <Unlock className="h-3.5 w-3.5" />
                Public
              </div>
              <div className="text-2xl font-bold">{stats.publicCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                <Lock className="h-3.5 w-3.5" />
                Authenticated
              </div>
              <div className="text-2xl font-bold">{stats.authCount + stats.contentKeyCount + stats.ingestKeyCount}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search APIs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <Button
            variant={filterCategory === null ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterCategory(null)}
          >
            All
          </Button>
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const Icon = meta.icon;
            return (
              <Button
                key={key}
                variant={filterCategory === key ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterCategory(filterCategory === key ? null : key)}
              >
                <Icon className="h-3.5 w-3.5 mr-1" />
                {meta.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Route groups by category */}
      {Array.from(grouped.entries()).map(([category, routes]) => {
        const meta = CATEGORY_META[category] ?? { label: category, icon: Globe, color: "text-muted-foreground" };
        const CatIcon = meta.icon;
        return (
          <div key={category} className="space-y-3">
            <div className="flex items-center gap-2">
              <CatIcon className={`h-4 w-4 ${meta.color}`} />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {meta.label}
              </h2>
              <Badge variant="outline" className="text-xs">{routes.length}</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {routes.map((route) => {
                const authMeta = AUTH_BADGE[route.authType];
                const AuthIcon = authMeta?.icon ?? Lock;
                return (
                  <Card key={route.prefix} className="relative">
                    <CardHeader className="pb-2 pt-4 px-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <StatusDot status={route.liveStatus?.status} />
                          <CardTitle className="text-sm font-medium truncate">{route.name}</CardTitle>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 shrink-0"
                          disabled={pingMutation.isPending}
                          onClick={() => pingMutation.mutate(route.prefix)}
                          title="Ping this route"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${pingMutation.isPending && pingMutation.variables === route.prefix ? "animate-spin" : ""}`} />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-0 space-y-2">
                      <code className="text-xs text-muted-foreground font-mono block">{route.prefix}/*</code>
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{route.description}</p>
                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {route.endpointCount} endpoint{route.endpointCount !== 1 ? "s" : ""}
                        </Badge>
                        <Badge variant={authMeta?.variant ?? "default"} className="text-[10px] px-1.5 py-0">
                          <AuthIcon className="h-2.5 w-2.5 mr-0.5" />
                          {authMeta?.label ?? route.authType}
                        </Badge>
                        {route.liveStatus && (
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {route.liveStatus.latencyMs}ms &middot; {relativeTime(route.liveStatus.checkedAt)}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No API routes match your search.
        </div>
      )}
    </div>
  );
}
