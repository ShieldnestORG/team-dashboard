import { useEffect, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Trophy } from "lucide-react";
import {
  affiliatesAdminApi,
  type AdminTier,
} from "@/api/affiliates-admin";
import { AffiliateAdminTabs } from "@/components/AffiliateAdminTabs";

interface Draft {
  commissionRate: string;
  minLifetimeCents: string;
  minActivePartners: string;
  perksCsv: string;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

function tierToDraft(t: AdminTier): Draft {
  return {
    commissionRate: t.commissionRate,
    minLifetimeCents: String(t.minLifetimeCents),
    minActivePartners: String(t.minActivePartners),
    perksCsv: (t.perks ?? []).join(", "),
    saving: false,
    error: null,
    saved: false,
  };
}

function formatRatePct(rate: string): string {
  const n = parseFloat(rate);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function formatDollars(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function AffiliateAdminTiers() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tiers, setTiers] = useState<AdminTier[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Affiliates", href: "/affiliates" }, { label: "Tiers" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    affiliatesAdminApi.listTiers()
      .then((res) => {
        const sorted = [...res].sort((a, b) => a.displayOrder - b.displayOrder);
        setTiers(sorted);
        const next: Record<string, Draft> = {};
        for (const t of sorted) next[t.id] = tierToDraft(t);
        setDrafts(next);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load tiers"))
      .finally(() => setLoading(false));
  }, []);

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch, saved: false } }));
  }

  async function handleSave(tier: AdminTier) {
    const draft = drafts[tier.id];
    if (!draft) return;

    const commissionRate = draft.commissionRate.trim();
    const minLifetime = parseInt(draft.minLifetimeCents, 10);
    const minActive = parseInt(draft.minActivePartners, 10);
    const perks = draft.perksCsv
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (!commissionRate || Number.isNaN(parseFloat(commissionRate))) {
      setDrafts((prev) => ({
        ...prev,
        [tier.id]: { ...prev[tier.id], error: "Commission rate must be a number like 0.10" },
      }));
      return;
    }
    if (Number.isNaN(minLifetime) || minLifetime < 0) {
      setDrafts((prev) => ({
        ...prev,
        [tier.id]: { ...prev[tier.id], error: "Min lifetime cents must be a non-negative integer" },
      }));
      return;
    }
    if (Number.isNaN(minActive) || minActive < 0) {
      setDrafts((prev) => ({
        ...prev,
        [tier.id]: { ...prev[tier.id], error: "Min active partners must be a non-negative integer" },
      }));
      return;
    }

    setDrafts((prev) => ({ ...prev, [tier.id]: { ...prev[tier.id], saving: true, error: null, saved: false } }));
    try {
      await affiliatesAdminApi.updateTier(tier.id, {
        commissionRate,
        minLifetimeCents: minLifetime,
        minActivePartners: minActive,
        perks,
      });
      // Reflect in local state
      setTiers((prev) => prev.map((t) =>
        t.id === tier.id
          ? { ...t, commissionRate, minLifetimeCents: minLifetime, minActivePartners: minActive, perks }
          : t,
      ));
      setDrafts((prev) => ({
        ...prev,
        [tier.id]: { ...prev[tier.id], saving: false, saved: true },
      }));
    } catch (err) {
      setDrafts((prev) => ({
        ...prev,
        [tier.id]: {
          ...prev[tier.id],
          saving: false,
          error: err instanceof Error ? err.message : "Save failed",
        },
      }));
    }
  }

  if (loading && tiers.length === 0) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Tiers</h1>
        <p className="text-sm text-muted-foreground">
          Configure commission rates and qualification thresholds for each affiliate tier.
        </p>
      </div>

      <AffiliateAdminTabs active="tiers" />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {tiers.length === 0 && !loading ? (
        <EmptyState icon={Trophy} message="No tiers configured yet." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tiers.map((t) => {
            const d = drafts[t.id] ?? tierToDraft(t);
            return (
              <Card key={t.id} className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold capitalize text-foreground">{t.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      Current: {formatRatePct(t.commissionRate)} · {formatDollars(t.minLifetimeCents)} lifetime
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Order {t.displayOrder}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                      Commission rate
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={d.commissionRate}
                      onChange={(e) => updateDraft(t.id, { commissionRate: e.target.value })}
                      disabled={d.saving}
                      placeholder="0.10"
                      className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                      Min lifetime (¢)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={d.minLifetimeCents}
                      onChange={(e) => updateDraft(t.id, { minLifetimeCents: e.target.value })}
                      disabled={d.saving}
                      className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                      Min active partners
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={d.minActivePartners}
                      onChange={(e) => updateDraft(t.id, { minActivePartners: e.target.value })}
                      disabled={d.saving}
                      className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Perks (comma-separated)
                  </label>
                  <textarea
                    rows={2}
                    value={d.perksCsv}
                    onChange={(e) => updateDraft(t.id, { perksCsv: e.target.value })}
                    disabled={d.saving}
                    placeholder="Priority support, Exclusive swag, Event invites"
                    className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
                  />
                </div>

                {d.error && (
                  <p className="text-xs text-destructive">{d.error}</p>
                )}

                <div className="flex items-center justify-between">
                  {d.saved ? (
                    <span className="text-xs text-green-600">Saved</span>
                  ) : <span />}
                  <Button
                    type="button"
                    onClick={() => handleSave(t)}
                    disabled={d.saving}
                    className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
                  >
                    {d.saving ? "Saving…" : "Save tier"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
