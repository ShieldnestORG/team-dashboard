import { useEffect, useMemo, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Users, Check, Copy } from "lucide-react";
import {
  shopSharersApi,
  type ShopSharer,
  type ShopSharerApproveResult,
  type ShopCommission,
} from "@/api/shop-sharers";

function fmtMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format((cents ?? 0) / 100);
}

// Mirror of the server-side slugifyReferralCode: lowercases, collapses
// non-alphanumerics to hyphens, trims, caps at 32 chars. Keeps the vanity
// code and placeholder email in sync as the admin types a handle.
function slugifyCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Shop Sharers Admin — approve / reject applications from the shop email
// capture → QR + referral link flow. See docs/products/shop-sharers.md.
// ---------------------------------------------------------------------------

type FilterKey = "pending" | "approved" | "rejected" | "all";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: string | null): { label: string; cls: string } {
  if (status === "pending") {
    return {
      label: "Pending",
      cls: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    };
  }
  if (status === "approved") {
    return {
      label: "Approved",
      cls: "bg-green-500/15 text-green-600 border-green-500/30",
    };
  }
  if (status === "rejected") {
    return {
      label: "Rejected",
      cls: "bg-red-500/15 text-red-600 border-red-500/30",
    };
  }
  return {
    label: "Sharer only",
    cls: "bg-muted text-muted-foreground border-border",
  };
}

export function ShopSharersAdmin() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [rows, setRows] = useState<ShopSharer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [lastApproval, setLastApproval] = useState<
    ShopSharerApproveResult | null
  >(null);

  // ── Add-affiliate form ───────────────────────────────────────────────────
  const [handle, setHandle] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdSharer, setCreatedSharer] = useState<ShopSharer | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Influencer commission ledger (read-only; populated once the WooCommerce
  // order webhook is wired — see docs/products/affiliate-unified-links.md).
  const [commissions, setCommissions] = useState<ShopCommission[]>([]);

  useEffect(() => {
    shopSharersApi
      .listCommissions()
      .then((res) => setCommissions(res.commissions))
      .catch(() => setCommissions([]));
  }, []);

  function copyLink(id: string, url: string) {
    void navigator.clipboard?.writeText(url).then(() => {
      setCopiedId(id);
      window.setTimeout(
        () => setCopiedId((cur) => (cur === id ? null : cur)),
        1500,
      );
    });
  }

  // Typing the handle auto-fills the vanity code + placeholder email until the
  // admin overrides either field directly.
  function handleHandleChange(value: string) {
    setHandle(value);
    const slug = slugifyCode(value);
    if (!codeTouched) setCode(slug);
    if (!emailTouched) setEmail(slug ? `${slug}@coherencedaddy.com` : "");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setCreateError("Email is required.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await shopSharersApi.create({
        email: trimmedEmail,
        referralCode: code.trim() || undefined,
      });
      setCreatedSharer(res.sharer);
      if (!res.created) {
        setCreateError(
          `${trimmedEmail} already had a link — showing the existing one.`,
        );
      }
      // Reset the form for the next entry.
      setHandle("");
      setCode("");
      setEmail("");
      setCodeTouched(false);
      setEmailTouched(false);
      // Admin-created rows have no application status, so reveal them via "All".
      if (filter !== "all") setFilter("all");
      else await refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create link");
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    setBreadcrumbs([{ label: "Shop Sharers" }]);
  }, [setBreadcrumbs]);

  async function refresh() {
    const status = filter === "all" ? undefined : filter;
    const res = await shopSharersApi.list(status);
    setRows(res.sharers);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    refresh()
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load sharers"),
      )
      .finally(() => setLoading(false));
  }, [filter]);

  async function handleApprove(row: ShopSharer) {
    if (!confirm(`Approve ${row.email} as an affiliate?`)) return;
    setBusyId(row.id);
    try {
      const result = await shopSharersApi.approve(row.id);
      setLastApproval(result);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(row: ShopSharer) {
    const notes = window.prompt(`Reject ${row.email}? Optional notes:`, "");
    if (notes === null) return;
    setBusyId(row.id);
    try {
      await shopSharersApi.reject(row.id, notes || undefined);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, total: rows.length };
    for (const r of rows) {
      if (r.affiliateApplicationStatus === "pending") c.pending += 1;
      else if (r.affiliateApplicationStatus === "approved") c.approved += 1;
      else if (r.affiliateApplicationStatus === "rejected") c.rejected += 1;
    }
    return c;
  }, [rows]);

  if (loading && rows.length === 0) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Shop Sharers</h1>
        <p className="text-sm text-muted-foreground">
          Email signups from <code className="text-xs">shop.coherencedaddy.com</code>,
          plus affiliate links you mint here. Approving a pending application
          creates an active affiliate row with shared-marketing eligibility.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Add affiliate link</h2>
          <p className="text-xs text-muted-foreground">
            Mint a referral link for an influencer or affiliate. Tracking only —
            the shopper gets <span className="font-medium">no discount</span>.
            Append <code className="text-[11px]">?ref=&lt;code&gt;</code> to any{" "}
            <code className="text-[11px]">outrizzd.com</code> link (incl. a
            single-shirt <code className="text-[11px]">/p/&lt;id&gt;</code> link)
            to attribute that click.
          </p>
        </div>
        <form
          onSubmit={handleCreate}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end"
        >
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Name / handle</span>
            <Input
              value={handle}
              onChange={(e) => handleHandleChange(e.target.value)}
              placeholder="remy"
              disabled={creating}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Referral code</span>
            <Input
              value={code}
              onChange={(e) => {
                setCode(slugifyCode(e.target.value));
                setCodeTouched(true);
              }}
              placeholder="remy"
              disabled={creating}
              className="font-mono"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Email</span>
            <Input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailTouched(true);
              }}
              placeholder="remy@coherencedaddy.com"
              disabled={creating}
            />
          </label>
          <Button
            type="submit"
            disabled={creating || !email.trim()}
            className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
          >
            {creating ? "Adding…" : "Add link"}
          </Button>
        </form>
        {code && (
          <p className="text-xs text-muted-foreground">
            Link preview:{" "}
            <span className="font-mono text-foreground">
              outrizzd.com/?ref={code}
            </span>
          </p>
        )}
        {createError && <p className="text-xs text-destructive">{createError}</p>}
      </Card>

      <div className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key === "pending" && counts.pending > 0 && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-700">
                {counts.pending}
              </span>
            )}
          </Button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {createdSharer && (
        <Card className="p-4 bg-[#ff876d]/5 border-[#ff876d]/30">
          <div className="text-sm font-medium">
            Affiliate link ready — {createdSharer.email}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 text-xs bg-background border border-border rounded p-2 font-mono break-all">
              {createdSharer.affiliateUrl ??
                `https://outrizzd.com/?ref=${createdSharer.referralCode}`}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                copyLink(
                  createdSharer.id,
                  createdSharer.affiliateUrl ??
                    `https://outrizzd.com/?ref=${createdSharer.referralCode}`,
                )
              }
            >
              {copiedId === createdSharer.id ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => setCreatedSharer(null)}
          >
            Dismiss
          </Button>
        </Card>
      )}

      {lastApproval && (
        <Card className="p-4 bg-green-500/5 border-green-500/30">
          <div className="text-sm font-medium">
            Approved {lastApproval.affiliate.email}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Send them this one-time password-set token (valid 14 days):
          </div>
          <code className="mt-2 block text-xs bg-background border border-border rounded p-2 font-mono break-all">
            {lastApproval.resetToken}
          </code>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => setLastApproval(null)}
          >
            Dismiss
          </Button>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={Users} message="No sharers in this view yet." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">
                    Source
                  </th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">
                    Signed up
                  </th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const busy = busyId === row.id;
                  const badge = statusBadge(row.affiliateApplicationStatus);
                  const link = row.affiliateUrl ?? row.shareUrl;
                  return (
                    <tr
                      key={row.id}
                      className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-foreground">
                        {row.email}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{row.referralCode}</span>
                          {link && (
                            <button
                              type="button"
                              onClick={() => copyLink(row.id, link)}
                              title="Copy affiliate link (outrizzd.com)"
                              className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {copiedId === row.id ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                        {row.source}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(row.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          {row.affiliateApplicationStatus === "pending" && (
                            <>
                              <Button
                                size="sm"
                                className="text-xs h-7 bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
                                onClick={() => handleApprove(row)}
                                disabled={busy}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 text-destructive"
                                onClick={() => handleReject(row)}
                                disabled={busy}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {row.affiliateApplicationStatus === null && (
                            <span className="text-xs text-muted-foreground">
                              No application
                            </span>
                          )}
                          {row.affiliateApplicationStatus === "approved" && (
                            <span className="text-xs text-muted-foreground">
                              Affiliate #{row.affiliateId?.slice(0, 8)}
                            </span>
                          )}
                          {row.affiliateApplicationStatus === "rejected" &&
                            row.notes && (
                              <span
                                className="text-xs text-muted-foreground truncate max-w-[220px]"
                                title={row.notes}
                              >
                                {row.notes}
                              </span>
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

      <div className="pt-2">
        <h2 className="text-sm font-semibold">Influencer commissions</h2>
        <p className="text-xs text-muted-foreground mb-2">
          Attributed shop sales. Populated once the WooCommerce order webhook is
          wired (see <code className="text-[11px]">affiliate-unified-links.md</code>).
        </p>
        {commissions.length === 0 ? (
          <EmptyState
            icon={Users}
            message="No attributed sales yet."
          />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Code</th>
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium text-right">Gross</th>
                    <th className="px-4 py-3 font-medium text-right">Commission</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium hidden lg:table-cell">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                        {c.referralCode}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                        {c.orderRef}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fmtMoney(c.grossAmountCents, c.currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {fmtMoney(c.commissionCents, c.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-muted text-muted-foreground border-border">
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(c.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
