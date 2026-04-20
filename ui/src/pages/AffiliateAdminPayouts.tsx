import { useEffect, useMemo, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { ChevronDown, ChevronRight, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  affiliatesAdminApi,
  type AdminPayout,
} from "@/api/affiliates-admin";
import type { PayoutMethod } from "@/api/affiliates";
import { AffiliateAdminTabs } from "@/components/AffiliateAdminTabs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDollars(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatBatchMonth(batchMonth: string): string {
  const [y, m] = batchMonth.split("-").map((v) => parseInt(v, 10));
  if (!y || !m) return batchMonth;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
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

const METHOD_OPTIONS: { value: PayoutMethod; label: string }[] = [
  { value: "manual_ach", label: "ACH Transfer" },
  { value: "manual_paypal", label: "PayPal" },
  { value: "manual_check", label: "Check" },
  { value: "stripe_connect", label: "Stripe Connect" },
];

const STATUS_PILL: Record<string, { label: string; className: string }> = {
  scheduled: { label: "Scheduled", className: "bg-violet-500/15 text-violet-500 border-violet-500/30" },
  sent: { label: "Sent", className: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  paid: { label: "Paid", className: "bg-green-500/15 text-green-500 border-green-500/30" },
  failed: { label: "Failed", className: "bg-red-500/15 text-red-500 border-red-500/30" },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_PILL[status] ?? { label: status, className: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function daysAgo(iso: string | null): number {
  if (!iso) return Infinity;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Dialog state
// ---------------------------------------------------------------------------

interface SendDialogState {
  open: boolean;
  payout: AdminPayout | null;
  externalId: string;
  method: PayoutMethod | "";
  loading: boolean;
  error: string | null;
}

interface PaidDialogState {
  open: boolean;
  payout: AdminPayout | null;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AffiliateAdminPayouts() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [payouts, setPayouts] = useState<AdminPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sentExpanded, setSentExpanded] = useState(true);
  const [paidExpanded, setPaidExpanded] = useState(false);

  const [sendDialog, setSendDialog] = useState<SendDialogState>({
    open: false,
    payout: null,
    externalId: "",
    method: "",
    loading: false,
    error: null,
  });

  const [paidDialog, setPaidDialog] = useState<PaidDialogState>({
    open: false,
    payout: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Affiliates", href: "/affiliates" }, { label: "Payouts" }]);
  }, [setBreadcrumbs]);

  async function refresh() {
    const res = await affiliatesAdminApi.listPayoutsAdmin();
    setPayouts(res.payouts);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load payouts"))
      .finally(() => setLoading(false));
  }, []);

  const scheduled = useMemo(() => payouts.filter((p) => p.status === "scheduled"), [payouts]);
  const sent = useMemo(() => payouts.filter((p) => p.status === "sent"), [payouts]);
  const paid = useMemo(() => payouts.filter((p) => p.status === "paid" || p.status === "failed"), [payouts]);

  // Auto-collapse Sent if all sent > 30 days old
  const sentAllOld = sent.length > 0 && sent.every((p) => daysAgo(p.sentAt) > 30);

  function openSend(payout: AdminPayout) {
    setSendDialog({
      open: true,
      payout,
      externalId: "",
      method: (payout.method as PayoutMethod) || "manual_ach",
      loading: false,
      error: null,
    });
  }

  function closeSend() {
    if (sendDialog.loading) return;
    setSendDialog({ open: false, payout: null, externalId: "", method: "", loading: false, error: null });
  }

  async function handleSendSubmit() {
    if (!sendDialog.payout) return;
    const ext = sendDialog.externalId.trim();
    if (!ext) {
      setSendDialog((d) => ({ ...d, error: "External ID is required" }));
      return;
    }
    setSendDialog((d) => ({ ...d, loading: true, error: null }));
    try {
      await affiliatesAdminApi.markPayoutSent(
        sendDialog.payout.id,
        ext,
        sendDialog.method || undefined,
      );
      await refresh();
      closeSend();
    } catch (err) {
      setSendDialog((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to mark sent",
      }));
    }
  }

  function openPaid(payout: AdminPayout) {
    setPaidDialog({ open: true, payout, loading: false, error: null });
  }

  function closePaid() {
    if (paidDialog.loading) return;
    setPaidDialog({ open: false, payout: null, loading: false, error: null });
  }

  async function handlePaidSubmit() {
    if (!paidDialog.payout) return;
    setPaidDialog((d) => ({ ...d, loading: true, error: null }));
    try {
      await affiliatesAdminApi.markPayoutPaid(paidDialog.payout.id);
      await refresh();
      closePaid();
    } catch (err) {
      setPaidDialog((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to mark paid",
      }));
    }
  }

  if (loading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Payouts</h1>
        <p className="text-sm text-muted-foreground">
          Manage monthly payout batches — mark sent when you initiate transfer, mark paid when confirmed.
        </p>
      </div>

      <AffiliateAdminTabs active="payouts" />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {payouts.length === 0 ? (
        <EmptyState
          icon={Send}
          message="No payout batches yet. The monthly cron will create them automatically."
        />
      ) : (
        <div className="space-y-6">
          {/* Scheduled */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Scheduled</h2>
              <span className="text-xs text-muted-foreground">{scheduled.length}</span>
            </div>
            {scheduled.length === 0 ? (
              <Card className="p-4">
                <p className="text-xs text-muted-foreground">No scheduled payouts.</p>
              </Card>
            ) : (
              <PayoutTable
                payouts={scheduled}
                emptyMsg="No scheduled payouts."
                rowAction={(p) => (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 border-[#ff876d]/40 text-[#ff876d] hover:bg-[#ff876d]/10"
                    onClick={() => openSend(p)}
                  >
                    Mark Sent
                  </Button>
                )}
              />
            )}
          </section>

          {/* Sent */}
          <section className="space-y-2">
            <button
              type="button"
              onClick={() => setSentExpanded((v) => !v)}
              className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-[#ff876d] transition-colors"
            >
              {sentExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span>Sent</span>
              <span className="text-xs text-muted-foreground font-normal">{sent.length}</span>
              {sentAllOld && <span className="text-[10px] text-muted-foreground font-normal">(all &gt;30d old)</span>}
            </button>
            {sentExpanded && (
              sent.length === 0 ? (
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">No sent payouts.</p>
                </Card>
              ) : (
                <PayoutTable
                  payouts={sent}
                  emptyMsg="No sent payouts."
                  rowAction={(p) => (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 border-green-500/40 text-green-600 hover:bg-green-500/10 hover:text-green-700"
                      onClick={() => openPaid(p)}
                    >
                      Mark Paid
                    </Button>
                  )}
                />
              )
            )}
          </section>

          {/* Paid */}
          <section className="space-y-2">
            <button
              type="button"
              onClick={() => setPaidExpanded((v) => !v)}
              className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-[#ff876d] transition-colors"
            >
              {paidExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span>Paid</span>
              <span className="text-xs text-muted-foreground font-normal">{paid.length}</span>
            </button>
            {paidExpanded && (
              paid.length === 0 ? (
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">No paid payouts yet.</p>
                </Card>
              ) : (
                <PayoutTable
                  payouts={paid}
                  emptyMsg="No paid payouts yet."
                  rowAction={() => (
                    <span className="text-xs text-muted-foreground italic">Complete</span>
                  )}
                />
              )
            )}
          </section>
        </div>
      )}

      {/* Mark Sent Dialog */}
      <Dialog open={sendDialog.open} onOpenChange={(open) => { if (!open) closeSend(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark payout as sent</DialogTitle>
            {sendDialog.payout && (
              <DialogDescription>
                <span className="font-semibold text-foreground">
                  {formatDollars(sendDialog.payout.amountCents)}
                </span>
                {" to "}
                <span className="font-semibold text-foreground">
                  {sendDialog.payout.affiliateName}
                </span>
                {" · "}
                {sendDialog.payout.commissionCount} commissions · scheduled{" "}
                {formatShortDate(sendDialog.payout.scheduledFor)}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                External reference ID <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={sendDialog.externalId}
                onChange={(e) => setSendDialog((d) => ({ ...d, externalId: e.target.value }))}
                disabled={sendDialog.loading}
                placeholder="e.g. ACH reference, PayPal txn id"
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Method</label>
              <select
                value={sendDialog.method}
                onChange={(e) => setSendDialog((d) => ({ ...d, method: e.target.value as PayoutMethod }))}
                disabled={sendDialog.loading}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              >
                {METHOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            {sendDialog.error && (
              <p className="text-xs text-destructive">{sendDialog.error}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeSend} disabled={sendDialog.loading}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSendSubmit}
              disabled={sendDialog.loading}
              className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
            >
              {sendDialog.loading ? "Saving…" : "Mark Sent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Paid Dialog */}
      <Dialog open={paidDialog.open} onOpenChange={(open) => { if (!open) closePaid(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm payout received</DialogTitle>
            {paidDialog.payout && (
              <DialogDescription>
                <span className="font-semibold text-foreground">
                  {formatDollars(paidDialog.payout.amountCents)}
                </span>
                {" to "}
                <span className="font-semibold text-foreground">
                  {paidDialog.payout.affiliateName}
                </span>
                {" — confirm paid on "}
                {formatShortDate(new Date().toISOString())}?
              </DialogDescription>
            )}
          </DialogHeader>

          {paidDialog.error && (
            <p className="text-xs text-destructive">{paidDialog.error}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closePaid} disabled={paidDialog.loading}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handlePaidSubmit}
              disabled={paidDialog.loading}
              className="bg-green-500 hover:bg-green-500/90 text-white"
            >
              {paidDialog.loading ? "Saving…" : "Confirm Paid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table sub-component
// ---------------------------------------------------------------------------

function PayoutTable({
  payouts,
  rowAction,
}: {
  payouts: AdminPayout[];
  emptyMsg: string;
  rowAction: (p: AdminPayout) => React.ReactNode;
}) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">Month</th>
              <th className="px-4 py-3 font-medium">Affiliate</th>
              <th className="px-4 py-3 font-medium text-right">Amount</th>
              <th className="px-4 py-3 font-medium hidden sm:table-cell text-right">Commissions</th>
              <th className="px-4 py-3 font-medium hidden md:table-cell">Method</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium hidden lg:table-cell">External</th>
              <th className="px-4 py-3 font-medium hidden lg:table-cell whitespace-nowrap">Sent / Paid</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                <td className="px-4 py-3 whitespace-nowrap">
                  <p className="font-medium text-foreground">{formatBatchMonth(p.batchMonth)}</p>
                  <p className="text-xs text-muted-foreground">
                    Sched. {formatShortDate(p.scheduledFor)}
                  </p>
                </td>
                <td className="px-4 py-3 text-sm font-medium text-foreground">{p.affiliateName}</td>
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
                  {p.paidAt
                    ? `Paid ${formatShortDate(p.paidAt)}`
                    : p.sentAt
                    ? `Sent ${formatShortDate(p.sentAt)}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {rowAction(p)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
