import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Globe,
  Play,
  Loader2,
  Clock,
  Database,
  Layers,
  TrendingUp,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { firecrawlApi, type FirecrawlOverview } from "@/api/firecrawl";

const firecrawlKeys = {
  overview: ["firecrawl", "admin", "overview"] as const,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Plugin tool metadata (hard-coded from manifest so we don't refetch it).
// The 9 firecrawl tools documented in packages/plugins/plugin-firecrawl/src/manifest.ts
// ---------------------------------------------------------------------------

const FIRECRAWL_TOOLS: Array<{ id: string; summary: string }> = [
  { id: "scrape", summary: "Single URL → markdown (auto-persists)" },
  { id: "crawl", summary: "Multi-page site crawl (auto-persists each)" },
  { id: "map", summary: "Discover all URLs (sitemap, no scrape)" },
  { id: "extract", summary: "Structured data extraction via prompt" },
  { id: "search", summary: "Web search returning full content" },
  { id: "classify", summary: "Tag scraped URLs with venture/category" },
  { id: "query", summary: "Search persisted scrape database" },
  { id: "summarize", summary: "Summarize URLs with local Ollama" },
  { id: "metrics", summary: "Usage stats and volume" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FirecrawlActivityTab() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<FirecrawlOverview>({
    queryKey: firecrawlKeys.overview,
    queryFn: () => firecrawlApi.getOverview(),
    refetchInterval: 30_000,
  });

  const runJobMutation = useMutation({
    mutationFn: (jobName: string) => firecrawlApi.runJob(jobName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: firecrawlKeys.overview });
    },
  });

  const stats = useMemo(() => {
    const m = data?.metrics;
    return [
      {
        label: "Total Scrapes",
        value: m?.totalScrapes ?? 0,
        icon: Database,
        hint: "All-time rows in intel_reports tagged firecrawl-sync",
      },
      {
        label: "Last 7 days",
        value: m?.scrapesLast7d ?? 0,
        icon: TrendingUp,
        hint: "Scrapes captured this week",
      },
      {
        label: "Last 24 hours",
        value: m?.scrapesLast24h ?? 0,
        icon: Clock,
        hint: "Scrapes captured in last 24h",
      },
      {
        label: "Companies covered",
        value: m?.intelCompaniesCovered ?? 0,
        icon: Layers,
        hint: "Distinct intel_companies touched",
      },
    ];
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Firecrawl activity…
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Failed to load Firecrawl overview.
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Host banner */}
      <Card>
        <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Firecrawl host</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{data.host.url}</code>
          </div>
          <Badge
            variant="outline"
            className={
              data.host.mode === "self-hosted"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-blue-500/30 bg-blue-500/10 text-blue-400"
            }
          >
            {data.host.mode}
          </Badge>
        </CardContent>
      </Card>

      {/* Stats row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label}>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5 text-xs">
                  <Icon className="h-3.5 w-3.5" />
                  {s.label}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{s.value.toLocaleString()}</div>
                <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Scheduled actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled actions</CardTitle>
          <CardDescription>
            Cron jobs that automatically run Firecrawl work. Click <em>Run now</em> to trigger
            an out-of-band execution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.crons.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Firecrawl cron jobs registered.</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Job</th>
                    <th className="px-3 py-2 text-left">Schedule</th>
                    <th className="px-3 py-2 text-left">Owner</th>
                    <th className="px-3 py-2 text-left">Last run</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.crons.map((job) => {
                    const schedule = job.scheduleOverride ?? job.schedule;
                    const hasError = Boolean(job.lastError);
                    const isTrigger =
                      runJobMutation.isPending && runJobMutation.variables === job.jobName;
                    return (
                      <tr key={job.jobName} className="border-t">
                        <td className="px-3 py-2 font-medium">{job.jobName}</td>
                        <td className="px-3 py-2">
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {schedule}
                          </code>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{job.ownerAgent}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatRelative(job.lastRunAt)}
                        </td>
                        <td className="px-3 py-2">
                          {job.running ? (
                            <Badge variant="outline" className="gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              running
                            </Badge>
                          ) : hasError ? (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              error
                            </Badge>
                          ) : !job.enabled ? (
                            <Badge variant="outline" className="text-muted-foreground">
                              disabled
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="gap-1 border-emerald-500/30 text-emerald-400"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              healthy
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isTrigger || job.running}
                            onClick={() => runJobMutation.mutate(job.jobName)}
                          >
                            {isTrigger ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                            <span className="ml-1.5">Run now</span>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {runJobMutation.isError ? (
            <p className="text-xs text-destructive">
              {(runJobMutation.error as Error).message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Tools */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plugin tools</CardTitle>
          <CardDescription>
            Tools exposed by the firecrawl plugin. Invoke via the plugin tool runner or from
            agent instructions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {FIRECRAWL_TOOLS.map((tool) => (
              <div
                key={tool.id}
                className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2"
              >
                <code className="text-xs font-medium text-foreground">{tool.id}</code>
                <span className="text-xs text-muted-foreground">{tool.summary}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recently collected */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recently collected</CardTitle>
          <CardDescription>
            The 10 most recent pages scraped into <code>intel_reports</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentScrapes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scrapes yet. Run <code>firecrawl:sync</code> to collect your first batch.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Company</th>
                    <th className="px-3 py-2 text-left">Headline</th>
                    <th className="px-3 py-2 text-left">Source</th>
                    <th className="px-3 py-2 text-right">Size</th>
                    <th className="px-3 py-2 text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentScrapes.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2 font-medium">{row.companySlug}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <span className="line-clamp-1">{row.headline}</span>
                      </td>
                      <td className="px-3 py-2">
                        {row.sourceUrl ? (
                          <a
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            href={row.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-3 w-3" />
                            visit
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                        {formatBytes(row.bodySize)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                        {formatRelative(row.capturedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
