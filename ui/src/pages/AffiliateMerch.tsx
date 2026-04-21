import { useEffect, useMemo, useState } from "react";
import {
  affiliatesApi,
  AffiliateApiError,
  getAffiliateToken,
  type MerchItemType,
  type MerchRequest,
  type MerchShippingAddress,
} from "@/api/affiliates";
import { AffiliateNav } from "@/components/AffiliateNav";

const ITEM_OPTIONS: { value: MerchItemType; label: string; needsSize: boolean }[] = [
  { value: "starter_shirt", label: "Starter Shirt", needsSize: true },
  { value: "hat", label: "Hat", needsSize: false },
  { value: "sticker_pack", label: "Sticker Pack", needsSize: false },
];

const COOLDOWN_DAYS = 90;

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusClass(status: string): string {
  switch (status) {
    case "approved":
    case "shipped":
    case "delivered":
      return "bg-green-500/15 text-green-500 border-green-500/30";
    case "pending":
      return "bg-yellow-500/15 text-yellow-500 border-yellow-500/30";
    case "rejected":
      return "bg-red-500/15 text-red-500 border-red-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function formatItemType(t: string): string {
  const match = ITEM_OPTIONS.find((o) => o.value === t);
  if (match) return match.label;
  return t.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Compute cooldown based on the most recent approved/shipped/delivered request.
 * Returns null if no cooldown is active, or an ISO string for when the next
 * request will be eligible.
 */
function cooldownEndsAt(requests: MerchRequest[]): string | null {
  const ELIGIBLE_STATUSES = new Set(["approved", "shipped", "delivered"]);
  const eligible = requests
    .filter((r) => ELIGIBLE_STATUSES.has(r.status))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (eligible.length === 0) return null;
  const last = new Date(eligible[0].createdAt);
  const endsAt = new Date(last.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  if (endsAt.getTime() <= Date.now()) return null;
  return endsAt.toISOString();
}

export function AffiliateMerch() {
  const [requests, setRequests] = useState<MerchRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [itemType, setItemType] = useState<MerchItemType | "">("");
  const [sizeOrVariant, setSizeOrVariant] = useState("");
  const [address, setAddress] = useState<MerchShippingAddress>({
    name: "",
    street1: "",
    street2: "",
    city: "",
    region: "",
    postalCode: "",
    country: "US",
  });
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [serverCooldownUntil, setServerCooldownUntil] = useState<string | null>(null);

  useEffect(() => {
    if (!getAffiliateToken()) {
      window.location.href = "/";
      return;
    }
    loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    setError(null);
    try {
      const res = await affiliatesApi.listMerchRequests();
      setRequests(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load merch requests");
    } finally {
      setLoading(false);
    }
  }

  const clientCooldownUntil = useMemo(() => cooldownEndsAt(requests), [requests]);
  const cooldownUntil = serverCooldownUntil ?? clientCooldownUntil;
  const formShouldHide = !!cooldownUntil;

  const selectedItem = ITEM_OPTIONS.find((o) => o.value === itemType);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!itemType) return;
    if (selectedItem?.needsSize && !sizeOrVariant.trim()) return;
    setSubmitLoading(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const body: Parameters<typeof affiliatesApi.submitMerchRequest>[0] = {
        itemType,
        shippingAddress: {
          name: address.name.trim(),
          street1: address.street1.trim(),
          city: address.city.trim(),
          region: address.region.trim(),
          postalCode: address.postalCode.trim(),
          country: address.country.trim() || "US",
          ...(address.street2?.trim() ? { street2: address.street2.trim() } : {}),
        },
      };
      if (sizeOrVariant.trim()) body.sizeOrVariant = sizeOrVariant.trim();
      await affiliatesApi.submitMerchRequest(body);
      setSubmitSuccess("Request submitted. We'll email you when it ships.");
      setItemType("");
      setSizeOrVariant("");
      setAddress({
        name: "",
        street1: "",
        street2: "",
        city: "",
        region: "",
        postalCode: "",
        country: "US",
      });
      await loadRequests();
    } catch (err) {
      if (err instanceof AffiliateApiError && err.status === 429) {
        const nextEligible = (err as unknown as { nextEligibleAt?: string }).nextEligibleAt;
        if (nextEligible) setServerCooldownUntil(nextEligible);
        setSubmitError(
          err.message ||
            "You're currently in a cooldown. Try again after the cooldown period ends.",
        );
      } else {
        setSubmitError(err instanceof Error ? err.message : "Failed to submit request");
      }
    } finally {
      setSubmitLoading(false);
    }
  }

  function updateAddress<K extends keyof MerchShippingAddress>(
    key: K,
    value: MerchShippingAddress[K],
  ) {
    setAddress((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AffiliateNav active="/merch" subtitle="Affiliate Program" title="Merch" />

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {loading ? (
          <div className="rounded-xl border border-border bg-card py-12 text-center">
            <p className="text-muted-foreground text-sm">Loading…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <>
            {formShouldHide ? (
              <section className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-base font-semibold text-foreground">
                  Cooldown active
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  You recently received merch. You'll be eligible to request again on{" "}
                  <span className="font-medium text-foreground">
                    {formatShortDate(cooldownUntil!)}
                  </span>
                  .
                </p>
              </section>
            ) : (
              <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Request merch
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    One request per {COOLDOWN_DAYS} days. Shipping is on us for active
                    affiliates.
                  </p>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      Item
                    </label>
                    <select
                      required
                      value={itemType}
                      onChange={(e) => {
                        setItemType(e.target.value as MerchItemType | "");
                        setSizeOrVariant("");
                      }}
                      disabled={submitLoading}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                    >
                      <option value="">Select item…</option>
                      {ITEM_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedItem?.needsSize && (
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Size
                      </label>
                      <input
                        type="text"
                        required
                        value={sizeOrVariant}
                        onChange={(e) => setSizeOrVariant(e.target.value)}
                        placeholder="S / M / L / XL / 2XL"
                        disabled={submitLoading}
                        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                      />
                    </div>
                  )}

                  <div className="pt-2 border-t border-border space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Shipping address
                    </p>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Full name
                      </label>
                      <input
                        type="text"
                        required
                        value={address.name}
                        onChange={(e) => updateAddress("name", e.target.value)}
                        disabled={submitLoading}
                        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Street address
                      </label>
                      <input
                        type="text"
                        required
                        value={address.street1}
                        onChange={(e) => updateAddress("street1", e.target.value)}
                        disabled={submitLoading}
                        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Apartment, suite, etc. (optional)
                      </label>
                      <input
                        type="text"
                        value={address.street2 ?? ""}
                        onChange={(e) => updateAddress("street2", e.target.value)}
                        disabled={submitLoading}
                        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1">
                          City
                        </label>
                        <input
                          type="text"
                          required
                          value={address.city}
                          onChange={(e) => updateAddress("city", e.target.value)}
                          disabled={submitLoading}
                          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1">
                          State / Region
                        </label>
                        <input
                          type="text"
                          required
                          value={address.region}
                          onChange={(e) => updateAddress("region", e.target.value)}
                          disabled={submitLoading}
                          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1">
                          Postal code
                        </label>
                        <input
                          type="text"
                          required
                          value={address.postalCode}
                          onChange={(e) => updateAddress("postalCode", e.target.value)}
                          disabled={submitLoading}
                          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1">
                          Country
                        </label>
                        <input
                          type="text"
                          required
                          value={address.country}
                          onChange={(e) => updateAddress("country", e.target.value.toUpperCase())}
                          disabled={submitLoading}
                          maxLength={2}
                          placeholder="US"
                          className="w-full rounded-lg border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                        />
                      </div>
                    </div>
                  </div>

                  {submitError && (
                    <p className="text-xs text-destructive">{submitError}</p>
                  )}
                  {submitSuccess && (
                    <p className="text-xs text-green-600">{submitSuccess}</p>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submitLoading || !itemType}
                      className="px-5 py-2 rounded-lg bg-[#ff876d] hover:bg-[#ff876d]/90 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                    >
                      {submitLoading ? "Submitting…" : "Submit Request"}
                    </button>
                  </div>
                </form>
              </section>
            )}

            {/* Request history */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">
                Your requests
              </h2>
              {requests.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    No merch requests yet.
                  </p>
                </div>
              ) : (
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="px-4 py-3 font-medium">Requested</th>
                          <th className="px-4 py-3 font-medium">Item</th>
                          <th className="px-4 py-3 font-medium hidden sm:table-cell">Size</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium hidden md:table-cell">Tracking</th>
                        </tr>
                      </thead>
                      <tbody>
                        {requests.map((r) => (
                          <tr
                            key={r.id}
                            className="border-b border-border last:border-0 hover:bg-background transition-colors"
                          >
                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                              {formatShortDate(r.createdAt)}
                            </td>
                            <td className="px-4 py-3 text-sm font-medium text-foreground">
                              {formatItemType(r.itemType)}
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">
                              {r.sizeOrVariant ?? "—"}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusClass(r.status)}`}
                              >
                                {r.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell text-xs font-mono text-muted-foreground">
                              {r.trackingNumber ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
