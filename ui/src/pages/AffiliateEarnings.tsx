import { useEffect, useMemo, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  clearAffiliateToken,
  type Commission,
} from "@/api/affiliates";
import { Copy, Check } from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDollars(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const sameYear = s.getFullYear() === e.getFullYear();
  const sFmt: Intl.DateTimeFormatOptions = sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "2-digit" };
  const eFmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "2-digit" };
  return `${s.toLocaleDateString("en-US", sFmt)} – ${e.toLocaleDateString("en-US", eFmt)}`;
}

const STATUS_PILL: Record<string, { label: string; className: string }> = {
  pending_activation: {
    label: "Pending",
    className: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30",
  },
  approved: {
    label: "Approved",
    className: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  },
  scheduled_for_payout: {
    label: "Scheduled",
    className: "bg-violet-500/15 text-violet-500 border-violet-500/30",
  },
  paid: {
    label: "Paid",
    className: "bg-green-500/15 text-green-500 border-green-500/30",
  },
  held: {
    label: "Held",
    className: "bg-orange-500/15 text-orange-500 border-orange-500/30",
  },
  reversed: {
    label: "Reversed",
    className: "bg-red-500/15 text-red-500 border-red-500/30",
  },
  clawed_back: {
    label: "Clawed Back",
    className: "bg-red-500/15 text-red-500 border-red-500/30",
  },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_PILL[status] ?? {
    label: status,
    className: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

function TypePill({ type }: { type: string }) {
  const isInitial = type === "initial";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
        isInitial
          ? "bg-[#ff876d]/15 text-[#ff876d] border-[#ff876d]/30"
          : "bg-muted text-muted-foreground border-border"
      }`}
    >
      {isInitial ? "Initial" : "Recurring"}
    </span>
  );
}

function CopyableInvoice({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const short = id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={id}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      <span className="font-mono">{short}</span>
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Filter config
// ---------------------------------------------------------------------------

type FilterKey = "all" | "pending_activation" | "approved" | "scheduled_for_payout" | "paid" | "held_reversed";

interface FilterOption {
  key: FilterKey;
  label: string;
  statusParam?: string;
}

const FILTERS: FilterOption[] = [
  { key: "all", label: "All" },
  { key: "pending_activation", label: "Pending", statusParam: "pending_activation" },
  { key: "approved", label: "Approved", statusParam: "approved" },
  { key: "scheduled_for_payout", label: "Scheduled", statusParam: "scheduled_for_payout" },
  { key: "paid", label: "Paid", statusParam: "paid" },
  { key: "held_reversed", label: "Held / Reversed", statusParam: "held_reversed" },
];

const PAGE_SIZE = 50;

function readInitialFilterFromUrl(): FilterKey {
  if (typeof window === "undefined") return "all";
  const sp = new URLSearchParams(window.location.search);
  const status = sp.get("status");
  if (!status) return "all";
  const match = FILTERS.find((f) => f.statusParam === status);
  return match?.key ?? "all";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AffiliateEarnings() {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<FilterKey>(() => readInitialFilterFromUrl());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentFilter = useMemo(
    () => FILTERS.find((f) => f.key === filter) ?? FILTERS[0],
    [filter],
  );

  useEffect(() => {
    if (!getAffiliateToken()) {
      window.location.href = "/";
      return;
    }
    setLoading(true);
    setError(null);
    affiliatesApi
      .listEarnings({
        limit: PAGE_SIZE,
        offset,
        status: currentFilter.statusParam,
      })
      .then((res) => {
        setCommissions(res.commissions);
        setTotal(res.total);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load earnings");
      })
      .finally(() => setLoading(false));
  }, [offset, currentFilter.statusParam]);

  function handleLogout() {
    clearAffiliateToken();
    window.location.href = "/";
  }

  function handleFilterChange(next: FilterKey) {
    setFilter(next);
    setOffset(0);
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">
              <a href="/dashboard" className="hover:text-foreground transition-colors">← Dashboard</a>
            </p>
            <h1 className="text-lg font-bold text-foreground">Earnings</h1>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Log Out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-5">
        {/* Filter chips */}
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => handleFilterChange(f.key)}
                className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? "bg-[#ff876d]/15 text-[#ff876d] border-[#ff876d]/40"
                    : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-border"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        {loading ? (
          <div className="rounded-xl border border-border bg-card py-12 text-center">
            <p className="text-muted-foreground text-sm">Loading…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : commissions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {filter === "all"
                ? "No commissions yet. When your referred businesses pay, your earnings will show up here."
                : "No commissions in this filter."}
            </p>
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Lead</th>
                    <th className="px-4 py-3 font-medium hidden sm:table-cell">Type</th>
                    <th className="px-4 py-3 font-medium hidden md:table-cell">Period</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium hidden lg:table-cell">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-border last:border-0 hover:bg-background transition-colors"
                    >
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatShortDate(c.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        {c.leadSlug ? (
                          <a
                            href={`/prospects/${c.leadSlug}`}
                            className="text-sm font-medium text-foreground hover:text-[#ff876d] transition-colors"
                          >
                            {c.leadName ?? "—"}
                          </a>
                        ) : (
                          <span className="text-sm font-medium text-foreground">
                            {c.leadName ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <TypePill type={c.type} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell whitespace-nowrap">
                        {formatPeriod(c.periodStart, c.periodEnd)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-foreground whitespace-nowrap">
                        {formatDollars(c.amountCents)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={c.status} />
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {c.stripeInvoiceId ? (
                          <CopyableInvoice id={c.stripeInvoiceId} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pagination */}
        {!loading && !error && total > 0 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {pageStart}–{pageEnd} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={!hasPrev}
                className="px-3 py-1.5 rounded-md border border-border bg-card text-xs font-medium text-foreground hover:border-[#ff876d]/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <button
                type="button"
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={!hasNext}
                className="px-3 py-1.5 rounded-md border border-border bg-card text-xs font-medium text-foreground hover:border-[#ff876d]/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
