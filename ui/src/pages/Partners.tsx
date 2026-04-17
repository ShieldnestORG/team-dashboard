import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Link } from "@/lib/router";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { partnersApi, type Partner, type CreatePartnerInput } from "../api/partners";
import {
  PartnerForm, EMPTY_FORM, formToInput, STATUS_COLORS,
  type PartnerFormState,
} from "../components/PartnerForm";
import { HowToGuide } from "../components/HowToGuide";
import {
  Handshake, Plus, MousePointerClick, FileText, TrendingUp, Users,
  ExternalLink, MapPin, ChevronRight, Globe, Wand2, Loader2,
} from "lucide-react";

const PARTNER_GUIDE_SECTIONS = [
  {
    heading: "Admin Flow",
    steps: [
      { title: "Add Partner", description: "Enter name, website, industry, location, and contact info. Click Save." },
      { title: "Auto-Onboarding", description: "AI scrapes the partner's website, classifies their industry, extracts keywords, services, and competitors automatically." },
      { title: "Review & Adjust", description: "Check the Overview tab for extracted data. Edit anything the AI got wrong in Settings. Mark as Featured for the homepage banner." },
      { title: "Monitor Performance", description: "Analytics tab shows clicks by day and source. Content tab tracks mentions. Monthly email reports fire on the 1st." },
    ],
  },
  {
    heading: "Partner (User) Flow",
    steps: [
      { title: "Gets Added", description: "Admin adds them \u2014 onboarding runs automatically, no action needed from the partner." },
      { title: "Receives Dashboard Link", description: "Copy the token-authenticated URL from Settings tab and share it. No login required." },
      { title: "Views Their Metrics", description: "Partner sees total clicks, 30-day chart, traffic sources, and content mention count on their dashboard." },
    ],
  },
  {
    heading: "Public Visitor Flow",
    steps: [
      { title: "Homepage Banner", description: "Featured partners appear in a scrollable \u201cTrusted Companies\u201d section on coherencedaddy.com." },
      { title: "Directory Page", description: "Visitors browse vetted partners by industry and location on the Trusted Companies page." },
      { title: "Click Through", description: "/go/:slug tracks the click with full metadata, then redirects to the partner\u2019s website." },
    ],
  },
  {
    heading: "Content Engine (Automatic)",
    steps: [
      { title: "Industry Matching", description: "Content crons match partners by industry keywords against the topic being generated." },
      { title: "Mention Injection", description: "Partner name + tracked redirect link woven naturally into AI-generated content." },
      { title: "Blog Footers", description: "Published blogs include a \u201cRecommended Partners\u201d footer with tracked links to deployed partners." },
      { title: "Microsite Content", description: "MWF at 8am, SEO-optimized blog posts are auto-generated for each partner\u2019s microsite." },
    ],
  },
];

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function Partners() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [prefillForm, setPrefillForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapeVersion, setScrapeVersion] = useState(0);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    setBreadcrumbs([{ label: "Partners" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    const prefillParam = searchParams.get("prefill");
    if (!prefillParam) return;
    try {
      const preFill = JSON.parse(atob(prefillParam)) as {
        name?: string;
        website?: string;
        industry?: string;
        location?: string;
        description?: string;
        contactEmail?: string;
        phone?: string;
        address?: string;
      };
      setPrefillForm({
        ...EMPTY_FORM,
        name: preFill.name ?? "",
        website: preFill.website ?? "",
        industry: preFill.industry ?? "other",
        location: preFill.location ?? "",
        description: preFill.description ?? "",
        contactEmail: preFill.contactEmail ?? "",
        phone: preFill.phone ?? "",
        address: preFill.address ?? "",
      });
      setShowCreate(true);
    } catch {
      // ignore malformed param
    }
  }, [searchParams]);

  // ---- Queries & Mutations ------------------------------------------------

  const { data, isLoading } = useQuery({
    queryKey: ["partners"],
    queryFn: () => partnersApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreatePartnerInput) => partnersApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      setShowCreate(false);
    },
  });

  // ---- Derived data -------------------------------------------------------

  const partners = data?.partners ?? [];

  const filtered = partners.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.industry.toLowerCase().includes(q) ||
      (p.location ?? "").toLowerCase().includes(q)
    );
  });

  const totalActive = partners.filter((p) => p.status === "active" || p.status === "trial").length;
  const totalClicks = partners.reduce((sum, p) => sum + (p.totalClicks ?? 0), 0);
  const totalMentions = partners.reduce((sum, p) => sum + (p.contentMentions ?? 0), 0);

  // ---- Handlers -----------------------------------------------------------

  async function handleScrape() {
    const url = scrapeUrl.trim();
    if (!url) return;
    setScraping(true);
    setScrapeError(null);
    try {
      const result = await partnersApi.prefill(url);
      setPrefillForm({
        ...EMPTY_FORM,
        name: result.name ?? "",
        website: url,
        industry: result.industry ?? "other",
        location: result.location ?? "",
        description: result.description ?? "",
        services: result.services?.join(", ") ?? "",
        targetKeywords: result.targetKeywords?.join(", ") ?? "",
        phone: result.contactInfo?.phone ?? "",
        address: result.contactInfo?.address ?? "",
        contactEmail: result.contactInfo?.email ?? "",
      });
      setScrapeVersion((v) => v + 1);
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : "Scrape failed — check the URL and try again.");
    } finally {
      setScraping(false);
    }
  }

  function handleCreate(form: PartnerFormState) {
    createMutation.mutate(formToInput(form));
  }

  // ---- Render -------------------------------------------------------------

  if (isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-primary/10 p-2">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{partners.length}</p>
              <p className="text-xs text-muted-foreground">Total Partners</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-green-500/10 p-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalActive}</p>
              <p className="text-xs text-muted-foreground">Active Partners</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-blue-500/10 p-2">
              <MousePointerClick className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalClicks.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total Clicks</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-purple-500/10 p-2">
              <FileText className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalMentions.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Content Mentions</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Flow Guide */}
      <HowToGuide sections={PARTNER_GUIDE_SECTIONS} />

      {/* Action Bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          className="sm:max-w-xs"
          placeholder="Search partners..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Partner
        </Button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <>
          {searchParams.get("prefill") && (
            <div className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded p-2">
              Pre-filled from city business lead — verify all details before saving.
            </div>
          )}

          {/* Scrape & Fill */}
          <Card className="border-dashed border-blue-400/40 bg-blue-500/5">
            <CardContent className="pt-4 pb-4 space-y-2">
              <div className="flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-blue-400 shrink-0" />
                <span className="text-sm font-medium">Scrape & Fill</span>
                <span className="text-xs text-muted-foreground">— enter the partner's website to auto-fill the form</span>
              </div>
              <div className="flex gap-2">
                <Input
                  value={scrapeUrl}
                  onChange={(e) => setScrapeUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !scraping && handleScrape()}
                  placeholder="https://example.com"
                  disabled={scraping}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleScrape}
                  disabled={!scrapeUrl.trim() || scraping}
                >
                  {scraping
                    ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
                  {scraping ? "Scraping..." : "Scrape & Fill"}
                </Button>
              </div>
              {scraping && (
                <p className="text-xs text-muted-foreground">
                  Scraping website and extracting business data — this can take 30–60 seconds...
                </p>
              )}
              {scrapeError && <p className="text-xs text-red-500">{scrapeError}</p>}
            </CardContent>
          </Card>

          <PartnerForm
            key={scrapeVersion}
            initial={prefillForm}
            onSave={handleCreate}
            onCancel={() => {
              setShowCreate(false);
              setPrefillForm(EMPTY_FORM);
              setScrapeUrl("");
              setScrapeError(null);
            }}
            saving={createMutation.isPending}
          />
        </>
      )}

      {/* Partner Table */}
      {filtered.length === 0 && !showCreate ? (
        <EmptyState
          icon={Handshake}
          message={
            search
              ? "No partners match your search."
              : "No partners yet. Add your first partner business to start driving traffic with your AEO content engine."
          }
          action={search ? undefined : "Add Partner"}
          onAction={search ? undefined : () => setShowCreate(true)}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Partner</th>
                  <th className="px-4 py-3 font-medium hidden sm:table-cell">Location</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Clicks</th>
                  <th className="px-4 py-3 font-medium text-right hidden sm:table-cell">Mentions</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Site</th>
                  <th className="px-4 py-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((partner) => (
                  <tr
                    key={partner.slug}
                    className="border-b last:border-0 hover:bg-muted/50 transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/partners/${partner.slug}`}
                        className="block"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                            {partner.name}
                          </span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {partner.industry}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {partner.tier}
                          </Badge>
                          {partner.affiliateId && partner.affiliateName && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-700 border border-amber-500/20">
                              via {partner.affiliateName}
                            </span>
                          )}
                        </div>
                        {partner.website && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Globe className="h-3 w-3" />
                            {partner.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {partner.location ? (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {partner.location}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${STATUS_COLORS[partner.status] ?? ""}`}
                      >
                        {partner.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-medium">
                        {partner.totalClicks.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      <span className="text-xs font-medium">
                        {partner.contentMentions.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <Badge variant="outline" className={`text-[10px] ${
                        partner.siteDeployStatus === "deployed" ? "bg-green-500/20 text-green-400 border-green-500/30" :
                        partner.siteDeployStatus === "building" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
                        partner.siteDeployStatus === "failed" ? "bg-red-500/20 text-red-400 border-red-500/30" :
                        "text-muted-foreground"
                      }`}>
                        {partner.siteDeployStatus === "none" ? "No site" : partner.siteDeployStatus}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/partners/${partner.slug}`}>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
