import { useEffect, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Megaphone, Plus } from "lucide-react";
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
  type AdminCampaign,
  type CampaignPayload,
  type CampaignStatus,
} from "@/api/affiliates-admin";
import { AffiliateAdminTabs } from "@/components/AffiliateAdminTabs";

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

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const STATUS_PILL: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground border-border" },
  live: { label: "Live", className: "bg-green-500/15 text-green-600 border-green-500/30" },
  ended: { label: "Ended", className: "bg-slate-500/15 text-slate-600 border-slate-500/30" },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_PILL[status] ?? { label: status, className: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface FormDialogState {
  open: boolean;
  mode: "create" | "edit";
  editingId: string | null;
  name: string;
  hashtag: string;
  startAt: string;
  endAt: string;
  giveawayPrize: string;
  status: CampaignStatus;
  loading: boolean;
  error: string | null;
}

const INITIAL_FORM: FormDialogState = {
  open: false,
  mode: "create",
  editingId: null,
  name: "",
  hashtag: "",
  startAt: "",
  endAt: "",
  giveawayPrize: "",
  status: "draft",
  loading: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AffiliateAdminCampaigns() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [campaigns, setCampaigns] = useState<AdminCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [form, setForm] = useState<FormDialogState>(INITIAL_FORM);

  useEffect(() => {
    setBreadcrumbs([{ label: "Affiliates", href: "/affiliates" }, { label: "Campaigns" }]);
  }, [setBreadcrumbs]);

  async function refresh() {
    const res = await affiliatesAdminApi.listCampaigns();
    setCampaigns(res);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load campaigns"))
      .finally(() => setLoading(false));
  }, []);

  function openNew() {
    setForm({ ...INITIAL_FORM, open: true, mode: "create" });
  }

  function openEdit(c: AdminCampaign) {
    setForm({
      open: true,
      mode: "edit",
      editingId: c.id,
      name: c.name,
      hashtag: c.hashtag,
      startAt: toDateInput(c.startAt),
      endAt: toDateInput(c.endAt),
      giveawayPrize: c.giveawayPrize,
      status: (c.status as CampaignStatus) ?? "draft",
      loading: false,
      error: null,
    });
  }

  function closeForm() {
    if (form.loading) return;
    setForm(INITIAL_FORM);
  }

  async function handleFormSubmit() {
    const name = form.name.trim();
    const hashtag = form.hashtag.trim();
    const startAt = form.startAt.trim();
    const endAt = form.endAt.trim();
    const giveawayPrize = form.giveawayPrize.trim();

    if (!name || !hashtag || !startAt || !endAt) {
      setForm((f) => ({ ...f, error: "Name, hashtag, and dates are required" }));
      return;
    }

    const payload: CampaignPayload = {
      name,
      hashtag,
      startAt,
      endAt,
      giveawayPrize,
      status: form.status,
    };

    setForm((f) => ({ ...f, loading: true, error: null }));
    try {
      if (form.mode === "create") {
        await affiliatesAdminApi.createCampaign(payload);
      } else if (form.editingId) {
        await affiliatesAdminApi.updateCampaign(form.editingId, payload);
      }
      await refresh();
      setForm(INITIAL_FORM);
    } catch (err) {
      setForm((f) => ({
        ...f,
        loading: false,
        error: err instanceof Error ? err.message : "Save failed",
      }));
    }
  }

  async function handleTransition(c: AdminCampaign, nextStatus: CampaignStatus) {
    setActionLoading(c.id);
    try {
      await affiliatesAdminApi.updateCampaign(c.id, { status: nextStatus });
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Status change failed");
    } finally {
      setActionLoading(null);
    }
  }

  if (loading && campaigns.length === 0) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Plan hashtag promos and giveaway prizes tied to affiliate engagement.
          </p>
        </div>
        <Button
          type="button"
          onClick={openNew}
          className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New Campaign
        </Button>
      </div>

      <AffiliateAdminTabs active="campaigns" />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {campaigns.length === 0 && !loading ? (
        <EmptyState
          icon={Megaphone}
          message="No campaigns yet. Create one to kick off a giveaway."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Hashtag</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Start</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">End</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Prize</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const busy = actionLoading === c.id;
                  return (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-foreground">{c.name}</td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{c.hashtag}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {formatShortDate(c.startAt)}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {formatShortDate(c.endAt)}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-foreground">
                        {c.giveawayPrize || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={c.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7"
                            onClick={() => openEdit(c)}
                            disabled={busy}
                          >
                            Edit
                          </Button>
                          {c.status === "draft" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7 border-green-500/40 text-green-600 hover:bg-green-500/10"
                              onClick={() => handleTransition(c, "live")}
                              disabled={busy}
                            >
                              Go Live
                            </Button>
                          )}
                          {c.status === "live" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7 border-slate-500/40 text-slate-600 hover:bg-slate-500/10"
                              onClick={() => handleTransition(c, "ended")}
                              disabled={busy}
                            >
                              End
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Form Dialog */}
      <Dialog open={form.open} onOpenChange={(open) => { if (!open) closeForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.mode === "create" ? "New campaign" : "Edit campaign"}</DialogTitle>
            <DialogDescription>
              Campaigns define the hashtag + timeframe affiliates can participate in.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                disabled={form.loading}
                placeholder="Spring Referral Blitz"
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Hashtag <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={form.hashtag}
                onChange={(e) => setForm((f) => ({ ...f, hashtag: e.target.value }))}
                disabled={form.loading}
                placeholder="#CoherenceReferral"
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Start <span className="text-destructive">*</span>
                </label>
                <input
                  type="date"
                  value={form.startAt}
                  onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
                  disabled={form.loading}
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  End <span className="text-destructive">*</span>
                </label>
                <input
                  type="date"
                  value={form.endAt}
                  onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
                  disabled={form.loading}
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Giveaway prize
              </label>
              <input
                type="text"
                value={form.giveawayPrize}
                onChange={(e) => setForm((f) => ({ ...f, giveawayPrize: e.target.value }))}
                disabled={form.loading}
                placeholder="$500 store credit"
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CampaignStatus }))}
                disabled={form.loading}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              >
                <option value="draft">Draft</option>
                <option value="live">Live</option>
                <option value="ended">Ended</option>
              </select>
            </div>

            {form.error && (
              <p className="text-xs text-destructive">{form.error}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeForm} disabled={form.loading}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleFormSubmit}
              disabled={form.loading}
              className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
            >
              {form.loading ? "Saving…" : form.mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
