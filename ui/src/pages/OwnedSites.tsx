import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { ownedSitesApi, type OwnedSite, type OwnedSiteStatus } from "../api/owned-sites";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Globe,
  DollarSign,
  TrendingUp,
  Users,
  ExternalLink,
  RefreshCw,
  Plus,
} from "lucide-react";

function fmtDollars(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function fmtNumber(n: number) {
  return n.toLocaleString("en-US");
}

const STATUS_STYLES: Record<OwnedSiteStatus, string> = {
  building: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  live: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  adsense_pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  monetized: "bg-green-500/20 text-green-400 border-green-500/30",
  killed: "bg-red-500/20 text-red-400 border-red-500/30",
};

const STATUS_LABEL: Record<OwnedSiteStatus, string> = {
  building: "Building",
  live: "Live",
  adsense_pending: "AdSense Pending",
  monetized: "Monetized",
  killed: "Killed",
};

function SummaryCards({ sites }: { sites: OwnedSite[] }) {
  const totalSites = sites.length;
  const liveSites = sites.filter(
    (s) => s.status === "live" || s.status === "monetized" || s.status === "adsense_pending",
  ).length;
  const revenue30d = sites.reduce((s, x) => s + x.rollup.adRevenueCents30d, 0);
  const sessions30d = sites.reduce((s, x) => s + x.rollup.sessions30d, 0);
  const monetizedCount = sites.filter((s) => s.status === "monetized").length;
  const avgRpmCents =
    monetizedCount > 0
      ? Math.round(
          sites
            .filter((s) => s.status === "monetized")
            .reduce((s, x) => s + x.rollup.rpmCentsAvg30d, 0) / monetizedCount,
        )
      : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <div className="rounded-md bg-slate-500/10 p-2">
            <Globe className="h-5 w-5 text-slate-400" />
          </div>
          <div>
            <p className="text-2xl font-bold">{totalSites}</p>
            <p className="text-xs text-muted-foreground">
              Sites ({liveSites} live)
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <div className="rounded-md bg-green-500/10 p-2">
            <DollarSign className="h-5 w-5 text-green-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">{fmtDollars(revenue30d)}</p>
            <p className="text-xs text-muted-foreground">Revenue 30d</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <div className="rounded-md bg-blue-500/10 p-2">
            <Users className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">{fmtNumber(sessions30d)}</p>
            <p className="text-xs text-muted-foreground">Sessions 30d</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <div className="rounded-md bg-purple-500/10 p-2">
            <TrendingUp className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">{fmtDollars(avgRpmCents)}</p>
            <p className="text-xs text-muted-foreground">Avg RPM (monetized)</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SitesTable({ sites }: { sites: OwnedSite[] }) {
  const qc = useQueryClient();
  const syncMut = useMutation({
    mutationFn: (slug: string) => ownedSitesApi.sync(slug),
    onSettled: () => qc.invalidateQueries({ queryKey: ["owned-sites", "list"] }),
  });

  if (sites.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Globe className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No owned sites registered yet.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            POST <code className="rounded bg-muted px-1 py-0.5">/api/owned-sites</code>{" "}
            to register one.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">
          {sites.length} site{sites.length === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Domain</th>
              <th className="px-4 py-2 font-medium">Niche</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium text-right">Sessions 30d</th>
              <th className="px-4 py-2 font-medium text-right">Revenue 30d</th>
              <th className="px-4 py-2 font-medium text-right">RPM</th>
              <th className="px-4 py-2 font-medium text-right">→ CD / Tokns</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="font-medium">{s.displayName}</span>
                    <a
                      href={`https://${s.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    >
                      {s.domain}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {s.niche ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    variant="outline"
                    className={STATUS_STYLES[s.status]}
                  >
                    {STATUS_LABEL[s.status]}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fmtNumber(s.rollup.sessions30d)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">
                  {fmtDollars(s.rollup.adRevenueCents30d)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {s.rollup.rpmCentsAvg30d > 0
                    ? fmtDollars(s.rollup.rpmCentsAvg30d)
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {fmtNumber(s.rollup.outboundToCoherence30d)} /{" "}
                  {fmtNumber(s.rollup.outboundToTokns30d)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={syncMut.isPending && syncMut.variables === s.slug}
                    onClick={() => syncMut.mutate(s.slug)}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${
                        syncMut.isPending && syncMut.variables === s.slug
                          ? "animate-spin"
                          : ""
                      }`}
                    />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CreateSiteForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [slug, setSlug] = useState("");
  const [domain, setDomain] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [primaryTool, setPrimaryTool] = useState("");
  const [niche, setNiche] = useState("");

  const createMut = useMutation({
    mutationFn: ownedSitesApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owned-sites", "list"] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Register new site</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!slug || !domain || !displayName) return;
            createMut.mutate({
              slug,
              domain,
              displayName,
              primaryTool: primaryTool || undefined,
              niche: niche || undefined,
            });
          }}
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Slug</span>
            <input
              className="rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="phone-generator"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Domain</span>
            <input
              className="rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="phonegenerator.app"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            <span className="text-muted-foreground">Display name</span>
            <input
              className="rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="Phone Number Generator"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Primary tool</span>
            <input
              className="rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="phone-number-generator"
              value={primaryTool}
              onChange={(e) => setPrimaryTool(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Niche</span>
            <input
              className="rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="utility/generator"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
            />
          </label>
          <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-2">
            {createMut.error ? (
              <span className="text-xs text-red-400 mr-auto">
                {(createMut.error as Error).message}
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDone}
              disabled={createMut.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={createMut.isPending}>
              {createMut.isPending ? "Registering…" : "Register"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function OwnedSites() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Owned Sites" }]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["owned-sites", "list"],
    queryFn: () => ownedSitesApi.list(),
  });

  const qc = useQueryClient();
  const triggerCronMut = useMutation({
    mutationFn: ownedSitesApi.triggerCron,
    onSettled: () => qc.invalidateQueries({ queryKey: ["owned-sites", "list"] }),
  });

  const sites = data?.sites ?? [];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Owned Sites</h1>
          <p className="text-sm text-muted-foreground">
            Utility-site portfolio — ad revenue, traffic, and outbound clicks to
            coherencedaddy / tokns.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerCronMut.mutate()}
            disabled={triggerCronMut.isPending}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1.5 ${
                triggerCronMut.isPending ? "animate-spin" : ""
              }`}
            />
            Sync all
          </Button>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {showCreate ? "Close" : "Register site"}
          </Button>
        </div>
      </div>

      {showCreate ? <CreateSiteForm onDone={() => setShowCreate(false)} /> : null}

      <SummaryCards sites={sites} />

      {error ? (
        <Card>
          <CardContent className="py-6 text-sm text-red-400">
            Failed to load sites: {(error as Error).message}
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading sites…
          </CardContent>
        </Card>
      ) : (
        <SitesTable sites={sites} />
      )}
    </div>
  );
}
