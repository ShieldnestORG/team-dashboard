import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User } from "lucide-react";
import { socialsApi, type SocialPost } from "../../api/socials";
import { useBoardAccess } from "../../hooks/useBoardAccess";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/HelpTip";

const STATUS_OPTIONS = ["all", "pending_approval", "scheduled", "publishing", "posted", "failed", "canceled"] as const;
type StatusFilter = typeof STATUS_OPTIONS[number];
const ALL_ACCOUNTS = "all";

function statusVariant(s: string): "default" | "secondary" | "outline" | "destructive" {
  if (s === "posted") return "default";
  if (s === "failed") return "destructive";
  if (s === "scheduled" || s === "publishing") return "secondary";
  return "outline";
}

function authorLabel(p: SocialPost): string {
  return p.authorName || p.authorEmail || p.createdByUserId || "—";
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
  const [accountId, setAccountId] = useState<string>(ALL_ACCOUNTS);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: accountsData } = useQuery({
    queryKey: ["socials", "accounts"],
    queryFn: () => socialsApi.listAccounts(),
  });
  const accounts = accountsData?.accounts ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ["socials", "posts", status, accountId],
    queryFn: () =>
      socialsApi.listPosts({
        ...(status === "all" ? {} : { status }),
        ...(accountId === ALL_ACCOUNTS ? {} : { accountId }),
      }),
    refetchInterval: 5000,
  });

  // Instance-admin signal — any /cli-auth/me failure reads as "not admin"
  // inside useBoardAccess, so Approve stays hidden.
  const { isInstanceAdmin: isAdmin } = useBoardAccess();

  const cancelMut = useMutation({
    mutationFn: (id: string) => socialsApi.cancelPost(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["socials", "posts"] }),
    onError: (err) => setActionError(err instanceof Error ? err.message : String(err)),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => socialsApi.approvePost(id),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ["socials", "posts"] });
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : String(err)),
  });

  const relayMut = useMutation({
    mutationFn: socialsApi.relayNow,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["socials", "posts"] }),
  });

  const posts: SocialPost[] = data?.posts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold">Queue</h2>
        <HelpTip label="What is Queue?">
          Everything scheduled to go out. Posts leave automatically every minute via Zernio —
          nobody needs to hit post.
        </HelpTip>
      </div>
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div className="flex gap-2 items-center flex-wrap">
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
          <span className="ml-2 text-sm text-muted-foreground">Account:</span>
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value={ALL_ACCOUNTS}>All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.brand} · {a.platform} · @{a.handle}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" variant="secondary" onClick={() => relayMut.mutate()} disabled={relayMut.isPending}>
          {relayMut.isPending ? "Running…" : "Run relayer now"}
        </Button>
      </div>

      {actionError && <div className="text-sm text-destructive">{actionError}</div>}

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
                <Badge variant="outline" className="gap-1 text-xs font-normal text-muted-foreground">
                  <User className="h-3 w-3" />
                  {authorLabel(p)}
                </Badge>
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
                  <div className="flex gap-2">
                    {p.status === "pending_approval" && isAdmin && (
                      <Button
                        size="sm"
                        onClick={() => approveMut.mutate(p.id)}
                        disabled={approveMut.isPending}
                      >
                        Approve
                      </Button>
                    )}
                    {(p.status === "scheduled" || p.status === "pending_approval") && (
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
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
