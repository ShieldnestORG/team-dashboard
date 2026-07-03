import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import {
  socialsApi,
  type SocialAccount,
  type ZernioAutomationMirror,
  type FunnelCatalogEntry,
  type FunnelLead,
  type ZernioEvent,
  type KilledAutomation,
} from "../api/socials";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime } from "../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
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

function statusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  const s = status.toLowerCase();
  if (s === "active") return "default";
  if (s === "paused" || s === "dormant") return "secondary";
  return "outline";
}

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
}: {
  liveFunnels: number;
  accountsOn: number;
  leadsCaptured: number;
  awaitingSync: number;
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
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                      <Badge variant={statusVariant(a.status)}>
                        {a.status}
                      </Badge>
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
                  const when = logField(row, ["sentAt", "createdAt", "timestamp", "time", "receivedAt"]);
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
              <Badge variant={statusVariant(status)}>
                {CATALOG_STATUS_LABELS[status] ?? status}
              </Badge>
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
            No leads captured yet.
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
            No webhook events yet.
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

  const accounts = useMemo(
    () => (accountsQ.data?.accounts ?? []).filter((a) => !a.archived),
    [accountsQ.data],
  );
  const mirror = mirrorQ.data?.automations ?? [];
  const leads = leadsQ.data?.leads ?? [];
  const events = eventsQ.data?.events ?? [];
  const catalog = catalogQ.data;

  // The two core feeds are accounts + mirror; block the page shell on them.
  const coreLoading = accountsQ.isLoading || mirrorQ.isLoading;
  const coreError = accountsQ.error || mirrorQ.error;

  const liveFunnels = mirror.filter((a) => a.isActive).length;
  const accountsOn = accounts.filter((a) => a.funnelsEnabled === true).length;
  const leadsCaptured = leads.length;
  const awaitingSync = leads.filter(
    (l) => l.email && !l.brevoSyncedAt,
  ).length;

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
          />

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
