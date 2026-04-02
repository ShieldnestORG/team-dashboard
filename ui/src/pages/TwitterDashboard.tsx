import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  Bird,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Target,
  BarChart3,
  Send,
  Heart,
  Repeat2,
  UserPlus,
} from "lucide-react";

// ── API helpers ──────────────────────────────────────────────────────────────

const PLUGIN_ID = "coherencedaddy.twitter";

interface ToolResult<T = unknown> {
  pluginId: string;
  toolName: string;
  result: { content?: string; data?: T; error?: string };
}

async function executeTool<T = unknown>(
  tool: string,
  parameters: Record<string, unknown>,
  companyId: string,
): Promise<ToolResult<T>> {
  const res = await fetch("/api/plugins/tools/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      tool: `${PLUGIN_ID}:${tool}`,
      parameters,
      runContext: {
        agentId: "dashboard-ui",
        runId: `ui-${Date.now()}`,
        companyId,
        projectId: companyId,
      },
    }),
  });
  if (!res.ok) throw new Error(`Tool ${tool} failed: ${res.status}`);
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

interface QueueStatusData {
  counts: { pending: number; claimed: number; posted: number; failed: number; cancelled: number };
  extensionOnline: boolean;
  totalItems: number;
}

interface TargetItem {
  handle: string;
  displayName?: string;
  engageActions: string[];
  engagementCount: number;
  venture: string;
  status: string;
}

interface AnalyticsTotals {
  postsSent: number;
  postsQueued: number;
  postsFailed: number;
  likes: number;
  reposts: number;
  follows: number;
  replies: number;
  extractions: number;
}

interface DailyAnalytics {
  date: string;
  postsSent: number;
  likes: number;
  reposts: number;
  follows: number;
}

// ── Component ────────────────────────────────────────────────────────────────

export function TwitterDashboard() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Twitter/X" }]);
  }, [setBreadcrumbs]);

  const { data: queueData, isLoading: queueLoading } = useQuery({
    queryKey: ["twitter", "queue-status", selectedCompanyId],
    queryFn: () =>
      executeTool<QueueStatusData>("get-queue-status", {}, selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10000,
  });

  const { data: targetsData } = useQuery({
    queryKey: ["twitter", "targets", selectedCompanyId],
    queryFn: () =>
      executeTool<{ targets: TargetItem[]; total: number }>(
        "list-targets",
        { status: "active" },
        selectedCompanyId!,
      ),
    enabled: !!selectedCompanyId,
    refetchInterval: 30000,
  });

  const { data: analyticsData } = useQuery({
    queryKey: ["twitter", "analytics", selectedCompanyId],
    queryFn: () =>
      executeTool<{ totals: AnalyticsTotals; daily: DailyAnalytics[] }>(
        "get-analytics",
        { days: 7 },
        selectedCompanyId!,
      ),
    enabled: !!selectedCompanyId,
    refetchInterval: 60000,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Bird} message="Select a company to view the Twitter dashboard." />;
  }

  if (queueLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const queue = queueData?.result?.data;
  const targets = targetsData?.result?.data?.targets ?? [];
  const analytics = analyticsData?.result?.data?.totals;
  const extensionOnline = queue?.extensionOnline ?? false;

  return (
    <div className="space-y-6">
      {/* Extension status banner */}
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
          extensionOnline
            ? "border-green-500/30 bg-green-500/5"
            : "border-yellow-500/30 bg-yellow-500/5"
        }`}
      >
        {extensionOnline ? (
          <Wifi className="h-4 w-4 text-green-500" />
        ) : (
          <WifiOff className="h-4 w-4 text-yellow-500" />
        )}
        <span className="text-sm">
          {extensionOnline
            ? "x-Ext extension is connected and running"
            : "x-Ext extension is offline — load the extension in Chrome and open x.com"}
        </span>
      </div>

      {/* Queue metrics */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Tweet Queue
        </h2>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-1 sm:gap-2">
          <MetricCard
            icon={Clock}
            value={queue?.counts?.pending ?? 0}
            label="Pending"
            description="Waiting for extension"
          />
          <MetricCard
            icon={Send}
            value={queue?.counts?.claimed ?? 0}
            label="Claimed"
            description="Being posted now"
          />
          <MetricCard
            icon={CheckCircle2}
            value={queue?.counts?.posted ?? 0}
            label="Posted"
            description="Successfully sent"
          />
          <MetricCard
            icon={AlertTriangle}
            value={queue?.counts?.failed ?? 0}
            label="Failed"
            description="Errors occurred"
          />
        </div>
      </div>

      {/* Analytics summary */}
      {analytics && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            7-Day Analytics
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-1 sm:gap-2">
            <MetricCard icon={Bird} value={analytics.postsSent} label="Posts Sent" />
            <MetricCard icon={Heart} value={analytics.likes} label="Likes" />
            <MetricCard icon={Repeat2} value={analytics.reposts} label="Reposts" />
            <MetricCard icon={UserPlus} value={analytics.follows} label="Follows" />
            <MetricCard icon={Send} value={analytics.replies} label="Replies" />
            <MetricCard icon={BarChart3} value={analytics.extractions} label="Extractions" />
          </div>
        </div>
      )}

      {/* Targets */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Engagement Targets ({targets.length})
        </h2>
        {targets.length > 0 ? (
          <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
            {targets.map((t) => (
              <div
                key={t.handle}
                className="flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Target className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      @{t.handle}
                      {t.displayName && (
                        <span className="text-muted-foreground ml-2">
                          {t.displayName}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.engageActions.join(", ")} &middot; {t.venture}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t.engagementCount} engagements
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-border rounded-lg p-6">
            <EmptyState
              icon={Target}
              message="No engagement targets yet. Use the add-target tool to add Twitter accounts."
            />
          </div>
        )}
      </div>
    </div>
  );
}
