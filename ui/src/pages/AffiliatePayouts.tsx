import { useEffect, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  clearAffiliateToken,
  type Payout,
} from "@/api/affiliates";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDollars(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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

const STATUS_PILL: Record<string, { label: string; className: string }> = {
  scheduled: {
    label: "Scheduled",
    className: "bg-violet-500/15 text-violet-500 border-violet-500/30",
  },
  sent: {
    label: "Sent",
    className: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  },
  paid: {
    label: "Paid",
    className: "bg-green-500/15 text-green-500 border-green-500/30",
  },
  failed: {
    label: "Failed",
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

  function handleLogout() {
    clearAffiliateToken();
    window.location.href = "/";
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">
              <a href="/dashboard" className="hover:text-foreground transition-colors">← Dashboard</a>
            </p>
            <h1 className="text-lg font-bold text-foreground">Payouts</h1>
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
        {loading ? (
          <div className="rounded-xl border border-border bg-card py-12 text-center">
            <p className="text-muted-foreground text-sm">Loading…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : payouts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
            <p className="text-sm text-muted-foreground">
              Your first payout will appear here once you hit $50 in approved commissions.
            </p>
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Month</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                    <th className="px-4 py-3 font-medium hidden sm:table-cell text-right">Commissions</th>
                    <th className="px-4 py-3 font-medium hidden md:table-cell">Method</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium hidden lg:table-cell">Reference</th>
                    <th className="px-4 py-3 font-medium hidden lg:table-cell whitespace-nowrap">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-border last:border-0 hover:bg-background transition-colors"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{formatBatchMonth(p.batchMonth)}</p>
                        <p className="text-xs text-muted-foreground">
                          Scheduled {formatShortDate(p.scheduledFor)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground whitespace-nowrap">
                        {formatDollars(p.amountCents)}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-right text-xs text-muted-foreground">
                        {p.commissionCount}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                        {methodLabel(p.method)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={p.status} />
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {p.externalId ? (
                          <span className="font-mono text-xs text-muted-foreground" title={p.externalId}>
                            {p.externalId.length > 18
                              ? `${p.externalId.slice(0, 10)}…${p.externalId.slice(-4)}`
                              : p.externalId}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {formatShortDate(p.paidAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
