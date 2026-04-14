import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import {
  repoUpdatesApi,
  type RepoUpdateSuggestion,
} from "../api/repo-updates";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  GitPullRequest,
  Check,
  X,
  MessageSquare,
  Play,
  AlertTriangle,
} from "lucide-react";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-500/10 text-red-700 dark:text-red-300",
  high: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  medium: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  low: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  approved: "bg-green-500/10 text-green-700 dark:text-green-300",
  rejected: "bg-red-500/10 text-red-700 dark:text-red-300",
  needs_revision: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  applied: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
};

function StatsRow() {
  const { data } = useQuery({
    queryKey: ["repo-updates", "stats"],
    queryFn: () => repoUpdatesApi.stats(),
  });
  const total = data?.total ?? 0;
  const pending = data?.byStatus.pending ?? 0;
  const approved = data?.byStatus.approved ?? 0;
  const rejected = data?.byStatus.rejected ?? 0;
  const needsRevision = data?.byStatus.needs_revision ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Card>
        <CardContent className="pt-4 pb-3">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="mt-1 text-2xl font-bold">{total}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <p className="text-sm text-muted-foreground">Pending</p>
          <p className="mt-1 text-2xl font-bold text-yellow-600">{pending}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <p className="text-sm text-muted-foreground">Approved</p>
          <p className="mt-1 text-2xl font-bold text-green-600">{approved}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <p className="text-sm text-muted-foreground">Needs revision</p>
          <p className="mt-1 text-2xl font-bold text-purple-600">{needsRevision}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <p className="text-sm text-muted-foreground">Rejected</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{rejected}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function RunAuditBox() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("https://coherencedaddy.com");
  const mut = useMutation({
    mutationFn: (u: string) => repoUpdatesApi.runAudit(u),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repo-updates"] });
    },
  });
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Play className="h-4 w-4" /> Run ad-hoc audit
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://coherencedaddy.com"
        />
        <Button
          disabled={mut.isPending || !url.trim()}
          onClick={() => mut.mutate(url.trim())}
        >
          {mut.isPending ? "Auditing…" : "Audit site"}
        </Button>
      </CardContent>
      {mut.data ? (
        <CardContent className="pt-0 text-sm text-muted-foreground">
          {mut.data.created.length === 0
            ? "Audit complete — no new failures."
            : `Audit complete — ${mut.data.created.length} new suggestions added to the queue.`}
        </CardContent>
      ) : null}
    </Card>
  );
}

function SuggestionCard({ s }: { s: RepoUpdateSuggestion }) {
  const queryClient = useQueryClient();
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["repo-updates"] });

  const approve = useMutation({
    mutationFn: () => repoUpdatesApi.approve(s.id),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: () => repoUpdatesApi.reject(s.id, "Rejected from dashboard"),
    onSuccess: invalidate,
  });
  const reply = useMutation({
    mutationFn: (msg: string) => repoUpdatesApi.reply(s.id, msg),
    onSuccess: () => {
      setReplyOpen(false);
      setReplyText("");
      invalidate();
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{s.checklistItem}</CardTitle>
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {s.siteUrl}
              {s.filePath ? <> · <code>{s.filePath}</code></> : null}
              {" · "}
              {s.repo}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className={SEVERITY_STYLES[s.severity] ?? ""}>{s.severity}</Badge>
            <Badge className={STATUS_STYLES[s.status] ?? ""}>{s.status}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-sm font-medium">Issue</p>
          <p className="text-sm text-muted-foreground">{s.issue}</p>
        </div>
        {s.rationale ? (
          <div>
            <p className="text-sm font-medium">Why</p>
            <p className="text-sm text-muted-foreground">{s.rationale}</p>
          </div>
        ) : null}
        {s.proposedPatch ? (
          <div>
            <p className="text-sm font-medium">Proposed patch</p>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
              <code>{s.proposedPatch}</code>
            </pre>
          </div>
        ) : null}
        {s.adminResponse ? (
          <div className="rounded border border-border/40 bg-muted/40 p-2 text-xs">
            <p className="font-medium">Admin response</p>
            <p className="text-muted-foreground">{s.adminResponse}</p>
          </div>
        ) : null}
        {s.status === "pending" ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={approve.isPending}
              onClick={() => approve.mutate()}
            >
              <Check className="mr-1 h-3 w-3" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={reject.isPending}
              onClick={() => reject.mutate()}
            >
              <X className="mr-1 h-3 w-3" /> Reject
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReplyOpen((v) => !v)}
            >
              <MessageSquare className="mr-1 h-3 w-3" /> Reply
            </Button>
          </div>
        ) : null}
        {replyOpen ? (
          <div className="flex flex-col gap-2">
            <textarea
              className="min-h-[80px] w-full rounded border border-border bg-background p-2 text-sm"
              placeholder="Your guidance for the advisor (what to change, what to try instead)…"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={reply.isPending || !replyText.trim()}
                onClick={() => reply.mutate(replyText.trim())}
              >
                Send reply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReplyOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function RepoUpdates() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "Repo Updates" }]);
  }, [setBreadcrumbs]);

  const [filter, setFilter] = useState<string>("pending");

  const { data, isLoading } = useQuery({
    queryKey: ["repo-updates", "list", filter],
    queryFn: () => repoUpdatesApi.list(filter === "all" ? undefined : filter),
  });

  if (isLoading) return <PageSkeleton />;

  const suggestions = data?.suggestions ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-2">
        <GitPullRequest className="h-5 w-5" />
        <h1 className="text-2xl font-bold">Repo Updates</h1>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Sage's weekly SEO/AEO audit drops advisory suggestions here. Nothing is ever
        auto-pushed — approve, reject, or reply with guidance. Approved suggestions
        become the hand-off queue for whoever applies the patch.
      </p>

      <StatsRow />
      <RunAuditBox />

      <div className="flex flex-wrap gap-2">
        {["pending", "approved", "needs_revision", "rejected", "all"].map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      {suggestions.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          message="No suggestions in this view. Either everything is clean or Sage hasn't run the weekly audit yet — use the box above to run an ad-hoc audit."
        />
      ) : (
        <div className="space-y-4">
          {suggestions.map((s) => (
            <SuggestionCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}
