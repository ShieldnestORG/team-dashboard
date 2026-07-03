import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { socialsApi, type SocialAccount } from "../../api/socials";
import { useLocation } from "@/lib/router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/HelpTip";

// Platforms whose text relayer pipeline is wired up. IG-feed/X/LinkedIn
// will appear once their adapters land.
const TEXT_PLATFORMS = new Set(["bluesky"]);

function toLocalInputValue(d: Date): string {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function SocialsCompose() {
  const qc = useQueryClient();
  const location = useLocation();
  // Kit cards' "Send to Compose" button hands off a caption via router
  // state — read once on mount so the queued post stays attributed to
  // whoever sends it, instead of a copy-paste with no author trail.
  const prefillText = (location.state as { prefillText?: string } | null)?.prefillText;

  const { data: accountsData, isLoading } = useQuery({
    queryKey: ["socials", "accounts"],
    queryFn: () => socialsApi.listAccounts(),
  });

  const composableAccounts = useMemo(() => {
    return (accountsData?.accounts ?? []).filter(
      (a) => TEXT_PLATFORMS.has(a.platform) && a.status === "active",
    );
  }, [accountsData]);

  const [accountId, setAccountId] = useState<string>("");
  const [text, setText] = useState<string>(prefillText ?? "");
  const [mediaUrlsText, setMediaUrlsText] = useState<string>("");
  const [scheduledAt, setScheduledAt] = useState<string>(toLocalInputValue(new Date(Date.now() + 60_000)));
  const [postNow, setPostNow] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const createMut = useMutation({
    mutationFn: socialsApi.createPost,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["socials", "posts"] });
      setText("");
      setMediaUrlsText("");
      setFeedback({
        kind: "ok",
        msg: res.pendingApproval ? "Submitted for approval" : "Post queued",
      });
    },
    onError: (err) => {
      setFeedback({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    },
  });

  const relayMut = useMutation({
    mutationFn: socialsApi.relayNow,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["socials", "posts"] });
      setFeedback({
        kind: "ok",
        msg: `Relayer tick — picked ${r.picked}, posted ${r.posted}, failed ${r.failed}, retrying ${r.retrying}`,
      });
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading accounts…</div>;

  const selected: SocialAccount | undefined = composableAccounts.find((a) => a.id === accountId);
  const charCount = text.length;
  const tooLong = selected?.platform === "bluesky" && charCount > 300;

  function submit() {
    setFeedback(null);
    if (!accountId) {
      setFeedback({ kind: "err", msg: "Pick an account" });
      return;
    }
    if (!text.trim()) {
      setFeedback({ kind: "err", msg: "Post text is empty" });
      return;
    }
    const mediaUrls = mediaUrlsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    createMut.mutate({
      socialAccountId: accountId,
      text,
      mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
      scheduledAt: postNow ? new Date().toISOString() : new Date(scheduledAt).toISOString(),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold">Compose</h2>
        <HelpTip label="What is Compose?">
          Write a post and submit it. If you're an admin it queues right away; otherwise it waits
          for an admin to approve it before going out. A kit sent from Content Hub shows up
          prefilled below.
        </HelpTip>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Schedule a post</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1">
            <div className="text-xs text-muted-foreground">Account</div>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Pick an account…</option>
              {composableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.brand} · {a.platform} · @{a.handle}
                </option>
              ))}
            </select>
            {composableAccounts.length === 0 && (
              <div className="text-xs text-muted-foreground">
                No active text-capable accounts. Add a Bluesky account in the <strong>Accounts</strong> tab,
                set <code>BLUESKY_HANDLE</code> + <code>BLUESKY_APP_PASSWORD</code> on the server, and ensure
                its status is <code>active</code>.
              </div>
            )}
          </label>

          <label className="block space-y-1">
            <div className="text-xs text-muted-foreground flex justify-between">
              <span>Text</span>
              <span className={tooLong ? "text-destructive" : ""}>{charCount}{selected?.platform === "bluesky" ? " / 300" : ""}</span>
            </div>
            <textarea
              rows={6}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
              value={text}
              placeholder="What's on your mind?"
              onChange={(e) => setText(e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <div className="text-xs text-muted-foreground">Media URLs (one per line, optional, max 4)</div>
            <textarea
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
              value={mediaUrlsText}
              placeholder="https://example.com/image.jpg"
              onChange={(e) => setMediaUrlsText(e.target.value)}
            />
          </label>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={postNow} onChange={(e) => setPostNow(e.target.checked)} />
              Post on the next relayer tick
            </label>
            {!postNow && (
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="max-w-xs"
              />
            )}
          </div>

          <div className="flex gap-2">
            <Button onClick={submit} disabled={createMut.isPending || tooLong}>
              {createMut.isPending ? "Queueing…" : "Queue post"}
            </Button>
            <Button variant="secondary" onClick={() => relayMut.mutate()} disabled={relayMut.isPending}>
              {relayMut.isPending ? "Running…" : "Run relayer now"}
            </Button>
          </div>

          {feedback && (
            <div className={feedback.kind === "ok" ? "text-sm text-green-700" : "text-sm text-destructive"}>
              {feedback.msg}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {selected ? (
            <>
              <div><Badge>{selected.platform}</Badge> @{selected.handle}</div>
              <div className="text-muted-foreground">brand: {selected.brand}</div>
              <div className="text-muted-foreground">connection: {selected.connectionType}</div>
              <div className="text-muted-foreground">automation: {selected.automationMode}</div>
              {selected.profileUrl && (
                <a href={selected.profileUrl} target="_blank" rel="noreferrer" className="text-primary underline text-xs">
                  Open profile
                </a>
              )}
            </>
          ) : (
            <div className="text-muted-foreground">Pick an account to see details.</div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
