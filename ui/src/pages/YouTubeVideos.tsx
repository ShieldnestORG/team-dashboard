import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { youtubeApi } from "../api/youtube";
import {
  Download,
  FileVideo,
  HardDrive,
  ExternalLink,
  Search,
  Film,
  Upload,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const STATUS_COLORS: Record<string, string> = {
  published: "bg-green-500/20 text-green-400 border-green-500/30",
  ready: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  scheduled: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  processing: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  unknown: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

const MODE_LABELS: Record<string, string> = {
  "site-walker": "Site Walker",
  presentation: "Presentation",
  images: "AI Images",
  unknown: "Unknown",
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function YouTubeVideos() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [search, setSearch] = useState("");

  useEffect(() => {
    setBreadcrumbs([
      { label: "YouTube", href: "/youtube" },
      { label: "Videos" },
    ]);
  }, [setBreadcrumbs]);

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

  const totalSize = data?.totalSize ?? 0;
  const publishedCount = videos.filter((v) => v.publishStatus === "published").length;
  const queuedCount = videos.filter((v) => v.publishStatus === "scheduled").length;

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Video Files</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Assembled videos on VPS — download or manage
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Film className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data?.count ?? 0}</p>
                <p className="text-xs text-muted-foreground">Total Videos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <HardDrive className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatBytes(totalSize)}</p>
                <p className="text-xs text-muted-foreground">Disk Usage</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{publishedCount}</p>
                <p className="text-xs text-muted-foreground">Published</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <Clock className="h-5 w-5 text-yellow-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{queuedCount}</p>
                <p className="text-xs text-muted-foreground">Queued</p>
              </div>
            </div>
          </CardContent>
        </Card>
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

      {/* Video List */}
      {videos.length === 0 ? (
        <EmptyState
          icon={FileVideo}
          message={search ? "No videos match your search" : "No videos yet — run the YouTube pipeline to generate videos"}
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
                        <span className="font-mono">{video.filename}</span>
                        <span>{formatBytes(video.fileSizeBytes)}</span>
                        {video.createdAt && <span>{formatDate(video.createdAt)}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Center: Badges */}
                  <div className="hidden md:flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={STATUS_COLORS[video.status] || STATUS_COLORS.unknown}>
                      {video.status}
                    </Badge>
                    <Badge variant="outline" className="bg-zinc-500/10 text-zinc-400 border-zinc-500/30">
                      {MODE_LABELS[video.visualMode] || video.visualMode}
                    </Badge>
                    {video.publishStatus && (
                      <Badge variant="outline" className={STATUS_COLORS[video.publishStatus] || ""}>
                        {video.publishStatus === "published" ? "on YouTube" : video.publishStatus}
                      </Badge>
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
