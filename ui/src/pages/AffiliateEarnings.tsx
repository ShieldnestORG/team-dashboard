import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  type Commission,
} from "@/api/affiliates";
import { Copy, Check, ChevronDown } from "lucide-react";
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
// for active money, Flare for failure. `hint` is the plain-language tooltip
// shown on the pill so affiliates know what each status means at a glance.
const STATUS_PILL: Record<string, { label: string; bg: string; fg: string; border: string; hint: string }> = {
  pending_activation: {
    label: "Pending",
    bg: "rgba(255,107,74,0.10)",
    fg: CD.accent,
    border: "rgba(255,107,74,0.35)",
    hint: "Earned, but not cleared yet — activates once your client completes their first paid month.",
  },
  approved: {
    label: "Approved",
    bg: "rgba(255,255,255,0.04)",
    fg: CD.ink,
    border: CD.borderStrong,
    hint: "Cleared the refund window and waiting to be queued into a payout batch.",
  },
  scheduled_for_payout: {
    label: "Scheduled",
    bg: "rgba(255,255,255,0.04)",
    fg: CD.ink,
    border: CD.borderStrong,
    hint: "Queued in an upcoming payout batch — you'll see it on your Payouts page soon.",
  },
  paid: {
    label: "Paid",
    bg: "rgba(74,157,124,0.10)",
    fg: CD.success,
    border: "rgba(74,157,124,0.35)",
    hint: "Sent to you. This one's yours.",
  },
  held: {
    label: "Held",
    bg: "rgba(217,67,67,0.08)",
    fg: CD.danger,
    border: "rgba(217,67,67,0.30)",
    hint: "Held to protect against chargebacks; releases on the date shown.",
  },
  reversed: {
    label: "Reversed",
    bg: "rgba(217,67,67,0.10)",
    fg: CD.danger,
    border: "rgba(217,67,67,0.35)",
    hint: "The deal refunded or canceled before payout, so this commission was undone.",
  },
  clawed_back: {
    label: "Clawed Back",
    bg: "rgba(217,67,67,0.10)",
    fg: CD.danger,
    border: "rgba(217,67,67,0.35)",
    hint: "A refund happened after you were paid; we recover it from future payouts. See your Clawbacks page.",
  },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_PILL[status] ?? {
    label: status,
    bg: "rgba(255,255,255,0.04)",
    fg: CD.muted,
    border: CD.border,
    hint: "",
  };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5"
      title={cfg.hint || undefined}
      style={{
        fontFamily: FONT_MONO,
        fontSize: "0.625rem",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        backgroundColor: cfg.bg,
        color: cfg.fg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 4,
        cursor: cfg.hint ? "help" : "default",
      }}
    >
      {cfg.label}
    </span>
  );
}

// Compact date for inline "releases …" hints next to a Held pill.
function formatReleaseDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// "How your earnings move" — plain-language lifecycle explainer.
// Collapsible so it stays out of the way once an affiliate knows the ropes.
// ---------------------------------------------------------------------------

const LIFECYCLE_STEPS: { label: string; body: string }[] = [
  {
    label: "Pending",
    body: "You earned it, but it's not cleared yet. It activates once your client completes their first paid month.",
  },
  {
    label: "Approved",
    body: "It cleared the refund window. Now it's just waiting to be queued into a payout batch.",
  },
  {
    label: "Scheduled",
    body: "It's lined up in an upcoming payout batch and on its way to you.",
  },
  {
    label: "Paid",
    body: "It's been sent. This one's yours to keep.",
  },
];

const LIFECYCLE_EXCEPTIONS: { label: string; body: React.ReactNode }[] = [
  {
    label: "Held",
    body: "Temporarily paused to protect against chargebacks. It releases on the date shown next to it — then it keeps moving.",
  },
  {
    label: "Reversed",
    body: "The deal refunded or canceled before payout, so this commission was undone. Nothing is owed by you.",
  },
  {
    label: "Clawed Back",
    body: (
      <>
        A refund happened after you were already paid. We never invoice you — we simply recover it from your future
        payouts.{" "}
        <a
          href="/clawbacks"
          style={{ color: CD.accent, textDecoration: "underline", textUnderlineOffset: "2px" }}
        >
          See your clawbacks
        </a>
        .
      </>
    ),
  },
];

function EarningsExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <EditorialCard style={{ overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors"
        style={{ background: "transparent", border: "none", cursor: "pointer" }}
      >
        <div className="min-w-0">
          <LabelCaps color={CD.accent}>How your earnings move</LabelCaps>
          <p className="mt-1 text-sm" style={{ color: CD.muted }}>
            From the moment you earn to the day it lands in your account.
          </p>
        </div>
        <ChevronDown
          className="h-4 w-4 flex-shrink-0 transition-transform"
          style={{ color: CD.muted, transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div className="px-4 pb-5" style={{ borderTop: `1px solid ${CD.border}` }}>
          {/* Happy path: Pending → Approved → Scheduled → Paid */}
          <div className="mt-4 space-y-3">
            {LIFECYCLE_STEPS.map((s, i) => (
              <div key={s.label} className="flex gap-3">
                <div className="flex flex-shrink-0 flex-col items-center" style={{ width: 18 }}>
                  <Mono
                    style={{
                      color: CD.accent,
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      lineHeight: "1.25rem",
                    }}
                  >
                    {i + 1}
                  </Mono>
                  {i < LIFECYCLE_STEPS.length - 1 && (
                    <span style={{ flex: 1, width: 1, backgroundColor: CD.border, marginTop: 2 }} />
                  )}
                </div>
                <div className="pb-1">
                  <span className="text-sm font-semibold" style={{ color: CD.ink }}>
                    {s.label}
                  </span>
                  <p className="mt-0.5 text-sm" style={{ color: CD.muted }}>
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Things that can interrupt the path */}
          <div
            className="mt-5 pt-4 space-y-3"
            style={{ borderTop: `1px solid ${CD.border}` }}
          >
            <LabelCaps>If something changes</LabelCaps>
            {LIFECYCLE_EXCEPTIONS.map((e) => (
              <div key={e.label}>
                <span className="text-sm font-semibold" style={{ color: CD.ink }}>
                  {e.label}
                </span>
                <p className="mt-0.5 text-sm" style={{ color: CD.muted }}>
                  {e.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </EditorialCard>
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
        {/* Plain-language lifecycle explainer */}
        <EarningsExplainer />

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
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusPill status={c.status} />
                        {c.status === "held" && c.holdExpiresAt && (
                          <Mono
                            className="mt-1 block"
                            style={{ color: CD.muted, fontSize: "0.625rem" }}
                          >
                            releases {formatReleaseDate(c.holdExpiresAt)}
                          </Mono>
                        )}
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
