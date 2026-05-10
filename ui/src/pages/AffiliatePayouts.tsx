import { useEffect, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  type Payout,
} from "@/api/affiliates";
import { AffiliateNav } from "@/components/AffiliateNav";
import { CDPage, EditorialCard, LabelCaps, Mono } from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO, formatDollars } from "@/lib/cdDesign";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBatchMonth(batchMonth: string): string {
  // 'YYYY-MM'
  const [y, m] = batchMonth.split("-").map((v) => parseInt(v, 10));
  if (!y || !m) return batchMonth;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const METHOD_LABELS: Record<string, string> = {
  stripe_connect: "Stripe Connect",
  manual_ach: "ACH Transfer",
  manual_paypal: "PayPal",
  manual_check: "Check",
};

function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

const STATUS_PILL: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  scheduled: {
    label: "Scheduled",
    bg: "rgba(255,255,255,0.04)",
    fg: CD.ink,
    border: CD.borderStrong,
  },
  sent: {
    label: "Sent",
    bg: "rgba(255,107,74,0.10)",
    fg: CD.accent,
    border: "rgba(255,107,74,0.35)",
  },
  paid: {
    label: "Paid",
    bg: "rgba(74,157,124,0.10)",
    fg: CD.success,
    border: "rgba(74,157,124,0.35)",
  },
  failed: {
    label: "Failed",
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AffiliatePayouts() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
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
      .listPayouts()
      .then((res) => setPayouts(res.payouts))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load payouts"))
      .finally(() => setLoading(false));
  }, []);

  const totalPaidCents = payouts
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + (p.amountCents || 0), 0);

  return (
    <CDPage>
      <AffiliateNav active="/payouts" subtitle="Affiliate" title="Payouts" />

      <main className="mx-auto w-full max-w-[1200px] px-6 py-10 space-y-6">
        {/* Lifetime paid header card */}
        {!loading && !error && payouts.length > 0 && (
          <div
            className="flex flex-wrap items-baseline gap-8 px-1 py-3"
            style={{ borderBottom: `1px solid ${CD.border}` }}
          >
            <div>
              <LabelCaps>Lifetime paid</LabelCaps>
              <p
                className="mt-1"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "clamp(1.5rem,3vw,2.25rem)",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: CD.success,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.05,
                }}
              >
                {formatDollars(totalPaidCents)}
              </p>
            </div>
            <div>
              <LabelCaps>Payouts</LabelCaps>
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
                {payouts.length}
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <EditorialCard className="py-12 text-center">
            <LabelCaps>Loading payouts…</LabelCaps>
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
        ) : payouts.length === 0 ? (
          <EditorialCard className="py-16 text-center" style={{ borderStyle: "dashed" }}>
            <LabelCaps color={CD.accent}>No payouts yet</LabelCaps>
            <p className="mt-3 text-sm" style={{ color: CD.muted }}>
              Your first payout will appear here once you hit $50 in approved commissions.
            </p>
          </EditorialCard>
        ) : (
          <EditorialCard style={{ overflow: "hidden" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${CD.border}`, textAlign: "left" }}>
                    <th className="px-4 py-3"><LabelCaps>Month</LabelCaps></th>
                    <th className="px-4 py-3 text-right"><LabelCaps>Amount</LabelCaps></th>
                    <th className="px-4 py-3 hidden sm:table-cell text-right"><LabelCaps>Commissions</LabelCaps></th>
                    <th className="px-4 py-3 hidden md:table-cell"><LabelCaps>Method</LabelCaps></th>
                    <th className="px-4 py-3"><LabelCaps>Status</LabelCaps></th>
                    <th className="px-4 py-3 hidden lg:table-cell"><LabelCaps>Reference</LabelCaps></th>
                    <th className="px-4 py-3 hidden lg:table-cell whitespace-nowrap"><LabelCaps>Paid</LabelCaps></th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr
                      key={p.id}
                      style={{ borderBottom: `1px solid ${CD.border}` }}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium" style={{ color: CD.ink }}>
                          {formatBatchMonth(p.batchMonth)}
                        </p>
                        <Mono style={{ color: CD.muted, fontSize: "0.6875rem" }}>
                          Scheduled {formatShortDate(p.scheduledFor)}
                        </Mono>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Mono style={{ color: CD.ink, fontWeight: 600 }}>
                          {formatDollars(p.amountCents)}
                        </Mono>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-right">
                        <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                          {p.commissionCount}
                        </Mono>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span style={{ color: CD.muted, fontSize: "0.75rem" }}>
                          {methodLabel(p.method)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={p.status} />
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {p.externalId ? (
                          <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                            <span title={p.externalId}>
                              {p.externalId.length > 18
                                ? `${p.externalId.slice(0, 10)}…${p.externalId.slice(-4)}`
                                : p.externalId}
                            </span>
                          </Mono>
                        ) : (
                          <span style={{ color: CD.muted, fontSize: "0.75rem" }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell whitespace-nowrap">
                        <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                          {formatShortDate(p.paidAt)}
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
