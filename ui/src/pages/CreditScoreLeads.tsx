import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  ExternalLink,
  Gift,
  Inbox as InboxIcon,
  Link2,
  Tag,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PageSkeleton } from "../components/PageSkeleton";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import {
  creditscoreLeadsApi,
  type CreditScoreReportLead,
  type CreditScoreReportStatus,
  type CreditScoreSubscriptionTier,
  type PromoCode,
} from "../api/creditscoreLeads";

const PAGE_SIZE = 50;

type DateRange = "7d" | "30d" | "90d" | "all";

const STATUS_OPTIONS: { value: "" | CreditScoreReportStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "complete", label: "Complete" },
  { value: "failed", label: "Failed" },
];

const TIER_OPTIONS: { value: "" | CreditScoreSubscriptionTier; label: string }[] = [
  { value: "", label: "All tiers" },
  { value: "report", label: "Report (one-time)" },
  { value: "starter", label: "Starter" },
  { value: "growth", label: "Growth" },
  { value: "pro", label: "Pro" },
];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dateRangeToISO(range: DateRange): string | undefined {
  if (range === "all") return undefined;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    {
      pending: "bg-yellow-500/20 text-yellow-500",
      complete: "bg-green-500/20 text-green-500",
      failed: "bg-red-500/20 text-red-500",
    }[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", tone)}>
      {status}
    </span>
  );
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) {
    return (
      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
        free
      </span>
    );
  }
  const tone =
    {
      report: "bg-zinc-500/20 text-zinc-400",
      starter: "bg-blue-500/20 text-blue-500",
      growth: "bg-purple-500/20 text-purple-500",
      pro: "bg-amber-500/20 text-amber-500",
    }[tier] ?? "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", tone)}>
      {tier}
    </span>
  );
}

function ScoreCell({
  score,
  previousScore,
}: {
  score: number | null;
  previousScore: number | null;
}) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const delta = previousScore != null ? score - previousScore : null;
  return (
    <div className="flex items-baseline gap-1">
      <span className="font-semibold tabular-nums">{score}</span>
      {delta != null && delta !== 0 && (
        <span
          className={cn(
            "text-[10px] tabular-nums",
            delta > 0 ? "text-green-500" : "text-red-500",
          )}
        >
          {delta > 0 ? "+" : ""}
          {delta}
        </span>
      )}
    </div>
  );
}

function ActionsCell({
  row,
  onComp,
}: {
  row: CreditScoreReportLead;
  onComp: (row: CreditScoreReportLead) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        asChild
        className="h-7 px-2 text-xs"
        title="View report"
      >
        <a
          href={`/api/creditscore/report/${row.id}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Button>
      {row.email && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          title={copied ? "Copied" : "Copy email"}
          onClick={() => {
            if (!row.email) return;
            void navigator.clipboard.writeText(row.email).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      )}
      {row.shareableSlug && (
        <Button
          size="sm"
          variant="ghost"
          asChild
          className="h-7 px-2 text-xs"
          title="Open share link"
        >
          <a
            href={`/creditscore/r/${row.shareableSlug}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Link2 className="h-3.5 w-3.5" />
          </a>
        </Button>
      )}
      {row.email && !row.subscriptionId && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-amber-500 hover:text-amber-400"
          title="Comp this lead (free promo)"
          onClick={() => onComp(row)}
        >
          <Gift className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

const COMP_TIER_OPTIONS: { value: CreditScoreSubscriptionTier; label: string }[] = [
  { value: "report", label: "Report (one-time $19)" },
  { value: "starter", label: "Starter (monthly)" },
  { value: "growth", label: "Growth (monthly)" },
  { value: "pro", label: "Pro (monthly)" },
];

function CompGrantDialog({
  row,
  open,
  onOpenChange,
}: {
  row: CreditScoreReportLead | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [tier, setTier] = useState<CreditScoreSubscriptionTier>("report");
  const [reason, setReason] = useState("");
  const [durationDays, setDurationDays] = useState<string>("30");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (open) {
      setTier("report");
      setReason("");
      setDurationDays("30");
      setError(null);
      setSuccess(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!row?.email) throw new Error("Lead has no email");
      const url = row.domain.startsWith("http")
        ? row.domain
        : `https://${row.domain}`;
      const parsedDuration = Number.parseInt(durationDays, 10);
      return creditscoreLeadsApi.compGrant({
        tier,
        url,
        email: row.email,
        compReason: reason.trim() || "admin_comp",
        durationDays:
          tier !== "report" && Number.isFinite(parsedDuration) && parsedDuration > 0
            ? parsedDuration
            : undefined,
      });
    },
    onSuccess: () => {
      setSuccess("Comped — welcome email + initial audit triggered.");
      setError(null);
      void qc.invalidateQueries({ queryKey: queryKeys.creditscoreReview.all });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to comp lead");
      setSuccess(null);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">Comp this lead</h2>
            <p className="text-xs text-muted-foreground">
              Grants a free CreditScore subscription. Customer gets the welcome
              email + initial audit automatically.
            </p>
          </div>
          {row && (
            <div className="rounded border border-border bg-muted/30 p-2 text-xs">
              <div>
                <span className="text-muted-foreground">Email:</span> {row.email}
              </div>
              <div>
                <span className="text-muted-foreground">Domain:</span> {row.domain}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Tier</label>
            <select
              value={tier}
              onChange={(e) =>
                setTier(e.target.value as CreditScoreSubscriptionTier)
              }
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {COMP_TIER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {tier !== "report" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Duration (days)</label>
              <Input
                type="number"
                min={1}
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              Reason <span className="text-muted-foreground">(internal)</span>
            </label>
            <Input
              placeholder="launch_promo, friend, support_credit…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {success && <p className="text-xs text-green-500">{success}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Close
            </Button>
            <Button
              size="sm"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !row?.email}
            >
              {mutation.isPending ? "Granting…" : "Grant comp"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PromoCodePanel() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [percentOff, setPercentOff] = useState("100");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: promoData } = useQuery({
    queryKey: queryKeys.creditscoreReview.promoCodes,
    queryFn: () => creditscoreLeadsApi.listPromoCodes(),
  });
  const codes: PromoCode[] = promoData?.codes ?? [];

  const mutation = useMutation({
    mutationFn: () => {
      const pct = Number.parseInt(percentOff, 10);
      const max = Number.parseInt(maxRedemptions, 10);
      return creditscoreLeadsApi.createPromoCode({
        code: code.trim().toUpperCase(),
        percentOff: Number.isFinite(pct) && pct > 0 ? pct : undefined,
        maxRedemptions: Number.isFinite(max) && max > 0 ? max : undefined,
        expiresAt: expiresAt || undefined,
      });
    },
    onSuccess: (out) => {
      setSuccess(`Created promo code "${out.code}" in Stripe.`);
      setError(null);
      setCode("");
      setMaxRedemptions("");
      setExpiresAt("");
      void qc.invalidateQueries({
        queryKey: queryKeys.creditscoreReview.promoCodes,
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to create code");
      setSuccess(null);
    },
  });

  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
            Promo codes
            <span className="text-xs font-normal text-muted-foreground">
              ({codes.length})
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Create code
          </Button>
        </div>
        {codes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {codes.slice(0, 8).map((c) => (
              <Badge
                key={c.id}
                variant={c.active ? "secondary" : "outline"}
                className="text-[10px]"
                title={`${c.timesRedeemed}${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""} redeemed${c.expiresAt ? ` · expires ${new Date(c.expiresAt * 1000).toLocaleDateString()}` : ""}`}
              >
                {c.code}
                {c.coupon.percentOff != null && ` · ${c.coupon.percentOff}% off`}
                {c.coupon.amountOff != null &&
                  ` · $${(c.coupon.amountOff / 100).toFixed(2)} off`}
              </Badge>
            ))}
          </div>
        )}

        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) {
              setError(null);
              setSuccess(null);
            }
          }}
        >
          <DialogContent className="max-w-md">
            <div className="space-y-3">
              <div>
                <h2 className="text-base font-semibold">Create promo code</h2>
                <p className="text-xs text-muted-foreground">
                  Creates a Stripe coupon + promotion code. Redeemable at
                  checkout on coherencedaddy.com.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Code</label>
                <Input
                  placeholder="LAUNCH19"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Percent off</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={percentOff}
                  onChange={(e) => setPercentOff(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Max redemptions{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    type="number"
                    min={1}
                    value={maxRedemptions}
                    onChange={(e) => setMaxRedemptions(e.target.value)}
                    placeholder="unlimited"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Expires{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                </div>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              {success && <p className="text-xs text-green-500">{success}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                  disabled={mutation.isPending}
                >
                  Close
                </Button>
                <Button
                  size="sm"
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending || !code.trim()}
                >
                  {mutation.isPending ? "Creating…" : "Create in Stripe"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export function CreditScoreLeadsTab() {
  // Comp dialog state
  const [compRow, setCompRow] = useState<CreditScoreReportLead | null>(null);
  const [compOpen, setCompOpen] = useState(false);

  // Filter state
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [status, setStatus] = useState<"" | CreditScoreReportStatus>("");
  const [tier, setTier] = useState<"" | CreditScoreSubscriptionTier>("");
  const [hasEmail, setHasEmail] = useState(false);
  const [paidOnly, setPaidOnly] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [offset, setOffset] = useState(0);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, status, tier, hasEmail, paidOnly, dateRange]);

  const since = useMemo(() => dateRangeToISO(dateRange), [dateRange]);

  const filters = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      status: status || undefined,
      tier: tier || undefined,
      hasEmail: hasEmail || undefined,
      hasSubscription: paidOnly || undefined,
      since,
      limit: PAGE_SIZE,
      offset,
    }),
    [debouncedSearch, status, tier, hasEmail, paidOnly, since, offset],
  );

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: queryKeys.creditscoreReview.leads(filters),
    queryFn: () => creditscoreLeadsApi.listReports(filters),
  });

  const reports = data?.reports ?? [];
  const total = data?.total ?? 0;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + reports.length, total);
  const hasNext = offset + reports.length < total;
  const hasPrev = offset > 0;

  return (
    <div className="space-y-3">
      <PromoCodePanel />

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <Input
              placeholder="Search domain or email…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "" | CreditScoreReportStatus)
              }
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={tier}
              onChange={(e) =>
                setTier(e.target.value as "" | CreditScoreSubscriptionTier)
              }
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {TIER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={hasEmail}
                onChange={(e) => setHasEmail(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Has email only
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={paidOnly}
                onChange={(e) => setPaidOnly(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Paid only
            </label>
            <div className="ml-auto flex items-center gap-1">
              {(["7d", "30d", "90d", "all"] as DateRange[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDateRange(r)}
                  className={cn(
                    "rounded px-2 py-1 text-[11px] font-medium uppercase transition-colors",
                    dateRange === r
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent",
                  )}
                >
                  {r === "all" ? "All time" : `Last ${r}`}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <PageSkeleton />
      ) : error ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load leads"}
        </p>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <InboxIcon className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              No reports match these filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Domain</th>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Score</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Tier</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {fmtDate(r.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-medium">{r.domain}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.email ?? (
                        <span className="text-muted-foreground italic">anonymous</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ScoreCell score={r.score} previousScore={r.previousScore} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge tier={r.subscriptionTier ?? null} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ActionsCell
                        row={r}
                        onComp={(row) => {
                          setCompRow(row);
                          setCompOpen(true);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div>
          {total > 0 ? (
            <>
              Showing <Badge variant="secondary">{start}</Badge>–
              <Badge variant="secondary">{end}</Badge> of{" "}
              <Badge variant="secondary">{total}</Badge>
              {isFetching && <span className="ml-2 italic">refreshing…</span>}
            </>
          ) : (
            <span>No results</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!hasPrev}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!hasNext}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>

      <CompGrantDialog row={compRow} open={compOpen} onOpenChange={setCompOpen} />
    </div>
  );
}
