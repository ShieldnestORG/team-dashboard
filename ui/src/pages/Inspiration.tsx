import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useBoardAccess } from "../hooks/useBoardAccess";
import { socialsApi, type InspirationItem } from "../api/socials";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime, cn } from "../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpTip } from "@/components/HelpTip";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { statusBadge, statusBadgeDefault } from "../lib/status-colors";
import { ApiError } from "../api/client";
import { Lightbulb, Trash2, Archive, ExternalLink } from "lucide-react";

const STATUS_FILTERS = ["all", "new", "reviewed", "archived"] as const;
type InspirationStatusFilter = typeof STATUS_FILTERS[number];

function AddInspirationForm() {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addMut = useMutation({
    mutationFn: () => socialsApi.addInspiration({ url: url.trim(), note: note.trim() || undefined }),
    onSuccess: () => {
      setUrl("");
      setNote("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["inspiration"] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Failed to add link");
    },
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            if (!url.trim()) return;
            addMut.mutate();
          }}
        >
          <div className="flex-1 space-y-2">
            <Input
              placeholder="https://instagram.com/p/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              type="url"
              required
            />
            <Input
              placeholder="Why is this good? (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={addMut.isPending || !url.trim()}>
            {addMut.isPending ? "Saving…" : "Save link"}
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function InspirationRow({ item, canManage }: { item: InspirationItem; canManage: boolean }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["inspiration"] });
  const archiveMut = useMutation({
    mutationFn: () => socialsApi.archiveInspiration(item.id),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: () => socialsApi.deleteInspiration(item.id),
    onSuccess: invalidate,
  });

  let host = item.url;
  let href = "#";
  try {
    const parsed = new URL(item.url);
    host = parsed.hostname.replace(/^www\./, "");
    // Server validates http(s) at insert; re-check at render so a row written
    // by any other path can never become a javascript: link.
    if (parsed.protocol === "http:" || parsed.protocol === "https:") href = item.url;
  } catch {
    // Keep the raw url as display text if it somehow isn't parseable.
  }

  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
        >
          {host}
          <ExternalLink className="h-3 w-3 text-muted-foreground" />
        </a>
        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} />
          <span className="text-xs text-muted-foreground">{relativeTime(item.createdAt)}</span>
          {canManage && item.status !== "archived" && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Archive"
              onClick={() => archiveMut.mutate()}
              disabled={archiveMut.isPending}
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          )}
          {canManage && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Delete"
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
        </div>
      </div>
      {item.note && <p className="text-sm text-muted-foreground">{item.note}</p>}
      {item.aiComment && (
        <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">AI: </span>
          {item.aiComment}
        </p>
      )}
    </div>
  );
}

export function Inspiration() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { isInstanceAdmin, access } = useBoardAccess();
  const [statusFilter, setStatusFilter] = useState<InspirationStatusFilter>("all");

  useEffect(() => {
    setBreadcrumbs([{ label: "Inspiration" }]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.inspiration.list(statusFilter === "all" ? undefined : statusFilter),
    queryFn: () => socialsApi.listInspiration(statusFilter === "all" ? undefined : statusFilter),
  });

  const items = data?.items ?? [];

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-xl font-semibold">
            Inspiration
            <HelpTip label="What is Inspiration?">
              Saw a great post? Paste its link here. The AI reviews the list every morning and
              mines it for content and funnel ideas.
            </HelpTip>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop links to good posts the team saved — Instagram or anywhere else.
          </p>
        </div>
      </div>

      <AddInspirationForm />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Status:</span>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize whitespace-nowrap transition-opacity",
              s === "all" ? statusBadgeDefault : statusBadge[s] ?? statusBadgeDefault,
              statusFilter === s ? "ring-2 ring-offset-1 ring-foreground/50" : "opacity-60 hover:opacity-100",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading ? (
        <PageSkeleton variant="list" />
      ) : error ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load inspiration items"}
        </p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Lightbulb}
              message={
                statusFilter === "all"
                  ? "No links saved yet — paste one above to get started."
                  : `No ${statusFilter} links.`
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Saved links ({items.length})</CardTitle>
          </CardHeader>
          <CardContent className={cn("p-0")}>
            {items.map((item) => (
              <InspirationRow
                key={item.id}
                item={item}
                canManage={isInstanceAdmin || item.addedByUserId === access?.userId}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
