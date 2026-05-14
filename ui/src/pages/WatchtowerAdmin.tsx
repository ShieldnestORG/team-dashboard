import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  Eye,
  PlayCircle,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  watchtowerAdminApi,
  type WatchtowerAdminAggregate,
  type WatchtowerAdminCustomerRow,
} from "../api/watchtower-admin";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "paused" || status === "cancelled") return "secondary";
  if (status === "past_due") return "destructive";
  return "outline";
}

// ── Stat cards ─────────────────────────────────────────────────────────────

function StatCards({
  data,
}: {
  data: WatchtowerAdminAggregate | undefined;
}) {
  const totalCustomers = data?.totalCustomers ?? 0;
  const activeCustomers = data?.activeCustomers ?? 0;
  const mrrDollars = ((data?.mrrCents ?? 0) / 100).toFixed(0);
  const runs7d = data?.runsLast7d ?? 0;
  const errored = data?.enginesWithErrorsLast7d ?? [];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <Users className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-2xl font-bold leading-tight">
              {activeCustomers}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / {totalCustomers}
              </span>
            </div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Customers (active / total)
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <DollarSign className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-2xl font-bold leading-tight">${mrrDollars}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              MRR
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <PlayCircle className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-2xl font-bold leading-tight">{runs7d}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Runs · last 7d
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <AlertTriangle
            className={`h-5 w-5 ${
              errored.length > 0 ? "text-red-400" : "text-muted-foreground"
            }`}
          />
          <div className="min-w-0">
            <div className="text-2xl font-bold leading-tight">{errored.length}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">
              {errored.length > 0
                ? `Errors · ${errored.join(", ")}`
                : "Errors · last 7d"}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sortable customers table ───────────────────────────────────────────────

type SortKey =
  | "email"
  | "brandName"
  | "plan"
  | "status"
  | "signupAt"
  | "lastRunAt"
  | "lastMentionCount";

function CustomersTable({
  rows,
  onSelect,
}: {
  rows: WatchtowerAdminCustomerRow[];
  onSelect: (subscriptionId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("signupAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const norm = (v: typeof av) => {
        if (v === null || v === undefined) return "";
        return v;
      };
      const an = norm(av);
      const bn = norm(bv);
      let cmp = 0;
      if (typeof an === "number" && typeof bn === "number") cmp = an - bn;
      else cmp = String(an).localeCompare(String(bn));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "signupAt" || k === "lastRunAt" ? "desc" : "asc");
    }
  }

  function SortHeader({ k, label }: { k: SortKey; label: string }) {
    const active = k === sortKey;
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 text-left font-medium transition-colors hover:text-foreground ${
          active ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {label}
        {active &&
          (sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          ))}
      </button>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Customers</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs">
                <th className="px-2 py-2">
                  <SortHeader k="email" label="Email" />
                </th>
                <th className="px-2 py-2">
                  <SortHeader k="brandName" label="Brand" />
                </th>
                <th className="px-2 py-2">
                  <SortHeader k="plan" label="Plan" />
                </th>
                <th className="px-2 py-2">
                  <SortHeader k="status" label="Status" />
                </th>
                <th className="px-2 py-2">
                  <SortHeader k="signupAt" label="Signup" />
                </th>
                <th className="px-2 py-2">
                  <SortHeader k="lastRunAt" label="Last run" />
                </th>
                <th className="px-2 py-2 text-right">
                  <SortHeader k="lastMentionCount" label="Last mentions" />
                </th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row.subscriptionId}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-accent/50"
                  onClick={() => onSelect(row.subscriptionId)}
                >
                  <td className="px-2 py-2 font-mono text-xs">
                    {row.email ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2 py-2">
                    <div className="truncate font-medium">{row.brandName}</div>
                    {row.domain && (
                      <div className="text-[11px] text-muted-foreground">
                        {row.domain}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    <Badge variant="outline">{row.plan}</Badge>
                  </td>
                  <td className="px-2 py-2">
                    <Badge variant={statusBadgeVariant(row.status)}>
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">
                    {formatDate(row.signupAt)}
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">
                    {formatRelative(row.lastRunAt)}
                  </td>
                  <td className="px-2 py-2 text-right text-xs">
                    {row.lastMentionCount === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="font-mono">{row.lastMentionCount}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-2 py-12 text-center text-sm text-muted-foreground"
                  >
                    No customers yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Copy-to-clipboard button ───────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard may be blocked (e.g. non-https). Fail silently — the
          // text is still visible next to the button.
        }
      }}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      title="Copy"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

// ── Drill-down sheet ───────────────────────────────────────────────────────

function CustomerSheet({
  subscriptionId,
  onClose,
}: {
  subscriptionId: string | null;
  onClose: () => void;
}) {
  const open = subscriptionId !== null;
  const detailQuery = useQuery({
    queryKey: ["watchtower-admin", "customer", subscriptionId],
    queryFn: () =>
      subscriptionId ? watchtowerAdminApi.getCustomer(subscriptionId) : Promise.reject(),
    enabled: open,
  });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-xl">
        {!subscriptionId ? null : detailQuery.isLoading ? (
          <div className="p-8 text-sm text-muted-foreground">Loading…</div>
        ) : detailQuery.error ? (
          <div className="p-8 text-sm text-red-400">
            Failed to load subscription.
          </div>
        ) : !detailQuery.data ? null : (
          <>
            <SheetHeader className="border-b">
              <SheetTitle>{detailQuery.data.subscription.brandName}</SheetTitle>
              <SheetDescription>
                {detailQuery.data.subscription.domain ?? "no domain on file"} ·{" "}
                <Badge variant={statusBadgeVariant(detailQuery.data.subscription.status)}>
                  {detailQuery.data.subscription.status}
                </Badge>
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-8 pt-2">
              {/* Subscription metadata */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Subscription
                </h3>
                <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="font-mono text-xs">
                    {detailQuery.data.subscription.email ?? "—"}
                  </dd>
                  <dt className="text-muted-foreground">Brand</dt>
                  <dd>{detailQuery.data.subscription.brandName}</dd>
                  <dt className="text-muted-foreground">Domain</dt>
                  <dd className="font-mono text-xs">
                    {detailQuery.data.subscription.domain ?? "—"}
                  </dd>
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd>
                    <Badge variant="outline">
                      {detailQuery.data.subscription.plan}
                    </Badge>{" "}
                    <span className="text-xs text-muted-foreground">
                      ({detailQuery.data.subscription.frequency}, cap{" "}
                      {detailQuery.data.subscription.promptCap})
                    </span>
                  </dd>
                  <dt className="text-muted-foreground">Joined</dt>
                  <dd className="text-xs">
                    {formatDateTime(detailQuery.data.subscription.createdAt)}
                  </dd>
                  {detailQuery.data.subscription.stripeCustomerId && (
                    <>
                      <dt className="text-muted-foreground">Stripe cust</dt>
                      <dd className="flex items-center gap-1">
                        <span className="font-mono text-xs">
                          {detailQuery.data.subscription.stripeCustomerId}
                        </span>
                        <CopyButton
                          value={detailQuery.data.subscription.stripeCustomerId}
                        />
                      </dd>
                    </>
                  )}
                  {detailQuery.data.subscription.stripeSubscriptionId && (
                    <>
                      <dt className="text-muted-foreground">Stripe sub</dt>
                      <dd className="flex items-center gap-1">
                        <span className="font-mono text-xs">
                          {detailQuery.data.subscription.stripeSubscriptionId}
                        </span>
                        <CopyButton
                          value={detailQuery.data.subscription.stripeSubscriptionId}
                        />
                      </dd>
                    </>
                  )}
                </dl>
              </section>

              {/* Prompts */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Prompts ({detailQuery.data.prompts.length})
                </h3>
                {detailQuery.data.prompts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No prompts configured yet.
                  </p>
                ) : (
                  <ol className="space-y-1.5 text-sm">
                    {detailQuery.data.prompts.map((prompt, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="w-5 shrink-0 text-right text-muted-foreground">
                          {i + 1}.
                        </span>
                        <span className="break-words">{prompt}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              {/* Run timeline */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Runs (last {detailQuery.data.runs.length})
                </h3>
                {detailQuery.data.runs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No runs in this period.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {detailQuery.data.runs.map((run) => (
                      <li
                        key={run.id}
                        className="rounded-md border border-border bg-card/50 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span>{formatDateTime(run.runAt)}</span>
                          </div>
                          <a
                            href={`/api/watchtower/runs/${run.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            title="Raw run JSON"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3" />
                            raw
                          </a>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {run.engines.map((engine) => (
                            <Badge
                              key={engine}
                              variant="outline"
                              className="text-[10px]"
                            >
                              {engine}
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
                          <span>
                            {run.mentionCount} mention
                            {run.mentionCount === 1 ? "" : "s"}
                          </span>
                          <span>·</span>
                          <span>{run.totalPrompts} prompts</span>
                          {run.errorCount > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-red-400">
                                {run.errorCount} engine error
                                {run.errorCount === 1 ? "" : "s"}
                              </span>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Activity log */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Activity (last {detailQuery.data.activityLog.length})
                </h3>
                {detailQuery.data.activityLog.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No activity recorded for this subscription.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {detailQuery.data.activityLog.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-start justify-between gap-3 rounded border border-border/60 px-2 py-1.5 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">{entry.action}</div>
                          <div className="text-muted-foreground">
                            {entry.actorType}:{entry.actorId}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-muted-foreground">
                          {formatRelative(entry.createdAt)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Footer — no destructive actions in v1 */}
              <div className="border-t pt-4">
                <p className="text-[11px] text-muted-foreground">
                  Refund / cancel / re-run actions land in Phase 2.
                </p>
                <div className="mt-2">
                  <Button variant="secondary" size="sm" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function WatchtowerAdmin() {
  const [openSubId, setOpenSubId] = useState<string | null>(null);

  const customersQuery = useQuery({
    queryKey: ["watchtower-admin", "customers"],
    queryFn: () => watchtowerAdminApi.listCustomers(),
  });
  const aggregateQuery = useQuery({
    queryKey: ["watchtower-admin", "aggregate"],
    queryFn: () => watchtowerAdminApi.aggregate(),
  });

  const rows = customersQuery.data?.customers ?? [];

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Watchtower</h1>
        <p className="text-sm text-muted-foreground">
          Customer subscriptions and operational health
        </p>
      </header>

      <StatCards data={aggregateQuery.data} />

      {customersQuery.isLoading ? (
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground">
            Loading customers…
          </CardContent>
        </Card>
      ) : customersQuery.error ? (
        <Card>
          <CardContent className="p-8 text-sm text-red-400">
            Failed to load customers.
          </CardContent>
        </Card>
      ) : (
        <CustomersTable rows={rows} onSelect={(id) => setOpenSubId(id)} />
      )}

      <CustomerSheet
        subscriptionId={openSubId}
        onClose={() => setOpenSubId(null)}
      />
    </div>
  );
}
