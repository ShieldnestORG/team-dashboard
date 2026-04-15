import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { pluginsApi } from "../api/plugins";
import type { PluginHealthCheckResult } from "../api/plugins";
import { queryKeys } from "../lib/queryKeys";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Bird,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Target,
  BarChart3,
  Send,
  Heart,
  Repeat2,
  UserPlus,
  Settings2,
  Save,
  Loader2,
  LinkIcon,
  Unlink,
  Gauge,
  MessageSquare,
  Eye,
  TrendingUp,
  XCircle,
  Activity,
  Monitor,
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

async function apiFetch<T = unknown>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

interface QueueStatusData {
  counts: { pending: number; claimed: number; posted: number; failed: number; cancelled: number };
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

interface ConnectionStatus {
  connected: boolean;
  username?: string;
  userId?: string;
  expiresAt?: string;
  connectedAt?: string;
}

interface ExtensionBotStatus {
  online: boolean;
  lastHeartbeatAt: string | null;
  sessionId: string | null;
  botEnabled: boolean;
  currentUrl: string | null;
  ageSeconds: number | null;
}

interface RateLimitStatus {
  endpoints: Record<string, unknown>;
  dailyBudget: {
    spentUsd: number;
    capUsd: number;
    repliesSent: number;
    maxReplies: number;
    readCount: number;
  };
  panicMode: boolean;
  multiplier?: number;
}

interface EngagementData {
  daily: Array<{ date: string; action: string; count: number }>;
  totals: Array<{ action: string; count: number; success_count: number }>;
  topTargets: Array<{ username: string; engagement_count: number; actions: string[] }>;
  days: number;
}

interface PostingData {
  daily: Array<{ date: string; count: number }>;
  recentPosts: Array<{
    tweet_id: string;
    tweet_text: string;
    posted_at: string;
    like_count: number;
    retweet_count: number;
    reply_count: number;
    impression_count: number;
    quote_count: number;
  }>;
  stats: {
    total: number;
    with_impressions: number;
    total_likes: number;
    total_retweets: number;
    total_replies: number;
    total_impressions: number;
  };
  days: number;
}

// ── Component ────────────────────────────────────────────────────────────────

export function TwitterDashboard() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    setBreadcrumbs([{ label: "Twitter/X" }]);
  }, [setBreadcrumbs]);

  // Plugin-based queries (existing)
  const { data: queueData, isLoading: queueLoading } = useQuery({
    queryKey: ["twitter", "queue-status", selectedCompanyId],
    queryFn: () =>
      executeTool<QueueStatusData>("get-queue-status", {}, selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 30000,
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

  // New API-based queries
  const { data: connectionData } = useQuery({
    queryKey: ["x-analytics", "connection"],
    queryFn: () => apiFetch<ConnectionStatus>("/api/x/analytics/connection"),
    refetchInterval: 60000,
  });

  const { data: extensionData } = useQuery({
    queryKey: ["x-analytics", "extension-status"],
    queryFn: () => apiFetch<ExtensionBotStatus>("/api/x/analytics/extension-status"),
    refetchInterval: 30000,
  });

  const { data: rateLimitData } = useQuery({
    queryKey: ["x-analytics", "rate-limits"],
    queryFn: () => apiFetch<RateLimitStatus>("/api/x/analytics/rate-limits"),
    refetchInterval: 30000,
  });

  const { data: engagementData } = useQuery({
    queryKey: ["x-analytics", "engagement"],
    queryFn: () => apiFetch<EngagementData>("/api/x/analytics/engagement?days=7"),
    refetchInterval: 60000,
  });

  const { data: postingData } = useQuery({
    queryKey: ["x-analytics", "posting"],
    queryFn: () => apiFetch<PostingData>("/api/x/analytics/posting?days=7"),
    refetchInterval: 60000,
  });

  // Config + health for posting diagnostics
  const { data: configData } = useQuery({
    queryKey: ["twitter", "config"],
    queryFn: () => pluginsApi.getConfig(PLUGIN_ID),
    refetchInterval: 30000,
  });

  const { data: pluginHealthData } = useQuery<PluginHealthCheckResult>({
    queryKey: queryKeys.plugins.health(PLUGIN_ID),
    queryFn: () => pluginsApi.health(PLUGIN_ID),
    refetchInterval: 30000,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Bird} message="Select a company to view the Twitter dashboard." />;
  }

  const queue = queueData?.result?.data;
  const targets = targetsData?.result?.data?.targets ?? [];
  const analytics = analyticsData?.result?.data?.totals;
  const connection = connectionData ?? { connected: false };
  const twitterConfig = configData?.configJson as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      {/* Connection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ConnectionCard connection={connection} />
        <ExtensionBotCard extension={extensionData} />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="posting">Posting</TabsTrigger>
          <TabsTrigger value="targets">Targets</TabsTrigger>
          <TabsTrigger value="rate-limits">Rate Limits</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ──────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6">
          <PostingHealthCard
            pluginHealth={pluginHealthData}
            config={twitterConfig}
            connection={connection}
            rateLimitData={rateLimitData}
            queue={queue}
            lastPostAt={postingData?.recentPosts?.[0]?.posted_at}
            onNavigateTab={setActiveTab}
          />

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
                description="Waiting to post"
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

          {/* Quick rate limit summary */}
          {rateLimitData && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Daily Rate Limits
              </h2>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-1 sm:gap-2">
                <MetricCard
                  icon={Gauge}
                  value={`$${rateLimitData.dailyBudget.spentUsd.toFixed(3)}`}
                  label="Spent Today"
                  description={`cap $${rateLimitData.dailyBudget.capUsd}`}
                />
                <MetricCard
                  icon={Send}
                  value={rateLimitData.dailyBudget.repliesSent}
                  label="Replies Sent"
                  description={`max ${rateLimitData.dailyBudget.maxReplies}/day`}
                />
                <MetricCard
                  icon={BarChart3}
                  value={rateLimitData.dailyBudget.readCount}
                  label="Reads Today"
                  description="search + read calls"
                />
                <MetricCard
                  icon={AlertTriangle}
                  value={rateLimitData.panicMode ? "ON" : "OFF"}
                  label="Panic Mode"
                  description={rateLimitData.panicMode ? "50% caps active" : "normal operation"}
                />
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Analytics Tab ─────────────────────────────────────────────── */}
        <TabsContent value="analytics" className="space-y-6">
          {/* Plugin analytics (existing) */}
          {analytics && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                7-Day Summary (Plugin)
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

          {/* Engagement breakdown by action */}
          {engagementData && (
            <>
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Engagement by Action Type
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                  {engagementData.totals.map((t) => (
                    <Card key={t.action}>
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium capitalize">{t.action}</span>
                          <Badge variant="secondary">{t.count}</Badge>
                        </div>
                        <EngagementBar
                          used={t.count}
                          total={Math.max(t.count, 1)}
                          label={`${t.success_count} succeeded`}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          {t.count > 0
                            ? `${Math.round((t.success_count / t.count) * 100)}% success rate`
                            : "No data"}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Top Engaged Accounts */}
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Top Engaged Accounts
                </h2>
                {engagementData.topTargets.length > 0 ? (
                  <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
                    <div className="grid grid-cols-3 gap-4 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      <span>Username</span>
                      <span>Actions</span>
                      <span className="text-right">Engagements</span>
                    </div>
                    {engagementData.topTargets.map((t) => (
                      <div
                        key={t.username}
                        className="grid grid-cols-3 gap-4 px-4 py-3 hover:bg-accent/50 transition-colors"
                      >
                        <span className="text-sm font-medium truncate">@{t.username}</span>
                        <div className="flex flex-wrap gap-1">
                          {t.actions.map((a) => (
                            <Badge key={a} variant="outline" className="text-xs capitalize">
                              {a}
                            </Badge>
                          ))}
                        </div>
                        <span className="text-sm text-right tabular-nums">{t.engagement_count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border border-border rounded-lg p-6">
                    <EmptyState icon={Target} message="No engagement data for this period." />
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Posting Tab ───────────────────────────────────────────────── */}
        <TabsContent value="posting" className="space-y-6">
          {postingData && (
            <>
              {/* Stats cards */}
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Posting Stats ({postingData.days} Days)
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-1 sm:gap-2">
                  <MetricCard icon={Bird} value={postingData.stats.total} label="Total Posts" />
                  <MetricCard icon={Eye} value={postingData.stats.total_impressions} label="Impressions" />
                  <MetricCard icon={Heart} value={postingData.stats.total_likes} label="Likes" />
                  <MetricCard icon={Repeat2} value={postingData.stats.total_retweets} label="Retweets" />
                  <MetricCard icon={MessageSquare} value={postingData.stats.total_replies} label="Replies" />
                  <MetricCard
                    icon={TrendingUp}
                    value={
                      postingData.stats.total > 0
                        ? `${Math.round((postingData.stats.with_impressions / postingData.stats.total) * 100)}%`
                        : "N/A"
                    }
                    label="Impression Rate"
                  />
                </div>
              </div>

              {/* Daily posts bar chart */}
              {postingData.daily.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    Daily Posts
                  </h2>
                  <Card>
                    <CardContent className="pt-4">
                      <SimpleBarChart data={postingData.daily} valueKey="count" labelKey="date" />
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Recent posts table */}
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Recent Posts
                </h2>
                {postingData.recentPosts.length > 0 ? (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            <th className="px-4 py-2 text-left">Tweet</th>
                            <th className="px-4 py-2 text-left">Posted</th>
                            <th className="px-4 py-2 text-right">Likes</th>
                            <th className="px-4 py-2 text-right">RTs</th>
                            <th className="px-4 py-2 text-right">Replies</th>
                            <th className="px-4 py-2 text-right">Impressions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {postingData.recentPosts.map((p) => (
                            <tr key={p.tweet_id} className="hover:bg-accent/50 transition-colors">
                              <td className="px-4 py-3 max-w-xs truncate" title={p.tweet_text}>
                                {p.tweet_text.length > 80
                                  ? p.tweet_text.slice(0, 80) + "..."
                                  : p.tweet_text}
                              </td>
                              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                                {new Date(p.posted_at).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">{p.like_count}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{p.retweet_count}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{p.reply_count}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{p.impression_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="border border-border rounded-lg p-6">
                    <EmptyState icon={Bird} message="No posts recorded for this period." />
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Targets Tab ───────────────────────────────────────────────── */}
        <TabsContent value="targets" className="space-y-6">
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
        </TabsContent>

        {/* ── Rate Limits Tab ───────────────────────────────────────────── */}
        <TabsContent value="rate-limits" className="space-y-6">
          <RateLimitsPanel data={rateLimitData} />
        </TabsContent>

        {/* ── Settings Tab ──────────────────────────────────────────────── */}
        <TabsContent value="settings" className="space-y-6">
          <XApiToggle companyId={selectedCompanyId} />
          <RateMultiplierSetting />
          <PostingSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Connection Card ────────────────────────────────────────────────────────

function ConnectionCard({ connection }: { connection: ConnectionStatus }) {
  const queryClient = useQueryClient();

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/x/oauth/revoke", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to disconnect");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["x-analytics", "connection"] });
    },
  });

  return (
    <Card>
      <CardContent className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <Bird className="h-5 w-5 text-sky-500" />
          {connection.connected ? (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm font-medium">
                Connected as <span className="text-sky-500">@{connection.username}</span>
              </span>
              {connection.connectedAt && (
                <span className="text-xs text-muted-foreground">
                  since {new Date(connection.connectedAt).toLocaleDateString()}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-yellow-500" />
              <span className="text-sm text-muted-foreground">Not connected to X</span>
            </div>
          )}
        </div>
        <div>
          {connection.connected ? (
            <button
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unlink className="h-3.5 w-3.5" />
              )}
              Disconnect
            </button>
          ) : (
            <a
              href="/api/x/oauth/authorize"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-sky-500 text-white hover:bg-sky-600 transition-colors"
            >
              <LinkIcon className="h-3.5 w-3.5" />
              Connect X Account
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Extension Bot Card ────────────────────────────────────────────────────

function ExtensionBotCard({ extension }: { extension?: ExtensionBotStatus }) {
  const online = extension?.online ?? false;

  function formatAge(seconds: number | null): string {
    if (seconds == null) return "";
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <Monitor className="h-5 w-5 text-violet-500" />
          {online ? (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm font-medium">
                Extension Bot <span className="text-violet-500">Online</span>
              </span>
              {extension?.botEnabled && (
                <Badge variant="outline" className="text-xs">Bot Active</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                last seen {formatAge(extension?.ageSeconds ?? null)}
              </span>
            </div>
          ) : extension?.lastHeartbeatAt ? (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-yellow-500" />
              <span className="text-sm text-muted-foreground">
                Extension Bot Disconnected
              </span>
              <span className="text-xs text-muted-foreground">
                last seen {formatAge(extension?.ageSeconds ?? null)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-zinc-500" />
              <span className="text-sm text-muted-foreground">
                Extension Bot — No heartbeat received
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Posting Health Card ──────────────────────────────────────────────────

interface HealthCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
  critical: boolean;
  action?: { label: string; onClick?: () => void; href?: string };
}

function PostingHealthCard({
  pluginHealth,
  config,
  connection,
  rateLimitData,
  queue,
  lastPostAt,
  onNavigateTab,
}: {
  pluginHealth?: PluginHealthCheckResult;
  config?: Record<string, unknown>;
  connection: ConnectionStatus;
  rateLimitData?: RateLimitStatus;
  queue?: QueueStatusData;
  lastPostAt?: string;
  onNavigateTab: (tab: string) => void;
}) {
  if (!connection) return null;

  const windowStart = (config?.postingWindowStart as number) ?? 6;
  const windowEnd = (config?.postingWindowEnd as number) ?? 24;
  const minGap = (config?.minPostGapMinutes as number) ?? 30;
  const currentHour = new Date().getHours();

  const checks: HealthCheck[] = [
    {
      key: "plugin",
      label: "Plugin running",
      passed: pluginHealth?.status === "ready",
      detail: pluginHealth?.status === "ready"
        ? "Plugin is active"
        : `Plugin status: ${pluginHealth?.status ?? "unknown"}${pluginHealth?.lastError ? ` — ${pluginHealth.lastError}` : ""}`,
      critical: true,
    },
    {
      key: "xapi",
      label: "X API enabled",
      passed: config?.xApiEnabled === true,
      detail: config?.xApiEnabled ? "Auto-posting is on" : "Auto-posting is disabled",
      critical: true,
      action: config?.xApiEnabled
        ? undefined
        : { label: "Go to Settings", onClick: () => onNavigateTab("settings") },
    },
    {
      key: "oauth",
      label: "Account connected",
      passed: connection.connected,
      detail: connection.connected
        ? `Connected as @${connection.username}`
        : "X account not linked",
      critical: true,
      action: connection.connected
        ? undefined
        : { label: "Connect Account", href: "/api/x/oauth/authorize" },
    },
    {
      key: "window",
      label: "Posting window",
      passed: currentHour >= windowStart && currentHour < windowEnd,
      detail:
        currentHour >= windowStart && currentHour < windowEnd
          ? `Active (${windowStart}:00–${windowEnd}:00)`
          : `Outside window (${windowStart}:00–${windowEnd}:00). Resumes at ${windowStart}:00`,
      critical: false,
    },
    {
      key: "budget",
      label: "Daily budget",
      passed: rateLimitData
        ? rateLimitData.dailyBudget.spentUsd < rateLimitData.dailyBudget.capUsd
        : true,
      detail: rateLimitData
        ? `$${rateLimitData.dailyBudget.spentUsd.toFixed(3)} / $${rateLimitData.dailyBudget.capUsd} spent today`
        : "Loading...",
      critical: false,
    },
    (() => {
      if (!lastPostAt) {
        return {
          key: "gap",
          label: "Post gap cleared",
          passed: true,
          detail: "No recent posts",
          critical: false,
        };
      }
      const minutesSince = Math.round(
        (Date.now() - new Date(lastPostAt).getTime()) / 60000,
      );
      const cleared = minutesSince >= minGap;
      return {
        key: "gap",
        label: "Post gap cleared",
        passed: cleared,
        detail: cleared
          ? `${minutesSince}min since last post (${minGap}min min)`
          : `${minutesSince}min since last post, need ${minGap}min`,
        critical: false,
      };
    })(),
    {
      key: "queue",
      label: "Queue has items",
      passed: (queue?.counts?.pending ?? 0) > 0,
      detail:
        (queue?.counts?.pending ?? 0) > 0
          ? `${queue!.counts.pending} pending`
          : "Queue is empty — add tweets to start posting",
      critical: false,
    },
  ];

  const criticalFail = checks.some((c) => c.critical && !c.passed);
  const anyFail = checks.some((c) => !c.passed);

  let overallLabel: string;
  let overallVariant: "default" | "destructive" | "secondary" | "outline";
  let overallClass: string;
  if (criticalFail) {
    overallLabel = "Posting Blocked";
    overallVariant = "destructive";
    overallClass = "";
  } else if (anyFail) {
    overallLabel = "Waiting";
    overallVariant = "outline";
    overallClass = "border-yellow-500/50 text-yellow-600 dark:text-yellow-400";
  } else {
    overallLabel = "Ready to Post";
    overallVariant = "outline";
    overallClass = "border-green-500/50 text-green-600 dark:text-green-400";
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Posting Health
          </span>
          <Badge variant={overallVariant} className={overallClass}>
            {overallLabel}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {checks.map((check) => (
          <div
            key={check.key}
            className="flex items-start gap-2.5 py-1.5 text-sm"
          >
            {check.passed ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            ) : check.critical ? (
              <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <span className={check.passed ? "text-muted-foreground" : "font-medium"}>
                {check.label}
              </span>
              <span className="text-xs text-muted-foreground ml-2">
                {check.detail}
              </span>
              {check.action && !check.passed && (
                <>
                  {" "}
                  {check.action.href ? (
                    <a
                      href={check.action.href}
                      className="text-xs text-sky-500 hover:underline"
                    >
                      {check.action.label}
                    </a>
                  ) : (
                    <button
                      onClick={check.action.onClick}
                      className="text-xs text-sky-500 hover:underline"
                    >
                      {check.action.label}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── X API Toggle ──────────────────────────────────────────────────────────

function XApiToggle({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();

  const { data: configData, isLoading: loading } = useQuery({
    queryKey: ["twitter", "config"],
    queryFn: () => pluginsApi.getConfig(PLUGIN_ID),
  });

  const enabled = (configData?.configJson as Record<string, unknown>)?.xApiEnabled === true;

  const toggleMutation = useMutation({
    mutationFn: async (newValue: boolean) => {
      await pluginsApi.saveConfig(PLUGIN_ID, {
        ...(configData?.configJson ?? {}),
        xApiEnabled: newValue,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["twitter", "config"] });
    },
  });

  const saving = toggleMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Bird className="h-4 w-4" />
          X API Auto-Posting
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Enable automated posting & engagement</p>
            <p className="text-xs text-muted-foreground mt-1">
              When enabled, the system will auto-generate tweets, post them via X API, and engage with targets.
            </p>
          </div>
          <button
            onClick={() => toggleMutation.mutate(!enabled)}
            disabled={loading || saving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              enabled ? "bg-sky-500" : "bg-muted"
            } ${loading || saving ? "opacity-50" : ""}`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
        {enabled && (
          <div className="mt-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-green-600">Active — posting & engagement crons running</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Rate Limits Panel ──────────────────────────────────────────────────────

function RateLimitsPanel({ data }: { data?: RateLimitStatus }) {
  if (!data) {
    return (
      <div className="border border-border rounded-lg p-6">
        <EmptyState icon={Gauge} message="Loading rate limit data..." />
      </div>
    );
  }

  const spendPct = data.dailyBudget.capUsd > 0
    ? (data.dailyBudget.spentUsd / data.dailyBudget.capUsd) * 100
    : 0;
  const replyPct = data.dailyBudget.maxReplies > 0
    ? (data.dailyBudget.repliesSent / data.dailyBudget.maxReplies) * 100
    : 0;

  return (
    <div className="space-y-4">
      {data.panicMode && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-red-500/30 bg-red-500/5">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          <span className="text-sm text-red-400">
            Panic mode active — operating at 50% capacity due to 429 response
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Gauge className="h-4 w-4" />
              Daily Spend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl font-bold tabular-nums">${data.dailyBudget.spentUsd.toFixed(3)}</span>
              <span className="text-xs text-muted-foreground">
                cap ${data.dailyBudget.capUsd}/day
              </span>
            </div>
            <RateLimitBar pct={spendPct} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <MessageSquare className="h-4 w-4" />
              Replies Sent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl font-bold tabular-nums">{data.dailyBudget.repliesSent}</span>
              <span className="text-xs text-muted-foreground">
                {data.dailyBudget.repliesSent}/{data.dailyBudget.maxReplies} today
              </span>
            </div>
            <RateLimitBar pct={replyPct} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <BarChart3 className="h-4 w-4" />
              Read Calls
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl font-bold tabular-nums">{data.dailyBudget.readCount}</span>
              <span className="text-xs text-muted-foreground">search + read today</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RateLimitBar({ pct }: { pct: number }) {
  const color =
    pct < 50
      ? "bg-green-500"
      : pct < 80
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <div className="h-2 rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

function EngagementBar({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  return (
    <div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-sky-500 transition-all duration-500"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

// ── Simple Bar Chart ───────────────────────────────────────────────────────

function SimpleBarChart({
  data,
  valueKey,
  labelKey,
}: {
  data: Array<Record<string, unknown>>;
  valueKey: string;
  labelKey: string;
}) {
  if (data.length === 0) return null;

  const maxVal = Math.max(...data.map((d) => (d[valueKey] as number) || 0), 1);

  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d, i) => {
        const val = (d[valueKey] as number) || 0;
        const heightPct = (val / maxVal) * 100;
        const dateStr = String(d[labelKey]);
        const shortDate = dateStr.length >= 10
          ? new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" })
          : dateStr;

        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-xs tabular-nums text-muted-foreground">{val}</span>
            <div className="w-full flex items-end justify-center" style={{ height: "80px" }}>
              <div
                className="w-full max-w-8 rounded-t bg-sky-500/80 transition-all duration-500"
                style={{ height: `${Math.max(2, heightPct)}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{shortDate}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Rate Multiplier Setting ────────────────────────────────────────────────

function RateMultiplierSetting() {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(0.5);
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async (mult: number) => {
      const res = await fetch("/api/x/oauth/rate-limits/multiplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ multiplier: mult }),
      });
      if (!res.ok) throw new Error("Failed to update multiplier");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["x-analytics", "rate-limits"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        <Gauge className="inline h-4 w-4 mr-1.5 -mt-0.5" />
        Rate Limit Multiplier
      </h2>
      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Controls what percentage of X API rate limits to use. Lower values are safer but slower.
          </p>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={0.1}
              max={1.0}
              step={0.1}
              value={value}
              onChange={(e) => setValue(parseFloat(e.target.value))}
              className="flex-1 accent-sky-500"
            />
            <span className="text-lg font-bold tabular-nums w-16 text-right">
              {Math.round(value * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => saveMutation.mutate(value)}
              disabled={saveMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Multiplier
            </button>
            {saved && (
              <span className="text-sm text-green-500 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved
              </span>
            )}
          </div>
        </CardContent>
      </Card>
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
  // Anti-bot
  cycleIntervalMin: number;
  cycleIntervalMax: number;
  dailyLikesLimit: number;
  dailyFollowsLimit: number;
  dailyRepliesLimit: number;
  dailyRepostsLimit: number;
  breathingPauseMinActions: number;
  breathingPauseMaxActions: number;
  breathingPauseMinSeconds: number;
  breathingPauseMaxSeconds: number;
}

const DEFAULTS: PostingConfig = {
  maxPostsPerDay: 8,
  minPostGapMinutes: 30,
  maxPostGapMinutes: 120,
  postingWindowStart: 6,
  postingWindowEnd: 24,
  maxQueueSize: 100,
  cycleIntervalMin: 12,
  cycleIntervalMax: 25,
  dailyLikesLimit: 40,
  dailyFollowsLimit: 15,
  dailyRepliesLimit: 20,
  dailyRepostsLimit: 10,
  breathingPauseMinActions: 5,
  breathingPauseMaxActions: 10,
  breathingPauseMinSeconds: 30,
  breathingPauseMaxSeconds: 90,
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
        cycleIntervalMin: (c.cycleIntervalMin as number) || DEFAULTS.cycleIntervalMin,
        cycleIntervalMax: (c.cycleIntervalMax as number) || DEFAULTS.cycleIntervalMax,
        dailyLikesLimit: (c.dailyLikesLimit as number) || DEFAULTS.dailyLikesLimit,
        dailyFollowsLimit: (c.dailyFollowsLimit as number) || DEFAULTS.dailyFollowsLimit,
        dailyRepliesLimit: (c.dailyRepliesLimit as number) || DEFAULTS.dailyRepliesLimit,
        dailyRepostsLimit: (c.dailyRepostsLimit as number) || DEFAULTS.dailyRepostsLimit,
        breathingPauseMinActions: (c.breathingPauseMinActions as number) || DEFAULTS.breathingPauseMinActions,
        breathingPauseMaxActions: (c.breathingPauseMaxActions as number) || DEFAULTS.breathingPauseMaxActions,
        breathingPauseMinSeconds: (c.breathingPauseMinSeconds as number) || DEFAULTS.breathingPauseMinSeconds,
        breathingPauseMaxSeconds: (c.breathingPauseMaxSeconds as number) || DEFAULTS.breathingPauseMaxSeconds,
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

        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
          Anti-Bot Behavior
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <SettingField
            label="Cycle Interval Min (sec)"
            description="Minimum seconds between bot poll cycles"
            value={values.cycleIntervalMin}
            min={5}
            max={60}
            onChange={(v) => update("cycleIntervalMin", v)}
          />
          <SettingField
            label="Cycle Interval Max (sec)"
            description="Maximum seconds between bot poll cycles"
            value={values.cycleIntervalMax}
            min={10}
            max={120}
            onChange={(v) => update("cycleIntervalMax", v)}
          />
          <SettingField
            label="Daily Likes Limit"
            description="Max likes per day per account"
            value={values.dailyLikesLimit}
            min={1}
            max={100}
            onChange={(v) => update("dailyLikesLimit", v)}
          />
          <SettingField
            label="Daily Follows Limit"
            description="Max follows per day (X.com is strict on this)"
            value={values.dailyFollowsLimit}
            min={1}
            max={50}
            onChange={(v) => update("dailyFollowsLimit", v)}
          />
          <SettingField
            label="Daily Replies Limit"
            description="Max replies per day per account"
            value={values.dailyRepliesLimit}
            min={1}
            max={50}
            onChange={(v) => update("dailyRepliesLimit", v)}
          />
          <SettingField
            label="Daily Reposts Limit"
            description="Max reposts per day per account"
            value={values.dailyRepostsLimit}
            min={1}
            max={50}
            onChange={(v) => update("dailyRepostsLimit", v)}
          />
          <SettingField
            label="Breathing Pause After (min)"
            description="Min consecutive actions before a pause"
            value={values.breathingPauseMinActions}
            min={2}
            max={20}
            onChange={(v) => update("breathingPauseMinActions", v)}
          />
          <SettingField
            label="Breathing Pause After (max)"
            description="Max consecutive actions before forced pause"
            value={values.breathingPauseMaxActions}
            min={3}
            max={30}
            onChange={(v) => update("breathingPauseMaxActions", v)}
          />
          <SettingField
            label="Breathing Pause Min (sec)"
            description="Minimum duration of breathing pause"
            value={values.breathingPauseMinSeconds}
            min={10}
            max={300}
            onChange={(v) => update("breathingPauseMinSeconds", v)}
          />
          <SettingField
            label="Breathing Pause Max (sec)"
            description="Maximum duration of breathing pause"
            value={values.breathingPauseMaxSeconds}
            min={15}
            max={600}
            onChange={(v) => update("breathingPauseMaxSeconds", v)}
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
