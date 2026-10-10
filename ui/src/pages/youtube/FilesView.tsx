import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileVideo,
  Film,
  HardDrive,
  Lightbulb,
  Loader2,
  Play,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { youtubeApi } from "../../api/youtube";

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const MODE_LABELS: Record<string, string> = {
  "site-walker": "Site Walker",
  presentation: "Presentation",
  images: "AI Images",
  unknown: "Unknown",
};

// ── Make a video now (the old "Run Pipeline" control) ───────────────────────

function MakeVideoNow() {
  const qc = useQueryClient();
  const [topic, setTopic] = useState("");

  const runMutation = useMutation({
    mutationFn: () => youtubeApi.runPipeline(topic ? { topic } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["yt-pipeline"] });
      setTopic("");
    },
  });

  return (
    <div className="flex gap-2">
      <Input
        placeholder="Custom topic (optional)"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        className="max-w-md"
      />
      <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
        {runMutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Play className="mr-2 h-4 w-4" />
        )}
        Run Pipeline
      </Button>
    </div>
  );
}

// ── Recent runs (the productions list) ─────────────────────────────────────

function RecentRuns() {
  const { data, isLoading } = useQuery({
    queryKey: ["yt-pipeline"],
    queryFn: youtubeApi.getPipeline,
  });

  const productions = (data as { productions: Array<Record<string, unknown>> } | undefined)?.productions || [];

  return isLoading ? (
    <p className="text-sm text-muted-foreground">Loading...</p>
  ) : productions.length === 0 ? (
    <p className="text-sm text-muted-foreground">
      No productions yet. Run the pipeline to generate your first video.
    </p>
  ) : (
    <div className="space-y-2">
      {productions.map((prod: Record<string, unknown>) => (
        <Card key={prod.id as string}>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium text-sm">
                {(prod.estimatedDuration as string) || "Video"} —{" "}
                {(prod.visualMode as string) || "presentation"}
              </p>
              <p className="text-xs text-muted-foreground">
                {relativeTime(prod.createdAt as string)}
              </p>
            </div>
            <StatusBadge status={String(prod.status)} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Numbers (the old "Analytics" tab) ───────────────────────────────────────

function Numbers() {
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
            const data = a.analyticsData as {
              views?: number;
              likes?: number;
              comments?: number;
            } | null;
            return (
              <Card key={a.id as string}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium text-sm">{a.videoTitle as string}</p>
                    <p className="text-xs text-muted-foreground">
                      {data?.views || 0} views | {data?.likes || 0} likes |{" "}
                      {data?.comments || 0} comments
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{String(a.performanceGrade)}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {String(a.performanceScore)}/100
                    </span>
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

// ── Settings (the old "Config" tab) ─────────────────────────────────────────

function Settings() {
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
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Visual Mode</span>
            <Badge variant="outline">{data.visualMode}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">YouTube API</span>
            {data.youtubeConfigured ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
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
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
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
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Video files (the old YouTubeVideos list) ───────────────────────────────

function FileList() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["youtube-videos"],
    queryFn: () => youtubeApi.getVideos(),
    refetchInterval: 30_000,
  });

  const videos = useMemo(() => {
    const all = data?.videos ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        v.filename.toLowerCase().includes(q) ||
        v.visualMode.toLowerCase().includes(q),
    );
  }, [data?.videos, search]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      {/* Summary line */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-muted">
          <Film className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-2xl font-bold">{data?.count ?? 0}</p>
          <p className="text-xs text-muted-foreground">Total Videos</p>
        </div>
        <div className="p-2 rounded-lg bg-muted">
          <HardDrive className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-2xl font-bold">{formatBytes(data?.totalSize ?? 0)}</p>
          <p className="text-xs text-muted-foreground">Disk Usage</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search videos by title, filename, or mode..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Video list */}
      {videos.length === 0 ? (
        <EmptyState
          icon={FileVideo}
          message={
            search
              ? "No videos match your search"
              : "No videos yet — run the YouTube pipeline to generate videos"
          }
        />
      ) : (
        <div className="space-y-3">
          {videos.map((video) => (
            <Card key={video.filename} className="hover:border-primary/30 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  {/* Left: Icon + Info */}
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="p-2.5 rounded-lg bg-primary/5 shrink-0">
                      <FileVideo className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{video.title}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="font-mono break-all">{video.filename}</span>
                        <span>{formatBytes(video.fileSizeBytes)}</span>
                        {video.createdAt && <span>{formatDate(video.createdAt)}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Center: Badges */}
                  <div className="hidden md:flex items-center gap-2 shrink-0">
                    <StatusBadge status={video.status} />
                    <Badge variant="outline">
                      {MODE_LABELS[video.visualMode] || video.visualMode}
                    </Badge>
                    {video.publishStatus && (
                      <StatusBadge
                        status={video.publishStatus}
                        label={video.publishStatus === "published" ? "on YouTube" : undefined}
                      />
                    )}
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {video.youtubeUrl && (
                      <a href={video.youtubeUrl} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon" title="View on YouTube">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </a>
                    )}
                    <a href={youtubeApi.getVideoDownloadUrl(video.filename)} download>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Download className="h-4 w-4" />
                        <span className="hidden sm:inline">Download</span>
                      </Button>
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Files & settings view ───────────────────────────────────────────────────

export function FilesView() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-semibold">Video files</h2>
        <div className="mt-3">
          <FileList />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Make a video now</h2>
        <div className="mt-3">
          <MakeVideoNow />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Recent runs</h2>
        <div className="mt-3">
          <RecentRuns />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Numbers</h2>
        <div className="mt-3">
          <Numbers />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Settings</h2>
        <div className="mt-3">
          <Settings />
        </div>
      </section>
    </div>
  );
}
