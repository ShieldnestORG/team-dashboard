import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { pluginsApi } from "../api/plugins";
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
  Settings2,
  Save,
  Loader2,
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

      {/* Posting Settings */}
      <PostingSettings />

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

// ── Posting Settings ────────────────────────────────────────────────────────

interface PostingConfig {
  maxPostsPerDay: number;
  minPostGapMinutes: number;
  maxPostGapMinutes: number;
  postingWindowStart: number;
  postingWindowEnd: number;
  maxQueueSize: number;
}

const DEFAULTS: PostingConfig = {
  maxPostsPerDay: 8,
  minPostGapMinutes: 30,
  maxPostGapMinutes: 120,
  postingWindowStart: 6,
  postingWindowEnd: 24,
  maxQueueSize: 100,
};

function PostingSettings() {
  const queryClient = useQueryClient();

  const { data: configData, isLoading } = useQuery({
    queryKey: ["twitter", "config"],
    queryFn: () => pluginsApi.getConfig(PLUGIN_ID),
  });

  const [values, setValues] = useState<PostingConfig>(DEFAULTS);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (configData?.configJson) {
      const c = configData.configJson as Record<string, unknown>;
      setValues({
        maxPostsPerDay: (c.maxPostsPerDay as number) || DEFAULTS.maxPostsPerDay,
        minPostGapMinutes: (c.minPostGapMinutes as number) || DEFAULTS.minPostGapMinutes,
        maxPostGapMinutes: (c.maxPostGapMinutes as number) || DEFAULTS.maxPostGapMinutes,
        postingWindowStart: (c.postingWindowStart as number) ?? DEFAULTS.postingWindowStart,
        postingWindowEnd: (c.postingWindowEnd as number) ?? DEFAULTS.postingWindowEnd,
        maxQueueSize: (c.maxQueueSize as number) || DEFAULTS.maxQueueSize,
      });
    }
  }, [configData]);

  const saveMutation = useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      pluginsApi.saveConfig(PLUGIN_ID, {
        ...(configData?.configJson ?? {}),
        ...config,
      }),
    onSuccess: () => {
      setDirty(false);
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["twitter", "config"] });
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const update = useCallback(
    (field: keyof PostingConfig, value: number) => {
      setValues((prev) => ({ ...prev, [field]: value }));
      setDirty(true);
      setSaved(false);
    },
    [],
  );

  const handleSave = useCallback(() => {
    saveMutation.mutate(values as unknown as Record<string, unknown>);
  }, [saveMutation, values]);

  if (isLoading) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        <Settings2 className="inline h-4 w-4 mr-1.5 -mt-0.5" />
        Posting Settings
      </h2>
      <div className="border border-border rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <SettingField
            label="Max Posts Per Day"
            description="Daily tweet limit across all agents"
            value={values.maxPostsPerDay}
            min={1}
            max={50}
            onChange={(v) => update("maxPostsPerDay", v)}
          />
          <SettingField
            label="Min Gap (minutes)"
            description="Minimum time between consecutive posts"
            value={values.minPostGapMinutes}
            min={5}
            max={480}
            onChange={(v) => update("minPostGapMinutes", v)}
          />
          <SettingField
            label="Max Gap (minutes)"
            description="Maximum random spread between auto-scheduled posts"
            value={values.maxPostGapMinutes}
            min={15}
            max={720}
            onChange={(v) => update("maxPostGapMinutes", v)}
          />
          <SettingField
            label="Window Start (hour)"
            description="Earliest hour to auto-schedule (0-23)"
            value={values.postingWindowStart}
            min={0}
            max={23}
            onChange={(v) => update("postingWindowStart", v)}
          />
          <SettingField
            label="Window End (hour)"
            description="Latest hour to auto-schedule (1-24)"
            value={values.postingWindowEnd}
            min={1}
            max={24}
            onChange={(v) => update("postingWindowEnd", v)}
          />
          <SettingField
            label="Max Queue Size"
            description="Maximum pending items before rejecting new posts"
            value={values.maxQueueSize}
            min={10}
            max={500}
            onChange={(v) => update("maxQueueSize", v)}
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={!dirty || saveMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Settings
          </button>
          {saved && (
            <span className="text-sm text-green-500 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {saveMutation.isError && (
            <span className="text-sm text-destructive">
              Failed to save
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingField({
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
