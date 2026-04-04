import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { contentApi } from "../api/content";
import type { ContentQueueItem } from "../api/content";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Newspaper,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Clock,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";

// ── Query Keys ──────────────────────────────────────────────────────────────

const contentKeys = {
  queue: (params: Record<string, unknown>) =>
    ["content", "queue", params] as const,
  stats: ["content", "stats"] as const,
};

// ── Constants ───────────────────────────────────────────────────────────────

const PLATFORMS = [
  "all",
  "twitter",
  "blog",
  "linkedin",
  "reddit",
  "discord",
  "bluesky",
] as const;

const STATUSES = [
  "all",
  "published",
  "pending",
  "failed",
  "rejected",
] as const;

const PERSONALITIES = ["all", "blaze", "cipher", "spark", "prism"] as const;

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
      return "bg-red-500/15 text-red-400 border-red-500/30";
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

// ── Filter Select ───────────────────────────────────────────────────────────

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt === "all" ? "All" : opt.charAt(0).toUpperCase() + opt.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Content Card ────────────────────────────────────────────────────────────

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

  const preview =
    item.content.length > 200
      ? item.content.slice(0, 200) + "..."
      : item.content;

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

        {/* Content preview */}
        <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
          {preview}
        </p>

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
      </CardContent>
    </Card>
  );
}

// ── Page Component ──────────────────────────────────────────────────────────

export function ContentReview() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Content Review" }]);
  }, [setBreadcrumbs]);

  const [platformFilter, setPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [personalityFilter, setPersonalityFilter] = useState("all");

  const queryParams = {
    ...(platformFilter !== "all" ? { platform: platformFilter } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(personalityFilter !== "all" ? { personality: personalityFilter } : {}),
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
  const pendingCount = stats?.byStatus?.pending ?? 0;
  const flaggedCount =
    (stats?.byStatus as Record<string, number> | undefined)?.flagged ?? 0;

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
          <h1 className="text-2xl font-bold tracking-tight">Content Review</h1>
          <p className="text-sm text-muted-foreground">
            Review, approve, or flag AI-generated content before publishing.
          </p>
        </div>
      </div>

      {/* ── Stats Cards ────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-xl">
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Total Items
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
                Pending Review
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

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 flex-wrap">
        <FilterSelect
          label="Platform"
          value={platformFilter}
          options={PLATFORMS}
          onChange={setPlatformFilter}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          options={STATUSES}
          onChange={setStatusFilter}
        />
        <FilterSelect
          label="Personality"
          value={personalityFilter}
          options={PERSONALITIES}
          onChange={setPersonalityFilter}
        />
        {(platformFilter !== "all" ||
          statusFilter !== "all" ||
          personalityFilter !== "all") && (
          <button
            onClick={() => {
              setPlatformFilter("all");
              setStatusFilter("all");
              setPersonalityFilter("all");
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Content Grid ───────────────────────────────────────────────── */}
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
              No content items match the current filters.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
