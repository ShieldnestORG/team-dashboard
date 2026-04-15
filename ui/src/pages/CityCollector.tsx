import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  MapPin,
  Search,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Briefcase,
  Globe,
  AlertTriangle,
  Copy,
  CheckCircle2,
  ExternalLink,
  X,
  UserPlus,
  Star,
} from "lucide-react";

import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  citiesApi,
  type CityListEntry,
  type CityIntelligenceRow,
  type CityItem,
  type CityPitchResponse,
  type DirectoryMatch,
  type CityBusinessLead,
} from "@/api/cities";

const cityKeys = {
  list: ["cities", "list"] as const,
  detail: (slug: string) => ["cities", "detail", slug] as const,
  directory: (slug: string) => ["cities", "directory", slug] as const,
  leads: (slug: string, topic?: string) => ["cities", "leads", slug, topic] as const,
};

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function statusBadge(status: CityListEntry["collectionStatus"]) {
  switch (status) {
    case "ready":
      return (
        <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          ready
        </Badge>
      );
    case "running":
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          running
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          error
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ---------------------------------------------------------------------------
// Ranked-item list (used inside drawer tabs)
// ---------------------------------------------------------------------------

function RankedList({ items }: { items: CityItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No items collected yet.</p>;
  }
  const hasTimestamps = items.some((item) => Boolean(item.collectedAt));
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="w-12 px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Term</th>
            <th className="px-3 py-2 text-left">Source</th>
            <th className="px-3 py-2 text-right">Score</th>
            {hasTimestamps && <th className="text-right text-xs text-muted-foreground font-normal">Collected</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.rank}-${item.term}`} className="border-t">
              <td className="px-3 py-2 text-muted-foreground">{item.rank}</td>
              <td className="px-3 py-2">{item.term}</td>
              <td className="px-3 py-2">
                <Badge variant="outline" className="text-xs">
                  {item.source}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                {item.score.toFixed(2)}
              </td>
              {hasTimestamps && (
                <td className="text-right text-xs text-muted-foreground">
                  {item.collectedAt ? formatRelative(item.collectedAt) : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pitch panel
// ---------------------------------------------------------------------------

function PitchPanel({ slug }: { slug: string }) {
  const [productOrService, setProductOrService] = useState("");
  const [audience, setAudience] = useState("");
  const [result, setResult] = useState<CityPitchResponse | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      citiesApi.pitch(slug, {
        productOrService,
        audience: audience || undefined,
      }),
    onSuccess: (data) => setResult(data),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // no-op
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Product / service to pitch
          </label>
          <Input
            value={productOrService}
            onChange={(e) => setProductOrService(e.target.value)}
            placeholder="e.g. yoga studio"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Audience (optional)
          </label>
          <Input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="e.g. busy working parents"
          />
        </div>
      </div>
      <Button
        size="sm"
        disabled={!productOrService.trim() || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Generating…
          </>
        ) : (
          <>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Generate pitch
          </>
        )}
      </Button>
      {mutation.isError ? (
        <p className="text-xs text-destructive">
          {(mutation.error as Error).message}
        </p>
      ) : null}
      {result ? (
        <div className="space-y-3">
          {result.variants.map((v) => (
            <Card key={v.length}>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center justify-between text-xs uppercase">
                  <span>{v.length}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 text-xs"
                    onClick={() => copy(v.text)}
                  >
                    <Copy className="h-3 w-3" />
                    copy
                  </Button>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{v.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Directory matches panel
// ---------------------------------------------------------------------------

function DirectoryMatchesPanel({ slug }: { slug: string }) {
  const { data, isLoading } = useQuery<{ matches: DirectoryMatch[] }>({
    queryKey: cityKeys.directory(slug),
    queryFn: () => citiesApi.directoryMatches(slug),
  });

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (!data || data.matches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No Coherence Daddy directory matches for this region yet.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Project</th>
            <th className="px-3 py-2 text-left">Directory</th>
            <th className="px-3 py-2 text-left">Category</th>
            <th className="px-3 py-2 text-right">Link</th>
          </tr>
        </thead>
        <tbody>
          {data.matches.map((m) => (
            <tr key={m.slug} className="border-t">
              <td className="px-3 py-2 font-medium">{m.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{m.directory}</td>
              <td className="px-3 py-2 text-muted-foreground">{m.category}</td>
              <td className="px-3 py-2 text-right">
                {m.website ? (
                  <a
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    href={m.website}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3 w-3" />
                    visit
                  </a>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Business Leads Panel
// ---------------------------------------------------------------------------

interface BusinessLeadsPanelProps {
  slug: string;
}

function BusinessLeadsPanel({ slug }: BusinessLeadsPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedTopic, setSelectedTopic] = useState<string | undefined>(undefined);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: cityKeys.leads(slug, selectedTopic),
    queryFn: () => citiesApi.getLeads(slug, { topic: selectedTopic }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { leadStatus?: string; notes?: string } }) =>
      citiesApi.updateLead(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cities", "leads", slug] });
    },
  });

  const promoteMutation = useMutation({
    mutationFn: (id: string) => citiesApi.promoteLead(id),
    onSuccess: (result) => {
      const encoded = btoa(JSON.stringify(result.preFill));
      navigate(`/partners?prefill=${encoded}`);
    },
  });

  const contentMutation = useMutation({
    mutationFn: (id: string) => citiesApi.generateLeadContent(id),
    onSuccess: () => {
      setActioningId(null);
    },
  });

  const leads: CityBusinessLead[] = data?.leads ?? [];
  const topics: string[] = data?.topics ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Topic filter */}
      {topics.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Filter by topic:</span>
          <button
            onClick={() => setSelectedTopic(undefined)}
            className={`text-xs px-2 py-0.5 rounded-full border ${!selectedTopic ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30 text-muted-foreground"}`}
          >
            All
          </button>
          {topics.map((t) => (
            <button
              key={t}
              onClick={() => setSelectedTopic(t)}
              className={`text-xs px-2 py-0.5 rounded-full border ${selectedTopic === t ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30 text-muted-foreground"}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {leads.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <MapPin className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p>No businesses found for this city yet.</p>
          <p className="mt-1 text-xs">Use the Business Finder form to search by topic.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map((lead) => (
            <div
              key={lead.id}
              className={`border rounded-lg p-3 text-sm space-y-1 ${
                lead.leadStatus === "skipped" ? "opacity-40" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{lead.name}</span>
                    {lead.leadStatus !== "new" && (
                      <Badge
                        variant={
                          lead.leadStatus === "promoted_partner"
                            ? "default"
                            : lead.leadStatus === "verified"
                            ? "secondary"
                            : "outline"
                        }
                        className="text-xs"
                      >
                        {lead.leadStatus.replace("_", " ")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                    {lead.category && <span>{lead.category}</span>}
                    {lead.rating && (
                      <span className="flex items-center gap-0.5">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        {lead.rating}
                        {lead.reviewCount ? ` (${lead.reviewCount})` : ""}
                      </span>
                    )}
                    {lead.phone && <span>{lead.phone}</span>}
                    {lead.address && <span className="truncate max-w-[180px]">{lead.address}</span>}
                  </div>
                  {lead.website && (
                    <a
                      href={lead.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline flex items-center gap-1 mt-0.5"
                    >
                      {lead.website.replace(/^https?:\/\//, "").split("/")[0]}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {/* Actions */}
                {lead.leadStatus !== "promoted_partner" && lead.leadStatus !== "skipped" && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="Add as Partner"
                      disabled={promoteMutation.isPending && actioningId === lead.id}
                      onClick={() => {
                        setActioningId(lead.id);
                        promoteMutation.mutate(lead.id);
                      }}
                    >
                      {promoteMutation.isPending && actioningId === lead.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <UserPlus className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="Generate Content"
                      disabled={contentMutation.isPending && actioningId === lead.id}
                      onClick={() => {
                        setActioningId(lead.id);
                        contentMutation.mutate(lead.id, {
                          onSuccess: () => setActioningId(null),
                        });
                      }}
                    >
                      {contentMutation.isPending && actioningId === lead.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground"
                      title="Skip"
                      onClick={() =>
                        updateMutation.mutate({ id: lead.id, body: { leadStatus: "skipped" } })
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-xs py-0">{lead.source}</Badge>
                <span>found {formatRelative(lead.foundAt)}</span>
                {lead.topic && <span>· topic: {lead.topic}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// City detail drawer (fixed right sheet, simple implementation)
// ---------------------------------------------------------------------------

function CityDetailDrawer({
  slug,
  onClose,
}: {
  slug: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const enabled = Boolean(slug);

  const { data, isLoading } = useQuery<{ city: CityIntelligenceRow }>({
    queryKey: slug ? cityKeys.detail(slug) : ["cities", "detail", "none"],
    queryFn: () => citiesApi.get(slug!),
    enabled,
  });

  const refreshMutation = useMutation({
    mutationFn: () => citiesApi.refresh(slug!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cityKeys.list });
      if (slug) {
        queryClient.invalidateQueries({ queryKey: cityKeys.detail(slug) });
      }
    },
  });

  if (!slug) return null;

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <div
        className="h-full w-full max-w-3xl overflow-y-auto bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {data?.city.city}
              {data?.city.region ? `, ${data.city.region}` : ""}
            </h2>
            {data ? statusBadge(data.city.collectionStatus) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={refreshMutation.isPending}
              onClick={() => refreshMutation.mutate()}
            >
              {refreshMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5">Refresh</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {isLoading || !data ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading city…
            </div>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Pitch generator</CardTitle>
                  <CardDescription>
                    Enter a product or service and get three pitch variants grounded in
                    the real local signals below.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <PitchPanel slug={data.city.slug} />
                </CardContent>
              </Card>

              <Tabs defaultValue="searches" className="space-y-3">
                <TabsList>
                  <TabsTrigger value="searches">
                    <Search className="mr-1.5 h-3.5 w-3.5" />
                    Top searches ({data.city.topSearches.length})
                  </TabsTrigger>
                  <TabsTrigger value="demand">
                    <Briefcase className="mr-1.5 h-3.5 w-3.5" />
                    Service demand ({data.city.serviceDemand.length})
                  </TabsTrigger>
                  <TabsTrigger value="trending">
                    <TrendingUp className="mr-1.5 h-3.5 w-3.5" />
                    Trending ({data.city.trendingTopics.length})
                  </TabsTrigger>
                  <TabsTrigger value="leads">
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                    Business Leads
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="searches">
                  <RankedList items={data.city.topSearches} />
                </TabsContent>
                <TabsContent value="demand">
                  <RankedList items={data.city.serviceDemand} />
                </TabsContent>
                <TabsContent value="trending">
                  <RankedList items={data.city.trendingTopics} />
                </TabsContent>
                <TabsContent value="leads">
                  <BusinessLeadsPanel slug={data.city.slug} />
                </TabsContent>
              </Tabs>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Directory matches</CardTitle>
                  <CardDescription>
                    Coherence Daddy directory entries that match this region.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DirectoryMatchesPanel slug={data.city.slug} />
                </CardContent>
              </Card>

              {data.city.collectionError ? (
                <Card>
                  <CardContent className="flex items-start gap-2 py-4 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4" />
                    <span>{data.city.collectionError}</span>
                  </CardContent>
                </Card>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function CityCollector() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [collectCity, setCollectCity] = useState("");
  const [collectRegion, setCollectRegion] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [finderCity, setFinderCity] = useState("");
  const [finderRegion, setFinderRegion] = useState("");
  const [finderTopic, setFinderTopic] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "City Collector" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading } = useQuery({
    queryKey: [...cityKeys.list, searchQuery],
    queryFn: () => citiesApi.list(searchQuery ? { q: searchQuery } : undefined),
    refetchInterval: 30_000,
  });

  const collectMutation = useMutation({
    mutationFn: () =>
      citiesApi.collect({
        city: collectCity,
        region: collectRegion || null,
        country: "US",
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: cityKeys.list });
      setCollectCity("");
      setCollectRegion("");
      if (res.slug) setSelectedSlug(res.slug);
    },
  });

  const findBusinessesMutation = useMutation({
    mutationFn: (body: { city: string; region: string; topic: string }) =>
      citiesApi.findBusinesses(body),
    onSuccess: () => {
      const slug =
        finderCity.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
        (finderRegion
          ? `-${finderRegion.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
          : "") +
        "-us";
      queryClient.invalidateQueries({ queryKey: cityKeys.list });
      queryClient.invalidateQueries({ queryKey: ["cities", "leads", slug] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Globe className="h-5 w-5" />
          City Collector
        </h1>
        <p className="text-sm text-muted-foreground">
          Scrape local intel from Firecrawl, Google Trends, Bing News, Reddit, and Yelp.
          Ranked top-50 lists of searches, service demand, and trending topics. Used to
          enrich partner content and generate location-grounded sales pitches.
        </p>
      </div>

      {/* Collect form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Collect a new city</CardTitle>
          <CardDescription>
            Typical collection runs ~60–120s. Fresh rows (&lt;30 days old) short-circuit the cache.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              className="sm:w-64"
              placeholder="City (e.g. Austin)"
              value={collectCity}
              onChange={(e) => setCollectCity(e.target.value)}
            />
            <Input
              className="sm:w-32"
              placeholder="Region (TX)"
              value={collectRegion}
              onChange={(e) => setCollectRegion(e.target.value)}
            />
            <Button
              disabled={!collectCity.trim() || collectMutation.isPending}
              onClick={() => collectMutation.mutate()}
            >
              {collectMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Collecting…
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Collect
                </>
              )}
            </Button>
          </div>
          {collectMutation.isError ? (
            <p className="mt-2 text-xs text-destructive">
              {(collectMutation.error as Error).message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Business Finder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Find Local Businesses
          </CardTitle>
          <CardDescription>
            Search for real businesses in a city by topic (e.g., "handyman", "plumber", "gym")
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="City"
              value={finderCity}
              onChange={(e) => setFinderCity(e.target.value)}
              className="sm:w-48"
            />
            <Input
              placeholder="State (optional)"
              value={finderRegion}
              onChange={(e) => setFinderRegion(e.target.value)}
              className="sm:w-24"
            />
            <Input
              placeholder="Topic (e.g. handyman)"
              value={finderTopic}
              onChange={(e) => setFinderTopic(e.target.value)}
              className="sm:flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter" && finderCity && finderTopic) {
                  findBusinessesMutation.mutate({
                    city: finderCity,
                    region: finderRegion,
                    topic: finderTopic,
                  });
                }
              }}
            />
            <Button
              onClick={() =>
                findBusinessesMutation.mutate({
                  city: finderCity,
                  region: finderRegion,
                  topic: finderTopic,
                })
              }
              disabled={!finderCity || !finderTopic || findBusinessesMutation.isPending}
            >
              {findBusinessesMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Search className="h-4 w-4 mr-1" />
              )}
              {findBusinessesMutation.isPending ? "Searching…" : "Find Businesses"}
            </Button>
          </div>
          {findBusinessesMutation.isSuccess && (
            <p className="text-sm text-muted-foreground mt-2">
              Found {findBusinessesMutation.data.count} businesses — see the Business Leads tab in the city drawer.
            </p>
          )}
          {findBusinessesMutation.isError && (
            <p className="text-sm text-destructive mt-2">Search failed — check server logs.</p>
          )}
        </CardContent>
      </Card>

      {/* Stats + search */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Cities</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {data?.stats.total ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Ready</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-emerald-400">
              {data?.stats.ready ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Running</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {data?.stats.running ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Total items</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {(data?.stats.totalItems ?? 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search collected cities"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* City list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Collected cities</CardTitle>
          <CardDescription>
            Click a row to view ranked lists, generate pitches, and see directory matches.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : !data || data.cities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No cities collected yet. Use the form above to collect your first one.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">City</th>
                    <th className="px-3 py-2 text-left">Region</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Items</th>
                    <th className="px-3 py-2 text-right">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cities.map((c) => (
                    <tr
                      key={c.slug}
                      className="cursor-pointer border-t hover:bg-muted/20"
                      onClick={() => setSelectedSlug(c.slug)}
                    >
                      <td className="px-3 py-2 font-medium">{c.city}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.region ?? "—"}
                      </td>
                      <td className="px-3 py-2">{statusBadge(c.collectionStatus)}</td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                        {(
                          c.itemCounts.topSearches +
                          c.itemCounts.serviceDemand +
                          c.itemCounts.trendingTopics
                        ).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                        {formatRelative(c.collectedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CityDetailDrawer slug={selectedSlug} onClose={() => setSelectedSlug(null)} />
    </div>
  );
}
