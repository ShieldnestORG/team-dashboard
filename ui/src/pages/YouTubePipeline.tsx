import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
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
  Youtube,
  Play,
  Clock,
  BarChart3,
  Lightbulb,
  Settings,
  RefreshCw,
  Trash2,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { youtubeApi } from "../api/youtube";

// ── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    ready: "bg-green-500/10 text-green-500",
    published: "bg-blue-500/10 text-blue-500",
    processing: "bg-yellow-500/10 text-yellow-500",
    pending: "bg-zinc-500/10 text-zinc-400",
    scheduled: "bg-purple-500/10 text-purple-500",
    failed: "bg-red-500/10 text-red-500",
  };
  return (
    <Badge className={colors[status] || "bg-zinc-500/10 text-zinc-400"}>
      {status}
    </Badge>
  );
}

// ── Tab Content Components ──────────────────────────────────────────────────

function PipelineTab() {
  const qc = useQueryClient();
  const [topic, setTopic] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["yt-pipeline"],
    queryFn: youtubeApi.getPipeline,
  });

  const runMutation = useMutation({
    mutationFn: () => youtubeApi.runPipeline(topic ? { topic } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["yt-pipeline"] });
      setTopic("");
    },
  });

  const productions = (data as { productions: Array<Record<string, unknown>> } | undefined)?.productions || [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Custom topic (optional)"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="max-w-md"
        />
        <Button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
        >
          {runMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Run Pipeline
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : productions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No productions yet. Run the pipeline to generate your first video.</p>
      ) : (
        <div className="space-y-2">
          {productions.map((prod: Record<string, unknown>) => (
            <Card key={prod.id as string}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium text-sm">
                    {(prod.estimatedDuration as string) || "Video"} — {(prod.visualMode as string) || "presentation"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {relativeTime(prod.createdAt as string)}
                  </p>
                </div>
                {statusBadge(prod.status as string)}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function QueueTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["yt-queue"],
    queryFn: youtubeApi.getQueue,
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => youtubeApi.publishNow(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["yt-queue"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => youtubeApi.deleteQueueItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["yt-queue"] }),
  });

  const queue = (data as { queue: Array<Record<string, unknown>> } | undefined)?.queue || [];

  return isLoading ? (
    <p className="text-sm text-muted-foreground">Loading...</p>
  ) : queue.length === 0 ? (
    <p className="text-sm text-muted-foreground">Publish queue is empty.</p>
  ) : (
    <div className="space-y-2">
      {queue.map((item: Record<string, unknown>) => (
        <Card key={item.id as string}>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium text-sm">{item.title as string}</p>
              <p className="text-xs text-muted-foreground">
                Scheduled: {new Date(item.publishTime as string).toLocaleString()}
              </p>
              {(item.youtubeUrl as string | null) && (
                <a
                  href={String(item.youtubeUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline"
                >
                  {String(item.youtubeUrl)}
                </a>
              )}
            </div>
            <div className="flex items-center gap-2">
              {statusBadge(item.status as string)}
              {item.status === "scheduled" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => publishMutation.mutate(item.id as string)}
                    disabled={publishMutation.isPending}
                  >
                    <Upload className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(item.id as string)}
                  >
                    <Trash2 className="h-3 w-3 text-red-500" />
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AnalyticsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["yt-analytics"],
    queryFn: youtubeApi.getAnalytics,
  });

  const { data: insightsData } = useQuery({
    queryKey: ["yt-insights"],
    queryFn: youtubeApi.getInsights,
  });

  const collectMutation = useMutation({
    mutationFn: youtubeApi.collectAnalytics,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["yt-analytics"] }),
  });

  const analytics = (data as { analytics: Array<Record<string, unknown>> } | undefined)?.analytics || [];
  const insights = insightsData?.insights || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => collectMutation.mutate()}>
          <RefreshCw className="mr-2 h-3 w-3" />
          Collect Analytics
        </Button>
      </div>

      {insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="h-4 w-4" /> Optimization Insights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {insights.map((insight, i) => (
                <li key={i}>{insight}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : analytics.length === 0 ? (
        <p className="text-sm text-muted-foreground">No analytics data yet.</p>
      ) : (
        <div className="space-y-2">
          {analytics.map((a: Record<string, unknown>) => {
            const data = a.analyticsData as { views?: number; likes?: number; comments?: number } | null;
            return (
              <Card key={a.id as string}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium text-sm">{a.videoTitle as string}</p>
                    <p className="text-xs text-muted-foreground">
                      {data?.views || 0} views | {data?.likes || 0} likes | {data?.comments || 0} comments
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{String(a.performanceGrade)}</Badge>
                    <span className="text-xs text-muted-foreground">{String(a.performanceScore)}/100</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConfigTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["yt-config"],
    queryFn: youtubeApi.getConfig,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pipeline Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Pipeline Enabled</span>
            {data.enabled ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Visual Mode</span>
            <Badge variant="outline">{data.visualMode}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">YouTube API</span>
            {data.youtubeConfigured ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">TTS Providers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.ttsProviders.map((p) => (
            <div key={p.name} className="flex justify-between">
              <span className="text-muted-foreground">{p.name}</span>
              {p.configured ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-zinc-400" />
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Visual Backends</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.visualBackends.map((b) => (
            <div key={b.name} className="flex justify-between">
              <span className="text-muted-foreground">
                {b.name} ({b.capabilities.join(", ")})
              </span>
              {b.enabled ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-zinc-400" />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

const TABS = [
  { id: "pipeline", label: "Pipeline", icon: Play },
  { id: "queue", label: "Queue", icon: Clock },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "config", label: "Config", icon: Settings },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function YouTubePipeline() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "YouTube Pipeline" }]);
  }, [setBreadcrumbs]);
  const [tab, setTab] = useState<TabId>("pipeline");

  const { data: stats } = useQuery({
    queryKey: ["yt-stats"],
    queryFn: youtubeApi.getStats,
    refetchInterval: 30_000,
  });

  const prodStats = stats?.productions || {};
  const queueStats = stats?.queue || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Youtube className="h-6 w-6 text-red-500" />
        <h1 className="text-xl font-semibold">YouTube Pipeline</h1>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Productions</p>
            <p className="text-2xl font-bold">{prodStats.total || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Published</p>
            <p className="text-2xl font-bold text-blue-500">{prodStats.published || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Queue</p>
            <p className="text-2xl font-bold text-purple-500">{queueStats.scheduled || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Failed</p>
            <p className="text-2xl font-bold text-red-500">{prodStats.failed || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === "pipeline" && <PipelineTab />}
      {tab === "queue" && <QueueTab />}
      {tab === "analytics" && <AnalyticsTab />}
      {tab === "config" && <ConfigTab />}
    </div>
  );
}
