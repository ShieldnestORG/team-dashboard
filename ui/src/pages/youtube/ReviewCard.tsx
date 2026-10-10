import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { VideoPreview } from "@/components/VideoPreview";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { youtubeApi } from "../../api/youtube";
import { youtubeStatusKind, youtubeStatusLabel } from "./youtube-status";

// "Sun, Oct 11, 7:00 AM PDT" — the viewer's own time zone.
function formatGoesOut(publishTime: string): string {
  return new Date(publishTime).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

// "Sun, 7:00 AM PDT" — the same weekday and time, for the helper sentence.
function formatWhen(publishTime: string): string {
  return new Date(publishTime).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

interface ReviewMeta {
  videoPath?: string;
  description?: string;
  tags?: string[];
}

export function ReviewCard({
  item,
  onRefresh,
}: {
  item: Record<string, unknown>;
  onRefresh: () => void;
}) {
  const id = item.id as string;
  const title = (item.title as string) ?? "";
  const publishTime = item.publishTime as string | undefined;
  const status = (item.status as string) ?? "pending_review";
  const meta = (item.metadata ?? null) as ReviewMeta | null;

  const [editingDate, setEditingDate] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmPostNow, setConfirmPostNow] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const approve = useMutation({
    mutationFn: () => youtubeApi.rescheduleQueueItem(id, publishTime ?? ""),
    onSuccess: onRefresh,
    onError: () => setActionError("That did not save. Nothing was changed. Try again."),
  });

  const reschedule = useMutation({
    mutationFn: (time: string) => youtubeApi.rescheduleQueueItem(id, time),
    onSuccess: () => {
      setEditingDate(false);
      onRefresh();
    },
    onError: () => setActionError("That did not save. Nothing was changed. Try again."),
  });

  const publishNow = useMutation({
    mutationFn: () => youtubeApi.publishNow(id),
    onSuccess: () => {
      setConfirmPostNow(false);
      onRefresh();
    },
    onError: () => setActionError("That did not save. Nothing was changed. Try again."),
  });

  const remove = useMutation({
    mutationFn: () => youtubeApi.deleteQueueItem(id),
    onSuccess: () => {
      setConfirmRemove(false);
      onRefresh();
    },
    onError: () => setActionError("That did not save. Nothing was changed. Try again."),
  });

  const busy = approve.isPending;
  const videoFile = meta?.videoPath ? meta.videoPath.split("/").pop() : undefined;
  const tags = Array.isArray(meta?.tags) ? meta.tags : undefined;

  return (
    <Card>
      <CardContent className="space-y-3">
        {/* Title, status and actions */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-base font-semibold leading-snug">{title}</h3>
            <StatusBadge status={youtubeStatusKind(status)} label={youtubeStatusLabel(status)} />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !publishTime}
              onClick={() => {
                setActionError(null);
                approve.mutate();
              }}
            >
              {approve.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Approve
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
                  disabled={!newDate || reschedule.isPending}
                  onClick={() => {
                    setActionError(null);
                    if (newDate) reschedule.mutate(new Date(newDate).toISOString());
                  }}
                >
                  {reschedule.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingDate(false)}
                >
                  <XCircle className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !publishTime}
                onClick={() => {
                  if (!publishTime) return;
                  const current = new Date(publishTime);
                  // datetime-local reads LOCAL time, so pre-fill in local time too
                  // (a UTC string would shift an unchanged approval by the offset).
                  const local = new Date(
                    current.getTime() - current.getTimezoneOffset() * 60_000,
                  );
                  setNewDate(local.toISOString().slice(0, 16));
                  setEditingDate(true);
                }}
              >
                <Calendar className="h-3 w-3" />
                Change time
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmPostNow(true)}
            >
              <Upload className="h-3 w-3" />
              Post now
            </Button>

            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
              Remove
            </Button>
          </div>
        </div>

        {publishTime && (
          <p className="text-xs text-muted-foreground">
            Approve schedules it for {formatWhen(publishTime)}. Nothing posts before then.
          </p>
        )}

        {actionError && (
          <p className="break-words text-sm text-destructive">{actionError}</p>
        )}

        {/* Player */}
        {videoFile && (
          <VideoPreview src={youtubeApi.getVideoStreamUrl(videoFile)} title={title} />
        )}

        {publishTime && (
          <p className="text-sm text-muted-foreground">
            Goes out: {formatGoesOut(publishTime)}
          </p>
        )}

        {/* Description, capped at about 8 lines with Show all */}
        {meta?.description && (
          <div>
            <Collapsible open={showAll} onOpenChange={setShowAll}>
              {!showAll && (
                <p className="line-clamp-8 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {meta.description}
                </p>
              )}
              <CollapsibleContent>
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {meta.description}
                </p>
              </CollapsibleContent>
              <CollapsibleTrigger className="group mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
                {showAll ? "Show less" : "Show all"}
              </CollapsibleTrigger>
            </Collapsible>
          </div>
        )}

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Post now confirm */}
        <AlertDialog open={confirmPostNow} onOpenChange={setConfirmPostNow}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Post this video publicly right now?</AlertDialogTitle>
              <AlertDialogDescription>
                It goes live on the YouTube channel immediately. This cannot be undone from here.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  setActionError(null);
                  publishNow.mutate();
                }}
                disabled={publishNow.isPending}
              >
                {publishNow.isPending ? "Posting…" : "Post now"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Remove confirm */}
        <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this video from the list?</AlertDialogTitle>
              <AlertDialogDescription>
                It will not be posted. The video file stays on the server until the clean-up
                removes files older than 30 days.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  setActionError(null);
                  remove.mutate();
                }}
                disabled={remove.isPending}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {remove.isPending ? "Removing…" : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
