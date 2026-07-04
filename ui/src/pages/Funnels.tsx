import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { useNavigate } from "@/lib/router";
import {
  socialsApi,
  type SocialAccount,
  type ZernioAutomationMirror,
  type FunnelCatalogEntry,
  type FunnelLead,
  type ZernioEvent,
  type KilledAutomation,
  type LibraryFunnel,
  type FunnelCoverageRow,
  type FunnelStatus,
  type FunnelStyle,
  type NewLibraryFunnel,
  type FunnelHookPost,
} from "../api/socials";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime, cn } from "../lib/utils";
import { normalizePlatform } from "@/lib/status-colors";
import { useBoardAccess } from "../hooks/useBoardAccess";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { HelpTip } from "@/components/HelpTip";
import { StatusBadge } from "@/components/StatusBadge";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronDown,
  ChevronRight,
  Filter,
  Radio,
  Users,
  ToggleRight,
  Send,
  Sparkles,
  Pencil,
  Check,
  X as XIcon,
  Rocket,
  Archive,
  Target,
  AlertTriangle,
  Megaphone,
  PenLine,
  type LucideIcon,
} from "lucide-react";
import { ApiError } from "../api/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Fetch a wider window of leads so the KPI counts more than one table page;
// the activity table still shows only the latest few.
const LEADS_FETCH_LIMIT = 100;
const LEADS_TABLE_LIMIT = 10;
const EVENTS_LIMIT = 10;

// Strategy-catalog status ordering, most-active first.
const CATALOG_STATUS_ORDER = [
  "live",
  "ready",
  "built",
  "planned",
  "blocked-on-account",
  "idea",
  "wont-build",
];

const CATALOG_STATUS_LABELS: Record<string, string> = {
  live: "Live",
  ready: "Ready",
  built: "Built",
  planned: "Planned",
  "blocked-on-account": "Blocked on account",
  idea: "Idea",
  "wont-build": "Won't build",
};

function catalogStatusRank(status: string): number {
  const i = CATALOG_STATUS_ORDER.indexOf(status.toLowerCase());
  return i === -1 ? CATALOG_STATUS_ORDER.length : i;
}

function tosRiskVariant(
  risk: string | undefined,
): "default" | "secondary" | "outline" | "destructive" {
  if (!risk) return "outline";
  const r = risk.toLowerCase();
  if (r === "high") return "destructive";
  if (r === "med" || r === "medium") return "secondary";
  return "outline";
}

// Pull a numeric metric out of the free-form stats jsonb, tolerating several
// key spellings. Returns undefined when absent so the cell renders "—".
function statNum(
  stats: Record<string, unknown> | null | undefined,
  keys: string[],
): number | undefined {
  if (!stats) return undefined;
  for (const k of keys) {
    const v = stats[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}

// The Zernio automation-logs endpoint passes its response straight through —
// shape is whatever Zernio returns, not something we control. Look for the
// array under a handful of likely keys before giving up.
function extractLogRows(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) {
    return raw.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["logs", "data", "items", "results"]) {
      const v = obj[key];
      if (Array.isArray(v)) {
        return v.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
      }
    }
  }
  return [];
}

// Best-effort pull of a string field out of a log row, trying several
// likely key spellings before giving up.
function logField(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

// Numeric epoch (seconds or milliseconds) → ISO string Date can parse.
// Second-epochs are ~1e9–1e10 today, ms-epochs ~1e12–1e13.
function epochToIso(n: number): string | undefined {
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = n > 1e11 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// Timestamp variant of logField: Zernio logs may carry ISO strings or
// numeric epochs. Stringified epochs would make `new Date("169...")` render
// "Invalid Date", so normalize numerics (and numeric strings) via the epoch.
function logTimestamp(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number") return epochToIso(v);
    if (typeof v === "string" && v.trim() !== "") {
      const trimmed = v.trim();
      if (/^\d+(\.\d+)?$/.test(trimmed)) return epochToIso(Number(trimmed));
      return trimmed;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Hand-rolled toggle switch (pattern from SocialsSchedule.tsx). Pure presentation
// — the parent owns the mutation and passes `pending`/`onToggle`.
// ---------------------------------------------------------------------------

function ToggleSwitch({
  enabled,
  pending,
  disabled,
  onToggle,
  title,
}: {
  enabled: boolean;
  pending?: boolean;
  disabled?: boolean;
  onToggle: () => void;
  title?: string;
}) {
  const off = disabled || pending;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={off}
      className={`shrink-0 relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
        enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
      } ${off ? "opacity-50 cursor-not-allowed" : ""}`}
      title={title ?? (enabled ? "Turn off" : "Turn on")}
      aria-pressed={enabled}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
          enabled ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

function KpiTiles({
  liveFunnels,
  accountsOn,
  leadsCaptured,
  awaitingSync,
  accountsAtTarget,
  accountsCoverageTotal,
}: {
  liveFunnels: number;
  accountsOn: number;
  leadsCaptured: number;
  awaitingSync: number;
  accountsAtTarget: number;
  accountsCoverageTotal: number;
}) {
  const tiles = [
    {
      label: "Live funnels",
      value: liveFunnels,
      icon: <Radio className="h-5 w-5 text-emerald-500" />,
      tint: "bg-emerald-500/10",
    },
    {
      label: "Accounts w/ funnels on",
      value: accountsOn,
      icon: <ToggleRight className="h-5 w-5 text-blue-500" />,
      tint: "bg-blue-500/10",
    },
    {
      label: `Accounts fully stocked (5+ ready)${accountsCoverageTotal > 0 ? ` / ${accountsCoverageTotal}` : ""}`,
      value: accountsAtTarget,
      icon: <Target className="h-5 w-5 text-teal-500" />,
      tint: "bg-teal-500/10",
    },
    {
      label: "Leads captured (recent)",
      value: leadsCaptured,
      icon: <Users className="h-5 w-5 text-purple-500" />,
      tint: "bg-purple-500/10",
    },
    {
      label: "Awaiting Brevo sync",
      value: awaitingSync,
      icon: <Send className="h-5 w-5 text-amber-500" />,
      tint: "bg-amber-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent className="flex items-center gap-3 py-4">
            <div className={`rounded-md ${t.tint} p-2`}>{t.icon}</div>
            <div>
              <p className="text-2xl font-bold tabular-nums">
                {t.value.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">{t.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funnel Library — the working table of drafts/ready/live/rejected/retired
// funnels behind the strategy catalog. AI drafts, an admin approves, "arm"
// creates the real Zernio comment automation.
// ---------------------------------------------------------------------------

// Mirrors the pure guard functions in server/src/services/socials/funnels-service.ts
// (canApprove/canReject/canArm/canRetire) — cosmetic only; the routes are the
// real enforcement.
function canApproveStatus(status: FunnelStatus): boolean {
  return status === "draft";
}
function canRejectStatus(status: FunnelStatus): boolean {
  return status === "draft" || status === "ready";
}
function canArmStatus(status: FunnelStatus, funnelsEnabled: boolean): boolean {
  return status === "ready" && funnelsEnabled;
}
function canRetireStatus(status: FunnelStatus): boolean {
  return status === "ready" || status === "live";
}

// Mirrors hasDmMessage() in funnels-service.ts — the "empty-DM ready trap"
// guard. Catalog-imported 'ready'/'built' rows land with dmMessage: "".
function needsDmText(dmMessage: string): boolean {
  return dmMessage.trim().length === 0;
}

/** Plain-English reason the Approve button is disabled, or null when it's clickable. */
function approveDisabledReason(funnel: LibraryFunnel): string | null {
  if (needsDmText(funnel.dmMessage)) return "Add the DM message first";
  return null;
}

/** Plain-English reason the Turn on button is disabled, or null when it's clickable. */
function armDisabledReason(
  funnel: LibraryFunnel,
  funnelsEnabled: boolean,
  zernioConnected: boolean,
): string | null {
  // Mirrors the server's armFunnel guards (canArm + the zernioAccountId
  // precondition) so the button is never clickable when the server would 409.
  if (!zernioConnected) return "Connect this account to Zernio first";
  if (!funnelsEnabled) return "Funnels are switched off for this account";
  if (needsDmText(funnel.dmMessage)) return "Add the DM message first";
  if (!funnel.keywords.some((k) => k.trim().length > 0)) return "Add a keyword first";
  return null;
}

// A hook post "counts" toward the funnel's hook-post status once it's queued
// or actually posted — a failed/canceled post never told anyone to comment.
function isLiveHookPost(post: FunnelHookPost): boolean {
  return post.status === "scheduled" || post.status === "pending_approval" || post.status === "publishing" || post.status === "posted";
}

function CoverageChips({ coverage }: { coverage: FunnelCoverageRow[] }) {
  if (coverage.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No Zernio-connected accounts yet.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {coverage.map((c) => (
        <span
          key={c.accountId}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${
            c.atTarget
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          }`}
          title={`draft ${c.counts.draft} · ready ${c.counts.ready} · live ${c.counts.live} · rejected ${c.counts.rejected} · retired ${c.counts.retired}`}
        >
          @{c.handle} {c.readyCount}/{c.readyTarget} ready
        </span>
      ))}
    </div>
  );
}

function EditFunnelDialog({
  funnel,
  open,
  onOpenChange,
}: {
  funnel: LibraryFunnel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<NewLibraryFunnel>>({});

  useEffect(() => {
    if (funnel) {
      setForm({
        name: funnel.name,
        keywords: funnel.keywords,
        matchMode: funnel.matchMode,
        dmMessage: funnel.dmMessage,
        destinationUrl: funnel.destinationUrl,
        postHooks: funnel.postHooks,
        style: funnel.style,
        tosRisk: funnel.tosRisk,
        notes: funnel.notes,
      });
    }
  }, [funnel]);

  const saveMut = useMutation({
    mutationFn: (data: Partial<NewLibraryFunnel>) => {
      if (!funnel) throw new Error("no funnel selected");
      return socialsApi.updateLibraryFunnel(funnel.id, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.funnels.library({}) });
      onOpenChange(false);
    },
  });

  if (!funnel) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit funnel</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <div className="text-xs text-muted-foreground">Name</div>
            <Input
              value={form.name ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <div className="text-xs text-muted-foreground">Keywords (comma-separated)</div>
            <p className="text-[11px] text-muted-foreground/80">
              The word people comment on the post to get the DM — e.g. GUIDE.
            </p>
            <Input
              value={(form.keywords ?? []).join(", ")}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  keywords: e.target.value
                    .split(",")
                    .map((k) => k.trim().toUpperCase())
                    .filter(Boolean),
                }))
              }
            />
          </label>
          <label className="block space-y-1">
            <div className="text-xs text-muted-foreground">DM message (2-step opener)</div>
            <p className="text-[11px] text-muted-foreground/80">
              What the robot sends, word for word, to everyone who comments the keyword.
            </p>
            <Textarea
              rows={3}
              value={form.dmMessage ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, dmMessage: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <div className="text-xs text-muted-foreground">Destination URL</div>
            <p className="text-[11px] text-muted-foreground/80">
              Where the link inside the DM sends people.
            </p>
            <Input
              value={form.destinationUrl ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, destinationUrl: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <div className="text-xs text-muted-foreground">Post hooks (one per line)</div>
            <p className="text-[11px] text-muted-foreground/80">
              Ready-made captions for the post that tells people to comment the keyword.
            </p>
            <Textarea
              rows={3}
              value={(form.postHooks ?? []).join("\n")}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  postHooks: e.target.value.split("\n").map((h) => h.trim()).filter(Boolean),
                }))
              }
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Style</div>
              <p className="text-[11px] text-muted-foreground/80">The tone of the hook posts.</p>
              <Select
                value={form.style ?? "standard"}
                onValueChange={(v) => setForm((f) => ({ ...f, style: v as FunnelStyle }))}
              >
                <SelectTrigger className="w-full" aria-label="Style">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="controversial">Controversial</SelectItem>
                  <SelectItem value="weird">Weird</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">ToS risk</div>
              <p className="text-[11px] text-muted-foreground/80">
                How likely this pattern is to upset Instagram's rules.
              </p>
              {/* Radix Select can't use "" as an item value — "unset" maps back to "". */}
              <Select
                value={form.tosRisk ? form.tosRisk : "unset"}
                onValueChange={(v) => setForm((f) => ({ ...f, tosRisk: v === "unset" ? "" : v }))}
              >
                <SelectTrigger className="w-full" aria-label="ToS risk">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Not set</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="block space-y-1">
            <div className="text-xs text-muted-foreground">Notes</div>
            <Textarea
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
          {saveMut.isError && (
            <p className="text-xs text-destructive">
              {saveMut.error instanceof ApiError
                ? saveMut.error.message
                : saveMut.error instanceof Error
                  ? saveMut.error.message
                  : "Save failed"}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Small shared button that renders a plain-English tooltip explaining why an
// action is disabled instead of just greying it out — the "surface it BEFORE
// the click" requirement for Turn on / Approve.
// ---------------------------------------------------------------------------

function GuardedActionButton({
  label,
  icon: Icon,
  onClick,
  disabledReason,
  pending,
  variant = "ghost",
  className,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabledReason?: string | null;
  pending?: boolean;
  variant?: "ghost" | "outline";
  className?: string;
}) {
  const disabled = Boolean(pending) || Boolean(disabledReason);
  const button = (
    <Button size="xs" variant={variant} className={className} disabled={disabled} onClick={onClick}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
  if (!disabledReason) return button;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{button}</span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// "Post the hook" — a small picker over the funnel's up-to-3 post-hook
// captions (plus "write my own"), then hands off to Compose exactly like
// Content Hub's "Send to Compose" seam (KitCard.sendToCompose): prefillText +
// the account pre-selected by matching handle+platform, plus prefillFunnelId
// so the queued post links back to this funnel (payload.funnelId,
// server-validated in POST /posts).
// ---------------------------------------------------------------------------

function PostHookDialog({
  funnel,
  account,
  open,
  onOpenChange,
}: {
  funnel: LibraryFunnel;
  account: SocialAccount | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { pushToast } = useToast();

  function sendToCompose(text: string) {
    onOpenChange(false);
    pushToast({ title: "Loaded into Compose", tone: "success" });
    navigate("/socials?tab=compose", {
      state: {
        prefillText: text,
        prefillAccountHandle: funnel.accountHandle,
        prefillAccountPlatform: account ? normalizePlatform(account.platform) : undefined,
        prefillFunnelId: funnel.id,
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Post the hook for "{funnel.name}"</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Pick a caption that tells people to comment{" "}
          <strong>{funnel.keywords.join(" or ") || "the keyword"}</strong> — it opens in Compose,
          pre-loaded and pointed at @{funnel.accountHandle}.
        </p>
        <div className="space-y-2">
          {funnel.postHooks.length > 0 ? (
            funnel.postHooks.map((hook, i) => (
              <button
                key={i}
                type="button"
                onClick={() => sendToCompose(hook)}
                className="w-full rounded-md border p-2.5 text-left text-sm hover:bg-accent"
              >
                {hook}
              </button>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">This funnel has no pre-written hooks.</p>
          )}
          <button
            type="button"
            onClick={() => sendToCompose("")}
            className="flex w-full items-center gap-2 rounded-md border border-dashed p-2.5 text-left text-sm text-muted-foreground hover:bg-accent"
          >
            <PenLine className="h-3.5 w-3.5 shrink-0" />
            Write my own caption
          </button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Inline "Enable funnels for @handle" — calls the same PATCH
// /accounts/:id/funnels the Accounts table's master switch uses. Its own
// confirm dialog (mirroring the AccountsTable pattern below) so flipping a
// whole account's funnels on from deep inside one funnel row never feels
// like an accident.
// ---------------------------------------------------------------------------

function EnableAccountFunnelsButton({ account }: { account: SocialAccount }) {
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enableMut = useMutation({
    mutationFn: () => socialsApi.setAccountFunnels(account.id, { enabled: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.funnels.accounts });
      qc.invalidateQueries({ queryKey: queryKeys.funnels.coverage });
      setConfirmOpen(false);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Enable failed");
      setConfirmOpen(false);
    },
  });

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setConfirmOpen(true)}>
        Enable funnels for @{account.handle}
      </Button>
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on funnels for @{account.handle}?</AlertDialogTitle>
            <AlertDialogDescription>
              This flips the account-wide funnels switch on. It doesn't arm anything by itself —
              you'll still hit Turn on for each funnel you want live.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => enableMut.mutate()} disabled={enableMut.isPending}>
              Enable funnels
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Lifecycle stepper — the plain-English "what happens next" map for one
// funnel. Visual language mirrors FlowStepper.tsx (numbered circles + arrow
// separators) but adds a per-step primary action button, since here the
// steps are gated one at a time rather than always all clickable.
// Only rendered for draft/ready/live funnels — rejected/retired are exits
// from this lifecycle, not steps within it.
// ---------------------------------------------------------------------------

interface LifecycleStepDef {
  label: string;
  description: string;
}

const LIFECYCLE_STEPS: LifecycleStepDef[] = [
  { label: "Draft", description: "AI wrote it — waiting for a human to review it." },
  { label: "Ready", description: "Approved — waiting to be turned on." },
  { label: "Turned on", description: "The robot is watching comments for the keyword right now." },
  { label: "Hook posted", description: "A post is telling people to comment the keyword." },
  { label: "Collecting leads", description: "People are commenting and getting the DM." },
];

/** 0-indexed current step. hasHookPost/hasLeads only matter once status is 'live'. */
function lifecycleStepIndex(funnel: LibraryFunnel, hasHookPost: boolean, hasLeads: boolean): number {
  if (funnel.status === "draft") return 0;
  if (funnel.status === "ready") return 1;
  // live
  if (!hasHookPost) return 2;
  if (!hasLeads) return 3;
  return 4;
}

function FunnelLifecycleStepper({
  funnel,
  account,
  isAdmin,
  hasHookPost,
  hookPostsLoading,
  hasLeads,
  onApprove,
  approvePending,
  onTurnOnRequest,
  armPending,
  onPostHook,
}: {
  funnel: LibraryFunnel;
  account: SocialAccount | undefined;
  isAdmin: boolean;
  hasHookPost: boolean;
  hookPostsLoading: boolean;
  hasLeads: boolean;
  onApprove: () => void;
  approvePending: boolean;
  onTurnOnRequest: () => void;
  armPending: boolean;
  onPostHook: () => void;
}) {
  const current = lifecycleStepIndex(funnel, hasHookPost, hasLeads);
  const funnelsEnabled = account?.funnelsEnabled === true;
  const approveReason = approveDisabledReason(funnel);
  const armReason = armDisabledReason(funnel, funnelsEnabled, Boolean(account?.zernioAccountId));

  return (
    <div className="border-t bg-muted/10 p-3">
      <div className="flex flex-wrap items-start gap-x-1 gap-y-3">
        {LIFECYCLE_STEPS.map((step, i) => {
          const isCurrent = i === current;
          const isDone = i < current;
          return (
            <div key={step.label} className="flex items-start">
              <div
                className={cn(
                  "flex max-w-[11.5rem] flex-col gap-1 rounded-md px-2 py-1",
                  isCurrent && "bg-muted/60",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      isDone
                        ? "bg-emerald-500 text-white"
                        : isCurrent
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted-foreground/15 text-muted-foreground",
                    )}
                  >
                    {isDone ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  {step.label}
                </span>
                <span className="text-xs text-muted-foreground">{step.description}</span>
                {isCurrent && isAdmin && (
                  <div className="mt-1 flex flex-col items-start gap-1.5">
                    {i === 0 && (
                      <GuardedActionButton
                        label="Approve"
                        icon={Check}
                        variant="outline"
                        onClick={onApprove}
                        pending={approvePending}
                        disabledReason={approveReason}
                      />
                    )}
                    {i === 1 && (
                      <>
                        <GuardedActionButton
                          label="Turn on"
                          icon={Rocket}
                          variant="outline"
                          onClick={onTurnOnRequest}
                          pending={armPending}
                          disabledReason={armReason}
                        />
                        {!funnelsEnabled && account && <EnableAccountFunnelsButton account={account} />}
                      </>
                    )}
                    {i === 2 && !hookPostsLoading && (
                      <Button size="xs" variant="outline" onClick={onPostHook}>
                        <Megaphone className="h-3.5 w-3.5" />
                        Post the hook
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {i < LIFECYCLE_STEPS.length - 1 && (
                <span className="mx-1 mt-1.5 text-muted-foreground/40" aria-hidden="true">
                  &rarr;
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FunnelDetail({
  funnel,
  hookPosts,
  hookPostsLoading,
}: {
  funnel: LibraryFunnel;
  hookPosts: FunnelHookPost[];
  hookPostsLoading: boolean;
}) {
  return (
    <div className="grid gap-2 border-t bg-muted/10 p-3 text-xs sm:grid-cols-2">
      <div>
        <p className="mb-1 font-medium text-muted-foreground">DM message</p>
        <p>{funnel.dmMessage || "—"}</p>
      </div>
      <div>
        <p className="mb-1 font-medium text-muted-foreground">Post hooks</p>
        {funnel.postHooks.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4">
            {funnel.postHooks.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        ) : (
          <p>—</p>
        )}
      </div>
      <div>
        <p className="mb-1 font-medium text-muted-foreground">ToS risk</p>
        <p>{funnel.tosRisk ?? "—"}</p>
      </div>
      <div>
        <p className="mb-1 font-medium text-muted-foreground">Notes</p>
        <p>{funnel.notes ?? "—"}</p>
      </div>
      <div className="sm:col-span-2">
        <p className="mb-1 font-medium text-muted-foreground">Hook posts</p>
        {hookPostsLoading ? (
          <p>Loading…</p>
        ) : hookPosts.length > 0 ? (
          <ul className="space-y-1">
            {hookPosts.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <StatusBadge status={p.status} />
                <span className="truncate">{p.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No posts linked to this funnel yet.</p>
        )}
      </div>
    </div>
  );
}

function FunnelLibraryRow({
  funnel,
  account,
  isAdmin,
  onEdit,
}: {
  funnel: LibraryFunnel;
  account: SocialAccount | undefined;
  isAdmin: boolean;
  onEdit: (f: LibraryFunnel) => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [confirmArm, setConfirmArm] = useState(false);
  const [hookDialogOpen, setHookDialogOpen] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.funnels.library({}) });
    qc.invalidateQueries({ queryKey: queryKeys.funnels.coverage });
  };

  const approveMut = useMutation({
    mutationFn: () => socialsApi.approveLibraryFunnel(funnel.id),
    onSuccess: invalidate,
    onError: (err) => setRowError(err instanceof Error ? err.message : "Approve failed"),
  });
  const rejectMut = useMutation({
    mutationFn: () => socialsApi.rejectLibraryFunnel(funnel.id),
    onSuccess: invalidate,
    onError: (err) => setRowError(err instanceof Error ? err.message : "Reject failed"),
  });
  const armMut = useMutation({
    mutationFn: () => socialsApi.armLibraryFunnel(funnel.id),
    onSuccess: () => {
      invalidate();
      setConfirmArm(false);
    },
    onError: (err) => {
      setRowError(err instanceof Error ? err.message : "Arm failed");
      setConfirmArm(false);
    },
  });
  const retireMut = useMutation({
    mutationFn: () => socialsApi.retireLibraryFunnel(funnel.id),
    onSuccess: invalidate,
    onError: (err) => setRowError(err instanceof Error ? err.message : "Retire failed"),
  });

  const anyPending =
    approveMut.isPending || rejectMut.isPending || armMut.isPending || retireMut.isPending;

  // "Post the hook" status — always fetched for ready/live funnels (not just
  // when expanded) so the amber "nothing is telling people to comment yet"
  // callout is visible without opening the row. Cheap: bounded by the ~5
  // ready + few live funnels the coverage target keeps per account.
  const hookPostsQ = useQuery({
    queryKey: queryKeys.funnels.hookPosts(funnel.id),
    queryFn: () => socialsApi.funnelPosts(funnel.id, { limit: 20 }),
    enabled: funnel.status === "ready" || funnel.status === "live",
  });
  const hookPosts = hookPostsQ.data?.posts ?? [];
  const hasLiveHookPost = hookPosts.some(isLiveHookPost);

  // Step 5 ("Collecting leads") only needs to resolve while the row is
  // expanded (it drives the full stepper, not the always-visible callout).
  const zernioAccountId = account?.zernioAccountId ?? undefined;
  const leadsQ = useQuery({
    queryKey: queryKeys.funnels.leads({ zernioAccountId, scope: "lifecycle-stepper" }),
    queryFn: () => socialsApi.funnelLeads({ zernioAccountId, limit: 50 }),
    enabled: expanded && funnel.status === "live" && Boolean(zernioAccountId),
  });
  const keywordSet = useMemo(
    () => new Set(funnel.keywords.map((k) => k.toUpperCase())),
    [funnel.keywords],
  );
  const hasLeads = (leadsQ.data?.leads ?? []).some(
    (l) => l.keyword && keywordSet.has(l.keyword.toUpperCase()),
  );

  const needsDm = needsDmText(funnel.dmMessage);
  const approveReason = approveDisabledReason(funnel);
  const armReason = armDisabledReason(
    funnel,
    account?.funnelsEnabled === true,
    Boolean(account?.zernioAccountId),
  );
  const showLifecycleStepper = funnel.status === "draft" || funnel.status === "ready" || funnel.status === "live";

  return (
    <Fragment>
      <tr className="border-b last:border-0 hover:bg-muted/30 align-top">
        <td className="px-2 py-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide details" : "Show DM message, hooks, notes"}
            className="text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-4 py-2">
          <p className="font-medium">{funnel.name}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {funnel.keywords.map((k) => (
              <Badge key={k} variant="outline" className="text-[10px] px-1 py-0">
                {k}
              </Badge>
            ))}
          </div>
          {funnel.status === "live" && !hookPostsQ.isLoading && !hasLiveHookPost && (
            <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3 shrink-0 translate-y-0.5" />
              Nothing is telling people to comment {funnel.keywords.join(" or ") || "the keyword"} yet
              — post the hook.
            </p>
          )}
          {rowError && <p className="mt-1 text-[11px] text-destructive">{rowError}</p>}
        </td>
        <td className="px-2 py-2">
          <Badge variant="outline" className="text-[10px] px-1 py-0 capitalize">
            {funnel.style}
          </Badge>
        </td>
        <td className="px-2 py-2 hidden sm:table-cell">
          {funnel.destinationUrl ? (
            <span className="text-[11px] text-muted-foreground break-all">{funnel.destinationUrl}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-2 py-2">
          <div className="flex flex-col items-start gap-1">
            <StatusBadge status={funnel.status} />
            {needsDm && (funnel.status === "draft" || funnel.status === "ready") && (
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                <AlertTriangle className="h-3 w-3" />
                Needs DM text
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-2">
          {isAdmin ? (
            <div className="flex flex-wrap items-center justify-end gap-1">
              {canApproveStatus(funnel.status) && (
                // The action that moves the funnel forward gets outline weight
                // so it reads as THE button in the row; secondary actions stay ghost.
                <GuardedActionButton
                  label="Approve"
                  icon={Check}
                  variant="outline"
                  className="text-emerald-600"
                  pending={anyPending}
                  disabledReason={approveReason}
                  onClick={() => approveMut.mutate()}
                />
              )}
              {canRejectStatus(funnel.status) && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-destructive"
                  disabled={anyPending}
                  onClick={() => rejectMut.mutate()}
                >
                  <XIcon className="h-3.5 w-3.5" />
                  Reject
                </Button>
              )}
              {funnel.status !== "live" && funnel.status !== "retired" && (
                <Button
                  size="xs"
                  variant={needsDm ? "outline" : "ghost"}
                  disabled={anyPending}
                  onClick={() => onEdit(funnel)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              )}
              {(funnel.status === "ready" || funnel.status === "live") && (
                <Button size="xs" variant="outline" disabled={anyPending} onClick={() => setHookDialogOpen(true)}>
                  <Megaphone className="h-3.5 w-3.5" />
                  Post the hook
                </Button>
              )}
              {funnel.status === "ready" && (
                <GuardedActionButton
                  label="Turn on"
                  icon={Rocket}
                  variant="outline"
                  className="text-blue-600"
                  pending={anyPending}
                  disabledReason={armReason}
                  onClick={() => setConfirmArm(true)}
                />
              )}
              {canRetireStatus(funnel.status) && (
                <Button size="xs" variant="ghost" disabled={anyPending} onClick={() => retireMut.mutate()}>
                  <Archive className="h-3.5 w-3.5" />
                  Retire
                </Button>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground">read-only</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b last:border-0">
          <td colSpan={6} className="p-0">
            {showLifecycleStepper && (
              <FunnelLifecycleStepper
                funnel={funnel}
                account={account}
                isAdmin={isAdmin}
                hasHookPost={hasLiveHookPost}
                hookPostsLoading={hookPostsQ.isLoading}
                hasLeads={hasLeads}
                onApprove={() => approveMut.mutate()}
                approvePending={anyPending}
                onTurnOnRequest={() => setConfirmArm(true)}
                armPending={anyPending}
                onPostHook={() => setHookDialogOpen(true)}
              />
            )}
            <FunnelDetail funnel={funnel} hookPosts={hookPosts} hookPostsLoading={hookPostsQ.isLoading} />
          </td>
        </tr>
      )}

      <AlertDialog open={confirmArm} onOpenChange={setConfirmArm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on "{funnel.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This goes live on Instagram immediately — commenting{" "}
              {funnel.keywords.join(" or ")} on @{funnel.accountHandle}'s posts will start
              triggering the DM sequence right away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => armMut.mutate()} disabled={armMut.isPending}>
              Turn on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PostHookDialog
        funnel={funnel}
        account={account}
        open={hookDialogOpen}
        onOpenChange={setHookDialogOpen}
      />
    </Fragment>
  );
}

function GenerateDraftsButton({ accountHandle }: { accountHandle: string }) {
  const qc = useQueryClient();
  const { pushToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const genMut = useMutation({
    mutationFn: () => socialsApi.generateLibraryFunnels({ accountHandle, count: 5 }),
    onSuccess: (result) => {
      setError(null);
      qc.invalidateQueries({ queryKey: queryKeys.funnels.library({}) });
      qc.invalidateQueries({ queryKey: queryKeys.funnels.coverage });
      pushToast({
        title: `${result.inserted.length} draft${result.inserted.length === 1 ? "" : "s"} created for @${accountHandle}`,
        body: "Scroll down to review — they start as Draft.",
        tone: "success",
      });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Generation failed"),
  });
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={genMut.isPending} onClick={() => genMut.mutate()}>
        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
        {genMut.isPending ? "Generating…" : "Generate 5 drafts"}
      </Button>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}

function FunnelLibrarySection({ accounts }: { accounts: SocialAccount[] }) {
  const { isInstanceAdmin: isAdmin } = useBoardAccess();
  const [editing, setEditing] = useState<LibraryFunnel | null>(null);

  const coverageQ = useQuery({
    queryKey: queryKeys.funnels.coverage,
    queryFn: () => socialsApi.funnelCoverage(),
  });
  const libraryQ = useQuery({
    queryKey: queryKeys.funnels.library({}),
    queryFn: () => socialsApi.listLibraryFunnels(),
  });

  const coverage = coverageQ.data?.coverage ?? [];
  const library = libraryQ.data?.funnels ?? [];

  const accountByHandle = useMemo(() => {
    const m = new Map<string, SocialAccount>();
    for (const a of accounts) m.set(a.handle, a);
    return m;
  }, [accounts]);

  const grouped = useMemo(() => {
    const by = new Map<string, LibraryFunnel[]>();
    for (const f of library) {
      if (!by.has(f.accountHandle)) by.set(f.accountHandle, []);
      by.get(f.accountHandle)!.push(f);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [library]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-sm font-medium">Funnel library</CardTitle>
          <HelpTip label="How does a funnel work?">
            <div className="space-y-2">
              <p>
                A funnel works in three steps: a post tells people to comment a keyword, the
                robot DMs everyone who does with your link, and they land on your free page and
                become leads.
              </p>
              <p>
                <strong>Draft</strong> = AI wrote it, waiting for approval.{" "}
                <strong>Ready</strong> = approved, waiting to be turned on.{" "}
                <strong>Live</strong> = robot is watching right now.
              </p>
            </div>
          </HelpTip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {coverageQ.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading coverage…</p>
        ) : (
          <CoverageChips coverage={coverage} />
        )}

        {libraryQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading funnels…</p>
        ) : libraryQ.error ? (
          <p className="text-sm text-destructive">
            {libraryQ.error instanceof Error ? libraryQ.error.message : "Failed to load funnels"}
          </p>
        ) : grouped.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            message="No funnels drafted yet — AI drafts arrive daily at 5:30am, or press Generate now below."
          />
        ) : (
          grouped.map(([handle, funnelsForAccount]) => (
            <div key={handle} className="rounded-md border">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2">
                <p className="text-sm font-medium">@{handle}</p>
                {isAdmin && <GenerateDraftsButton accountHandle={handle} />}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="w-8 px-2 py-2" aria-hidden="true" />
                      <th className="px-4 py-2 text-left font-medium">Funnel</th>
                      <th className="px-2 py-2 text-left font-medium">Style</th>
                      <th className="px-2 py-2 text-left font-medium hidden sm:table-cell">
                        Destination
                      </th>
                      <th className="px-2 py-2 text-left font-medium">Status</th>
                      <th className="px-4 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funnelsForAccount.map((f) => (
                      <FunnelLibraryRow
                        key={f.id}
                        funnel={f}
                        account={accountByHandle.get(f.accountHandle)}
                        isAdmin={isAdmin}
                        onEdit={setEditing}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}

        {isAdmin && grouped.length === 0 && coverage.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {coverage.map((c) => (
              <GenerateDraftsButton key={c.accountId} accountHandle={c.handle} />
            ))}
          </div>
        )}
      </CardContent>

      <EditFunnelDialog funnel={editing} open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Accounts table — funnels master switch per account
// ---------------------------------------------------------------------------

function AccountsTable({
  accounts,
  mirror,
}: {
  accounts: SocialAccount[];
  mirror: ZernioAutomationMirror[];
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<SocialAccount | null>(null);
  const [result, setResult] = useState<
    Record<string, KilledAutomation[]>
  >({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  // live automation count per zernio account id
  const liveByZid = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of mirror) {
      if (!a.isActive) continue;
      m.set(a.zernioAccountId, (m.get(a.zernioAccountId) ?? 0) + 1);
    }
    return m;
  }, [mirror]);

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      socialsApi.setAccountFunnels(id, { enabled }),
    onMutate: ({ id }) => {
      setRowError((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    onSuccess: (res, { id }) => {
      setResult((prev) => ({ ...prev, [id]: res.killed ?? [] }));
      qc.invalidateQueries({ queryKey: queryKeys.funnels.accounts });
      qc.invalidateQueries({ queryKey: queryKeys.funnels.mirror });
    },
    onError: (err, { id }) => {
      setRowError((prev) => ({
        ...prev,
        [id]:
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Toggle failed",
      }));
    },
  });

  const liveCountForAccount = (a: SocialAccount) =>
    a.zernioAccountId ? (liveByZid.get(a.zernioAccountId) ?? 0) : 0;

  const requestToggle = (a: SocialAccount) => {
    const isOn = a.funnelsEnabled === true;
    if (isOn) {
      // turning OFF: confirm because it kills live automations
      setPending(a);
    } else {
      toggleMut.mutate({ id: a.id, enabled: true });
    }
  };

  const confirmDisable = () => {
    if (!pending) return;
    toggleMut.mutate({ id: pending.id, enabled: false });
    setPending(null);
  };

  const pendingLiveCount = pending ? liveCountForAccount(pending) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Accounts</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Account</th>
                <th className="px-2 py-2 text-left font-medium hidden sm:table-cell">
                  Status
                </th>
                <th className="px-2 py-2 text-right font-medium">
                  Live automations
                </th>
                <th className="px-4 py-2 text-right font-medium">Funnels</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const connected = !!a.zernioAccountId;
                const isOn = a.funnelsEnabled === true;
                const rowPending =
                  toggleMut.isPending &&
                  toggleMut.variables?.id === a.id;
                const killed = result[a.id];
                const err = rowError[a.id];
                return (
                  <tr
                    key={a.id}
                    className="border-b last:border-0 hover:bg-muted/30 align-top"
                  >
                    <td className="px-4 py-2">
                      <p className="font-medium">@{a.handle}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {a.platform}
                      </p>
                      {a.latestFollowerCount != null && (
                        <p className="text-[11px] text-muted-foreground">
                          {a.latestFollowerCount.toLocaleString()}{" "}
                          {a.latestFollowerCount === 1 ? "follower" : "followers"}
                        </p>
                      )}
                      {killed && killed.length > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Deactivated:{" "}
                          {killed
                            .map(
                              (k) =>
                                `${k.name}${k.mechanism ? ` (${k.mechanism})` : ""}${k.ok ? "" : ` — failed${k.error ? `: ${k.error}` : ""}`}`,
                            )
                            .join(", ")}
                        </p>
                      )}
                      {err && (
                        <p className="mt-1 text-[11px] text-destructive">
                          {err}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2 hidden sm:table-cell">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {connected ? liveCountForAccount(a) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-2">
                        {connected ? (
                          <>
                            <span className="text-[11px] text-muted-foreground">
                              {isOn ? "on" : "off"}
                            </span>
                            <ToggleSwitch
                              enabled={isOn}
                              pending={rowPending}
                              onToggle={() => requestToggle(a)}
                              title={isOn ? "Turn funnels off" : "Turn funnels on"}
                            />
                          </>
                        ) : (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <ToggleSwitch
                                    enabled={false}
                                    disabled
                                    onToggle={() => {}}
                                  />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                not connected to Zernio
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off funnels for @{pending?.handle}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes/deactivates {pendingLiveCount} live DM automation
              {pendingLiveCount === 1 ? "" : "s"} on Zernio for @
              {pending?.handle}. Comments will no longer trigger DMs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisable}>
              Turn off funnels
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Funnel drill-down — recent automation logs + recent leads for one funnel.
// Mounted only while its row is expanded (queries are `enabled` on that).
// ---------------------------------------------------------------------------

const DRILLDOWN_LOGS_LIMIT = 20;
const DRILLDOWN_LEADS_LIMIT = 10;

function FunnelDrilldown({
  automationId,
  zernioAccountId,
}: {
  automationId: string;
  zernioAccountId: string;
}) {
  const logsQ = useQuery({
    queryKey: queryKeys.funnels.automationLogs(automationId, zernioAccountId),
    queryFn: () =>
      socialsApi.zernioAutomationLogs(automationId, {
        zernioAccountId,
        limit: DRILLDOWN_LOGS_LIMIT,
      }),
  });
  const leadsQ = useQuery({
    queryKey: queryKeys.funnels.leads({ zernioAccountId, limit: DRILLDOWN_LEADS_LIMIT }),
    queryFn: () => socialsApi.funnelLeads({ zernioAccountId, limit: DRILLDOWN_LEADS_LIMIT }),
  });

  const logRows = logsQ.data ? extractLogRows(logsQ.data) : [];

  return (
    <div className="grid gap-3 border-t bg-muted/10 p-3 md:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Recent automation logs</p>
        {logsQ.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : logsQ.error ? (
          <p className="text-xs text-destructive">
            {logsQ.error instanceof Error ? logsQ.error.message : "Failed to load logs"}
          </p>
        ) : logRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No logs reported for this automation yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">When</th>
                  <th className="px-2 py-1.5 text-left font-medium">Status</th>
                  <th className="px-2 py-1.5 text-left font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((row, i) => {
                  const when = logTimestamp(row, ["sentAt", "createdAt", "timestamp", "time", "receivedAt"]);
                  const rowStatus = logField(row, ["status", "result", "outcome"]);
                  const detail = logField(row, [
                    "error",
                    "message",
                    "reason",
                    "recipient",
                    "contact",
                    "to",
                    "handle",
                  ]);
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                        {when ? relativeTime(when) : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {rowStatus ? (
                          <Badge
                            variant={
                              rowStatus === "sent"
                                ? "default"
                                : rowStatus === "failed"
                                  ? "destructive"
                                  : "outline"
                            }
                            className="text-[10px] px-1 py-0"
                          >
                            {rowStatus}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{detail ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Recent leads for this account</p>
        {leadsQ.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : leadsQ.error ? (
          <p className="text-xs text-destructive">
            {leadsQ.error instanceof Error ? leadsQ.error.message : "Failed to load leads"}
          </p>
        ) : (leadsQ.data?.leads.length ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground">No leads captured on this account yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">Lead</th>
                  <th className="px-2 py-1.5 text-left font-medium">Keyword</th>
                  <th className="px-2 py-1.5 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {leadsQ.data!.leads.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-2 py-1.5">{l.handle ? `@${l.handle}` : (l.displayName ?? "—")}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{l.keyword ?? l.clickTag ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right text-muted-foreground">
                      {l.lastEventAt ? relativeTime(l.lastEventAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live funnels table (Zernio mirror) — per-funnel toggle
// ---------------------------------------------------------------------------

function LiveFunnelsTable({
  mirror,
  accounts,
}: {
  mirror: ZernioAutomationMirror[];
  accounts: SocialAccount[];
}) {
  const qc = useQueryClient();
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleByZid = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) {
      if (a.zernioAccountId) m.set(a.zernioAccountId, a.handle);
    }
    return m;
  }, [accounts]);

  const toggleMut = useMutation({
    mutationFn: ({
      automationId,
      zernioAccountId,
      isActive,
    }: {
      automationId: string;
      zernioAccountId: string;
      isActive: boolean;
    }) =>
      socialsApi.setAutomationActive(automationId, {
        zernioAccountId,
        isActive,
      }),
    onMutate: ({ automationId }) => {
      setRowError((prev) => {
        const next = { ...prev };
        delete next[automationId];
        return next;
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.funnels.mirror });
      qc.invalidateQueries({ queryKey: queryKeys.funnels.accounts });
    },
    onError: (err, { automationId }) => {
      setRowError((prev) => ({
        ...prev,
        [automationId]:
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Toggle failed",
      }));
    },
  });

  if (mirror.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Live funnels</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Radio}
            message="No comment→DM automations mirrored yet — they appear here after the hourly Zernio sync."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Live funnels</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="w-8 px-2 py-2" aria-hidden="true" />
                <th className="px-4 py-2 text-left font-medium">Funnel</th>
                <th className="px-2 py-2 text-left font-medium hidden md:table-cell">
                  Account
                </th>
                <th className="px-2 py-2 text-left font-medium hidden lg:table-cell">
                  Keywords
                </th>
                <th className="px-2 py-2 text-left font-medium hidden lg:table-cell">
                  Match
                </th>
                <th className="px-2 py-2 text-left font-medium hidden sm:table-cell">
                  Click tag
                </th>
                <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">
                  Triggered
                </th>
                <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">
                  DMs sent
                </th>
                <th className="px-2 py-2 text-right font-medium hidden md:table-cell">
                  Synced
                </th>
                <th className="px-4 py-2 text-right font-medium">On/off</th>
              </tr>
            </thead>
            <tbody>
              {mirror.map((a) => {
                const rowPending =
                  toggleMut.isPending &&
                  toggleMut.variables?.automationId === a.zernioAutomationId;
                const triggered = statNum(a.stats, [
                  "triggered",
                  "triggers",
                  "comments",
                ]);
                const dmsSent = statNum(a.stats, [
                  "dmsSent",
                  "dms_sent",
                  "dms",
                ]);
                const handle = handleByZid.get(a.zernioAccountId);
                const err = rowError[a.zernioAutomationId];
                const isExpanded = expandedId === a.zernioAutomationId;
                return (
                  <Fragment key={a.zernioAutomationId}>
                  <tr
                    className="border-b last:border-0 hover:bg-muted/30 align-top"
                  >
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : a.zernioAutomationId)}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? "Hide details" : "Show recent logs and leads"}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <p className="font-medium">{a.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {a.platform}
                        {a.trigger ? ` · ${a.trigger}` : ""}
                      </p>
                      {err && (
                        <p className="mt-1 text-[11px] text-destructive">
                          {err}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2 hidden md:table-cell">
                      {handle ? (
                        <span>@{handle}</span>
                      ) : (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {a.zernioAccountId}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {a.keywords.length > 0 ? (
                          a.keywords.map((kw) => (
                            <Badge
                              key={kw}
                              variant="outline"
                              className="text-[10px] px-1 py-0"
                            >
                              {kw}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 hidden lg:table-cell text-muted-foreground">
                      {a.matchMode ?? "—"}
                    </td>
                    <td className="px-2 py-2 hidden sm:table-cell">
                      {a.clickTag ? (
                        <span className="font-mono text-[11px]">
                          {a.clickTag}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                      {triggered != null ? triggered.toLocaleString() : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                      {dmsSent != null ? dmsSent.toLocaleString() : "—"}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-muted-foreground hidden md:table-cell whitespace-nowrap">
                      {a.lastSyncedAt ? relativeTime(a.lastSyncedAt) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {a.isActive ? "on" : "off"}
                        </span>
                        <ToggleSwitch
                          enabled={a.isActive}
                          pending={rowPending}
                          onToggle={() =>
                            toggleMut.mutate({
                              automationId: a.zernioAutomationId,
                              zernioAccountId: a.zernioAccountId,
                              isActive: !a.isActive,
                            })
                          }
                          title={a.isActive ? "Deactivate" : "Activate"}
                        />
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b last:border-0">
                      <td colSpan={10} className="p-0">
                        <FunnelDrilldown
                          automationId={a.zernioAutomationId}
                          zernioAccountId={a.zernioAccountId}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          Mirror refreshes hourly; toggles act on Zernio directly and update the
          mirror immediately.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Catalog overview (read-only strategy layer)
// ---------------------------------------------------------------------------

function CatalogSection({
  funnels,
  snapshotDate,
  source,
}: {
  funnels: FunnelCatalogEntry[];
  snapshotDate: string | null;
  source: string | null;
}) {
  const grouped = useMemo(() => {
    const by = new Map<string, FunnelCatalogEntry[]>();
    for (const f of funnels) {
      const s = (f.status ?? "").toLowerCase();
      if (!by.has(s)) by.set(s, []);
      by.get(s)!.push(f);
    }
    return [...by.entries()].sort(
      ([a], [b]) => catalogStatusRank(a) - catalogStatusRank(b),
    );
  }, [funnels]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-sm font-medium">
            Strategy catalog
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            The full funnel plan — read-only. Live/off state above is the source
            of truth for what's actually running.
          </p>
        </div>
        <div className="text-right text-[11px] text-muted-foreground shrink-0">
          {snapshotDate && <p>Snapshot {snapshotDate}</p>}
          {source && <p className="truncate max-w-[12rem]">{source}</p>}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {grouped.map(([status, entries]) => (
          <div key={status}>
            <div className="mb-2 flex items-center gap-2">
              <StatusBadge status={status} label={CATALOG_STATUS_LABELS[status] ?? status} />
              <span className="text-[11px] text-muted-foreground">
                {entries.length}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {entries.map((f) => (
                <div
                  key={f.id}
                  className="rounded-md border px-3 py-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{f.name}</p>
                    {f.tos_risk && (
                      <Badge
                        variant={tosRiskVariant(f.tos_risk)}
                        className="text-[10px] px-1 py-0 shrink-0"
                      >
                        {f.tos_risk} ToS
                      </Badge>
                    )}
                  </div>
                  {(f.accounts?.length ?? 0) > 0 && (
                    <p className="mt-1 text-muted-foreground">
                      {f.accounts!.join(", ")}
                    </p>
                  )}
                  {(f.trigger || f.destination) && (
                    <p className="mt-1 text-muted-foreground">
                      {f.trigger ?? ""}
                      {f.trigger && f.destination ? " → " : ""}
                      {f.destination ?? ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recent activity — leads + webhook events side by side
// ---------------------------------------------------------------------------

function RecentLeadsTable({ leads }: { leads: FunnelLead[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Recent leads</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {leads.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No leads captured yet — they show up here after the hourly Zernio sync.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Lead</th>
                  <th className="px-2 py-2 text-left font-medium hidden sm:table-cell">
                    Keyword
                  </th>
                  <th className="px-2 py-2 text-center font-medium">Email</th>
                  <th className="px-2 py-2 text-left font-medium">Brevo</th>
                  <th className="px-4 py-2 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr
                    key={l.id}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-2">
                      <p className="font-medium">
                        {l.handle ? `@${l.handle}` : (l.displayName ?? "—")}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {l.captureKind ?? l.platform ?? "—"}
                      </p>
                    </td>
                    <td className="px-2 py-2 hidden sm:table-cell">
                      {l.keyword ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1 py-0"
                        >
                          {l.keyword}
                        </Badge>
                      ) : l.clickTag ? (
                        <span className="font-mono text-[11px]">
                          {l.clickTag}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          l.email ? "bg-emerald-500" : "bg-muted-foreground/30"
                        }`}
                        title={l.email ? "Email captured" : "No email"}
                      />
                    </td>
                    <td className="px-2 py-2">
                      {l.email ? (
                        <Badge
                          variant={l.brevoSyncedAt ? "secondary" : "outline"}
                          className="text-[10px] px-1 py-0"
                        >
                          {l.brevoSyncedAt ? "synced" : "pending"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-[11px] text-muted-foreground whitespace-nowrap">
                      {l.lastEventAt ? relativeTime(l.lastEventAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentEventsTable({ events }: { events: ZernioEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Webhook events</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {events.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No webhook events yet — they show up here after the hourly Zernio sync.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Event</th>
                  <th className="px-2 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-2 font-mono text-[11px]">
                      {e.eventType ?? "—"}
                    </td>
                    <td className="px-2 py-2">
                      {e.error ? (
                        <Badge
                          variant="destructive"
                          className="text-[10px] px-1 py-0"
                        >
                          error
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1 py-0"
                        >
                          ok
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-[11px] text-muted-foreground whitespace-nowrap">
                      {e.receivedAt ? relativeTime(e.receivedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Funnels() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Funnels" }]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  const accountsQ = useQuery({
    queryKey: queryKeys.funnels.accounts,
    queryFn: () => socialsApi.listAccounts(),
  });
  const mirrorQ = useQuery({
    queryKey: queryKeys.funnels.mirror,
    queryFn: () => socialsApi.zernioAutomationsMirror(),
  });
  const catalogQ = useQuery({
    queryKey: queryKeys.funnels.catalog,
    queryFn: () => socialsApi.funnelsCatalog(),
  });
  const leadsQ = useQuery({
    queryKey: queryKeys.funnels.leads({ limit: LEADS_FETCH_LIMIT }),
    queryFn: () => socialsApi.funnelLeads({ limit: LEADS_FETCH_LIMIT }),
  });
  const eventsQ = useQuery({
    queryKey: queryKeys.funnels.events({ limit: EVENTS_LIMIT }),
    queryFn: () => socialsApi.zernioEvents({ limit: EVENTS_LIMIT }),
  });
  // Shares its cache entry with FunnelLibrarySection's own coverage query
  // (same query key) — one network fetch, not two.
  const coverageQ = useQuery({
    queryKey: queryKeys.funnels.coverage,
    queryFn: () => socialsApi.funnelCoverage(),
  });

  const accounts = useMemo(
    () => (accountsQ.data?.accounts ?? []).filter((a) => !a.archived),
    [accountsQ.data],
  );
  const mirror = mirrorQ.data?.automations ?? [];
  const leads = leadsQ.data?.leads ?? [];
  const events = eventsQ.data?.events ?? [];
  const catalog = catalogQ.data;
  const coverage = coverageQ.data?.coverage ?? [];

  // The two core feeds are accounts + mirror; block the page shell on them.
  const coreLoading = accountsQ.isLoading || mirrorQ.isLoading;
  const coreError = accountsQ.error || mirrorQ.error;

  const liveFunnels = mirror.filter((a) => a.isActive).length;
  const accountsOn = accounts.filter((a) => a.funnelsEnabled === true).length;
  const leadsCaptured = leads.length;
  const awaitingSync = leads.filter(
    (l) => l.email && !l.brevoSyncedAt,
  ).length;
  const accountsAtTarget = coverage.filter((c) => c.atTarget).length;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Funnels</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The comment→DM funnel system — live automations, per-account and
          per-funnel controls, and the strategy catalog behind them.
        </p>
      </div>

      {coreLoading ? (
        <PageSkeleton variant="dashboard" />
      ) : coreError ? (
        <p className="text-sm text-destructive">
          {coreError instanceof Error
            ? coreError.message
            : "Failed to load funnels"}
        </p>
      ) : (
        <>
          <KpiTiles
            liveFunnels={liveFunnels}
            accountsOn={accountsOn}
            leadsCaptured={leadsCaptured}
            awaitingSync={awaitingSync}
            accountsAtTarget={accountsAtTarget}
            accountsCoverageTotal={coverage.length}
          />

          <FunnelLibrarySection accounts={accounts} />

          {accounts.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={Filter}
                  message="No social accounts yet — connect accounts to Zernio to run funnels."
                />
              </CardContent>
            </Card>
          ) : (
            <AccountsTable accounts={accounts} mirror={mirror} />
          )}

          <LiveFunnelsTable mirror={mirror} accounts={accounts} />

          {catalogQ.error ? (
            <p className="text-sm text-destructive">
              {catalogQ.error instanceof Error
                ? catalogQ.error.message
                : "Failed to load strategy catalog"}
            </p>
          ) : catalog && catalog.funnels.length > 0 ? (
            <CatalogSection
              funnels={catalog.funnels}
              snapshotDate={catalog.snapshotDate}
              source={catalog.source}
            />
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <RecentLeadsTable leads={leads.slice(0, LEADS_TABLE_LIMIT)} />
            <RecentEventsTable events={events} />
          </div>
        </>
      )}
    </div>
  );
}
