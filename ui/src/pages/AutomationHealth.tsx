import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import {
  automationHealthApi,
  type AutomationHealthSnapshot,
  type CronJobSnapshot,
  type IntegrationSnapshot,
  type Staleness,
} from "../api/automation-health";
import { PageSkeleton } from "../components/PageSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plug,
  Puzzle,
  Server,
  GitPullRequest,
  ArrowUpDown,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STALENESS_STYLES: Record<Staleness, string> = {
  ok: "bg-green-500/10 text-green-700 dark:text-green-300",
  warn: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  critical: "bg-red-500/10 text-red-700 dark:text-red-300",
};

const INTEGRATION_STYLES: Record<string, string> = {
  live: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30",
  dormant: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/30",
  paused: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/30",
  stub: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  if (diff < 0) return "soon";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-green-600 dark:text-green-400"
      : tone === "warn"
        ? "text-yellow-600 dark:text-yellow-400"
        : tone === "bad"
          ? "text-red-600 dark:text-red-400"
          : "";
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
        {sub ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function WarningsBanner({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return (
      <Card className="border-green-500/30 bg-green-500/5">
        <CardContent className="pt-4 pb-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <p className="text-sm text-green-700 dark:text-green-300">
            No warnings — all automated services look healthy.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-yellow-500/30 bg-yellow-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          {warnings.length} warning{warnings.length === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-1.5">
          {warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2">
              <Badge className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 shrink-0">
                warn
              </Badge>
              <span className="text-sm">{w}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

type SortKey = "staleness" | "jobName" | "ownerAgent" | "lastRunAt" | "errorCount";

function CronTable({ jobs }: { jobs: CronJobSnapshot[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("staleness");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    const order: Record<Staleness, number> = { critical: 0, warn: 1, ok: 2 };
    const copy = [...jobs];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "staleness") cmp = order[a.staleness] - order[b.staleness];
      else if (sortKey === "jobName") cmp = a.jobName.localeCompare(b.jobName);
      else if (sortKey === "ownerAgent")
        cmp = a.ownerAgent.localeCompare(b.ownerAgent);
      else if (sortKey === "lastRunAt") {
        const at = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
        const bt = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
        cmp = bt - at;
      } else if (sortKey === "errorCount") cmp = b.errorCount - a.errorCount;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [jobs, sortKey, sortDir]);

  const headerBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      className="flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground hover:text-foreground"
      onClick={() => {
        if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
        else {
          setSortKey(key);
          setSortDir("asc");
        }
      }}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          Cron Jobs ({jobs.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">{headerBtn("staleness", "Status")}</th>
                <th className="px-2 py-2 text-left">{headerBtn("jobName", "Job")}</th>
                <th className="px-2 py-2 text-left">{headerBtn("ownerAgent", "Owner")}</th>
                <th className="px-2 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                  Schedule
                </th>
                <th className="px-2 py-2 text-left">{headerBtn("lastRunAt", "Last Run")}</th>
                <th className="px-2 py-2 text-right">{headerBtn("errorCount", "Errors")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((j) => (
                <tr key={j.jobName} className="border-b last:border-b-0">
                  <td className="px-2 py-2">
                    <Badge className={STALENESS_STYLES[j.staleness]}>
                      {j.enabled ? j.staleness : "disabled"}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{j.jobName}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">
                    {j.ownerAgent}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                    {j.schedule}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {relativeTime(j.lastRunAt)}
                    {j.lastError ? (
                      <span
                        className="ml-1 text-red-600 dark:text-red-400"
                        title={j.lastError}
                      >
                        ·err
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs">
                    {j.errorCount}
                    <span className="text-muted-foreground"> / {j.runCount}</span>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No cron jobs registered.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function PluginSection({
  installed,
  dormant,
}: {
  installed: AutomationHealthSnapshot["plugins"]["installed"];
  dormant: string[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Puzzle className="h-4 w-4" />
            Installed Plugins ({installed.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {installed.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plugins registered.</p>
          ) : (
            <ul className="space-y-2">
              {installed.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded border bg-muted/40 px-3 py-2"
                >
                  <div>
                    <p className="font-mono text-xs">{p.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.name} · v{p.version}
                    </p>
                  </div>
                  <Badge className="bg-green-500/10 text-green-700 dark:text-green-300">
                    {p.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            Dormant Manifests ({dormant.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dormant.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              All on-disk plugin manifests are registered.
            </p>
          ) : (
            <ul className="space-y-2">
              {dormant.map((id) => (
                <li
                  key={id}
                  className="rounded border border-yellow-500/30 bg-yellow-500/5 px-3 py-2"
                >
                  <p className="font-mono text-xs">{id}</p>
                  <p className="text-xs text-muted-foreground">
                    Manifest on disk, missing from plugin_config.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function IntegrationsSection({
  integrations,
}: {
  integrations: IntegrationSnapshot[];
}) {
  const live = integrations.filter((i) => i.status === "live").length;
  const configured = integrations.filter((i) => i.configured).length;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" />
          External Integrations ({live} live / {configured} configured / {integrations.length} total)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {integrations.map((i) => (
            <div
              key={i.provider}
              className={`rounded border px-3 py-2 ${INTEGRATION_STYLES[i.status] ?? ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase">{i.status}</span>
                {i.configured ? (
                  <CheckCircle2 className="h-3 w-3 opacity-60" />
                ) : null}
              </div>
              <p className="mt-0.5 text-sm font-medium">{i.provider}</p>
              <p className="font-mono text-[10px] opacity-70">{i.envVar}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AutomationHealth() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "Automation Health" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading } = useQuery({
    queryKey: ["automation-health"],
    queryFn: () => automationHealthApi.get(),
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return <PageSkeleton />;

  const { crons, plugins, integrations, advisory, warnings, timestamp } = data;
  const liveIntegrations = integrations.filter((i) => i.status === "live").length;
  const configuredIntegrations = integrations.filter((i) => i.configured).length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          <h1 className="text-2xl font-bold">Automation Health</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Updated {relativeTime(timestamp)}
        </p>
      </div>

      <p className="max-w-3xl text-sm text-muted-foreground">
        Unified snapshot of every automated service: cron registry, plugin
        dormancy, external integrations, and the advisory queue. Auto-refreshes
        every 60 seconds.
      </p>

      {/* Top stat row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Crons healthy"
          value={`${crons.healthy} / ${crons.total}`}
          sub={`${crons.stale} stale · ${crons.erroring} erroring`}
          icon={Clock}
          tone={crons.erroring > 0 || crons.stale > 2 ? "warn" : "good"}
        />
        <StatCard
          label="Plugins installed"
          value={`${plugins.installed.length}`}
          sub={
            plugins.dormantManifests.length > 0
              ? `${plugins.dormantManifests.length} dormant`
              : "none dormant"
          }
          icon={Puzzle}
          tone={plugins.dormantManifests.length > 0 ? "warn" : "good"}
        />
        <StatCard
          label="Integrations live"
          value={`${liveIntegrations} / ${configuredIntegrations}`}
          sub={`of ${integrations.length} declared`}
          icon={Plug}
          tone={liveIntegrations > 0 ? "good" : "warn"}
        />
        <StatCard
          label="Advisory pending"
          value={advisory.pendingRepoUpdates}
          sub={`${advisory.approvedRepoUpdates} approved · ${advisory.needsRevision} revise`}
          icon={GitPullRequest}
          tone={advisory.pendingRepoUpdates > 0 ? "warn" : "default"}
        />
      </div>

      <WarningsBanner warnings={warnings} />

      <CronTable jobs={crons.jobs} />

      <PluginSection
        installed={plugins.installed}
        dormant={plugins.dormantManifests}
      />

      <IntegrationsSection integrations={integrations} />

      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm">
                Advisory queue: {advisory.pendingRepoUpdates} pending,{" "}
                {advisory.approvedRepoUpdates} approved, {advisory.needsRevision} need
                revision
              </p>
            </div>
            <Link
              to="/repo-updates"
              className="text-sm font-medium text-primary hover:underline"
            >
              Open Repo Updates →
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
