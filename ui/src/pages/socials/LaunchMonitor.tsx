import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { launchMonitorApi, type CommentReply } from "../../api/launch-monitor";

const PLATFORM_LABEL: Record<string, string> = {
  hn: "Hacker News",
  reddit: "Reddit",
  devto: "dev.to",
};

function platformVariant(p: string): "default" | "secondary" | "outline" {
  if (p === "hn") return "default";
  if (p === "reddit") return "secondary";
  return "outline";
}

function CommentCard({ row }: { row: CommentReply }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDismiss, setShowDismiss] = useState(false);
  const [dismissReason, setDismissReason] = useState("");

  const repliedMut = useMutation({
    mutationFn: () => launchMonitorApi.markReplied(row.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["launch-monitor", "comments"] }),
  });
  const dismissMut = useMutation({
    mutationFn: (reason: string) => launchMonitorApi.dismiss(row.id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["launch-monitor", "comments"] }),
  });

  const confidenceNum = row.confidence != null ? Number(row.confidence) : null;
  const hasSuggestion = !!row.suggestedReply && confidenceNum != null && confidenceNum >= 0.85;
  const preview = row.commentBody.length > 200 && !expanded
    ? row.commentBody.slice(0, 200) + "…"
    : row.commentBody;

  async function copySuggestion() {
    if (!row.suggestedReply) return;
    try {
      await navigator.clipboard.writeText(row.suggestedReply);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — silently fail.
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={platformVariant(row.platform)}>
              {PLATFORM_LABEL[row.platform] ?? row.platform}
            </Badge>
            {row.author && (
              <span className="text-xs text-muted-foreground">@{row.author}</span>
            )}
            {hasSuggestion ? (
              <Badge variant="default">
                {row.patternId} · {confidenceNum?.toFixed(2)}
              </Badge>
            ) : (
              <Badge variant="outline">needs custom</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(row.externalCommentUrl, "_blank", "noopener")}
            >
              Open Comment ↗
            </Button>
            <Button
              size="sm"
              onClick={() => repliedMut.mutate()}
              disabled={repliedMut.isPending}
            >
              Mark Replied
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowDismiss((v) => !v)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm whitespace-pre-wrap rounded border bg-muted/30 p-3">
          {preview}
          {row.commentBody.length > 200 && (
            <button
              type="button"
              className="ml-2 text-xs underline text-muted-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "collapse" : "expand"}
            </button>
          )}
        </div>

        {hasSuggestion ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                Suggested reply
              </div>
              <Button size="sm" variant="ghost" onClick={copySuggestion}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="text-sm whitespace-pre-wrap rounded border p-3">
              {row.suggestedReply}
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            No high-confidence pattern match. Reply manually or dismiss.
          </div>
        )}

        {showDismiss && (
          <div className="flex items-center gap-2">
            <Input
              placeholder="Dismiss reason (optional)"
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
            />
            <Button
              size="sm"
              onClick={() => dismissMut.mutate(dismissReason)}
              disabled={dismissMut.isPending}
            >
              Confirm dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrackNewPostForm() {
  const qc = useQueryClient();
  const [platform, setPlatform] = useState<"hn" | "reddit" | "devto">("hn");
  const [externalId, setExternalId] = useState("");
  const [title, setTitle] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [watchHours, setWatchHours] = useState("72");
  const [error, setError] = useState<string | null>(null);

  const addMut = useMutation({
    mutationFn: () =>
      launchMonitorApi.addTrackedItem({
        platform,
        externalId: externalId.trim(),
        title: title.trim() || undefined,
        postUrl: postUrl.trim() || undefined,
        watchHours: Number(watchHours) || 72,
      }),
    onSuccess: () => {
      setExternalId("");
      setTitle("");
      setPostUrl("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["launch-monitor", "tracked-items"] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to add");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Track new post</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-5">
        <label className="space-y-1 sm:col-span-1">
          <div className="text-xs">Platform</div>
          <select
            className="w-full rounded border px-2 py-1 text-sm bg-background"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as typeof platform)}
          >
            <option value="hn">Hacker News</option>
            <option value="reddit">Reddit</option>
            <option value="devto">dev.to</option>
          </select>
        </label>
        <label className="space-y-1 sm:col-span-1">
          <div className="text-xs">External ID</div>
          <Input
            placeholder="HN item id / reddit post id / devto article id"
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
          />
        </label>
        <label className="space-y-1 sm:col-span-1">
          <div className="text-xs">Title (optional)</div>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="space-y-1 sm:col-span-1">
          <div className="text-xs">Post URL (optional)</div>
          <Input value={postUrl} onChange={(e) => setPostUrl(e.target.value)} />
        </label>
        <label className="space-y-1 sm:col-span-1">
          <div className="text-xs">Watch hours</div>
          <Input
            type="number"
            min={1}
            value={watchHours}
            onChange={(e) => setWatchHours(e.target.value)}
          />
        </label>
        <div className="sm:col-span-5 flex items-center justify-between gap-3">
          <div className="text-xs text-destructive">{error}</div>
          <Button
            size="sm"
            onClick={() => addMut.mutate()}
            disabled={addMut.isPending || !externalId.trim()}
          >
            {addMut.isPending ? "Adding…" : "Track"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function LaunchMonitor() {
  const { data, isLoading } = useQuery({
    queryKey: ["launch-monitor", "comments", "pending"],
    queryFn: () => launchMonitorApi.listComments("pending"),
    refetchInterval: 30_000,
  });
  const { data: customData } = useQuery({
    queryKey: ["launch-monitor", "comments", "needs_custom"],
    queryFn: () => launchMonitorApi.listComments("needs_custom"),
    refetchInterval: 30_000,
  });
  const { data: itemsData } = useQuery({
    queryKey: ["launch-monitor", "tracked-items"],
    queryFn: () => launchMonitorApi.listTrackedItems(),
  });

  const pending = data?.comments ?? [];
  const custom = customData?.comments ?? [];
  const items = itemsData?.items ?? [];
  const activeItems = items.filter((i) => i.active);

  return (
    <div className="space-y-4">
      <TrackNewPostForm />

      <div className="text-sm text-muted-foreground">
        {activeItems.length} active tracked post{activeItems.length === 1 ? "" : "s"} ·{" "}
        {pending.length} pending high-confidence · {custom.length} needs custom
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : pending.length + custom.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No comments awaiting review.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pending.map((row) => (
            <CommentCard key={row.id} row={row} />
          ))}
          {custom.map((row) => (
            <CommentCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

export default LaunchMonitor;
