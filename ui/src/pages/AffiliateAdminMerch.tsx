import { useEffect, useMemo, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Shirt } from "lucide-react";
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
  type AdminMerchRequest,
  type MerchRequestStatus,
  type UpdateMerchPayload,
} from "@/api/affiliates-admin";
import { AffiliateAdminTabs } from "@/components/AffiliateAdminTabs";

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncate(text: string, max = 60): string {
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const STATUS_PILL: Record<string, { label: string; className: string }> = {
  requested: { label: "Requested", className: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30" },
  approved: { label: "Approved", className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  shipped: { label: "Shipped", className: "bg-violet-500/15 text-violet-600 border-violet-500/30" },
  delivered: { label: "Delivered", className: "bg-green-500/15 text-green-600 border-green-500/30" },
  cancelled: { label: "Cancelled", className: "bg-red-500/15 text-red-600 border-red-500/30" },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_PILL[status] ?? { label: status, className: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "requested", label: "Requested" },
  { value: "approved", label: "Approved" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

// ---------------------------------------------------------------------------
// Dialog state
// ---------------------------------------------------------------------------

type DialogMode = "ship" | "notes" | "cancel" | "detail" | null;

interface DialogState {
  mode: DialogMode;
  request: AdminMerchRequest | null;
  trackingNumber: string;
  notes: string;
  loading: boolean;
  error: string | null;
}

const INITIAL_DIALOG: DialogState = {
  mode: null,
  request: null,
  trackingNumber: "",
  notes: "",
  loading: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AffiliateAdminMerch() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [requests, setRequests] = useState<AdminMerchRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(INITIAL_DIALOG);

  useEffect(() => {
    setBreadcrumbs([{ label: "Affiliates", href: "/affiliates" }, { label: "Merch" }]);
  }, [setBreadcrumbs]);

  const filters = useMemo(() => status || undefined, [status]);

  async function refresh() {
    const res = await affiliatesAdminApi.listMerchRequests(filters);
    setRequests(res);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    affiliatesAdminApi.listMerchRequests(filters)
      .then((res) => setRequests(res))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load merch requests"))
      .finally(() => setLoading(false));
  }, [filters]);

  async function applyStatus(r: AdminMerchRequest, payload: UpdateMerchPayload) {
    setActionLoading(r.id);
    try {
      await affiliatesAdminApi.updateMerchRequest(r.id, payload);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Update failed");
    } finally {
      setActionLoading(null);
    }
  }

  function openShip(r: AdminMerchRequest) {
    setDialog({
      mode: "ship",
      request: r,
      trackingNumber: r.trackingNumber ?? "",
      notes: r.notes ?? "",
      loading: false,
      error: null,
    });
  }

  function openNotes(r: AdminMerchRequest) {
    setDialog({
      mode: "notes",
      request: r,
      trackingNumber: r.trackingNumber ?? "",
      notes: r.notes ?? "",
      loading: false,
      error: null,
    });
  }

  function openCancel(r: AdminMerchRequest) {
    setDialog({
      mode: "cancel",
      request: r,
      trackingNumber: r.trackingNumber ?? "",
      notes: r.notes ?? "",
      loading: false,
      error: null,
    });
  }

  function openDetail(r: AdminMerchRequest) {
    setDialog({
      mode: "detail",
      request: r,
      trackingNumber: r.trackingNumber ?? "",
      notes: r.notes ?? "",
      loading: false,
      error: null,
    });
  }

  function closeDialog() {
    if (dialog.loading) return;
    setDialog(INITIAL_DIALOG);
  }

  async function handleDialogSubmit() {
    if (!dialog.request || !dialog.mode || dialog.mode === "detail") return;

    if (dialog.mode === "ship") {
      const tracking = dialog.trackingNumber.trim();
      if (!tracking) {
        setDialog((d) => ({ ...d, error: "Tracking number is required" }));
        return;
      }
      setDialog((d) => ({ ...d, loading: true, error: null }));
      try {
        await affiliatesAdminApi.updateMerchRequest(dialog.request.id, {
          status: "shipped",
          trackingNumber: tracking,
          notes: dialog.notes.trim() || undefined,
        });
        await refresh();
        setDialog(INITIAL_DIALOG);
      } catch (err) {
        setDialog((d) => ({
          ...d,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to mark shipped",
        }));
      }
      return;
    }

    if (dialog.mode === "notes") {
      setDialog((d) => ({ ...d, loading: true, error: null }));
      try {
        await affiliatesAdminApi.updateMerchRequest(dialog.request.id, {
          status: dialog.request.status,
          trackingNumber: dialog.trackingNumber.trim() || undefined,
          notes: dialog.notes.trim() || undefined,
        });
        await refresh();
        setDialog(INITIAL_DIALOG);
      } catch (err) {
        setDialog((d) => ({
          ...d,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to save notes",
        }));
      }
      return;
    }

    if (dialog.mode === "cancel") {
      setDialog((d) => ({ ...d, loading: true, error: null }));
      try {
        await affiliatesAdminApi.updateMerchRequest(dialog.request.id, {
          status: "cancelled",
          notes: dialog.notes.trim() || undefined,
        });
        await refresh();
        setDialog(INITIAL_DIALOG);
      } catch (err) {
        setDialog((d) => ({
          ...d,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to cancel",
        }));
      }
      return;
    }
  }

  function renderRowActions(r: AdminMerchRequest) {
    const busy = actionLoading === r.id;
    const s = r.status as MerchRequestStatus;

    return (
      <div className="flex items-center gap-1.5 justify-end flex-wrap">
        {s === "requested" && (
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 border-blue-500/40 text-blue-600 hover:bg-blue-500/10"
            onClick={() => applyStatus(r, { status: "approved" })}
            disabled={busy}
          >
            Approve
          </Button>
        )}
        {(s === "requested" || s === "approved") && (
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 border-violet-500/40 text-violet-600 hover:bg-violet-500/10"
            onClick={() => openShip(r)}
            disabled={busy}
          >
            Mark Shipped
          </Button>
        )}
        {s === "shipped" && (
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 border-green-500/40 text-green-600 hover:bg-green-500/10"
            onClick={() => applyStatus(r, { status: "delivered" })}
            disabled={busy}
          >
            Mark Delivered
          </Button>
        )}
        {(s === "requested" || s === "approved") && (
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 border-red-500/40 text-red-600 hover:bg-red-500/10"
            onClick={() => openCancel(r)}
            disabled={busy}
          >
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7"
          onClick={() => openNotes(r)}
          disabled={busy}
        >
          Notes
        </Button>
      </div>
    );
  }

  if (loading && requests.length === 0) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Merch</h1>
        <p className="text-sm text-muted-foreground">
          Fulfill affiliate starter-pack merch requests. Track shipping and delivery status.
        </p>
      </div>

      <AffiliateAdminTabs active="merch" />

      {/* Filter */}
      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="min-w-[200px]">
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {requests.length === 0 && !loading ? (
        <EmptyState
          icon={Shirt}
          message={status
            ? "No merch requests match the current filter."
            : "No merch requests yet. Affiliates opted-in to promo will show up here."}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Affiliate</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium hidden sm:table-cell">Size</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Address</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b last:border-0 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={(e) => {
                      // Only open detail when clicking the row itself, not action buttons
                      if ((e.target as HTMLElement).closest("button")) return;
                      openDetail(r);
                    }}
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatShortDate(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-foreground">
                      {r.affiliateName}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">{r.itemType}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">
                      {r.sizeOrVariant || "—"}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                      {truncate(r.shippingAddress, 40)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {renderRowActions(r)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Dialog */}
      <Dialog open={dialog.mode !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog.mode === "ship" && "Mark shipped"}
              {dialog.mode === "notes" && "Update notes"}
              {dialog.mode === "cancel" && "Cancel request"}
              {dialog.mode === "detail" && "Merch request detail"}
            </DialogTitle>
            {dialog.request && (
              <DialogDescription>
                <span className="font-semibold text-foreground">{dialog.request.affiliateName}</span>
                {" · "}
                {dialog.request.itemType}
                {dialog.request.sizeOrVariant ? ` (${dialog.request.sizeOrVariant})` : ""}
              </DialogDescription>
            )}
          </DialogHeader>

          {dialog.request && dialog.mode === "detail" && (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Status</p>
                <StatusPill status={dialog.request.status} />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Shipping address</p>
                <p className="text-sm text-foreground whitespace-pre-wrap bg-muted/40 rounded-md border border-border p-3">
                  {dialog.request.shippingAddress || "—"}
                </p>
              </div>
              {dialog.request.trackingNumber && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Tracking</p>
                  <p className="font-mono text-xs text-foreground">{dialog.request.trackingNumber}</p>
                </div>
              )}
              {dialog.request.notes && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{dialog.request.notes}</p>
                </div>
              )}
            </div>
          )}

          {dialog.mode === "ship" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Tracking number <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={dialog.trackingNumber}
                  onChange={(e) => setDialog((d) => ({ ...d, trackingNumber: e.target.value }))}
                  disabled={dialog.loading}
                  placeholder="USPS 9400..."
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Notes (optional)</label>
                <textarea
                  rows={2}
                  value={dialog.notes}
                  onChange={(e) => setDialog((d) => ({ ...d, notes: e.target.value }))}
                  disabled={dialog.loading}
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
                />
              </div>
              {dialog.error && (
                <p className="text-xs text-destructive">{dialog.error}</p>
              )}
            </div>
          )}

          {dialog.mode === "notes" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Tracking number</label>
                <input
                  type="text"
                  value={dialog.trackingNumber}
                  onChange={(e) => setDialog((d) => ({ ...d, trackingNumber: e.target.value }))}
                  disabled={dialog.loading}
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Notes</label>
                <textarea
                  rows={3}
                  value={dialog.notes}
                  onChange={(e) => setDialog((d) => ({ ...d, notes: e.target.value }))}
                  disabled={dialog.loading}
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
                />
              </div>
              {dialog.error && (
                <p className="text-xs text-destructive">{dialog.error}</p>
              )}
            </div>
          )}

          {dialog.mode === "cancel" && (
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                Confirm cancellation of this merch request? Include an optional note explaining why.
              </p>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Notes (optional)</label>
                <textarea
                  rows={2}
                  value={dialog.notes}
                  onChange={(e) => setDialog((d) => ({ ...d, notes: e.target.value }))}
                  disabled={dialog.loading}
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
                />
              </div>
              {dialog.error && (
                <p className="text-xs text-destructive">{dialog.error}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={dialog.loading}>
              {dialog.mode === "detail" ? "Close" : "Cancel"}
            </Button>
            {dialog.mode !== "detail" && (
              <Button
                type="button"
                onClick={handleDialogSubmit}
                disabled={dialog.loading}
                className={
                  dialog.mode === "cancel"
                    ? "bg-red-500 hover:bg-red-500/90 text-white"
                    : "bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
                }
              >
                {dialog.loading ? "Saving…" :
                  dialog.mode === "ship" ? "Mark Shipped" :
                  dialog.mode === "cancel" ? "Confirm Cancel" :
                  "Save"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
