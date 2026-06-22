import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { controlPlaneApi, type PingResult, type RepoEntry } from "../api/control-plane";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { PageSkeleton } from "../components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  GitBranch,
  Search,
  Link2,
  Link2Off,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Boxes,
  Rocket,
} from "lucide-react";

const ROLE_BADGE: Record<RepoEntry["role"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  "full-clone": { label: "Full clone", variant: "default" },
  worktree: { label: "Worktree", variant: "secondary" },
  "non-git": { label: "Non-git", variant: "outline" },
};

export function ControlPlane() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterOrg, setFilterOrg] = useState<string | null>(null);
  // Track the most recent ping result per repo key for inline status display.
  const [pingResults, setPingResults] = useState<Record<string, PingResult>>({});

  useEffect(() => {
    setBreadcrumbs([{ label: "Control Plane" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["control-plane", "repos"],
    queryFn: () => controlPlaneApi.listRepos(),
    refetchInterval: 60_000,
  });

  const pingMutation = useMutation({
    mutationFn: (key: string) => controlPlaneApi.pingRepo(key),
    onSuccess: (result) => {
      setPingResults((prev) => ({ ...prev, [result.key]: result }));
      queryClient.invalidateQueries({ queryKey: ["control-plane", "repos"] });
    },
  });

  const filtered = useMemo(() => {
    if (!data?.repos) return [];
    let repos = data.repos;
    if (filterOrg) {
      repos = repos.filter((r) => r.org === filterOrg);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      repos = repos.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.key.toLowerCase().includes(q) ||
          r.org.toLowerCase().includes(q) ||
          r.remote.toLowerCase().includes(q) ||
          r.deployTarget.toLowerCase().includes(q),
      );
    }
    return repos;
  }, [data?.repos, search, filterOrg]);

  if (isLoading) return <PageSkeleton variant="dashboard" />;

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <div className="font-medium">Failed to load control plane repos</div>
          <div className="text-xs text-destructive/80">
            {error instanceof Error ? error.message : "Unknown error"}
          </div>
        </div>
      </div>
    );
  }

  const counts = data?.counts;
  const orgs = counts ? Object.keys(counts.byOrg).sort() : [];

  return (
    <div className="space-y-6">
      {/* Counts row */}
      {counts && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                <Boxes className="h-3.5 w-3.5" />
                Total Repos
              </div>
              <div className="text-2xl font-bold">{counts.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                <Link2 className="h-3.5 w-3.5 text-emerald-500" />
                Coupled
              </div>
              <div className="text-2xl font-bold text-emerald-600">
                {counts.coupled}
                <span className="text-sm text-muted-foreground font-normal ml-1">/ {counts.total}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                <Link2Off className="h-3.5 w-3.5" />
                Standalone
              </div>
              <div className="text-2xl font-bold">{counts.total - counts.coupled}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                <GitBranch className="h-3.5 w-3.5" />
                Orgs
              </div>
              <div className="text-2xl font-bold">{orgs.length}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and org filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search repos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <Button
            variant={filterOrg === null ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterOrg(null)}
          >
            All
          </Button>
          {orgs.map((org) => (
            <Button
              key={org}
              variant={filterOrg === org ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterOrg(filterOrg === org ? null : org)}
            >
              {org}
              {counts && (
                <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0">
                  {counts.byOrg[org]}
                </Badge>
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Repos table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Repo</th>
                <th className="px-4 py-3 font-medium">Org</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 font-medium">Deploy Target</th>
                <th className="px-4 py-3 font-medium">Coupled</th>
                <th className="px-4 py-3 font-medium text-right">Ping</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((repo) => {
                const roleMeta = ROLE_BADGE[repo.role];
                const ping = pingResults[repo.key];
                const isPinging = pingMutation.isPending && pingMutation.variables === repo.key;
                return (
                  <tr key={repo.key} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium">{repo.name}</div>
                      <code className="text-xs text-muted-foreground font-mono break-all">{repo.remote}</code>
                      {repo.notes && (
                        <div className="text-xs text-muted-foreground mt-0.5">{repo.notes}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">{repo.org}</td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <Badge variant={roleMeta.variant} className="text-[10px] px-1.5 py-0">
                        {roleMeta.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <code className="text-xs font-mono text-muted-foreground">{repo.branch}</code>
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Rocket className="h-3 w-3" />
                        {repo.deployTarget}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      {repo.coupled ? (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0">
                          <Link2 className="h-2.5 w-2.5 mr-0.5" />
                          Coupled
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          <Link2Off className="h-2.5 w-2.5 mr-0.5" />
                          Standalone
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-right">
                      {repo.coupled && repo.controlBase ? (
                        <div className="inline-flex items-center gap-2 justify-end">
                          {ping && !isPinging && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                              {ping.ok ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5 text-red-500" />
                              )}
                              {ping.status ?? "err"}
                              {typeof ping.ms === "number" && ` · ${ping.ms}ms`}
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            disabled={isPinging}
                            onClick={() => pingMutation.mutate(repo.key)}
                            title={`Ping ${repo.controlBase}`}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${isPinging ? "animate-spin" : ""}`} />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">&mdash;</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No repos match your search.
        </div>
      )}
    </div>
  );
}
