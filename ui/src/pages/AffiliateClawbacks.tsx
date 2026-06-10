import { useEffect, useMemo, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  type Clawback,
} from "@/api/affiliates";
import { AffiliateNav } from "@/components/AffiliateNav";
import { CDPage, EditorialCard, LabelCaps, Mono } from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO, formatDollars } from "@/lib/cdDesign";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Plain-language reason labels — no internal enum jargon for affiliates.
const REASON_LABELS: Record<string, string> = {
  stripe_refund: "Client refund",
  compliance_violation: "Policy review",
  admin_manual: "Manual adjustment",
};

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

// Narrowed palette — Verdant for cleared, Rizz Coral for actively recovering,
// Flare for open. `hint` is the friendly tooltip shown on each pill.
const STATUS_PILL: Record<string, { label: string; bg: string; fg: string; border: string; hint: string }> = {
  open: {
    label: "Open",
    bg: "rgba(217,67,67,0.08)",
    fg: CD.danger,
    border: "rgba(217,67,67,0.30)",
    hint: "Not yet recovered. We'll net it against your next payout — nothing for you to do.",
  },
  recovering: {
    label: "Recovering",
    bg: "rgba(255,107,74,0.10)",
    fg: CD.accent,
    border: "rgba(255,107,74,0.35)",
    hint: "Partly recovered from your payouts. The rest comes out of future payouts until it's clear.",
  },
  recovered: {
    label: "Recovered",
    bg: "rgba(74,157,124,0.10)",
    fg: CD.success,
    border: "rgba(74,157,124,0.35)",
    hint: "Fully cleared. This one is settled.",
  },
  written_off: {
    label: "Cleared",
    bg: "rgba(255,255,255,0.04)",
    fg: CD.muted,
    border: CD.border,
    hint: "We closed this out on our end — you owe nothing.",
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AffiliateClawbacks() {
  const [clawbacks, setClawbacks] = useState<Clawback[]>([]);
  const [balanceCents, setBalanceCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getAffiliateToken()) {
      window.location.href = "/";
      return;
    }
    setLoading(true);
    setError(null);
    affiliatesApi
      .listClawbacks()
      .then((res) => {
        setClawbacks(res.clawbacks);
        setBalanceCents(res.balanceCents);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load clawbacks"))
      .finally(() => setLoading(false));
  }, []);

  // Prefer the server's netted balance; fall back to summing open/recovering rows.
  const outstandingCents = useMemo(() => {
    if (balanceCents) return balanceCents;
    return clawbacks
      .filter((c) => c.status === "open" || c.status === "recovering")
      .reduce((sum, c) => sum + (c.remainingCents || 0), 0);
  }, [balanceCents, clawbacks]);

  return (
    <CDPage>
      <AffiliateNav active="/clawbacks" subtitle="Affiliate" title="Clawbacks" />

      <main className="mx-auto w-full max-w-[1200px] px-6 py-10 space-y-6">
        {/* Calm, non-alarming explainer */}
        <EditorialCard className="p-5">
          <LabelCaps color={CD.accent}>What clawbacks are</LabelCaps>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: CD.muted }}>
            A clawback happens when a deal you earned on later refunds. We never invoice you — we
            simply recover it from your future payouts until it's cleared. Most affiliates never
            see one, and there's nothing you need to do here.
          </p>
        </EditorialCard>

        {/* Outstanding balance — prominent but calm */}
        {!loading && !error && (
          <div
            className="flex flex-wrap items-baseline gap-8 px-1 py-3"
            style={{ borderBottom: `1px solid ${CD.border}` }}
          >
            <div>
              <LabelCaps>Outstanding balance</LabelCaps>
              <p
                className="mt-1"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "clamp(1.5rem,3vw,2.25rem)",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: outstandingCents > 0 ? CD.ink : CD.success,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.05,
                }}
              >
                {formatDollars(outstandingCents)}
              </p>
              <p className="mt-1 text-xs" style={{ color: CD.muted }}>
                {outstandingCents > 0
                  ? "Recovered from your future payouts — never billed to you."
                  : "Nothing outstanding. You're all clear."}
              </p>
            </div>
            {clawbacks.length > 0 && (
              <div>
                <LabelCaps>Obligations</LabelCaps>
                <p
                  className="mt-1"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "1.25rem",
                    fontWeight: 600,
                    color: CD.ink,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {clawbacks.length}
                </p>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <EditorialCard className="py-12 text-center">
            <LabelCaps>Loading clawbacks…</LabelCaps>
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
        ) : clawbacks.length === 0 ? (
          <EditorialCard className="py-16 text-center" style={{ borderStyle: "dashed" }}>
            <LabelCaps color={CD.success}>All clear</LabelCaps>
            <p className="mt-3 text-sm" style={{ color: CD.muted }}>
              No clawbacks — all your earnings are yours to keep.
            </p>
          </EditorialCard>
        ) : (
          <EditorialCard style={{ overflow: "hidden" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${CD.border}`, textAlign: "left" }}>
                    <th className="px-4 py-3"><LabelCaps>Date</LabelCaps></th>
                    <th className="px-4 py-3 hidden sm:table-cell"><LabelCaps>Lead</LabelCaps></th>
                    <th className="px-4 py-3 hidden md:table-cell"><LabelCaps>Reason</LabelCaps></th>
                    <th className="px-4 py-3 text-right"><LabelCaps>Original</LabelCaps></th>
                    <th className="px-4 py-3 text-right hidden sm:table-cell"><LabelCaps>Recovered</LabelCaps></th>
                    <th className="px-4 py-3 text-right"><LabelCaps>Remaining</LabelCaps></th>
                    <th className="px-4 py-3"><LabelCaps>Status</LabelCaps></th>
                    <th className="px-4 py-3 hidden lg:table-cell whitespace-nowrap"><LabelCaps>Window ends</LabelCaps></th>
                  </tr>
                </thead>
                <tbody>
                  {clawbacks.map((c) => (
                    <tr key={c.id} style={{ borderBottom: `1px solid ${CD.border}` }}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                          {formatShortDate(c.createdAt)}
                        </Mono>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-sm font-medium" style={{ color: CD.ink }}>
                          {c.leadName ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span style={{ color: CD.muted, fontSize: "0.75rem" }}>
                          {reasonLabel(c.reason)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Mono style={{ color: CD.muted }}>
                          {formatDollars(c.originAmountCents)}
                        </Mono>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap hidden sm:table-cell">
                        <Mono style={{ color: CD.success }}>
                          {formatDollars(c.recoveredCents)}
                        </Mono>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Mono style={{ color: CD.ink, fontWeight: 600 }}>
                          {formatDollars(c.remainingCents)}
                        </Mono>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={c.status} />
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell whitespace-nowrap">
                        <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                          {formatShortDate(c.windowExpiresAt)}
                        </Mono>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </EditorialCard>
        )}
      </main>
    </CDPage>
  );
}
