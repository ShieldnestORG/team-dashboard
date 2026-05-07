import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { socialsApi, type SocialPost } from "../../api/socials";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_OPTIONS = ["all", "scheduled", "publishing", "posted", "failed", "canceled"] as const;
type StatusFilter = typeof STATUS_OPTIONS[number];

function statusVariant(s: string): "default" | "secondary" | "outline" | "destructive" {
  if (s === "posted") return "default";
  if (s === "failed") return "destructive";
  if (s === "scheduled" || s === "publishing") return "secondary";
  return "outline";
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function SocialsQueue() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["socials", "posts", status],
    queryFn: () => socialsApi.listPosts(status === "all" ? {} : { status }),
    refetchInterval: 5000,
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => socialsApi.cancelPost(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["socials", "posts"] }),
  });

  const relayMut = useMutation({
    mutationFn: socialsApi.relayNow,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["socials", "posts"] }),
  });

  const posts: SocialPost[] = data?.posts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div className="flex gap-2 items-center">
          <span className="text-sm text-muted-foreground">Status:</span>
          {STATUS_OPTIONS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "default" : "outline"}
              onClick={() => setStatus(s)}
            >
              {s}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => relayMut.mutate()} disabled={relayMut.isPending}>
          {relayMut.isPending ? "Running…" : "Run relayer now"}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : posts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nothing in the queue. Schedule a post in the <strong>Compose</strong> tab.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                  <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                  <Badge variant="outline">{p.platform}</Badge>
                  <span className="text-muted-foreground">{p.brand} · @{p.handle}</span>
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {p.status === "posted" && p.postedAt
                      ? `posted ${formatWhen(p.postedAt)}`
                      : `scheduled ${formatWhen(p.scheduledAt)}`}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="whitespace-pre-wrap font-mono text-xs">{p.text}</div>
                {p.mediaUrls.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {p.mediaUrls.length} media attachment{p.mediaUrls.length === 1 ? "" : "s"}
                  </div>
                )}
                {p.error && (
                  <div className="text-xs text-destructive">
                    error: {p.error} {p.attempts > 0 && <>· attempts {p.attempts}/{p.maxAttempts}</>}
                  </div>
                )}
                <div className="flex justify-between items-center gap-2 pt-1">
                  {p.postedUrl ? (
                    <a
                      href={p.postedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline text-xs"
                    >
                      Open post
                    </a>
                  ) : (
                    <span />
                  )}
                  {p.status === "scheduled" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => cancelMut.mutate(p.id)}
                      disabled={cancelMut.isPending}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
