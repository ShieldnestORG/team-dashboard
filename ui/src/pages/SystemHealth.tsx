import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { systemHealthApi } from "../api/system-health";
import type { EvalRunRecord, EvalCaseResult, AlertRecord, LogEntry, ServiceStatusInfo, SystemMetricsInfo, InfraCostItem } from "../api/system-health";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  HeartPulse,
  Activity,
  CheckCircle2,
  XCircle,
  Gauge,
  Layers,
  Lightbulb,
  FlaskConical,
  Brain,
  Cpu,
  Clock,
  TrendingUp,
  AlertTriangle,
  Bell,
  ScrollText,
  Mail,
  MailX,
  Server,
  HardDrive,
  Wifi,
  WifiOff,
} from "lucide-react";

// ── Query Keys ──────────────────────────────────────────────────────────────

const systemHealthKeys = {
  overview: ["system-health", "overview"] as const,
  ladder: (project?: string) => ["system-health", "ladder", project] as const,
  evals: (limit?: number) => ["system-health", "evals", limit] as const,
  alerts: ["system-health", "alerts"] as const,
  logs: (level?: string, limit?: number) =>
    ["system-health", "logs", level, limit] as const,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function gradeColor(grade: string): string {
  switch (grade.toUpperCase()) {
    case "A":
      return "text-emerald-400";
    case "B":
      return "text-blue-400";
    case "C":
      return "text-yellow-400";
    case "D":
      return "text-orange-400";
    case "F":
      return "text-red-400";
    default:
      return "text-muted-foreground";
  }
}

function gradeBg(grade: string): string {
  switch (grade.toUpperCase()) {
    case "A":
      return "bg-emerald-500/10 border-emerald-500/20";
    case "B":
      return "bg-blue-500/10 border-blue-500/20";
    case "C":
      return "bg-yellow-500/10 border-yellow-500/20";
    case "D":
      return "bg-orange-500/10 border-orange-500/20";
    case "F":
      return "bg-red-500/10 border-red-500/20";
    default:
      return "bg-muted/10 border-border";
  }
}

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "complete":
      return "default";
    case "active":
      return "secondary";
    case "testing":
      return "destructive";
    default:
      return "outline";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "complete":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "active":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "testing":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "draft":
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
    default:
      return "bg-muted/15 text-muted-foreground border-border";
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// ── Provider Breakdown ──────────────────────────────────────────────────────

function ProviderBreakdown({ results }: { results: EvalCaseResult[] }) {
  const byProvider = new Map<string, { passed: number; failed: number }>();
  for (const r of results) {
    const entry = byProvider.get(r.provider) ?? { passed: 0, failed: 0 };
    if (r.pass) entry.passed++;
    else entry.failed++;
    byProvider.set(r.provider, entry);
  }

  const providers = [...byProvider.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  if (providers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No provider data available.</p>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {providers.map(([provider, counts]) => {
        const total = counts.passed + counts.failed;
        const rate = total > 0 ? Math.round((counts.passed / total) * 100) : 0;
        return (
          <div
            key={provider}
            className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium truncate">{provider}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                {counts.passed}
              </span>
              <span className="flex items-center gap-1 text-xs text-red-400">
                <XCircle className="h-3 w-3" />
                {counts.failed}
              </span>
              <Badge
                variant="outline"
                className="text-xs tabular-nums ml-1"
              >
                {rate}%
              </Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Eval History Table ──────────────────────────────────────────────────────

function EvalHistoryTable({ history }: { history: EvalRunRecord[] }) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No eval history available.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="pb-2 font-medium text-muted-foreground">Date</th>
            <th className="pb-2 font-medium text-muted-foreground">Passed</th>
            <th className="pb-2 font-medium text-muted-foreground">Failed</th>
            <th className="pb-2 font-medium text-muted-foreground">Duration</th>
            <th className="pb-2 font-medium text-muted-foreground">Trigger</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {history.slice(0, 10).map((run) => (
            <tr key={run.id} className="text-sm">
              <td className="py-2 pr-4 tabular-nums">
                {formatDate(run.ranAt)}
              </td>
              <td className="py-2 pr-4">
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  {run.passed}
                </span>
              </td>
              <td className="py-2 pr-4">
                <span className="flex items-center gap-1 text-red-400">
                  <XCircle className="h-3 w-3" />
                  {run.failed}
                </span>
              </td>
              <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                {formatDuration(run.durationMs)}
              </td>
              <td className="py-2">
                <Badge variant="outline" className="text-xs">
                  {run.trigger}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Alert + Log Helpers ────────────────────────────────────────────────────

function alertTypeColor(type: string): string {
  switch (type) {
    case "health_down":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "eval_failed":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "agent_error":
      return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "budget_breach":
      return "bg-purple-500/15 text-purple-400 border-purple-500/30";
    case "backup_failed":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default:
      return "bg-muted/15 text-muted-foreground border-border";
  }
}

function logLevelColor(level: string): string {
  switch (level) {
    case "error":
    case "fatal":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "warn":
      return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "info":
    default:
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  }
}

// ── Pipeline Stage Names + Icons ────────────────────────────────────────────

const PIPELINE_STAGES: Array<{
  key: string;
  label: string;
  icon: typeof Layers;
}> = [
  { key: "source", label: "Sources", icon: Layers },
  { key: "idea", label: "Ideas", icon: Lightbulb },
  { key: "hypothesis", label: "Hypotheses", icon: Brain },
  { key: "experiment", label: "Experiments", icon: FlaskConical },
  { key: "algorithm", label: "Algorithms", icon: Cpu },
  { key: "result", label: "Results", icon: TrendingUp },
];

// ── Page Component ──────────────────────────────────────────────────────────

export function SystemHealth() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "System Health" }]);
  }, [setBreadcrumbs]);

  const [logLevelFilter, setLogLevelFilter] = useState<string | undefined>(
    undefined,
  );

  const {
    data: overview,
    isLoading,
    error,
  } = useQuery({
    queryKey: systemHealthKeys.overview,
    queryFn: () => systemHealthApi.overview(),
    refetchInterval: 60_000,
  });

  const { data: alertsData } = useQuery({
    queryKey: systemHealthKeys.alerts,
    queryFn: () => systemHealthApi.alerts(),
    refetchInterval: 60_000,
  });

  const { data: logsData } = useQuery({
    queryKey: systemHealthKeys.logs(logLevelFilter, 50),
    queryFn: () => systemHealthApi.logs(logLevelFilter, 50),
    refetchInterval: 30_000,
  });

  const { data: servicesData } = useQuery({
    queryKey: ["system-health", "services"] as const,
    queryFn: () => systemHealthApi.services(),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
          <div className="space-y-2">
            <div className="h-5 w-48 animate-pulse rounded bg-muted" />
            <div className="h-3 w-72 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-border bg-muted/30"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl border border-border bg-muted/30" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-200">
              Failed to load system health data
            </p>
            <p className="text-xs text-red-300/70">{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!overview) return null;

  const { grade, runs, ladder, evals } = overview;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
          <HeartPulse className="h-5 w-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Health</h1>
          <p className="text-sm text-muted-foreground">
            Eval results, pipeline status, and run health at a glance.
          </p>
        </div>
      </div>

      {/* ── Service Status ──────────────────────────────────────────────── */}
      {servicesData && (
        <Card className="rounded-xl">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4 text-muted-foreground" />
              VPS Service Status
            </CardTitle>
            <CardDescription>Real-time health of all monitored services (checks every 3 min)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(servicesData.services ?? []).map((svc: ServiceStatusInfo) => (
                <div
                  key={svc.name}
                  className={`flex items-center gap-3 rounded-lg border p-3 ${
                    svc.status === "up" ? "border-emerald-500/20 bg-emerald-500/5" :
                    svc.status === "down" ? "border-red-500/20 bg-red-500/5" :
                    svc.status === "degraded" ? "border-yellow-500/20 bg-yellow-500/5" :
                    "border-border bg-muted/20"
                  }`}
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                    svc.status === "up" ? "bg-emerald-500/20" :
                    svc.status === "down" ? "bg-red-500/20" :
                    svc.status === "degraded" ? "bg-yellow-500/20" :
                    "bg-muted"
                  }`}>
                    {svc.status === "up" ? <Wifi className="h-4 w-4 text-emerald-400" /> :
                     svc.status === "down" ? <WifiOff className="h-4 w-4 text-red-400" /> :
                     <AlertTriangle className="h-4 w-4 text-yellow-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{svc.name}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                        svc.status === "up" ? "text-emerald-400 border-emerald-500/30" :
                        svc.status === "down" ? "text-red-400 border-red-500/30" :
                        svc.status === "degraded" ? "text-yellow-400 border-yellow-500/30" :
                        ""
                      }`}>
                        {svc.status}
                      </Badge>
                      {svc.cost && (
                        <span className={`text-[10px] font-mono ${svc.cost.monthlyCents > 0 ? "text-amber-400" : "text-muted-foreground/60"}`} title={svc.cost.tier}>
                          {svc.cost.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                      {svc.latencyMs !== null && <span>{svc.latencyMs}ms</span>}
                      {svc.resources?.cpuPercent != null && <span>CPU {svc.resources.cpuPercent}%</span>}
                      {svc.resources?.memMb != null && <span>RAM {svc.resources.memMb >= 1024 ? `${(svc.resources.memMb / 1024).toFixed(1)}GB` : `${svc.resources.memMb}MB`}</span>}
                      {svc.error && <span className="text-red-400 truncate">{svc.error}</span>}
                      {svc.consecutiveFailures > 0 && (
                        <span className="text-red-400">{svc.consecutiveFailures} failures</span>
                      )}
                    </div>
                    {svc.resources?.detail && (
                      <div className="text-[9px] text-muted-foreground/70 mt-0.5 truncate">{svc.resources.detail}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {servicesData.metrics && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t">
                <div className="text-center">
                  <HardDrive className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-1" />
                  <div className={`text-lg font-bold tabular-nums ${
                    (servicesData.metrics.diskUsedPercent ?? 0) > 85 ? "text-red-400" :
                    (servicesData.metrics.diskUsedPercent ?? 0) > 70 ? "text-yellow-400" :
                    "text-emerald-400"
                  }`}>
                    {servicesData.metrics.diskUsedPercent ?? "--"}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Disk ({servicesData.metrics.diskFreeGb ?? "--"}GB free)
                  </div>
                </div>
                <div className="text-center">
                  <Cpu className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-1" />
                  <div className={`text-lg font-bold tabular-nums ${
                    servicesData.metrics.memUsedPercent > 85 ? "text-red-400" :
                    servicesData.metrics.memUsedPercent > 70 ? "text-yellow-400" :
                    "text-emerald-400"
                  }`}>
                    {servicesData.metrics.memUsedPercent}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Memory ({servicesData.metrics.memFreeGb}GB free)
                  </div>
                </div>
                <div className="text-center">
                  <Activity className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-1" />
                  <div className="text-lg font-bold tabular-nums">
                    {servicesData.metrics.cpuLoad1m}
                  </div>
                  <div className="text-[10px] text-muted-foreground">CPU Load (1m)</div>
                </div>
                <div className="text-center">
                  <Clock className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-1" />
                  <div className="text-lg font-bold tabular-nums">
                    {servicesData.metrics.uptimeHours}h
                  </div>
                  <div className="text-[10px] text-muted-foreground">Uptime</div>
                </div>
              </div>
            )}

            {/* Infrastructure cost breakdown */}
            {servicesData.infraCosts && servicesData.infraCosts.length > 0 && (
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">Infrastructure Costs</span>
                  <span className="text-sm font-bold text-amber-400 tabular-nums">
                    ${((servicesData.totalMonthlyCents ?? 0) / 100).toFixed(0)}/mo
                  </span>
                </div>
                <div className="grid gap-1.5">
                  {servicesData.infraCosts.map((item: InfraCostItem) => (
                    <div key={item.name} className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${item.cost.monthlyCents > 0 ? "bg-amber-400" : "bg-emerald-400"}`} />
                        <span className="text-muted-foreground truncate">{item.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-muted-foreground/60 text-[10px] truncate max-w-[180px]" title={item.cost.tier}>{item.cost.tier}</span>
                        <span className={`font-mono tabular-nums ${item.cost.monthlyCents > 0 ? "text-amber-400" : "text-muted-foreground/60"}`}>
                          {item.cost.label}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── A. Health Grade Card ────────────────────────────────────────── */}
      <Card className={`rounded-xl border ${gradeBg(grade)}`}>
        <CardContent className="flex flex-col gap-6 pt-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-5">
            <div
              className={`flex h-20 w-20 items-center justify-center rounded-2xl border ${gradeBg(grade)}`}
            >
              <span className={`text-5xl font-black ${gradeColor(grade)}`}>
                {grade.toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-lg font-semibold">Overall Health Grade</p>
              <p className="text-sm text-muted-foreground">
                Composite of eval pass rate, run success rate, and pipeline
                activity.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Eval Pass Rate
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums">
                {evals.passRate !== null ? `${Math.round(evals.passRate)}%` : "--"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Run Success
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums">
                {runs.successRate !== null
                  ? `${Math.round(runs.successRate)}%`
                  : "--"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Pipeline Items
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums">
                {ladder.pipeline
                  ? Object.values(ladder.pipeline).reduce(
                      (sum, statuses) =>
                        sum +
                        Object.values(statuses).reduce((s, c) => s + c, 0),
                      0,
                    )
                  : "--"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── B. Eval Results Section ────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Eval Results</h2>
        </div>

        {evals.latest ? (
          <div className="space-y-4">
            {/* Latest eval summary */}
            <Card className="rounded-xl">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-base">Latest Eval Run</CardTitle>
                    <Badge
                      className={
                        evals.latest.failed === 0
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : "bg-red-500/15 text-red-400 border-red-500/30"
                      }
                    >
                      {evals.latest.failed === 0 ? "All Passed" : `${evals.latest.failed} Failed`}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(evals.latest.ranAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Gauge className="h-3 w-3" />
                      {formatDuration(evals.latest.durationMs)}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {evals.latest.trigger}
                    </Badge>
                  </div>
                </div>
                <CardDescription>
                  {evals.latest.passed} of {evals.latest.totalTests} tests passed
                  {evals.latest.totalTests > 0 &&
                    ` (${Math.round((evals.latest.passed / evals.latest.totalTests) * 100)}%)`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm font-medium text-muted-foreground">
                  Per-Provider Breakdown
                </p>
                <ProviderBreakdown results={evals.latest.results} />
              </CardContent>
            </Card>

            {/* Eval history */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="text-base">Eval History</CardTitle>
                <CardDescription>Last 10 eval runs</CardDescription>
              </CardHeader>
              <CardContent>
                <EvalHistoryTable history={evals.history} />
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="rounded-xl">
            <CardContent className="flex items-center gap-3 pt-0">
              <FlaskConical className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No eval runs recorded yet. Evals will appear here once the first
                run completes.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── C. Ladder Pipeline Section ─────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Ladder Pipeline</h2>
        </div>

        {!ladder.available ? (
          <Card className="rounded-xl border-dashed">
            <CardContent className="flex items-center gap-3 pt-0">
              <AlertTriangle className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Ladder 2.0 not connected
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Install the MCP server to enable pipeline tracking and
                  telemetry.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Pipeline stage grid */}
            {ladder.pipeline && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {PIPELINE_STAGES.map((stage) => {
                  const statuses = ladder.pipeline?.[stage.key] ?? {};
                  const total = Object.values(statuses).reduce(
                    (s, c) => s + c,
                    0,
                  );
                  const StageIcon = stage.icon;
                  return (
                    <Card key={stage.key} className="rounded-xl">
                      <CardContent className="space-y-3 pt-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <StageIcon className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-semibold">
                              {stage.label}
                            </span>
                          </div>
                          <span className="text-lg font-bold tabular-nums">
                            {total}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(statuses).length > 0 ? (
                            Object.entries(statuses).map(([status, count]) => (
                              <Badge
                                key={status}
                                variant={statusBadgeVariant(status)}
                                className={`text-xs ${statusColor(status)}`}
                              >
                                {status}: {count}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              No items
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Telemetry events */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="text-base">Recent Telemetry Events</CardTitle>
                <CardDescription>Last 10 pipeline events</CardDescription>
              </CardHeader>
              <CardContent>
                {ladder.recentEvents.length > 0 ? (
                  <div className="divide-y divide-border">
                    {ladder.recentEvents.slice(0, 10).map((event) => (
                      <div
                        key={event.id}
                        className="flex items-center justify-between py-2"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Badge variant="outline" className="text-xs shrink-0">
                            {event.event_type}
                          </Badge>
                          <span className="text-xs text-muted-foreground truncate">
                            {event.project}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-3">
                          {formatDate(event.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No telemetry events recorded yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* ── D. Run Health Section ──────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Run Health</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="rounded-xl">
            <CardContent className="pt-0">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Total Runs (14d)
                </p>
              </div>
              <p className="text-2xl font-bold tabular-nums">{runs.total}</p>
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <CardContent className="pt-0">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Succeeded
                </p>
              </div>
              <p className="text-2xl font-bold tabular-nums text-emerald-400">
                {runs.succeeded}
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <CardContent className="pt-0">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-3.5 w-3.5 text-blue-400" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Success Rate
                </p>
              </div>
              <p className="text-2xl font-bold tabular-nums">
                {runs.successRate !== null
                  ? `${Math.round(runs.successRate)}%`
                  : "--"}
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <CardContent className="pt-0">
              <div className="flex items-center gap-2 mb-1">
                <Cpu className="h-3.5 w-3.5 text-amber-400" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Active Runs
                </p>
              </div>
              <p className="text-2xl font-bold tabular-nums text-amber-400">
                {runs.active}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── E. Recent Alerts ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Recent Alerts</h2>
        </div>

        {alertsData?.alerts && alertsData.alerts.length > 0 ? (
          <Card className="rounded-xl">
            <CardContent className="pt-0">
              <div className="divide-y divide-border">
                {alertsData.alerts.map((alert: AlertRecord) => (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge className={`text-xs shrink-0 ${alertTypeColor(alert.type)}`}>
                        {alert.type.replace(/_/g, " ")}
                      </Badge>
                      <span className="text-sm truncate">{alert.subject}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {alert.emailSent ? (
                        <Mail className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <MailX className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatDate(alert.sentAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-xl border-dashed">
            <CardContent className="flex items-center gap-3 pt-0">
              <Bell className="h-5 w-5 text-muted-foreground shrink-0" />
              <p className="text-sm text-muted-foreground">
                No alerts triggered yet. The system checks health every 5
                minutes.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── F. Server Logs ────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Server Logs</h2>
          <div className="ml-auto flex gap-1">
            {(
              [
                { label: "All", value: undefined },
                { label: "Warnings", value: "warn" },
                { label: "Errors", value: "error" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.label}
                onClick={() => setLogLevelFilter(opt.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  logLevelFilter === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {logsData?.logs && logsData.logs.length > 0 ? (
          <Card className="rounded-xl">
            <CardContent className="pt-0">
              <div className="divide-y divide-border max-h-96 overflow-y-auto">
                {logsData.logs.map((entry: LogEntry, idx: number) => (
                  <div
                    key={`${entry.timestamp}-${idx}`}
                    className="flex items-center gap-3 py-2"
                  >
                    <Badge
                      className={`text-xs shrink-0 w-12 justify-center ${logLevelColor(entry.level)}`}
                    >
                      {entry.level}
                    </Badge>
                    <span className="text-sm truncate min-w-0 flex-1">
                      {entry.message}
                    </span>
                    {entry.service && (
                      <Badge variant="outline" className="text-xs shrink-0">
                        {entry.service}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {formatDate(entry.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-xl border-dashed">
            <CardContent className="flex items-center gap-3 pt-0">
              <ScrollText className="h-5 w-5 text-muted-foreground shrink-0" />
              <p className="text-sm text-muted-foreground">
                No log entries available.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
