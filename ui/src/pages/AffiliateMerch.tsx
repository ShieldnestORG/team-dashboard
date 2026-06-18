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
import {
  CDPage,
  CDPrimaryButton,
  EditorialCard,
  LabelCaps,
  Mono,
} from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO } from "@/lib/cdDesign";

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

// Narrowed palette — Verdant for fulfilled, Rizz Coral for in-flight, Flare for
// rejected. Neutral fallback for anything unmapped.
const STATUS_PILL: Record<string, { bg: string; fg: string; border: string }> = {
  approved: { bg: "rgba(74,157,124,0.10)", fg: CD.success, border: "rgba(74,157,124,0.35)" },
  shipped: { bg: "rgba(74,157,124,0.10)", fg: CD.success, border: "rgba(74,157,124,0.35)" },
  delivered: { bg: "rgba(74,157,124,0.10)", fg: CD.success, border: "rgba(74,157,124,0.35)" },
  pending: { bg: "rgba(255,107,74,0.10)", fg: CD.accent, border: "rgba(255,107,74,0.35)" },
  rejected: { bg: "rgba(217,67,67,0.10)", fg: CD.danger, border: "rgba(217,67,67,0.35)" },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_PILL[status] ?? {
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
      {status}
    </span>
  );
}

function formatItemType(t: string): string {
  const match = ITEM_OPTIONS.find((o) => o.value === t);
  if (match) return match.label;
  return t.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

// Shared input styling for the shipping form — dark surface, hairline border,
// coral focus ring matching the rest of the CD affiliate surfaces.
const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: `1px solid ${CD.border}`,
  backgroundColor: "rgba(255,255,255,0.025)",
  color: CD.ink,
  padding: "8px 12px",
  fontSize: "0.875rem",
};

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
    <CDPage>
      <AffiliateNav active="/merch" subtitle="Affiliate" title="Merch" />

      <main className="mx-auto w-full max-w-5xl px-6 py-10 space-y-6">
        {loading ? (
          <EditorialCard className="py-12 text-center">
            <LabelCaps>Loading merch…</LabelCaps>
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
        ) : (
          <>
            {formShouldHide ? (
              <EditorialCard className="p-5">
                <LabelCaps color={CD.accent}>Cooldown active</LabelCaps>
                <p className="mt-2 text-sm" style={{ color: CD.muted }}>
                  You recently received merch. You'll be eligible to request again on{" "}
                  <span className="font-medium" style={{ color: CD.ink }}>
                    {formatShortDate(cooldownUntil!)}
                  </span>
                  .
                </p>
              </EditorialCard>
            ) : (
              <EditorialCard className="p-5 space-y-4">
                <div>
                  <LabelCaps color={CD.accent}>Request merch</LabelCaps>
                  <p className="mt-1 text-xs" style={{ color: CD.muted }}>
                    One request per {COOLDOWN_DAYS} days. Shipping is on us for active
                    affiliates.
                  </p>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label
                      className="block text-xs font-medium mb-1"
                      style={{ color: CD.ink }}
                    >
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
                      style={{ ...inputStyle, opacity: submitLoading ? 0.6 : 1 }}
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
                      <label
                        className="block text-xs font-medium mb-1"
                        style={{ color: CD.ink }}
                      >
                        Size
                      </label>
                      <input
                        type="text"
                        required
                        value={sizeOrVariant}
                        onChange={(e) => setSizeOrVariant(e.target.value)}
                        placeholder="S / M / L / XL / 2XL"
                        disabled={submitLoading}
                        style={{ ...inputStyle, opacity: submitLoading ? 0.6 : 1 }}
                      />
                    </div>
                  )}

                  <div className="pt-2 space-y-3" style={{ borderTop: `1px solid ${CD.border}` }}>
                    <LabelCaps>Shipping address</LabelCaps>
                    <div>
                      <label
                        className="block text-xs font-medium mb-1"
                        style={{ color: CD.ink }}
                      >
                        Full name
                      </label>
                      <input
                        type="text"
                        required
                        value={address.name}
                        onChange={(e) => updateAddress("name", e.target.value)}
                        disabled={submitLoading}
                        style={{ ...inputStyle, opacity: submitLoading ? 0.6 : 1 }}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-xs font-medium mb-1"
                        style={{ color: CD.ink }}
                      >
                        Street address
                      </label>
                      <input
                        type="text"
                        required
                        value={address.street1}
                        onChange={(e) => updateAddress("street1", e.target.value)}
                        disabled={submitLoading}
                        style={{ ...inputStyle, opacity: submitLoading ? 0.6 : 1 }}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-xs font-medium mb-1"
                        style={{ color: CD.ink }}
                      >
                        Apartment, suite, etc. (optional)
                      </label>
                      <input
                        type="text"
                        value={address.street2 ?? ""}
                        onChange={(e) => updateAddress("street2", e.target.value)}
                        disabled={submitLoading}
                        style={{ ...inputStyle, opacity: submitLoading ? 0.6 : 1 }}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          className="block text-xs font-medium mb-1"
                          style={{ color: CD.ink }}
                        >
                          City
                        </label>
                        <input
                          type="text"
                          required
                          value={address.city}
                          onChange={(e) => updateAddress("city", e.target.value)}
                          disabled={submitLoading}
                          style={{ ...inputStyle, opacity: submitLoading ? 0.6 : 1 }}
                        />
                      </div>
                      <div>
                        <label
                          className="block text-xs font-medium mb-1"
                          style={{ color: CD.ink }}
                        >
                          State / Region
                        </label>
                        <input
                          type="text"
                          required
                          value={address.region}
                          onChange={(e) => updateAddress("region", e.target.value)}
                          disabled={submitLoading}
                          style={{ ...inputStyle, opacity: submitLoading ? 0.6 : 1 }}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          className="block text-xs font-medium mb-1"
                          style={{ color: CD.ink }}
                        >
                          Postal code
                        </label>
                        <input
                          type="text"
                          required
                          value={address.postalCode}
                          onChange={(e) => updateAddress("postalCode", e.target.value)}
                          disabled={submitLoading}
                          style={{ ...inputStyle, opacity: submitLoading ? 0.6 : 1 }}
                        />
                      </div>
                      <div>
                        <label
                          className="block text-xs font-medium mb-1"
                          style={{ color: CD.ink }}
                        >
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
                          style={{
                            ...inputStyle,
                            fontFamily: FONT_MONO,
                            opacity: submitLoading ? 0.6 : 1,
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {submitError && (
                    <p className="text-xs" style={{ color: CD.danger }}>
                      {submitError}
                    </p>
                  )}
                  {submitSuccess && (
                    <p className="text-xs" style={{ color: CD.success }}>
                      {submitSuccess}
                    </p>
                  )}

                  <div className="flex justify-end">
                    <CDPrimaryButton type="submit" disabled={submitLoading || !itemType}>
                      {submitLoading ? "Submitting…" : "Submit Request"}
                    </CDPrimaryButton>
                  </div>
                </form>
              </EditorialCard>
            )}

            {/* Request history */}
            <section className="space-y-3">
              <LabelCaps as="div">Your requests</LabelCaps>
              {requests.length === 0 ? (
                <EditorialCard className="py-12 text-center" style={{ borderStyle: "dashed" }}>
                  <p className="text-sm" style={{ color: CD.muted }}>
                    No merch requests yet.
                  </p>
                </EditorialCard>
              ) : (
                <EditorialCard style={{ overflow: "hidden" }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${CD.border}`, textAlign: "left" }}>
                          <th className="px-4 py-3"><LabelCaps>Requested</LabelCaps></th>
                          <th className="px-4 py-3"><LabelCaps>Item</LabelCaps></th>
                          <th className="px-4 py-3 hidden sm:table-cell"><LabelCaps>Size</LabelCaps></th>
                          <th className="px-4 py-3"><LabelCaps>Status</LabelCaps></th>
                          <th className="px-4 py-3 hidden md:table-cell"><LabelCaps>Tracking</LabelCaps></th>
                        </tr>
                      </thead>
                      <tbody>
                        {requests.map((r) => (
                          <tr key={r.id} style={{ borderBottom: `1px solid ${CD.border}` }}>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                                {formatShortDate(r.createdAt)}
                              </Mono>
                            </td>
                            <td className="px-4 py-3 text-sm font-medium" style={{ color: CD.ink }}>
                              {formatItemType(r.itemType)}
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell">
                              <span style={{ color: CD.muted, fontSize: "0.75rem" }}>
                                {r.sizeOrVariant ?? "—"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <StatusPill status={r.status} />
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              {r.trackingNumber ? (
                                <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                                  {r.trackingNumber}
                                </Mono>
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
            </section>
          </>
        )}
      </main>
    </CDPage>
  );
}
