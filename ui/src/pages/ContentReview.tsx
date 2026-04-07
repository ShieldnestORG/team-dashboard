import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { contentApi } from "../api/content";
import type { ContentQueueItem, ContentPreviewResult } from "../api/content";
import { visualContentApi } from "../api/visual-content";
import type { VisualContentItem } from "../api/visual-content";
import { contentFeedbackApi } from "../api/content-feedback";
import type { FeedbackStats } from "../api/content-feedback";
import { PlatformPreview } from "../components/content-previews";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Newspaper,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Clock,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Sparkles,
  Save,
  RefreshCw,
  Trash2,
  Twitter,
  BookOpen,
  Linkedin,
  MessageCircle as DiscordIcon,
  Cloud,
  Hash,
  Video,
  Image,
  Play,
  Camera,
  MonitorPlay,
} from "lucide-react";
import { HowToGuide } from "../components/HowToGuide";

// ── Query Keys ──────────────────────────────────────────────────────────────

const contentKeys = {
  queue: (params: Record<string, unknown>) =>
    ["content", "queue", params] as const,
  stats: ["content", "stats"] as const,
};

const visualKeys = {
  queue: (params: Record<string, unknown>) =>
    ["visual", "queue", params] as const,
  stats: ["visual", "stats"] as const,
};

// ── Constants ───────────────────────────────────────────────────────────────

const PLATFORM_TABS = [
  { value: "all", label: "All", icon: Newspaper },
  { value: "twitter", label: "Twitter", icon: Twitter },
  { value: "blog", label: "Blog", icon: BookOpen },
  { value: "linkedin", label: "LinkedIn", icon: Linkedin },
  { value: "discord", label: "Discord", icon: DiscordIcon },
  { value: "bluesky", label: "Bluesky", icon: Cloud },
  { value: "reddit", label: "Reddit", icon: Hash },
] as const;

const PERSONALITY_OPTIONS = [
  { value: "blaze", label: "Blaze" },
  { value: "cipher", label: "Cipher" },
  { value: "spark", label: "Spark" },
  { value: "prism", label: "Prism" },
] as const;

const CONTENT_TYPE_OPTIONS = [
  { value: "tweet", label: "Tweet", platform: "twitter" },
  { value: "blog_post", label: "Blog Post", platform: "blog" },
  { value: "linkedin", label: "LinkedIn", platform: "linkedin" },
  { value: "discord", label: "Discord", platform: "discord" },
  { value: "bluesky", label: "Bluesky", platform: "bluesky" },
  { value: "reddit", label: "Reddit", platform: "reddit" },
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function platformColor(platform: string): string {
  switch (platform) {
    case "twitter":
      return "bg-sky-500/15 text-sky-400 border-sky-500/30";
    case "blog":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "linkedin":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "reddit":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "discord":
      return "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
    case "bluesky":
      return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
    default:
      return "bg-muted/15 text-muted-foreground border-border";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "published":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "pending":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "failed":
    case "rejected":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default:
      return "bg-muted/15 text-muted-foreground border-border";
  }
}

function reviewStatusColor(reviewStatus: string | null): string {
  switch (reviewStatus) {
    case "approved":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "flagged":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default:
      return "";
  }
}

function personalityColor(personality: string): string {
  switch (personality) {
    case "blaze":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "cipher":
      return "bg-violet-500/15 text-violet-400 border-violet-500/30";
    case "spark":
      return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "prism":
      return "bg-pink-500/15 text-pink-400 border-pink-500/30";
    default:
      return "bg-muted/15 text-muted-foreground border-border";
  }
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function resolvePlatform(contentType: string): string {
  return CONTENT_TYPE_OPTIONS.find((o) => o.value === contentType)?.platform ?? contentType;
}

// ── Generate Preview Panel ─────────────────────────────────────────────────

function GeneratePreviewPanel() {
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState("");
  const [personalityId, setPersonalityId] = useState("blaze");
  const [contentType, setContentType] = useState("tweet");
  const [previewResult, setPreviewResult] = useState<ContentPreviewResult | null>(null);

  const previewMutation = useMutation({
    mutationFn: () =>
      contentApi.preview({ personalityId, contentType, topic }),
    onSuccess: (data) => setPreviewResult(data),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      contentApi.generate({ personalityId, contentType, topic }),
    onSuccess: () => {
      setPreviewResult(null);
      setTopic("");
      queryClient.invalidateQueries({ queryKey: ["content"] });
    },
  });

  const platform = resolvePlatform(contentType);
  const canGenerate = topic.trim().length > 0 && !previewMutation.isPending;

  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-4 pt-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold">Generate Preview</h3>
        </div>

        {/* Input row */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Topic
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enter a topic for content generation..."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canGenerate) previewMutation.mutate();
              }}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Personality
            </label>
            <select
              value={personalityId}
              onChange={(e) => setPersonalityId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {PERSONALITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Platform
            </label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {CONTENT_TYPE_OPTIONS.map((ct) => (
                <option key={ct.value} value={ct.value}>
                  {ct.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Generate button */}
        <div>
          <button
            onClick={() => previewMutation.mutate()}
            disabled={!canGenerate}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {previewMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {previewMutation.isPending ? "Generating..." : "Generate Preview"}
          </button>
        </div>

        {/* Error */}
        {previewMutation.isError && (
          <div className="flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
            <p className="text-xs text-red-300">
              {previewMutation.error instanceof Error
                ? previewMutation.error.message
                : "Generation failed"}
            </p>
          </div>
        )}

        {/* Preview result */}
        {previewResult && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Preview Result
              </span>
              {previewResult.metadata.withinLimit ? (
                <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                  Within limit
                </Badge>
              ) : (
                <Badge className="text-[10px] bg-red-500/15 text-red-400 border-red-500/30">
                  Over limit ({previewResult.metadata.charCount}/{previewResult.metadata.charLimit})
                </Badge>
              )}
            </div>

            {/* Platform-specific preview */}
            <div className="max-w-xl">
              <PlatformPreview
                platform={platform}
                content={previewResult.content}
                personality={personalityId}
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save to Queue
              </button>
              <button
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted border border-border"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate
              </button>
              <button
                onClick={() => setPreviewResult(null)}
                className="inline-flex items-center gap-1.5 rounded-md bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted border border-border"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Discard
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Content Card ────────────────────────────────────────────────────────────

function FeedbackButtons({ itemId, contentType }: { itemId: string; contentType: "text" | "visual" }) {
  const queryClient = useQueryClient();
  const [showFeedbackComment, setShowFeedbackComment] = useState(false);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [lastRating, setLastRating] = useState<"like" | "dislike" | null>(null);

  const feedbackMutation = useMutation({
    mutationFn: ({ rating, comment }: { rating: "like" | "dislike"; comment?: string }) =>
      contentFeedbackApi.submit(itemId, rating, comment, contentType),
    onSuccess: (_data, vars) => {
      setLastRating(vars.rating);
      setShowFeedbackComment(false);
      setFeedbackComment("");
      queryClient.invalidateQueries({ queryKey: ["content", "feedback"] });
    },
  });

  return (
    <div className="flex items-center gap-2 border-t border-border/50 pt-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mr-1">Training</span>
      <button
        onClick={() => {
          if (showFeedbackComment) {
            feedbackMutation.mutate({ rating: "like", comment: feedbackComment || undefined });
          } else {
            feedbackMutation.mutate({ rating: "like" });
          }
        }}
        disabled={feedbackMutation.isPending}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors border ${lastRating === "like" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : "bg-muted/30 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-400 border-border/50"}`}
      >
        <ThumbsUp className="h-3 w-3" /> Like
      </button>
      <button
        onClick={() => {
          if (showFeedbackComment) {
            feedbackMutation.mutate({ rating: "dislike", comment: feedbackComment || undefined });
          } else {
            feedbackMutation.mutate({ rating: "dislike" });
          }
        }}
        disabled={feedbackMutation.isPending}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors border ${lastRating === "dislike" ? "bg-red-500/20 text-red-400 border-red-500/40" : "bg-muted/30 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 border-border/50"}`}
      >
        <ThumbsDown className="h-3 w-3" /> Dislike
      </button>
      <button
        onClick={() => setShowFeedbackComment(!showFeedbackComment)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium bg-muted/30 text-muted-foreground hover:bg-muted border border-border/50 transition-colors"
      >
        <MessageSquare className="h-3 w-3" />
      </button>
      {showFeedbackComment && (
        <input
          type="text"
          value={feedbackComment}
          onChange={(e) => setFeedbackComment(e.target.value)}
          placeholder="Why? (helps train future content)"
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          onKeyDown={(e) => {
            if (e.key === "Enter" && feedbackComment.trim()) {
              feedbackMutation.mutate({ rating: "like", comment: feedbackComment.trim() });
            }
          }}
        />
      )}
    </div>
  );
}

function ContentCard({
  item,
  onReview,
  isReviewing,
}: {
  item: ContentQueueItem;
  onReview: (id: string, status: string, comment?: string) => void;
  isReviewing: boolean;
}) {
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-3 pt-0">
        {/* Badges row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-xs ${platformColor(item.platform)}`}>
            {item.platform}
          </Badge>
          <Badge className={`text-xs ${personalityColor(item.personality)}`}>
            {item.personality}
          </Badge>
          <Badge className={`text-xs ${statusColor(item.status)}`}>
            {item.status}
          </Badge>
          {item.reviewStatus && (
            <Badge
              className={`text-xs ${reviewStatusColor(item.reviewStatus)}`}
            >
              {item.reviewStatus}
            </Badge>
          )}
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(item.createdAt)}
          </span>
        </div>

        {/* Platform-specific preview */}
        <div
          className={`max-w-xl ${!expanded ? "max-h-64 overflow-hidden relative" : ""}`}
        >
          <PlatformPreview
            platform={item.platform}
            content={item.content}
            personality={item.personality}
          />
          {!expanded && item.content.length > 200 && (
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />
          )}
        </div>
        {item.content.length > 200 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? "Show less" : "Expand preview"}
          </button>
        )}

        {/* Review comment if present */}
        {item.reviewComment && (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Review note:</span>{" "}
              {item.reviewComment}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onReview(item.id, "approved")}
            disabled={isReviewing || item.reviewStatus === "approved"}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isReviewing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ThumbsUp className="h-3.5 w-3.5" />
            )}
            Approve
          </button>
          <button
            onClick={() => {
              if (showComment && comment.trim()) {
                onReview(item.id, "flagged", comment.trim());
                setShowComment(false);
                setComment("");
              } else {
                onReview(item.id, "flagged");
              }
            }}
            disabled={isReviewing || item.reviewStatus === "flagged"}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isReviewing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ThumbsDown className="h-3.5 w-3.5" />
            )}
            Flag
          </button>
          <button
            onClick={() => setShowComment(!showComment)}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-muted/50 text-muted-foreground hover:bg-muted border border-border transition-colors"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Comment
          </button>
        </div>

        {/* Comment input */}
        {showComment && (
          <div className="flex gap-2">
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a review comment..."
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter" && comment.trim()) {
                  onReview(item.id, "flagged", comment.trim());
                  setShowComment(false);
                  setComment("");
                }
              }}
            />
          </div>
        )}

        {/* Training feedback */}
        <FeedbackButtons itemId={item.id} contentType="text" />
      </CardContent>
    </Card>
  );
}

// ── Visual Content Helpers ────────────────────────────────────────────────

const VISUAL_PLATFORM_TABS = [
  { value: "all", label: "All", icon: Video },
  { value: "youtube_shorts", label: "YouTube Shorts", icon: Play },
  { value: "tiktok", label: "TikTok", icon: MonitorPlay },
  { value: "instagram_reels", label: "Reels", icon: Camera },
  { value: "twitter_video", label: "X Video", icon: Twitter },
] as const;

function visualPlatformColor(platform: string): string {
  switch (platform) {
    case "youtube_shorts": return "bg-red-500/15 text-red-400 border-red-500/30";
    case "tiktok": return "bg-pink-500/15 text-pink-400 border-pink-500/30";
    case "instagram_reels": return "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30";
    case "twitter_video": return "bg-sky-500/15 text-sky-400 border-sky-500/30";
    default: return "bg-muted/15 text-muted-foreground border-border";
  }
}

function visualPlatformLabel(platform: string): string {
  switch (platform) {
    case "youtube_shorts": return "YouTube Shorts";
    case "tiktok": return "TikTok";
    case "instagram_reels": return "Instagram Reels";
    case "twitter_video": return "X Video";
    default: return platform;
  }
}

function agentColor(agentId: string): string {
  switch (agentId) {
    case "lens": return "bg-teal-500/15 text-teal-400 border-teal-500/30";
    case "frame": return "bg-purple-500/15 text-purple-400 border-purple-500/30";
    default: return "bg-muted/15 text-muted-foreground border-border";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Visual Content Card ──────────────────────────────────────────────────

function VisualContentCard({ item, onReview, isReviewing }: { item: VisualContentItem; onReview: (id: string, status: string, comment?: string) => void; isReviewing: boolean }) {
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const asset = item.assets[0];
  const isVideo = asset?.type === "video" || asset?.type === "animation";
  const assetUrl = asset ? visualContentApi.assetUrl(asset.objectKey) : null;

  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-3 pt-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-xs ${visualPlatformColor(item.platform)}`}>{visualPlatformLabel(item.platform)}</Badge>
          <Badge className={`text-xs ${agentColor(item.agentId)}`}>{item.agentId}</Badge>
          <Badge className={`text-xs ${statusColor(item.status)}`}>{item.status}</Badge>
          {item.reviewStatus && item.reviewStatus !== "pending" && <Badge className={`text-xs ${reviewStatusColor(item.reviewStatus)}`}>{item.reviewStatus}</Badge>}
          <Badge className="text-xs bg-muted/15 text-muted-foreground border-border">{item.backend}</Badge>
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{formatRelativeTime(item.createdAt)}</span>
        </div>
        {item.status === "generating" && <div className="flex items-center justify-center h-48 rounded-lg border border-border bg-muted/20"><div className="flex flex-col items-center gap-2"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /><span className="text-xs text-muted-foreground">Generating...</span></div></div>}
        {item.status === "failed" && <div className="flex items-center justify-center h-32 rounded-lg border border-red-500/20 bg-red-500/5"><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-400" /><span className="text-xs text-red-300">Generation failed</span></div></div>}
        {assetUrl && <div className="rounded-lg border border-border overflow-hidden bg-black/20">{isVideo ? <video src={assetUrl} controls className="w-full max-h-80 object-contain" preload="metadata" /> : <img src={assetUrl} alt={item.prompt} className="w-full max-h-80 object-contain" loading="lazy" />}</div>}
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2"><p className="text-xs text-muted-foreground mb-1 font-medium">Prompt</p><p className="text-xs text-foreground leading-relaxed line-clamp-3">{item.prompt}</p></div>
        {asset && <div className="flex items-center gap-3 text-xs text-muted-foreground">{asset.type === "image" ? <Image className="h-3 w-3" /> : <Video className="h-3 w-3" />}<span>{asset.width}x{asset.height}</span>{asset.durationMs && <span>{(asset.durationMs / 1000).toFixed(1)}s</span>}<span>{formatBytes(asset.byteSize)}</span><span className="uppercase">{asset.contentType.split("/")[1]}</span></div>}
        {item.status === "ready" && <div className="flex items-center gap-2">
          <button onClick={() => onReview(item.id, "approved")} disabled={isReviewing || item.reviewStatus === "approved"} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">{isReviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="h-3.5 w-3.5" />} Approve</button>
          <button onClick={() => { if (showComment && comment.trim()) { onReview(item.id, "flagged", comment.trim()); setShowComment(false); setComment(""); } else { onReview(item.id, "flagged"); } }} disabled={isReviewing || item.reviewStatus === "flagged"} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">{isReviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsDown className="h-3.5 w-3.5" />} Flag</button>
          <button onClick={() => setShowComment(!showComment)} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-muted/50 text-muted-foreground hover:bg-muted border border-border transition-colors"><MessageSquare className="h-3.5 w-3.5" /> Comment</button>
        </div>}
        {showComment && <div className="flex gap-2"><input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a review comment..." className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" onKeyDown={(e) => { if (e.key === "Enter" && comment.trim()) { onReview(item.id, "flagged", comment.trim()); setShowComment(false); setComment(""); } }} /></div>}
        <FeedbackButtons itemId={item.id} contentType="visual" />
      </CardContent>
    </Card>
  );
}

// ── Visual Content Section ───────────────────────────────────────────────

function VisualContentSection() {
  const queryClient = useQueryClient();
  const [platformTab, setPlatformTab] = useState("all");
  const queryParams = { ...(platformTab !== "all" ? { platform: platformTab } : {}), limit: 50 };
  const { data: queueData, isLoading } = useQuery({ queryKey: visualKeys.queue(queryParams), queryFn: () => visualContentApi.listQueue(queryParams), refetchInterval: 15_000 });
  const { data: stats } = useQuery({ queryKey: visualKeys.stats, queryFn: () => visualContentApi.stats(), refetchInterval: 30_000 });
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const reviewMutation = useMutation({
    mutationFn: ({ id, reviewStatus, reviewComment }: { id: string; reviewStatus: string; reviewComment?: string }) => visualContentApi.reviewItem(id, reviewStatus, reviewComment),
    onMutate: ({ id }) => setReviewingId(id),
    onSettled: () => { setReviewingId(null); queryClient.invalidateQueries({ queryKey: ["visual"] }); },
  });
  const items = queueData?.items ?? [];
  const totalItems = stats?.total ?? 0;
  const generatingCount = stats?.byStatus?.generating ?? 0;
  const readyCount = stats?.byStatus?.ready ?? 0;
  const publishedCount = stats?.byStatus?.published ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-xl"><CardContent className="pt-0"><div className="flex items-center gap-2 mb-1"><Video className="h-3.5 w-3.5 text-muted-foreground" /><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total</p></div><p className="text-2xl font-bold tabular-nums">{totalItems}</p></CardContent></Card>
        <Card className="rounded-xl"><CardContent className="pt-0"><div className="flex items-center gap-2 mb-1"><Loader2 className="h-3.5 w-3.5 text-blue-400" /><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Generating</p></div><p className="text-2xl font-bold tabular-nums text-blue-400">{generatingCount}</p></CardContent></Card>
        <Card className="rounded-xl"><CardContent className="pt-0"><div className="flex items-center gap-2 mb-1"><Clock className="h-3.5 w-3.5 text-amber-400" /><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ready</p></div><p className="text-2xl font-bold tabular-nums text-amber-400">{readyCount}</p></CardContent></Card>
        <Card className="rounded-xl"><CardContent className="pt-0"><div className="flex items-center gap-2 mb-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Published</p></div><p className="text-2xl font-bold tabular-nums text-emerald-400">{publishedCount}</p></CardContent></Card>
      </div>
      <Tabs value={platformTab} onValueChange={setPlatformTab}>
        <TabsList variant="line" className="rounded-lg">
          {VISUAL_PLATFORM_TABS.map((tab) => { const Icon = tab.icon; const count = tab.value === "all" ? totalItems : (stats?.byPlatform?.[tab.value] ?? 0); return (<TabsTrigger key={tab.value} value={tab.value}><Icon className="h-3.5 w-3.5" />{tab.label}{count > 0 && <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums leading-none">{count}</span>}</TabsTrigger>); })}
        </TabsList>
        {VISUAL_PLATFORM_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {isLoading ? <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-64 animate-pulse rounded-xl border border-border bg-muted/30" />)}</div>
            : items.length > 0 ? <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">{items.map((item: VisualContentItem) => <VisualContentCard key={item.id} item={item} onReview={(id, status, comment) => reviewMutation.mutate({ id, reviewStatus: status, reviewComment: comment })} isReviewing={reviewingId === item.id} />)}</div>
            : <Card className="rounded-xl border-dashed"><CardContent className="flex items-center gap-3 pt-0"><Video className="h-5 w-5 text-muted-foreground shrink-0" /><p className="text-sm text-muted-foreground">No visual content{tab.value !== "all" ? ` for ${tab.label}` : ""} in the queue.</p></CardContent></Card>}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// ── Page Component ──────────────────────────────────────────────────────────

export function ContentReview() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Content Studio" }]);
  }, [setBreadcrumbs]);

  const [contentMode, setContentMode] = useState<"text" | "visual">("text");
  const [platformTab, setPlatformTab] = useState("all");

  const queryParams = {
    ...(platformTab !== "all" ? { platform: platformTab } : {}),
    limit: 50,
  };

  const {
    data: queueData,
    isLoading,
    error,
  } = useQuery({
    queryKey: contentKeys.queue(queryParams),
    queryFn: () => contentApi.listQueue(queryParams),
    refetchInterval: 30_000,
  });

  const { data: stats } = useQuery({
    queryKey: contentKeys.stats,
    queryFn: () => contentApi.stats(),
    refetchInterval: 60_000,
  });

  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      reviewStatus,
      reviewComment,
    }: {
      id: string;
      reviewStatus: string;
      reviewComment?: string;
    }) => contentApi.reviewItem(id, reviewStatus, reviewComment),
    onMutate: ({ id }) => setReviewingId(id),
    onSettled: () => {
      setReviewingId(null);
      queryClient.invalidateQueries({ queryKey: ["content"] });
    },
  });

  function handleReview(id: string, status: string, comment?: string) {
    reviewMutation.mutate({ id, reviewStatus: status, reviewComment: comment });
  }

  // Derive stat counts
  const totalItems = stats?.total ?? 0;
  const publishedCount = stats?.byStatus?.published ?? 0;
  const pendingCount = stats?.byReviewStatus?.pending ?? stats?.byStatus?.pending ?? 0;
  const flaggedCount = stats?.byReviewStatus?.flagged ?? 0;

  // ── Loading state ───────────────────────────────────────────────────────

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

  // ── Error state ─────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-200">
              Failed to load content queue
            </p>
            <p className="text-xs text-red-300/70">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const items = queueData?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
          <Newspaper className="h-5 w-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Content Studio</h1>
          <p className="text-sm text-muted-foreground">
            Generate, preview, and review content before publishing.
          </p>
        </div>
      </div>

      {/* ── How-To Guide ──────────────────────────────────────────────── */}
      <HowToGuide
        sections={[
          {
            heading: "Generating Content",
            steps: [
              { title: "Pick a platform", description: "Use the tabs (Twitter, Blog, LinkedIn, etc.) to filter by where you want to post." },
              { title: "AI generates drafts", description: "Our 4 AI personalities (Blaze, Cipher, Spark, Prism) auto-generate content on a schedule. New items appear here." },
              { title: "Review and approve", description: "Read through the draft. If it looks good, approve it. If not, flag it with a note so the AI learns." },
            ],
          },
          {
            heading: "Visual Content (Images & Videos)",
            steps: [
              { title: "Switch to Visual mode", description: "Toggle between Text and Visual tabs to see AI-generated images and video reels." },
              { title: "Review visuals", description: "Check the generated image or video. Approve to publish or flag to reject." },
              { title: "Published content goes live", description: "Approved visuals are available via the public reels API for coherencedaddy.com." },
            ],
          },
          {
            heading: "Posting Canva Designs to Twitter",
            steps: [
              { title: "Export from Canva", description: "Download your design as PNG, JPG, or MP4 from Canva." },
              { title: "Upload to Media Drops", description: "Use the Media Drops API to upload your files with a caption and hashtags." },
              { title: "Agent picks it up", description: "The AI agent sees your drop and queues it as a tweet with your images attached." },
              { title: "X-bot extension posts it", description: "The Chrome extension bot grabs the queued post and publishes it to X/Twitter." },
            ],
          },
          {
            heading: "Training the AI",
            steps: [
              { title: "Like or dislike content", description: "Use the thumbs up/down buttons on any piece of content." },
              { title: "Add a reason", description: "Tell the AI why you liked or disliked it. This feedback trains future generations." },
            ],
          },
        ]}
      />

      {/* ── Stats Cards ────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-xl">
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Total
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums">{totalItems}</p>
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Published
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-emerald-400">
              {publishedCount}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Pending
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-amber-400">
              {pendingCount}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="h-3.5 w-3.5 text-red-400" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Flagged
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-red-400">
              {flaggedCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Content Mode Toggle ─────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-lg bg-muted/30 p-1 w-fit border border-border">
        <button onClick={() => setContentMode("text")} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${contentMode === "text" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          <FileText className="h-3.5 w-3.5" /> Text Content
        </button>
        <button onClick={() => setContentMode("visual")} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${contentMode === "visual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          <Video className="h-3.5 w-3.5" /> Visual Content
        </button>
      </div>

      {contentMode === "visual" ? <VisualContentSection /> : <>
      {/* ── Generate Preview Panel ─────────────────────────────────────── */}
      <GeneratePreviewPanel />

        {/* ── Platform Tabs + Content Queue ──────────────────────────────── */}
        <Tabs value={platformTab} onValueChange={setPlatformTab}>
        <TabsList variant="line" className="rounded-lg">
          {PLATFORM_TABS.map((tab) => {
            const Icon = tab.icon;
            const count =
              tab.value === "all"
                ? totalItems
                : (stats?.byPlatform?.[tab.value] ?? 0);
            return (
              <TabsTrigger key={tab.value} value={tab.value}>
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                {count > 0 && (
                  <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums leading-none">
                    {count}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* All tab contents share the same filtered queue */}
        {PLATFORM_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {items.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
                {items.map((item: ContentQueueItem) => (
                  <ContentCard
                    key={item.id}
                    item={item}
                    onReview={handleReview}
                    isReviewing={reviewingId === item.id}
                  />
                ))}
              </div>
            ) : (
              <Card className="rounded-xl border-dashed">
                <CardContent className="flex items-center gap-3 pt-0">
                  <Newspaper className="h-5 w-5 text-muted-foreground shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    No content items
                    {tab.value !== "all" ? ` for ${tab.label}` : ""} in the
                    queue.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>
      </>}
    </div>
  );
}
