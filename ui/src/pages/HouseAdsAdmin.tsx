import { useEffect, useRef, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Image as ImageIcon, Plus, Upload, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { houseAdsApi, type HouseAd, type HouseAdPayload } from "@/api/house-ads";
import { assetsApi } from "@/api/assets";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLOT_OPTIONS = [
  "header",
  "in-article-1",
  "in-article-2",
  "sidebar",
  "footer",
] as const;

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

function ctr(impressions: number, clicks: number): string {
  if (!impressions) return "—";
  return `${((clicks / impressions) * 100).toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface FormState {
  open: boolean;
  mode: "create" | "edit";
  editingId: string | null;
  title: string;
  slot: string;
  clickUrl: string;
  imageAlt: string;
  imageAssetId: string;
  imagePreviewUrl: string;
  weight: number;
  active: boolean;
  startsAt: string;
  endsAt: string;
  uploading: boolean;
  loading: boolean;
  error: string | null;
}

const INITIAL_FORM: FormState = {
  open: false,
  mode: "create",
  editingId: null,
  title: "",
  slot: "header",
  clickUrl: "",
  imageAlt: "",
  imageAssetId: "",
  imagePreviewUrl: "",
  weight: 1,
  active: true,
  startsAt: "",
  endsAt: "",
  uploading: false,
  loading: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function HouseAdsAdmin() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId } = useCompany();
  const [ads, setAds] = useState<HouseAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "House Ads" }]);
  }, [setBreadcrumbs]);

  async function refresh() {
    const res = await houseAdsApi.list();
    setAds(res.ads);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load ads"))
      .finally(() => setLoading(false));
  }, []);

  function openNew() {
    setForm({ ...INITIAL_FORM, open: true, mode: "create" });
  }

  function openEdit(ad: HouseAd) {
    setForm({
      open: true,
      mode: "edit",
      editingId: ad.id,
      title: ad.title,
      slot: ad.slot,
      clickUrl: ad.clickUrl,
      imageAlt: ad.imageAlt,
      imageAssetId: ad.imageAssetId,
      imagePreviewUrl: `/api/house-ads/${ad.id}/image`,
      weight: ad.weight,
      active: ad.active,
      startsAt: toDateInput(ad.startsAt),
      endsAt: toDateInput(ad.endsAt),
      uploading: false,
      loading: false,
      error: null,
    });
  }

  function closeForm() {
    if (form.loading || form.uploading) return;
    setForm(INITIAL_FORM);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!selectedCompanyId) {
      setForm((f) => ({ ...f, error: "No company selected" }));
      return;
    }
    setForm((f) => ({ ...f, uploading: true, error: null }));
    try {
      const asset = await assetsApi.uploadImage(selectedCompanyId, file, "house-ads");
      setForm((f) => ({
        ...f,
        uploading: false,
        imageAssetId: asset.assetId,
        imagePreviewUrl: asset.contentPath,
      }));
    } catch (err) {
      setForm((f) => ({
        ...f,
        uploading: false,
        error: err instanceof Error ? err.message : "Image upload failed",
      }));
    }
  }

  async function handleFormSubmit() {
    const title = form.title.trim();
    const clickUrl = form.clickUrl.trim();
    const slot = form.slot.trim();
    if (!title || !clickUrl || !slot || !form.imageAssetId) {
      setForm((f) => ({
        ...f,
        error: "Title, click URL, slot, and image are required",
      }));
      return;
    }

    const payload: HouseAdPayload = {
      title,
      imageAssetId: form.imageAssetId,
      imageAlt: form.imageAlt,
      clickUrl,
      slot,
      weight: form.weight,
      active: form.active,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
    };

    setForm((f) => ({ ...f, loading: true, error: null }));
    try {
      if (form.mode === "create") {
        await houseAdsApi.create(payload);
      } else if (form.editingId) {
        await houseAdsApi.update(form.editingId, payload);
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

  async function handleDelete(ad: HouseAd) {
    if (!confirm(`Delete "${ad.title}"?`)) return;
    setBusyId(ad.id);
    try {
      await houseAdsApi.remove(ad.id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(ad: HouseAd) {
    setBusyId(ad.id);
    try {
      await houseAdsApi.update(ad.id, { active: !ad.active });
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && ads.length === 0) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">House Ads</h1>
          <p className="text-sm text-muted-foreground">
            In-house creatives served to <code className="text-xs">*.coherencedaddy.com</code> slots
            while AdSense is pending (and as a permanent fallback).
          </p>
        </div>
        <Button
          type="button"
          onClick={openNew}
          className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New Ad
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {ads.length === 0 && !loading ? (
        <EmptyState
          icon={ImageIcon}
          message="No house ads yet. Create one to start filling ad slots."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Slot</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Weight</th>
                  <th className="px-4 py-3 font-medium">Active</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Window</th>
                  <th className="px-4 py-3 font-medium text-right">Impr.</th>
                  <th className="px-4 py-3 font-medium text-right">Clicks</th>
                  <th className="px-4 py-3 font-medium text-right hidden md:table-cell">CTR</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ads.map((ad) => {
                  const busy = busyId === ad.id;
                  return (
                    <tr
                      key={ad.id}
                      className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <img
                            src={`/api/house-ads/${ad.id}/image`}
                            alt=""
                            className="h-8 w-12 object-cover rounded border border-border"
                          />
                          <span>{ad.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                        {ad.slot}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                        {ad.weight}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(ad)}
                          disabled={busy}
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                            ad.active
                              ? "bg-green-500/15 text-green-600 border-green-500/30"
                              : "bg-muted text-muted-foreground border-border"
                          }`}
                        >
                          {ad.active ? "Active" : "Paused"}
                        </button>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {formatShortDate(ad.startsAt)} → {formatShortDate(ad.endsAt)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                        {ad.impressions}
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                        {ad.clicks}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-right text-xs tabular-nums text-muted-foreground">
                        {ctr(ad.impressions, ad.clicks)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7"
                            onClick={() => openEdit(ad)}
                            disabled={busy}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 text-destructive"
                            onClick={() => handleDelete(ad)}
                            disabled={busy}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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

      <Dialog open={form.open} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{form.mode === "create" ? "New house ad" : "Edit house ad"}</DialogTitle>
            <DialogDescription>
              Upload a creative and target it at a slot. Served to any{" "}
              <code>*.coherencedaddy.com</code> subdomain.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title (admin label)</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="CreditScore upsell — hero"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Slot</label>
                <select
                  value={form.slot}
                  onChange={(e) => setForm((f) => ({ ...f, slot: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {SLOT_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Weight</label>
                <input
                  type="number"
                  min={1}
                  value={form.weight}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, weight: Math.max(1, Number(e.target.value) || 1) }))
                  }
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Click URL</label>
              <input
                type="url"
                value={form.clickUrl}
                onChange={(e) => setForm((f) => ({ ...f, clickUrl: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="https://coherencedaddy.com/creditscore"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Image alt text</label>
              <input
                type="text"
                value={form.imageAlt}
                onChange={(e) => setForm((f) => ({ ...f, imageAlt: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Run a free SEO audit in 60 seconds"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Creative image</label>
              <div className="mt-1 flex items-center gap-3">
                {form.imagePreviewUrl && (
                  <img
                    src={form.imagePreviewUrl}
                    alt=""
                    className="h-14 w-24 object-cover rounded border border-border"
                  />
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={form.uploading}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  {form.uploading
                    ? "Uploading…"
                    : form.imageAssetId
                      ? "Replace image"
                      : "Upload image"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Starts at</label>
                <input
                  type="date"
                  value={form.startsAt}
                  onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Ends at</label>
                <input
                  type="date"
                  value={form.endsAt}
                  onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              Active
            </label>

            {form.error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {form.error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm} disabled={form.loading}>
              Cancel
            </Button>
            <Button
              onClick={handleFormSubmit}
              disabled={form.loading || form.uploading}
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
