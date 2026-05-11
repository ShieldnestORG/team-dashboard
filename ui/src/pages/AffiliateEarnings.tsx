import { useEffect, useMemo, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  type Commission,
} from "@/api/affiliates";
import { Copy, Check } from "lucide-react";
import { AffiliateNav } from "@/components/AffiliateNav";
import { CDPage, EditorialCard, LabelCaps, Mono } from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO, formatDollars } from "@/lib/cdDesign";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Narrowed palette — no violet/yellow neon. Verdant for success, Rizz Coral
// for active money, Flare for failure.
const STATUS_PILL: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  pending_activation: {
    label: "Pending",
    bg: "rgba(255,107,74,0.10)",
    fg: CD.accent,
    border: "rgba(255,107,74,0.35)",
  },
  approved: {
    label: "Approved",
    bg: "rgba(255,255,255,0.04)",
    fg: CD.ink,
    border: CD.borderStrong,
  },
  scheduled_for_payout: {
    label: "Scheduled",
    bg: "rgba(255,255,255,0.04)",
    fg: CD.ink,
    border: CD.borderStrong,
  },
  paid: {
    label: "Paid",
    bg: "rgba(74,157,124,0.10)",
    fg: CD.success,
    border: "rgba(74,157,124,0.35)",
  },
  held: {
    label: "Held",
    bg: "rgba(217,67,67,0.08)",
    fg: CD.danger,
    border: "rgba(217,67,67,0.30)",
  },
  reversed: {
    label: "Reversed",
    bg: "rgba(217,67,67,0.10)",
    fg: CD.danger,
    border: "rgba(217,67,67,0.35)",
  },
  clawed_back: {
    label: "Clawed Back",
    bg: "rgba(217,67,67,0.10)",
    fg: CD.danger,
    border: "rgba(217,67,67,0.35)",
  },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_PILL[status] ?? {
    label: status,
    bg: "rgba(255,255,255,0.04)",
    fg: CD.muted,
    border: CD.border,
  };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5"
      style={{
        fontFamily: FONT_MONO,
        fontSize: "0.625rem",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        backgroundColor: cfg.bg,
        color: cfg.fg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 4,
      }}
    >
      {cfg.label}
    </span>
  );
}

function TypePill({ type }: { type: string }) {
  const isInitial = type === "initial";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5"
      style={{
        fontFamily: FONT_MONO,
        fontSize: "0.625rem",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        backgroundColor: isInitial ? "rgba(255,107,74,0.10)" : "rgba(255,255,255,0.04)",
        color: isInitial ? CD.accent : CD.muted,
        border: `1px solid ${isInitial ? "rgba(255,107,74,0.35)" : CD.border}`,
        borderRadius: 4,
      }}
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
      className="inline-flex items-center gap-1 transition-colors"
      style={{
        color: CD.muted,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontFamily: FONT_MONO,
        fontSize: "0.75rem",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = CD.ink)}
      onMouseLeave={(e) => (e.currentTarget.style.color = CD.muted)}
    >
      <span>{short}</span>
      {copied ? <Check className="h-3 w-3" style={{ color: CD.success }} /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Filter config
// ---------------------------------------------------------------------------

type FilterKey =
  | "all"
  | "pending_activation"
  | "approved"
  | "scheduled_for_payout"
  | "paid"
  | "held_reversed";

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

  function handleFilterChange(next: FilterKey) {
    setFilter(next);
    setOffset(0);
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  // Quick totals for the header strip.
  const visibleTotalCents = commissions.reduce((sum, c) => sum + (c.amountCents || 0), 0);

  return (
    <CDPage>
      <AffiliateNav active="/earnings" subtitle="Affiliate" title="Earnings" />

      <main className="mx-auto w-full max-w-[1200px] px-6 py-10 space-y-6">
        {/* Filter chips — labelCaps */}
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => handleFilterChange(f.key)}
                className="inline-flex items-center px-3 py-1.5 transition-colors"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "0.6875rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  borderRadius: 9999,
                  backgroundColor: active ? "rgba(255,107,74,0.10)" : "transparent",
                  color: active ? CD.accent : CD.muted,
                  border: `1px solid ${active ? "rgba(255,107,74,0.40)" : CD.border}`,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = CD.ink;
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = CD.muted;
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Page-visible totals strip */}
        {!loading && !error && commissions.length > 0 && (
          <div
            className="flex flex-wrap items-baseline gap-6 px-1 py-3"
            style={{ borderBottom: `1px solid ${CD.border}` }}
          >
            <div>
              <LabelCaps>Showing</LabelCaps>
              <p
                className="mt-0.5"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "1.125rem",
                  fontWeight: 600,
                  color: CD.ink,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {pageStart}–{pageEnd}{" "}
                <span style={{ color: CD.muted, fontWeight: 400 }}>of {total}</span>
              </p>
            </div>
            <div>
              <LabelCaps>Page total</LabelCaps>
              <p
                className="mt-0.5"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "1.125rem",
                  fontWeight: 600,
                  color: CD.accent,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatDollars(visibleTotalCents)}
              </p>
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <EditorialCard className="py-12 text-center">
            <LabelCaps>Loading earnings…</LabelCaps>
          </EditorialCard>
        ) : error ? (
          <div
            className="p-4 text-sm"
            style={{
              backgroundColor: "rgba(217,67,67,0.08)",
              border: `1px solid rgba(217,67,67,0.35)`,
              color: CD.danger,
              borderRadius: 10,
            }}
          >
            {error}
          </div>
        ) : commissions.length === 0 ? (
          <EditorialCard className="py-16 text-center" style={{ borderStyle: "dashed" }}>
            <LabelCaps color={CD.accent}>No commissions</LabelCaps>
            <p className="mt-3 text-sm" style={{ color: CD.muted }}>
              {filter === "all"
                ? "When your referred businesses pay, your earnings will show up here."
                : "No commissions in this filter."}
            </p>
          </EditorialCard>
        ) : (
          <EditorialCard style={{ overflow: "hidden" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${CD.border}`, textAlign: "left" }}>
                    <th className="px-4 py-3"><LabelCaps>Date</LabelCaps></th>
                    <th className="px-4 py-3"><LabelCaps>Lead</LabelCaps></th>
                    <th className="px-4 py-3 hidden sm:table-cell"><LabelCaps>Type</LabelCaps></th>
                    <th className="px-4 py-3 hidden md:table-cell"><LabelCaps>Period</LabelCaps></th>
                    <th className="px-4 py-3 text-right"><LabelCaps>Amount</LabelCaps></th>
                    <th className="px-4 py-3"><LabelCaps>Status</LabelCaps></th>
                    <th className="px-4 py-3 hidden lg:table-cell"><LabelCaps>Invoice</LabelCaps></th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr
                      key={c.id}
                      style={{ borderBottom: `1px solid ${CD.border}` }}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                          {formatShortDate(c.createdAt)}
                        </Mono>
                      </td>
                      <td className="px-4 py-3">
                        {c.leadSlug ? (
                          <a
                            href={`/prospects/${c.leadSlug}`}
                            className="text-sm font-medium transition-colors"
                            style={{ color: CD.ink }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = CD.accent)}
                            onMouseLeave={(e) => (e.currentTarget.style.color = CD.ink)}
                          >
                            {c.leadName ?? "—"}
                          </a>
                        ) : (
                          <span className="text-sm font-medium" style={{ color: CD.ink }}>
                            {c.leadName ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <TypePill type={c.type} />
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell whitespace-nowrap">
                        <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                          {formatPeriod(c.periodStart, c.periodEnd)}
                        </Mono>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Mono style={{ color: CD.ink, fontWeight: 600 }}>
                          {formatDollars(c.amountCents)}
                        </Mono>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={c.status} />
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {c.stripeInvoiceId ? (
                          <CopyableInvoice id={c.stripeInvoiceId} />
                        ) : (
                          <span style={{ color: CD.muted, fontSize: "0.75rem" }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </EditorialCard>
        )}

        {/* Pagination */}
        {!loading && !error && total > 0 && (
          <div className="flex items-center justify-between">
            <LabelCaps>
              {pageStart}–{pageEnd} of {total}
            </LabelCaps>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={!hasPrev}
                className="px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "0.6875rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  backgroundColor: "transparent",
                  color: CD.ink,
                  border: `1px solid ${CD.border}`,
                  borderRadius: 8,
                  cursor: hasPrev ? "pointer" : "not-allowed",
                }}
              >
                ← Prev
              </button>
              <button
                type="button"
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={!hasNext}
                className="px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "0.6875rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  backgroundColor: "transparent",
                  color: CD.ink,
                  border: `1px solid ${CD.border}`,
                  borderRadius: 8,
                  cursor: hasNext ? "pointer" : "not-allowed",
                }}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </main>
    </CDPage>
  );
}
