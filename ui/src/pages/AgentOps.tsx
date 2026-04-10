import { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Play,
  Pause,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { agentOpsApi, type AgentOpsEntry, type AttentionItem } from "../api/agent-ops";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { agentStatusDot, agentStatusDotDefault, statusBadge, statusBadgeDefault } from "../lib/status-colors";
import { agentUrl, cn, formatCents } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full shrink-0",
        agentStatusDot[status] ?? agentStatusDotDefault,
      )}
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        statusBadge[status] ?? statusBadgeDefault,
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function AttentionTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    error: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    pending_approval: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
    budget_paused: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
    paused: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
    failed_run: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    stale: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  };
  const labels: Record<string, string> = {
    error: "Error",
    pending_approval: "Needs Approval",
    budget_paused: "Budget Paused",
    paused: "Paused",
    failed_run: "Failed Run",
    stale: "Stale",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", styles[type] ?? styles.stale)}>
      {labels[type] ?? type}
    </span>
  );
}

function AttentionSection({
  items,
  agents,
  onResume,
  isResuming,
}: {
  items: AttentionItem[];
  agents: AgentOpsEntry[];
  onResume: (agentId: string) => void;
  isResuming: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
          Attention Required ({items.length})
        </h3>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => {
          const agent = agents.find((a) => a.id === item.agentId);
          const isPaused = item.type === "paused" || item.type === "budget_paused";
          return (
            <div key={`${item.agentId}-${item.type}-${i}`} className="flex items-center gap-3 text-sm">
              <Link
                to={agentUrl({ id: item.agentId, name: item.agentName })}
                className="font-medium text-foreground hover:underline min-w-[80px]"
              >
                {item.agentName}
              </Link>
              <AttentionTypeBadge type={item.type} />
              <span className="text-muted-foreground truncate flex-1 text-xs">{item.message}</span>
              {isPaused && (
                <button
                  onClick={() => onResume(agent?.id ?? item.agentId)}
                  disabled={isResuming}
                  className="text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 disabled:opacity-50"
                >
                  Resume
                </button>
              )}
              <Link
                to={agentUrl({ id: item.agentId, name: item.agentName })}
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryPills({ summary }: { summary: { total: number; running: number; idle: number; paused: number; error: number; pendingApproval: number } }) {
  const pills = [
    { label: "Total", value: summary.total, color: "text-foreground" },
    { label: "Running", value: summary.running, dotClass: "bg-cyan-400 animate-pulse" },
    { label: "Idle", value: summary.idle, dotClass: "bg-green-400" },
    { label: "Paused", value: summary.paused, dotClass: "bg-yellow-400" },
    { label: "Errors", value: summary.error, dotClass: "bg-red-400" },
  ];
  if (summary.pendingApproval > 0) {
    pills.push({ label: "Pending", value: summary.pendingApproval, dotClass: "bg-amber-400" });
  }

  return (
    <div className="flex flex-wrap gap-4">
      {pills.map((p) => (
        <div key={p.label} className="flex items-center gap-2 text-sm">
          {p.dotClass && <span className={cn("h-2 w-2 rounded-full", p.dotClass)} />}
          <span className="text-muted-foreground">{p.label}</span>
          <span className={cn("font-semibold", p.color)}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function AgentRow({
  agent,
  hasAttention,
  onInvoke,
  onPause,
  onResume,
  isMutating,
}: {
  agent: AgentOpsEntry;
  hasAttention: boolean;
  onInvoke: () => void;
  onPause: () => void;
  onResume: () => void;
  isMutating: boolean;
}) {
  const [showError, setShowError] = useState(false);
  const errorText = agent.lastError || agent.lastRunError;
  const hasErrors = !!(errorText || agent.cronErrorCount > 0);
  const isLive = agent.activeRunCount > 0;
  const isPaused = agent.status === "paused";

  const borderColor = hasAttention
    ? agent.status === "error"
      ? "border-l-red-400"
      : agent.status === "pending_approval"
        ? "border-l-amber-400"
        : "border-l-yellow-400"
    : "border-l-transparent";

  return (
    <>
      <tr className={cn("group hover:bg-muted/50 transition-colors border-l-2", borderColor)}>
        {/* Status dot */}
        <td className="pl-3 pr-2 py-2.5">
          <StatusDot status={isLive ? "running" : agent.status} />
        </td>

        {/* Agent name + role */}
        <td className="py-2.5 pr-3">
          <Link to={agentUrl({ id: agent.id, name: agent.name })} className="block">
            <div className="font-medium text-sm text-foreground hover:underline">{agent.name}</div>
            <div className="text-xs text-muted-foreground">{agent.title ?? agent.role}</div>
          </Link>
        </td>

        {/* Current activity */}
        <td className="py-2.5 pr-3">
          {isLive ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-cyan-600 dark:text-cyan-400">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Live{agent.activeRunCount > 1 ? ` (${agent.activeRunCount})` : ""}
              </span>
              {agent.activeRunIssueIdentifier && (
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                  {agent.activeRunIssueIdentifier}
                  {agent.activeRunIssueTitle ? `: ${agent.activeRunIssueTitle}` : ""}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              {isPaused ? (agent.pauseReason ?? "Paused") : "Idle"}
            </span>
          )}
        </td>

        {/* Last run */}
        <td className="py-2.5 pr-3">
          {agent.lastRunStatus ? (
            <div className="flex items-center gap-2">
              <StatusBadge status={agent.lastRunStatus} />
              {agent.lastRunFinishedAt && (
                <span className="text-xs text-muted-foreground">
                  {timeAgo(agent.lastRunFinishedAt)}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No runs</span>
          )}
        </td>

        {/* Last heartbeat */}
        <td className="py-2.5 pr-3">
          <span className="text-xs text-muted-foreground">
            {agent.lastHeartbeatAt ? timeAgo(agent.lastHeartbeatAt) : "Never"}
          </span>
        </td>

        {/* Errors */}
        <td className="py-2.5 pr-3">
          {hasErrors ? (
            <button
              onClick={() => setShowError(!showError)}
              className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 hover:underline"
            >
              {showError ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {agent.cronErrorCount > 0 ? `${agent.cronErrorCount} cron` : "error"}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </td>

        {/* Actions */}
        <td className="py-2.5 pr-3">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {isPaused ? (
              <button
                onClick={onResume}
                disabled={isMutating}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="Resume"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            ) : (
              <>
                <button
                  onClick={onInvoke}
                  disabled={isMutating}
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
                  title="Run heartbeat"
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={onPause}
                  disabled={isMutating}
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
                  title="Pause"
                >
                  <Pause className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </td>
      </tr>

      {/* Error expansion row */}
      {showError && errorText && (
        <tr>
          <td />
          <td colSpan={6} className="pb-3 pr-3">
            <pre className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded p-2 max-h-24 overflow-auto whitespace-pre-wrap break-all">
              {errorText}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

export function AgentOps() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Agent Ops" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.agentOps(selectedCompanyId!),
    queryFn: () => agentOpsApi.overview(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 20_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.agentOps(selectedCompanyId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
  };

  const actionMutation = useMutation({
    mutationFn: async ({ agentId, action }: { agentId: string; action: "invoke" | "pause" | "resume" }) => {
      switch (action) {
        case "invoke": return agentsApi.invoke(agentId, selectedCompanyId ?? undefined);
        case "pause": return agentsApi.pause(agentId, selectedCompanyId ?? undefined);
        case "resume": return agentsApi.resume(agentId, selectedCompanyId ?? undefined);
      }
    },
    onSuccess: invalidate,
  });

  if (!selectedCompanyId) {
    return <div className="p-6 text-sm text-muted-foreground">Select a company first.</div>;
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const attentionAgentIds = new Set(data.attentionRequired.map((a) => a.agentId));

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Agent Operations</h1>
        <SummaryPills summary={data.summary} />
      </div>

      <AttentionSection
        items={data.attentionRequired}
        agents={data.agents}
        onResume={(id) => actionMutation.mutate({ agentId: id, action: "resume" })}
        isResuming={actionMutation.isPending}
      />

      {/* Agent table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="pl-3 pr-2 py-2 text-xs font-medium text-muted-foreground w-[40px]" />
              <th className="py-2 pr-3 text-xs font-medium text-muted-foreground">Agent</th>
              <th className="py-2 pr-3 text-xs font-medium text-muted-foreground">Current Activity</th>
              <th className="py-2 pr-3 text-xs font-medium text-muted-foreground">Last Run</th>
              <th className="py-2 pr-3 text-xs font-medium text-muted-foreground">Last Heartbeat</th>
              <th className="py-2 pr-3 text-xs font-medium text-muted-foreground">Errors</th>
              <th className="py-2 pr-3 text-xs font-medium text-muted-foreground w-[80px]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                hasAttention={attentionAgentIds.has(agent.id)}
                onInvoke={() => actionMutation.mutate({ agentId: agent.id, action: "invoke" })}
                onPause={() => actionMutation.mutate({ agentId: agent.id, action: "pause" })}
                onResume={() => actionMutation.mutate({ agentId: agent.id, action: "resume" })}
                isMutating={actionMutation.isPending}
              />
            ))}
          </tbody>
        </table>
        {data.agents.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">No agents found.</div>
        )}
      </div>
    </div>
  );
}
