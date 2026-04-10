import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { systemCronsApi } from "../api/system-crons";
import type { SystemCronJob } from "../api/system-crons";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Clock,
  Play,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Timer,
  Loader2,
  Pencil,
  X,
  Check,
  RefreshCw,
} from "lucide-react";

// ── Query Keys ──────────────────────────────────────────────────────────────

const cronKeys = {
  list: ["system-crons"] as const,
};

// ── Agent display names ─────────────────────────────────────────────────────

const AGENT_LABELS: Record<string, string> = {
  echo: "Echo (Data Engineer)",
  sage: "Sage (CMO)",
  blaze: "Blaze (Hot-Take Analyst)",
  cipher: "Cipher (Tech Deep-Diver)",
  spark: "Spark (Community Builder)",
  prism: "Prism (Trend Reporter)",
  nova: "Nova (CTO)",
  core: "Core (Backend Dev)",
  bridge: "Bridge (Full-Stack Dev)",
};

const AGENT_COLORS: Record<string, string> = {
  echo: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  sage: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  blaze: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  cipher: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  spark: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  prism: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  nova: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  core: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  bridge: "bg-teal-500/10 text-teal-400 border-teal-500/20",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// ── Inline Schedule Editor ──────────────────────────────────────────────────

function ScheduleEditor({
  job,
  onSave,
}: {
  job: SystemCronJob;
  onSave: (schedule: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(job.scheduleOverride || job.schedule);

  if (!editing) {
    return (
      <button
        onClick={() => { setValue(job.scheduleOverride || job.schedule); setEditing(true); }}
        className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
        title="Click to edit schedule"
      >
        <Clock className="h-3 w-3" />
        {job.scheduleOverride || job.schedule}
        {job.scheduleOverride && (
          <span className="text-yellow-400 text-[10px]">(custom)</span>
        )}
        <Pencil className="h-2.5 w-2.5 opacity-50" />
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-6 w-36 font-mono text-xs px-1"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") { onSave(value === job.schedule ? null : value); setEditing(false); }
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button onClick={() => { onSave(value === job.schedule ? null : value); setEditing(false); }} className="text-emerald-400 hover:text-emerald-300">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
      {job.scheduleOverride && (
        <button
          onClick={() => { onSave(null); setEditing(false); }}
          className="text-xs text-yellow-400 hover:text-yellow-300"
          title="Reset to default"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── Job Row ─────────────────────────────────────────────────────────────────

function CronJobRow({ job }: { job: SystemCronJob }) {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => systemCronsApi.update(job.jobName, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cronKeys.list }),
  });

  const scheduleMutation = useMutation({
    mutationFn: (scheduleOverride: string | null) =>
      systemCronsApi.update(job.jobName, { scheduleOverride }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cronKeys.list }),
  });

  const triggerMutation = useMutation({
    mutationFn: () => systemCronsApi.trigger(job.jobName),
    onSuccess: () => {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: cronKeys.list }), 2000);
    },
  });

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-md border ${
      !job.enabled ? "opacity-50 bg-muted/20" : job.running ? "bg-blue-500/5 border-blue-500/20" : "bg-card"
    }`}>
      <button
        onClick={() => toggleMutation.mutate(!job.enabled)}
        disabled={toggleMutation.isPending}
        className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          job.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
        } ${toggleMutation.isPending ? "opacity-50" : ""}`}
        title={job.enabled ? "Disable" : "Enable"}
      >
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          job.enabled ? "translate-x-4.5" : "translate-x-1"
        }`} />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{job.jobName}</span>
          {job.running && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-400 border-blue-400/30">
              <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />running
            </Badge>
          )}
          {job.lastError && !job.running && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-red-400 border-red-400/30">
              <AlertTriangle className="h-2.5 w-2.5 mr-1" />error
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <ScheduleEditor job={job} onSave={(s) => scheduleMutation.mutate(s)} />
          <span className="text-[10px] text-muted-foreground">
            Last: {timeAgo(job.lastRunAt)} {job.lastDurationMs !== null && `(${formatDuration(job.lastDurationMs)})`}
          </span>
          <span className="text-[10px] text-muted-foreground">
            Next: {timeAgo(job.nextRunAt).replace(" ago", "")}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            {job.runCount - job.errorCount}
          </div>
          {job.errorCount > 0 && (
            <div className="flex items-center gap-1 text-red-400">
              <XCircle className="h-3 w-3" />
              {job.errorCount}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => triggerMutation.mutate()}
          disabled={triggerMutation.isPending || job.running || !job.enabled}
          title="Run now"
        >
          {triggerMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export function CronManagement() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Cron Jobs" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading } = useQuery({
    queryKey: cronKeys.list,
    queryFn: () => systemCronsApi.list(),
    refetchInterval: 30_000,
  });

  const crons = data?.crons ?? [];

  // Group by ownerAgent
  const grouped = new Map<string, SystemCronJob[]>();
  for (const job of crons) {
    const list = grouped.get(job.ownerAgent) ?? [];
    list.push(job);
    grouped.set(job.ownerAgent, list);
  }

  // Stats
  const totalJobs = crons.length;
  const enabledJobs = crons.filter((j) => j.enabled).length;
  const runningJobs = crons.filter((j) => j.running).length;
  const errorJobs = crons.filter((j) => j.lastError && j.enabled).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cron Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Manage scheduled background jobs across all agents
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Timer className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-lg font-bold">{totalJobs}</div>
              <div className="text-[10px] text-muted-foreground">Total Jobs</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <div>
              <div className="text-lg font-bold">{enabledJobs}</div>
              <div className="text-[10px] text-muted-foreground">Enabled</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Loader2 className={`h-4 w-4 ${runningJobs > 0 ? "text-blue-400 animate-spin" : "text-muted-foreground"}`} />
            <div>
              <div className="text-lg font-bold">{runningJobs}</div>
              <div className="text-[10px] text-muted-foreground">Running</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <AlertTriangle className={`h-4 w-4 ${errorJobs > 0 ? "text-red-400" : "text-muted-foreground"}`} />
            <div>
              <div className="text-lg font-bold">{errorJobs}</div>
              <div className="text-[10px] text-muted-foreground">Errors</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([agent, jobs]) => (
              <Card key={agent}>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-xs ${AGENT_COLORS[agent] || "bg-muted text-foreground"}`}
                    >
                      {agent}
                    </Badge>
                    <span>{AGENT_LABELS[agent] || agent}</span>
                    <span className="text-muted-foreground font-normal">
                      {jobs.length} job{jobs.length !== 1 ? "s" : ""}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-1.5">
                  {jobs.map((job) => (
                    <CronJobRow key={job.jobName} job={job} />
                  ))}
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}
