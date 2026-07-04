import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Upload, X } from "lucide-react";
import { socialsApi, type SocialAccount } from "../../api/socials";
import { useLocation } from "@/lib/router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpTip } from "@/components/HelpTip";
import { PlatformBadge } from "@/components/PlatformBadge";
import { useToast } from "@/context/ToastContext";
import { submitToAccounts, type SubmitResult } from "./multi-account-submit";
import { isAccountComposable, isExcludedForNonZernioRouting } from "./compose-eligibility";
import {
  MEDIA_REQUIRED_PLATFORMS,
  VIDEO_REQUIRED_PLATFORMS,
  PLATFORM_CAPTION_LIMITS,
  MAX_COMPOSE_MEDIA_ITEMS,
  checkComposeForPlatform,
  composePlatformLabel,
  isVideoRef,
  type ComposeMediaRef,
} from "@paperclipai/shared";

type CreatePostResult = Awaited<ReturnType<typeof socialsApi.createPost>>;
import { PLATFORM_META, PLATFORM_ORDER, normalizePlatform, platformBadge, platformBadgeDefault } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

// Client-side preflight only — the server (POST /socials/media) re-sniffs the
// actual bytes and is the authoritative gate. This just avoids a round-trip
// for an obviously wrong file.
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);
const CLIENT_MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB — matches server default
const CLIENT_MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB — matches server default

function looksLikeVideoFile(file: File): boolean {
  return ALLOWED_VIDEO_TYPES.has(file.type) || /\.(mp4|mov)$/i.test(file.name);
}
function looksLikeImageFile(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.has(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
}

/** Plain-English rejection, or null if the file is worth uploading. */
function precheckFile(file: File): string | null {
  const video = looksLikeVideoFile(file);
  const image = !video && looksLikeImageFile(file);
  if (!video && !image) {
    return "Unsupported file — use jpg/png/webp for photos or mp4/mov for video.";
  }
  const max = video ? CLIENT_MAX_VIDEO_BYTES : CLIENT_MAX_IMAGE_BYTES;
  if (file.size > max) {
    const limitMb = Math.floor(max / (1024 * 1024));
    return video
      ? `This video is over the ${limitMb}MB limit — trim it or export at a lower resolution in CapCut and try again.`
      : `This photo is over the ${limitMb}MB limit — resize or compress it and try again.`;
  }
  return null;
}

interface MediaItem {
  id: string;
  file: File;
  previewUrl: string;
  isVideo: boolean;
  status: "uploading" | "done" | "error";
  objectKey?: string;
  error?: string;
}

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
  /**
   * "Post the hook" handoff from the Funnels library (see Funnels.tsx
   * PostHookDialog) — forwarded to POST /posts as payload.funnelId so the
   * funnel's hook-post status can find this post. Server-side validated
   * (uuid format + belongs to this company) — never trust it silently.
   */
  prefillFunnelId?: string;
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
    return (accountsData?.accounts ?? []).filter(isAccountComposable);
  }, [accountsData]);

  // Active IG/TikTok accounts isAccountComposable silently drops for not
  // being Zernio-routed — surfaced as an inline note (see
  // compose-eligibility.ts) instead of a "where did my account go" dead end.
  const nonRoutedMediaAccounts = useMemo(() => {
    return (accountsData?.accounts ?? []).filter(isExcludedForNonZernioRouting);
  }, [accountsData]);

  // Grouped by platform, ordered by PLATFORM_ORDER.
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
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scheduledAt, setScheduledAt] = useState<string>(toLocalInputValue(new Date(Date.now() + 60_000)));
  const [postNow, setPostNow] = useState<boolean>(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<SubmitResult<CreatePostResult>[] | null>(null);
  const [kitDetailsOpen, setKitDetailsOpen] = useState(Boolean(state?.prefillKitRaw));

  // Pre-select the kit's account once accounts load — a ref (not state) so a
  // later manual deselect doesn't get silently re-applied on refetch. Match on
  // platform + handle, not handle alone: handles aren't unique across
  // platforms.
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

  // The kit's target platform has no composable account yet (no active
  // account on that platform, or an Instagram/TikTok account that isn't
  // Zernio-routed) — say so instead of silently failing to pre-select anything.
  const prefillPlatformUnsupported =
    state?.prefillAccountPlatform &&
    !composableAccounts.some((a) => normalizePlatform(a.platform) === state.prefillAccountPlatform)
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

  // ---- Media upload (drag-drop + file picker) ----

  const pastedMediaUrls = useMemo(
    () =>
      mediaUrlsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [mediaUrlsText],
  );
  const uploadedDoneCount = mediaItems.filter((m) => m.status === "done").length;
  const readyMediaCount = uploadedDoneCount + pastedMediaUrls.length;
  const readyVideoCount =
    mediaItems.filter((m) => m.status === "done" && m.isVideo).length +
    pastedMediaUrls.filter((url) => isVideoRef(url)).length;
  const anyUploading = mediaItems.some((m) => m.status === "uploading");

  function addFiles(files: FileList | File[]) {
    const room = Math.max(0, MAX_COMPOSE_MEDIA_ITEMS - mediaItems.length);
    const list = Array.from(files).slice(0, room);
    for (const file of list) {
      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      const isVideo = looksLikeVideoFile(file);
      const problem = precheckFile(file);
      if (problem) {
        setMediaItems((prev) => [...prev, { id, file, previewUrl, isVideo, status: "error", error: problem }]);
        continue;
      }
      setMediaItems((prev) => [...prev, { id, file, previewUrl, isVideo, status: "uploading" }]);
      socialsApi
        .uploadMedia(file)
        .then((uploaded) => {
          setMediaItems((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, status: "done", objectKey: uploaded.objectKey, isVideo: uploaded.isVideo } : m,
            ),
          );
        })
        .catch((err) => {
          setMediaItems((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, status: "error", error: err instanceof Error ? err.message : String(err) } : m,
            ),
          );
        });
    }
  }

  function removeMedia(id: string) {
    setMediaItems((prev) => {
      const found = prev.find((m) => m.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((m) => m.id !== id);
    });
  }

  function resetMedia() {
    setMediaItems((prev) => {
      for (const m of prev) URL.revokeObjectURL(m.previewUrl);
      return [];
    });
    setMediaUrlsText("");
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  const createMut = useMutation({
    mutationFn: (payload: {
      ids: string[];
      text: string;
      mediaUrls?: string[];
      scheduledAt: string;
      funnelId?: string;
    }) =>
      // N client-side inserts over the existing single-account POST /posts —
      // no bulk endpoint. The server derives pending_approval/scheduled per
      // request from the actor, and re-validates platform requirements (media
      // present, caption length) independently per account — so N calls
      // preserve per-account correctness for free. Partial failure is
      // expected and surfaced per-account below, not rolled back.
      submitToAccounts(payload.ids, (id) =>
        socialsApi.createPost({
          socialAccountId: id,
          text: payload.text,
          mediaUrls: payload.mediaUrls,
          scheduledAt: payload.scheduledAt,
          payload: payload.funnelId ? { funnelId: payload.funnelId } : undefined,
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
        resetMedia();
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
  const selectedCaptionLimits = selectedAccounts
    .map((a) => PLATFORM_CAPTION_LIMITS[a.platform])
    .filter((n): n is number => n !== undefined);
  const captionLimit = selectedCaptionLimits.length > 0 ? Math.min(...selectedCaptionLimits) : null;
  const tooLong = captionLimit !== null && charCount > captionLimit;

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
    if (anyUploading) {
      setFormError("Wait for media to finish uploading");
      return;
    }

    const media: ComposeMediaRef[] = [
      ...mediaItems
        .filter((m) => m.status === "done" && m.objectKey)
        .map((m) => ({ value: m.objectKey!, isVideo: m.isVideo })),
      ...pastedMediaUrls.map((value) => ({ value, isVideo: isVideoRef(value) })),
    ];

    // Same pure guard the server re-runs per account (@paperclipai/shared) —
    // each selected account's platform is validated independently so a mixed
    // Bluesky + Instagram selection catches each leg's own requirements.
    const problems = new Set<string>();
    for (const account of selectedAccounts) {
      const problem = checkComposeForPlatform({
        platform: account.platform,
        textLength: text.length,
        media,
      });
      if (problem) problems.add(problem);
    }
    if (problems.size > 0) {
      setFormError(Array.from(problems).join(" "));
      return;
    }

    const mediaUrls = media.map((m) => m.value);
    createMut.mutate({
      ids: Array.from(selectedIds),
      text,
      mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
      scheduledAt: postNow ? new Date().toISOString() : new Date(scheduledAt).toISOString(),
      funnelId: state?.prefillFunnelId,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold">Compose</h2>
        <HelpTip label="What is Compose?">
          Write a post, pick one or more accounts, and submit. If you're an admin it queues right
          away; otherwise it waits for an admin to approve it before going out. Instagram and
          TikTok accounts need a photo or video attached — attach one below and their chips
          unlock. A kit sent from Content Hub pre-selects its account below — its production notes
          show up in the "Kit details" panel, not in the post text.
        </HelpTip>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Schedule a post</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {state?.prefillFunnelId && (
              <div className="rounded-md border border-blue-300/60 bg-blue-50 p-2.5 text-xs text-blue-900 dark:border-blue-500/40 dark:bg-blue-900/20 dark:text-blue-200">
                This post is linked to a funnel — once queued it'll show up as that funnel's hook
                post back on the Funnels page.
              </div>
            )}
            {prefillPlatformUnsupported && (
              <div className="rounded-md border border-amber-300/60 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200">
                This kit targets {prefillPlatformUnsupported}, which Compose can't post to yet —
                pick an account below to send this caption somewhere Compose supports.
              </div>
            )}
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Accounts</div>
              {nonRoutedMediaAccounts.length > 0 && (
                <div className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200">
                  {nonRoutedMediaAccounts
                    .map((a) => `@${a.handle} (${composePlatformLabel(a.platform)})`)
                    .join(", ")}{" "}
                  {nonRoutedMediaAccounts.length === 1 ? "isn't" : "aren't"} connected for posting yet —
                  connect through Zernio to use{" "}
                  {nonRoutedMediaAccounts.length === 1 ? "it" : "them"} in Compose.
                </div>
              )}
              {groupedAccounts.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No active composable accounts. Add a Bluesky account in the <strong>Accounts</strong> tab
                  (set <code>BLUESKY_HANDLE</code> + <code>BLUESKY_APP_PASSWORD</code> on the server), or connect
                  an Instagram/TikTok account through Zernio — either way its status must be <code>active</code>.
                </div>
              ) : (
                <div className="space-y-3">
                  {groupedAccounts.map(([platform, accountsForPlatform]) => {
                    const ids = accountsForPlatform.map((a) => a.id);
                    const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
                    const meta = PLATFORM_META[platform];
                    const needsVideo = VIDEO_REQUIRED_PLATFORMS.has(platform) && readyVideoCount === 0;
                    const needsMedia =
                      !needsVideo && MEDIA_REQUIRED_PLATFORMS.has(platform) && readyMediaCount === 0;
                    const needsAttachment = needsMedia || needsVideo;
                    const attachmentHint = needsVideo ? "needs a video" : "needs a photo or video";
                    return (
                      <div key={platform} className="rounded-md border p-2 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs font-medium">
                            {meta?.icon && <meta.icon className="h-3.5 w-3.5" />}
                            {meta?.label ?? platform}
                            <span className="text-muted-foreground font-normal">
                              {selectedCount}/{ids.length} selected
                            </span>
                            {needsAttachment && (
                              <span className="text-amber-600 dark:text-amber-400 font-normal">
                                — {attachmentHint}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={needsAttachment}
                            onClick={() => toggleGroup(ids)}
                            className="text-xs text-primary underline underline-offset-2 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
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
                                disabled={needsAttachment && !isSelected}
                                title={
                                  needsAttachment && !isSelected
                                    ? needsVideo
                                      ? "Needs a video"
                                      : "Needs a photo or video"
                                    : undefined
                                }
                                onClick={() => toggleAccount(a.id)}
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                                  isSelected
                                    ? cn(platformBadge[platform] ?? platformBadgeDefault, "border-transparent")
                                    : "border-border bg-transparent text-foreground hover:bg-accent",
                                  needsAttachment && !isSelected && "opacity-40 cursor-not-allowed hover:bg-transparent",
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
                  {captionLimit !== null ? ` / ${captionLimit}` : ""}
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

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Media ({readyMediaCount}/{MAX_COMPOSE_MEDIA_ITEMS})
              </div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md border-2 border-dashed p-4 text-center text-xs cursor-pointer transition-colors",
                  dragActive ? "border-primary bg-accent/40" : "border-border hover:bg-accent/20",
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">
                  Drag photos or videos here, or click to choose (jpg/png/webp, mp4/mov — max{" "}
                  {MAX_COMPOSE_MEDIA_ITEMS})
                </span>
              </div>
              {mediaItems.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {mediaItems.map((m) => (
                    <div key={m.id} className="relative h-20 w-20 overflow-hidden rounded-md border bg-muted/30">
                      {m.isVideo ? (
                        <video src={m.previewUrl} className="h-full w-full object-cover" muted />
                      ) : (
                        <img src={m.previewUrl} className="h-full w-full object-cover" alt={m.file.name} />
                      )}
                      <button
                        type="button"
                        onClick={() => removeMedia(m.id)}
                        aria-label={`Remove ${m.file.name}`}
                        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                      {m.status === "uploading" && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] text-white">
                          Uploading…
                        </div>
                      )}
                      {m.status === "error" && (
                        <div className="absolute inset-0 flex items-center justify-center bg-red-900/80 p-1 text-center text-[9px] text-white">
                          {m.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <label className="block space-y-1">
              <div className="text-xs text-muted-foreground">
                Or paste already-public media URLs (one per line, optional)
              </div>
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

            <Button
              onClick={submit}
              disabled={createMut.isPending || tooLong || selectedIds.size === 0 || anyUploading}
            >
              {createMut.isPending
                ? "Sending…"
                : anyUploading
                  ? "Uploading media…"
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
