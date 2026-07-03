import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { socialsApi, type SocialAccount } from "../../api/socials";
import { useLocation } from "@/lib/router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpTip } from "@/components/HelpTip";
import { PlatformBadge } from "@/components/PlatformBadge";
import { useToast } from "@/context/ToastContext";
import { submitToAccounts, type SubmitResult } from "./multi-account-submit";

type CreatePostResult = Awaited<ReturnType<typeof socialsApi.createPost>>;
import { PLATFORM_META, PLATFORM_ORDER, normalizePlatform, platformBadge, platformBadgeDefault } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

// Platforms whose text relayer pipeline is wired up. IG-feed/X/LinkedIn
// will appear once their adapters land.
const TEXT_PLATFORMS = new Set(["bluesky"]);

function toLocalInputValue(d: Date): string {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

interface ComposeLocationState {
  /** Generic prefill entry point — any caller can hand off caption text this way. */
  prefillText?: string;
  /**
   * Kit-specific handoff from Content Hub's "Send to Compose" (see KitCard.sendToCompose).
   * The kit's raw block is a 2000+ char internal production brief, not a caption — it's
   * shown in a read-only "Kit details" reference panel, never dumped into the Text box.
   */
  prefillKitTitle?: string;
  prefillKitRaw?: string;
  prefillAccountHandle?: string;
  /** Normalized platform key (see normalizePlatform) parsed from the kit's account line, e.g. "instagram". */
  prefillAccountPlatform?: string;
}


export function SocialsCompose() {
  const qc = useQueryClient();
  const { pushToast } = useToast();
  const location = useLocation();
  const state = (location.state as ComposeLocationState | null) ?? null;

  const { data: accountsData, isLoading } = useQuery({
    queryKey: ["socials", "accounts"],
    queryFn: () => socialsApi.listAccounts(),
  });

  const composableAccounts = useMemo(() => {
    return (accountsData?.accounts ?? []).filter(
      (a) => TEXT_PLATFORMS.has(a.platform) && a.status === "active",
    );
  }, [accountsData]);

  // Grouped by platform, ordered by PLATFORM_ORDER — today that's usually a
  // single Bluesky group since TEXT_PLATFORMS only has one entry, but this
  // future-proofs the moment another adapter lands.
  const groupedAccounts = useMemo(() => {
    const by = new Map<string, SocialAccount[]>();
    for (const a of composableAccounts) {
      const key = normalizePlatform(a.platform);
      if (!by.has(key)) by.set(key, []);
      by.get(key)!.push(a);
    }
    const ordered = PLATFORM_ORDER.filter((p) => by.has(p)).map((p) => [p, by.get(p)!] as const);
    const rest = [...by.entries()].filter(([p]) => !PLATFORM_ORDER.includes(p));
    return [...ordered, ...rest];
  }, [composableAccounts]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [text, setText] = useState<string>(state?.prefillText ?? "");
  const [mediaUrlsText, setMediaUrlsText] = useState<string>("");
  const [scheduledAt, setScheduledAt] = useState<string>(toLocalInputValue(new Date(Date.now() + 60_000)));
  const [postNow, setPostNow] = useState<boolean>(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<SubmitResult<CreatePostResult>[] | null>(null);
  const [kitDetailsOpen, setKitDetailsOpen] = useState(Boolean(state?.prefillKitRaw));

  // Pre-select the kit's account once accounts load — a ref (not state) so a
  // later manual deselect doesn't get silently re-applied on refetch. Match on
  // platform + handle, not handle alone: handles aren't unique across
  // platforms (an IG handle can coincidentally collide with an unrelated
  // Bluesky handle) and today's only composable platform (Bluesky) uses
  // full-domain handles that would never equal an IG handle anyway.
  const didPrefillAccount = useRef(false);
  useEffect(() => {
    if (didPrefillAccount.current) return;
    if (!state?.prefillAccountHandle || composableAccounts.length === 0) return;
    const match = composableAccounts.find(
      (a) =>
        a.handle.toLowerCase() === state.prefillAccountHandle!.toLowerCase() &&
        (!state.prefillAccountPlatform || normalizePlatform(a.platform) === state.prefillAccountPlatform),
    );
    didPrefillAccount.current = true;
    if (match) {
      setSelectedIds((prev) => new Set(prev).add(match.id));
    }
  }, [state?.prefillAccountHandle, state?.prefillAccountPlatform, composableAccounts]);

  // The kit's target platform has no text adapter yet (e.g. Instagram) — say
  // so instead of silently failing to pre-select anything.
  const prefillPlatformUnsupported =
    state?.prefillAccountPlatform && !TEXT_PLATFORMS.has(state.prefillAccountPlatform)
      ? (PLATFORM_META[state.prefillAccountPlatform]?.label ?? state.prefillAccountPlatform)
      : null;

  function toggleAccount(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(ids: string[]) {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  const createMut = useMutation({
    mutationFn: (payload: { ids: string[]; text: string; mediaUrls?: string[]; scheduledAt: string }) =>
      // N client-side inserts over the existing single-account POST /posts —
      // no bulk endpoint. The server derives pending_approval/scheduled per
      // request from the actor (server/src/routes/socials.ts), so N calls
      // preserve that split for free. Partial failure is expected and
      // surfaced per-account below, not rolled back.
      submitToAccounts(payload.ids, (id) =>
        socialsApi.createPost({
          socialAccountId: id,
          text: payload.text,
          mediaUrls: payload.mediaUrls,
          scheduledAt: payload.scheduledAt,
        }),
      ),
    onSuccess: (settledResults) => {
      qc.invalidateQueries({ queryKey: ["socials", "posts"] });
      setResults(settledResults);
      const okCount = settledResults.filter((r) => r.ok).length;
      const failedIds = settledResults.filter((r) => !r.ok).map((r) => r.accountId);
      if (okCount > 0) {
        pushToast({
          title:
            okCount === 1
              ? "Queued for 1 account"
              : `Queued for ${okCount} accounts`,
          body: failedIds.length > 0 ? `${failedIds.length} failed — see details below.` : undefined,
          tone: failedIds.length > 0 ? "warn" : "success",
          action: { label: "View in Queue", href: "/socials?tab=queue" },
        });
      }
      if (failedIds.length === 0) {
        setText("");
        setMediaUrlsText("");
        setSelectedIds(new Set());
      } else {
        // Keep only the failed accounts selected so a retry is one click.
        setSelectedIds(new Set(failedIds));
      }
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading accounts…</div>;

  const selectedAccounts = composableAccounts.filter((a) => selectedIds.has(a.id));
  const charCount = text.length;
  const tooLong = charCount > 300 && selectedAccounts.some((a) => a.platform === "bluesky");

  function submit() {
    setFormError(null);
    setResults(null);
    if (selectedIds.size === 0) {
      setFormError("Pick at least one account");
      return;
    }
    if (!text.trim()) {
      setFormError("Post text is empty");
      return;
    }
    const mediaUrls = mediaUrlsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    createMut.mutate({
      ids: Array.from(selectedIds),
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
          Write a post, pick one or more accounts, and submit. If you're an admin it queues right
          away; otherwise it waits for an admin to approve it before going out. A kit sent from
          Content Hub pre-selects its account below — its production notes show up in the "Kit
          details" panel, not in the post text.
        </HelpTip>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Schedule a post</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {prefillPlatformUnsupported && (
              <div className="rounded-md border border-amber-300/60 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200">
                This kit targets {prefillPlatformUnsupported}, which Compose can't post to yet —
                pick an account below to send this caption somewhere Compose supports.
              </div>
            )}
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Accounts</div>
              {groupedAccounts.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No active text-capable accounts. Add a Bluesky account in the <strong>Accounts</strong> tab,
                  set <code>BLUESKY_HANDLE</code> + <code>BLUESKY_APP_PASSWORD</code> on the server, and ensure
                  its status is <code>active</code>.
                </div>
              ) : (
                <div className="space-y-3">
                  {groupedAccounts.map(([platform, accountsForPlatform]) => {
                    const ids = accountsForPlatform.map((a) => a.id);
                    const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
                    const meta = PLATFORM_META[platform];
                    return (
                      <div key={platform} className="rounded-md border p-2 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs font-medium">
                            {meta?.icon && <meta.icon className="h-3.5 w-3.5" />}
                            {meta?.label ?? platform}
                            <span className="text-muted-foreground font-normal">
                              {selectedCount}/{ids.length} selected
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleGroup(ids)}
                            className="text-xs text-primary underline underline-offset-2"
                          >
                            {selectedCount === ids.length ? "Deselect all" : "Select all"}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {accountsForPlatform.map((a) => {
                            const isSelected = selectedIds.has(a.id);
                            return (
                              <button
                                key={a.id}
                                type="button"
                                role="checkbox"
                                aria-checked={isSelected}
                                onClick={() => toggleAccount(a.id)}
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                                  isSelected
                                    ? cn(platformBadge[platform] ?? platformBadgeDefault, "border-transparent")
                                    : "border-border bg-transparent text-foreground hover:bg-accent",
                                )}
                              >
                                {isSelected && <Check className="h-3 w-3" />}@{a.handle}
                                <span className="text-muted-foreground">{a.brand}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <label className="block space-y-1">
              <div className="text-xs text-muted-foreground flex justify-between">
                <span>Text</span>
                <span className={tooLong ? "text-destructive" : ""}>
                  {charCount}
                  {selectedAccounts.some((a) => a.platform === "bluesky") ? " / 300" : ""}
                </span>
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

            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={postNow} onChange={(e) => setPostNow(e.target.checked)} />
                Post as soon as possible
              </label>
              {!postNow && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">Schedule for later:</span>
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="max-w-xs"
                  />
                </label>
              )}
            </div>

            <Button onClick={submit} disabled={createMut.isPending || tooLong || selectedIds.size === 0}>
              {createMut.isPending
                ? "Sending…"
                : `Queue to ${selectedIds.size} account${selectedIds.size === 1 ? "" : "s"}`}
            </Button>

            {formError && <div className="text-sm text-destructive">{formError}</div>}

            {results && (
              <div className="space-y-1.5 pt-1">
                {results.map((r) => {
                  const account = composableAccounts.find((a) => a.id === r.accountId);
                  return (
                    <div
                      key={r.accountId}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm",
                        r.ok
                          ? r.value.pendingApproval
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                            : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                          : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
                      )}
                    >
                      {account && <PlatformBadge platform={account.platform} showLabel={false} />}
                      <span className="font-medium">{account ? `@${account.handle}` : r.accountId}</span>
                      <span>{r.ok ? (r.value.pendingApproval ? "Submitted for approval" : "Queued") : r.error}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Accounts</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {selectedAccounts.length === 0 ? (
                <div className="text-muted-foreground">Pick an account to see details.</div>
              ) : selectedAccounts.length === 1 ? (
                (() => {
                  const acc = selectedAccounts[0]!;
                  return (
                    <>
                      <div>
                        <PlatformBadge platform={acc.platform} /> @{acc.handle}
                      </div>
                      <div className="text-muted-foreground">brand: {acc.brand}</div>
                      <div className="text-muted-foreground">connection: {acc.connectionType}</div>
                      <div className="text-muted-foreground">automation: {acc.automationMode}</div>
                      {acc.profileUrl && (
                        <a href={acc.profileUrl} target="_blank" rel="noreferrer" className="text-primary underline text-xs">
                          Open profile
                        </a>
                      )}
                    </>
                  );
                })()
              ) : (
                <div>
                  <div className="font-medium">{selectedAccounts.length} accounts selected</div>
                  <div className="text-muted-foreground text-xs mt-1">
                    {selectedAccounts.map((a) => `@${a.handle}`).join(", ")}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {state?.prefillKitRaw && (
            <Card>
              <CardHeader className="pb-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => setKitDetailsOpen((v) => !v)}
                >
                  <CardTitle className="text-base">
                    Kit details{state.prefillKitTitle ? ` — ${state.prefillKitTitle}` : ""}
                  </CardTitle>
                  {kitDetailsOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                </button>
              </CardHeader>
              {kitDetailsOpen && (
                <CardContent className="space-y-2 text-sm">
                  <p className="text-xs text-muted-foreground">
                    Reference only — write your own caption in the Text box above. This is the
                    kit's full production brief (script, DM copy, Zernio settings), not something
                    to post as-is.
                  </p>
                  <div className="overflow-x-auto rounded-md border bg-muted/30 p-3">
                    <pre className="whitespace-pre-wrap text-xs">{state.prefillKitRaw}</pre>
                  </div>
                </CardContent>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
