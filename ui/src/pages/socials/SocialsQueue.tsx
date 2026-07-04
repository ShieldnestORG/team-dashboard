import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User } from "lucide-react";
import { socialsApi, type SocialPost } from "../../api/socials";
import { useBoardAccess } from "../../hooks/useBoardAccess";
import { useNavigate } from "@/lib/router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HelpTip } from "@/components/HelpTip";
import { useToast } from "../../context/ToastContext";
import { StatusBadge } from "@/components/StatusBadge";
import { PlatformBadge } from "@/components/PlatformBadge";
import { statusBadge, statusBadgeDefault } from "@/lib/status-colors";
import { safeHref } from "@/lib/safe-href";
import { cn } from "@/lib/utils";
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

const STATUS_OPTIONS = ["all", "pending_approval", "scheduled", "publishing", "posted", "failed", "canceled"] as const;
type StatusFilter = typeof STATUS_OPTIONS[number];
const ALL_ACCOUNTS = "all";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  pending_approval: "Pending approval",
  scheduled: "Scheduled",
  publishing: "Publishing",
  posted: "Posted",
  failed: "Failed",
  canceled: "Canceled",
};

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
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [accountId, setAccountId] = useState<string>(ALL_ACCOUNTS);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SocialPost | null>(null);

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["socials", "posts"] });
      setCancelTarget(null);
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : String(err)),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => socialsApi.approvePost(id),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ["socials", "posts"] });
      pushToast({
        title: "Approved — it goes out within a minute",
        body: "No other clicks needed. It'll flip to \"Posted\" here once it's live.",
        tone: "success",
      });
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
          Everything scheduled to go out. Approved posts leave automatically within a minute —
          nobody needs to hit post. Posts marked "pending approval" are waiting on an admin.
        </HelpTip>
      </div>
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-sm text-muted-foreground">Status:</span>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-opacity",
                s === "all" ? statusBadgeDefault : statusBadge[s] ?? statusBadgeDefault,
                status === s ? "ring-2 ring-offset-1 ring-foreground/50" : "opacity-60 hover:opacity-100",
              )}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
          <span className="ml-2 text-sm text-muted-foreground">Account:</span>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger aria-label="Filter by account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ACCOUNTS}>All accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.brand} · {a.platform} · @{a.handle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => relayMut.mutate()}
          disabled={relayMut.isPending}
          title="Approved posts leave on their own every minute — this just sends anything due right now instead of waiting."
        >
          {relayMut.isPending ? "Sending…" : "Send due posts now"}
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
                  <StatusBadge status={p.status} />
                  <PlatformBadge platform={p.platform} />
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
                {p.error && p.status === "failed" ? (
                  <div className="text-xs text-destructive">
                    This post didn't go out: {p.error}
                    {p.attempts > 0 && <> (tried {p.attempts} of {p.maxAttempts} times)</>}.{" "}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() =>
                        navigate("/socials?tab=compose", { state: { prefillText: p.text } })
                      }
                    >
                      Try again in Compose
                    </button>{" "}
                    — the text comes with you — or check the account in the Accounts tab.
                  </div>
                ) : p.error ? (
                  <div className="text-xs text-destructive">
                    error: {p.error} {p.attempts > 0 && <>· attempts {p.attempts}/{p.maxAttempts}</>}
                  </div>
                ) : null}
                <div className="flex justify-between items-center gap-2 pt-1">
                  {p.postedUrl ? (
                    <a
                      href={safeHref(p.postedUrl)}
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
                        onClick={() => setCancelTarget(p)}
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

      <AlertDialog open={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this post?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget && (
                <>
                  This cancels the {STATUS_LABELS[cancelTarget.status as StatusFilter] ?? cancelTarget.status}{" "}
                  post to @{cancelTarget.handle}. It stays in the queue marked "Canceled" — this can't be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelTarget && cancelMut.mutate(cancelTarget.id)}
              disabled={cancelMut.isPending}
            >
              {cancelMut.isPending ? "Canceling…" : "Cancel post"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
