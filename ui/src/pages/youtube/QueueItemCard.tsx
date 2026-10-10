import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Calendar,
  CheckCircle2,
  Loader2,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { youtubeApi } from "../../api/youtube";

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    ready: "bg-green-500/10 text-green-500",
    published: "bg-blue-500/10 text-blue-500",
    processing: "bg-yellow-500/10 text-yellow-500",
    pending: "bg-zinc-500/10 text-zinc-400",
    scheduled: "bg-purple-500/10 text-purple-500",
    pending_review: "bg-amber-500/10 text-amber-500",
    failed: "bg-red-500/10 text-red-500",
  };
  return (
    <Badge className={colors[status] || "bg-zinc-500/10 text-zinc-400"}>
      {status}
    </Badge>
  );
}

// ── Queue card ─────────────────────────────────────────────────────────────
// Moved byte-for-byte from YouTubePipeline.tsx (DEV-118 slice 1a). It keeps its
// own local status colour map — the design-system collapse to five status
// colours is a later work item (W3) and not part of this slice.

export function QueueItemCard({ item, onRefresh }: { item: Record<string, unknown>; onRefresh: () => void }) {
  const [editingDate, setEditingDate] = useState(false);
  const [newDate, setNewDate] = useState("");

  const publishMutation = useMutation({
    mutationFn: () => youtubeApi.publishNow(item.id as string),
    onSuccess: onRefresh,
  });

  const rescheduleMutation = useMutation({
    mutationFn: (publishTime: string) =>
      youtubeApi.rescheduleQueueItem(item.id as string, publishTime),
    onSuccess: () => {
      setEditingDate(false);
      onRefresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => youtubeApi.deleteQueueItem(item.id as string),
    onSuccess: onRefresh,
  });

  const status = item.status as string;
  // "pending_review" = a new video waiting for the owner's approval. Reschedule (or
  // Publish Now) approves it: the server sets it to "scheduled".
  const isReview = status === "pending_review";
  const isScheduled = status === "scheduled" || isReview;
  const isPublished = status === "published";
  const meta = (item.metadata ?? null) as { videoPath?: string; description?: string } | null;
  const videoFile = meta?.videoPath ? meta.videoPath.split("/").pop() : undefined;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{item.title as string}</p>
            {isPublished && (item.youtubeUrl as string | null) ? (
              <a
                href={String(item.youtubeUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline break-words"
              >
                {String(item.youtubeUrl)}
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">
                {isReview ? "Awaiting approval — proposed: " : "Scheduled: "}
                {new Date(item.publishTime as string).toLocaleString()}
              </p>
            )}
          </div>
          {statusBadge(status)}
        </div>

        {/* Watch it where you approve it (stopgap until the review view of docs/ux/youtube-area-spec.md) */}
        {videoFile && !isPublished && (
          <video
            controls
            preload="metadata"
            className="w-full max-w-3xl aspect-video rounded-md border border-border bg-muted"
            src={youtubeApi.getVideoStreamUrl(videoFile)}
          />
        )}
        {meta?.description && !isPublished && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none text-foreground/80">Description that will post</summary>
            <p className="mt-2 whitespace-pre-wrap break-words">{meta.description}</p>
          </details>
        )}

        {/* Actions for scheduled items */}
        {isScheduled && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => {
                // Posts publicly at once; it had no confirm until 2026-10-09, when one click published a video by surprise.
                if (confirm("Post this video publicly on YouTube right now?")) publishMutation.mutate();
              }}
              disabled={publishMutation.isPending}
            >
              {publishMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-3 w-3" />
              )}
              Publish Now
            </Button>

            {editingDate ? (
              <div className="flex items-center gap-1.5">
                <Input
                  type="datetime-local"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="h-8 w-auto text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (newDate) rescheduleMutation.mutate(new Date(newDate).toISOString());
                  }}
                  disabled={!newDate || rescheduleMutation.isPending}
                >
                  {rescheduleMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingDate(false)}>
                  <XCircle className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const current = new Date(item.publishTime as string);
                  // datetime-local is read back as LOCAL time, so pre-fill it in local
                  // time too (the UTC string shifted an unchanged approval by the offset).
                  const local = new Date(current.getTime() - current.getTimezoneOffset() * 60_000);
                  setNewDate(local.toISOString().slice(0, 16));
                  setEditingDate(true);
                }}
              >
                <Calendar className="mr-1.5 h-3 w-3" />
                {isReview ? "Approve & schedule" : "Reschedule"}
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm("Remove this video from the queue?")) deleteMutation.mutate();
              }}
            >
              <Trash2 className="h-3 w-3 text-red-500" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
