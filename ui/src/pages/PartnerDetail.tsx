import { useEffect, useState } from "react";
import { useParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useNavigate } from "@/lib/router";
import { PageSkeleton } from "../components/PageSkeleton";
import { PageTabBar, type PageTabItem } from "../components/PageTabBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { partnersApi, type Partner, type PartnerMetrics, type PartnerClick } from "../api/partners";
import {
  PartnerForm, formFromPartner, formToInput, STATUS_COLORS,
  type PartnerFormState,
} from "../components/PartnerForm";
import { partnersApi as siteApi } from "../api/partners";
import type { PartnerSiteContent, PartnerSiteConfig } from "../api/partners";
import {
  ExternalLink, MapPin, Mail, User, Phone, MousePointerClick, FileText,
  TrendingUp, Calendar, Globe, Pencil, Trash2, Copy, CheckCircle,
  ArrowLeft, Clock, Tag, Shield, DollarSign, RefreshCw, Rocket,
  Target, Palette, Building, KeyRound, Loader2, AlertCircle, Scan,
  Sparkles, Upload, CreditCard, Trophy, Send, Info,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS: PageTabItem[] = [
  { value: "overview", label: "Overview" },
  { value: "analytics", label: "Analytics" },
  { value: "content", label: "Content" },
  { value: "site", label: "Site" },
  { value: "clicks", label: "Clicks" },
  { value: "crm", label: "CRM" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Globe; label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
      <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

function OverviewTab({ partner }: { partner: Partner }) {
  const competitors = partner.baselineAnalytics?.competitorSites ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Business Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Business Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <InfoRow icon={Globe} label="Website" value={
            partner.website ? (
              <a href={partner.website} target="_blank" rel="noopener noreferrer"
                className="text-primary hover:underline flex items-center gap-1">
                {partner.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null
          } />
          <InfoRow icon={MapPin} label="Location" value={partner.location} />
          <InfoRow icon={Tag} label="Industry" value={partner.industry} />
          <InfoRow icon={Building} label="Address" value={partner.address} />
          <InfoRow icon={Phone} label="Phone" value={partner.phone} />
          {partner.description && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Description</p>
              <p className="text-sm">{partner.description}</p>
            </div>
          )}
          {partner.baselineAnalytics?.businessSummary && !partner.description && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">AI Summary</p>
              <p className="text-sm text-muted-foreground italic">{partner.baselineAnalytics.businessSummary}</p>
            </div>
          )}
          {partner.services && partner.services.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1.5">Services</p>
              <div className="flex flex-wrap gap-1.5">
                {partner.services.map((s) => (
                  <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                ))}
              </div>
            </div>
          )}
          {partner.hours && Object.keys(partner.hours).length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1.5">Hours</p>
              <div className="grid gap-1 text-xs">
                {Object.entries(partner.hours).map(([day, hrs]) => (
                  <div key={day} className="flex justify-between">
                    <span className="text-muted-foreground capitalize">{day}</span>
                    <span>{hrs}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SEO Intelligence */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            SEO Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {partner.tagline && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Tagline</p>
              <p className="text-sm italic">"{partner.tagline}"</p>
            </div>
          )}
          {partner.targetKeywords && partner.targetKeywords.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Target Keywords</p>
              <div className="flex flex-wrap gap-1.5">
                {partner.targetKeywords.map((kw) => (
                  <Badge key={kw} variant="outline" className="text-xs">{kw}</Badge>
                ))}
              </div>
            </div>
          )}
          {partner.targetAudience && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Target Audience</p>
              <p className="text-sm">{partner.targetAudience}</p>
            </div>
          )}
          {partner.brandColors && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                <Palette className="h-3 w-3" /> Brand Colors
              </p>
              <div className="flex items-center gap-3">
                {Object.entries(partner.brandColors).map(([name, color]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded border shadow-sm" style={{ backgroundColor: color }} />
                    <span className="text-xs text-muted-foreground">{name}</span>
                    <span className="text-xs font-mono text-muted-foreground">{color}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {partner.socialHandles && Object.keys(partner.socialHandles).length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1.5">Social Handles</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(partner.socialHandles).map(([platform, handle]) => (
                  <Badge key={platform} variant="secondary" className="text-xs">
                    {platform}: {handle}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {!partner.tagline && !partner.targetKeywords?.length && (
            <p className="text-xs text-muted-foreground">Run the onboarding scan to extract SEO data.</p>
          )}
        </CardContent>
      </Card>

      {/* Onboarding Status */}
      <OnboardingStatus partner={partner} />

      {/* Quick Stats */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{partner.totalClicks.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total Clicks</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{partner.contentMentions.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">CD Mentions</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{partner.contentPostCount ?? 0}</p>
              <p className="text-xs text-muted-foreground">Site Posts</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Competitor Intelligence */}
      {competitors.length > 0 && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              Competitor Intelligence
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Found during onboarding scan
              {partner.baselineCapturedAt && ` · ${fmtDate(partner.baselineCapturedAt)}`}
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {competitors.map((c) => (
                <div key={c.url} className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-tight">{c.name}</p>
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="shrink-0 mt-0.5">
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
                    </a>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{c.url.replace(/^https?:\/\//, "")}</p>
                  <p className="text-xs leading-relaxed">{c.summary}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OnboardingStatus({ partner }: { partner: Partner }) {
  const queryClient = useQueryClient();
  const onboardMutation = useMutation({
    mutationFn: () => partnersApi.triggerOnboarding(partner.slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners", "detail", partner.slug] });
    },
  });

  const status = partner.onboardingStatus;

  const statusConfig: Record<string, { icon: typeof Scan; label: string; color: string; spinning?: boolean }> = {
    none: { icon: Scan, label: "Not Scanned", color: "bg-gray-500/20 text-gray-400" },
    scraping: { icon: Loader2, label: "Scraping Site...", color: "bg-yellow-500/20 text-yellow-400", spinning: true },
    analyzing: { icon: Loader2, label: "Analyzing...", color: "bg-yellow-500/20 text-yellow-400", spinning: true },
    complete: { icon: CheckCircle, label: "Scan Complete", color: "bg-green-500/20 text-green-400" },
    failed: { icon: AlertCircle, label: "Scan Failed", color: "bg-red-500/20 text-red-400" },
  };

  const cfg = statusConfig[status] ?? statusConfig.none;
  const StatusIcon = cfg.icon;
  const isRunning = status === "scraping" || status === "analyzing";

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`rounded-md p-2 ${cfg.color.split(" ")[0]}`}>
              <StatusIcon className={`h-5 w-5 ${cfg.color.split(" ")[1]} ${cfg.spinning ? "animate-spin" : ""}`} />
            </div>
            <div>
              <p className="text-sm font-medium">{cfg.label}</p>
              {status === "complete" && partner.onboardingCompletedAt && (
                <p className="text-xs text-muted-foreground">{fmtDateTime(partner.onboardingCompletedAt)}</p>
              )}
              {status === "failed" && partner.onboardingError && (
                <p className="text-xs text-red-400 max-w-md truncate">{partner.onboardingError}</p>
              )}
              {status === "none" && (
                <p className="text-xs text-muted-foreground">
                  Scan to auto-populate keywords, industry, and competitor data.
                </p>
              )}
            </div>
          </div>
          {!isRunning && partner.website && (
            <Button
              size="sm"
              variant={status === "failed" ? "destructive" : "outline"}
              onClick={() => onboardMutation.mutate()}
              disabled={onboardMutation.isPending}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${onboardMutation.isPending ? "animate-spin" : ""}`} />
              {status === "none" ? "Scan Now" : status === "failed" ? "Retry" : "Re-scan"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Analytics Tab
// ---------------------------------------------------------------------------

function AnalyticsTab({ slug }: { slug: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["partners", "metrics", slug],
    queryFn: () => partnersApi.getMetrics(slug),
  });

  if (isLoading) return <PageSkeleton variant="list" />;
  if (!data) return <p className="text-sm text-muted-foreground">No analytics data.</p>;

  const maxClicks = Math.max(...(data.clicksByDay?.map((d) => d.count) ?? []), 1);
  const totalSourceCount = data.clicksBySource?.reduce((sum, s) => sum + s.count, 0) || 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-blue-500/10 p-2">
              <MousePointerClick className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{data.totalClicks.toLocaleString()}</p>
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
              <p className="text-2xl font-bold">{data.contentMentions.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Content Mentions</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Clicks by Day
          </CardTitle>
          <p className="text-xs text-muted-foreground">Last 30 days</p>
        </CardHeader>
        <CardContent>
          {!data.clicksByDay || data.clicksByDay.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No click data yet.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-end gap-[2px] h-40">
                {data.clicksByDay.map((day) => {
                  const heightPct = (day.count / maxClicks) * 100;
                  return (
                    <div key={day.date} className="flex-1 flex flex-col justify-end group relative">
                      <div
                        className="bg-primary hover:bg-primary/80 rounded-t transition-colors min-h-[2px] cursor-default"
                        style={{ height: `${Math.max(heightPct, 1.5)}%` }}
                      />
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 border shadow-sm">
                        {fmtDate(day.date)}: {day.count} click{day.count !== 1 ? "s" : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground pt-1">
                <span>{fmtDate(data.clicksByDay[0].date)}</span>
                {data.clicksByDay.length > 2 && (
                  <span>{fmtDate(data.clicksByDay[Math.floor(data.clicksByDay.length / 2)].date)}</span>
                )}
                <span>{fmtDate(data.clicksByDay[data.clicksByDay.length - 1].date)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Traffic Sources</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.clicksBySource || data.clicksBySource.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No source data yet.</p>
          ) : (
            <div className="space-y-3">
              {data.clicksBySource.map((source) => {
                const pct = Math.round((source.count / totalSourceCount) * 100);
                return (
                  <div key={source.source ?? "direct"} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{source.source ?? "direct"}</span>
                      <span className="text-muted-foreground text-xs">
                        {source.count.toLocaleString()} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content Tab
// ---------------------------------------------------------------------------

function ContentTab({ partner }: { partner: Partner }) {
  const queryClient = useQueryClient();
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [pubMsg, setPubMsg] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["partners", "site-content", partner.slug, "all"],
    queryFn: () => partnersApi.site.getContent(partner.slug, { limit: 50 }),
  });

  const generateMutation = useMutation({
    mutationFn: () => partnersApi.site.generateContent(partner.slug),
    onSuccess: (res) => {
      setGenMsg(`Generated: "${res.title}"`);
      queryClient.invalidateQueries({ queryKey: ["partners", "site-content", partner.slug] });
      queryClient.invalidateQueries({ queryKey: ["partners", "detail", partner.slug] });
      setTimeout(() => setGenMsg(null), 5000);
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => partnersApi.site.publishDrafts(partner.slug),
    onSuccess: (res) => {
      setPubMsg(`Published ${res.published} of ${res.total} drafts`);
      queryClient.invalidateQueries({ queryKey: ["partners", "site-content", partner.slug] });
      setTimeout(() => setPubMsg(null), 5000);
    },
  });

  const items = data?.content ?? [];
  const total = data?.total ?? 0;
  const draftCount = items.filter((i) => i.status === "draft").length;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold">{partner.contentMentions}</p>
            <p className="text-xs text-muted-foreground">CD Mentions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold">{partner.contentPostCount ?? 0}</p>
            <p className="text-xs text-muted-foreground">Site Posts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold">{items.filter((i) => i.status === "published").length}</p>
            <p className="text-xs text-muted-foreground">Published</p>
          </CardContent>
        </Card>
      </div>

      {/* AI Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Content Actions
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Generate uses {partner.name}'s target keywords and industry context
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            {generateMutation.isPending ? "Generating..." : "Generate Blog Post"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => publishMutation.mutate()}
            disabled={publishMutation.isPending || draftCount === 0}
          >
            {publishMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Upload className="h-3.5 w-3.5 mr-1.5" />}
            {publishMutation.isPending ? "Publishing..." : `Publish Drafts${draftCount > 0 ? ` (${draftCount})` : ""}`}
          </Button>
          {genMsg && <p className="text-xs text-green-500 self-center">{genMsg}</p>}
          {pubMsg && <p className="text-xs text-green-500 self-center">{pubMsg}</p>}
          {generateMutation.isError && (
            <p className="text-xs text-red-500 self-center">
              {(generateMutation.error as Error).message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Content List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Site Content ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : items.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No content yet — click "Generate Blog Post" above to create the first one.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-[10px]">{item.contentType}</Badge>
                      <span className="text-xs text-muted-foreground">{fmtDate(item.createdAt)}</span>
                      {item.publishedUrl && (
                        <a href={item.publishedUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-0.5">
                          View <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-xs shrink-0 ml-2 ${
                    item.status === "published" ? "bg-green-500/20 text-green-400" :
                    item.status === "queued" ? "bg-yellow-500/20 text-yellow-400" :
                    item.status === "failed" ? "bg-red-500/20 text-red-400" : ""
                  }`}>
                    {item.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site Tab
// ---------------------------------------------------------------------------

const DEPLOY_STATUS_COLORS: Record<string, string> = {
  none: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  building: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  deployed: "bg-green-500/20 text-green-400 border-green-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  suspended: "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

function SiteTab({ partner }: { partner: Partner }) {
  const queryClient = useQueryClient();
  const [deploying, setDeploying] = useState(false);
  const [deployMsg, setDeployMsg] = useState<string | null>(null);
  const [deployErr, setDeployErr] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const { data: contentData, isLoading: contentLoading } = useQuery({
    queryKey: ["partners", "site-content", partner.slug],
    queryFn: () => partnersApi.site.getContent(partner.slug, { limit: 10 }),
  });

  const siteContent = contentData?.content ?? [];
  const hasDeployedSite = partner.siteDeployStatus === "deployed" && partner.siteUrl;
  const baseline = partner.baselineAnalytics;
  const topKeywords = baseline?.topKeywords ?? partner.targetKeywords ?? [];

  async function handleDeploy() {
    setDeploying(true);
    setDeployMsg(null);
    setDeployErr(null);
    try {
      const result = await partnersApi.site.deploy(partner.slug);
      setDeployMsg(`Deployed: ${result.message}`);
      queryClient.invalidateQueries({ queryKey: ["partners", "detail", partner.slug] });
    } catch (err) {
      setDeployErr(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  }

  function copyDashboardLink() {
    if (!partner.dashboardToken) return;
    const url = `${window.location.origin}/partner-dashboard/${partner.slug}?token=${partner.dashboardToken}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  return (
    <div className="space-y-4">
      {/* Microsite Deploy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            Microsite
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`text-xs ${DEPLOY_STATUS_COLORS[partner.siteDeployStatus] ?? ""}`}>
                  {partner.siteDeployStatus === "none" ? "Not deployed" : partner.siteDeployStatus}
                </Badge>
                {partner.siteLastDeployedAt && (
                  <span className="text-xs text-muted-foreground">
                    Last: {fmtDateTime(partner.siteLastDeployedAt)}
                  </span>
                )}
              </div>
              {hasDeployedSite && (
                <a href={partner.siteUrl!} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  {partner.siteUrl!.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {partner.siteRepoUrl && (
                <a href={partner.siteRepoUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  GitHub Repo <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <Button
              size="sm"
              variant={partner.siteDeployStatus === "deployed" ? "outline" : "default"}
              onClick={handleDeploy}
              disabled={deploying}
            >
              {deploying
                ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                : <Rocket className="h-3.5 w-3.5 mr-1.5" />}
              {deploying ? "Deploying..." :
                partner.siteDeployStatus === "deployed" ? "Re-deploy" :
                partner.siteDeployStatus === "failed" ? "Retry Deploy" : "Deploy Microsite"}
            </Button>
          </div>
          {deployMsg && <p className="text-xs text-green-500">{deployMsg}</p>}
          {deployErr && <p className="text-xs text-red-500">{deployErr}</p>}
          {partner.siteDeployStatus === "none" && (
            <div className="rounded-md bg-muted/40 border border-dashed p-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Deploying creates a GitHub repo in ShieldnestORG, renders an HTML microsite from {partner.name}'s
                brand data, and optionally connects a Vercel project. MWF blog posts will be published to this repo automatically.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Baseline Analytics */}
      {baseline && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Baseline Analytics</CardTitle>
            {baseline.capturedAt && (
              <p className="text-xs text-muted-foreground">Captured {fmtDateTime(baseline.capturedAt)}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {(baseline.monthlyVisitors != null || baseline.domainAuthority != null) && (
              <div className="grid grid-cols-2 gap-4 text-center">
                {baseline.monthlyVisitors != null && (
                  <div>
                    <p className="text-xl font-bold">{baseline.monthlyVisitors.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Monthly Visitors</p>
                  </div>
                )}
                {baseline.domainAuthority != null && (
                  <div>
                    <p className="text-xl font-bold">{baseline.domainAuthority}</p>
                    <p className="text-xs text-muted-foreground">Domain Authority</p>
                  </div>
                )}
              </div>
            )}
            {topKeywords.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Top Keywords</p>
                <div className="flex flex-wrap gap-1.5">
                  {topKeywords.map((kw) => (
                    <Badge key={kw} variant="outline" className="text-xs">{kw}</Badge>
                  ))}
                </div>
              </div>
            )}
            {baseline.sourceBreakdown && Object.keys(baseline.sourceBreakdown).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Source Breakdown</p>
                <div className="space-y-1.5">
                  {Object.entries(baseline.sourceBreakdown).map(([src, val]) => (
                    <div key={src} className="flex justify-between text-xs">
                      <span className="text-muted-foreground capitalize">{src}</span>
                      <span className="font-medium">{val.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Site Content */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Recent Site Content ({contentData?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {contentLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : siteContent.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No content yet — go to the Content tab to generate posts.
            </p>
          ) : (
            <div className="space-y-2">
              {siteContent.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.contentType} — {fmtDate(item.createdAt)}</p>
                  </div>
                  <Badge variant="outline" className={`text-xs ${
                    item.status === "published" ? "bg-green-500/20 text-green-400" :
                    item.status === "queued" ? "bg-yellow-500/20 text-yellow-400" : ""
                  }`}>
                    {item.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clicks Tab
// ---------------------------------------------------------------------------

function ClicksTab({ slug }: { slug: string }) {
  const [page, setPage] = useState(0);
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["partners", "clicks", slug, page],
    queryFn: () => partnersApi.getClicks(slug, { limit, offset: page * limit }),
  });

  if (isLoading) return <PageSkeleton variant="list" />;

  const clicks = data?.clicks ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  if (clicks.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <MousePointerClick className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No clicks recorded yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">{total.toLocaleString()} clicks</CardTitle>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium hidden sm:table-cell">Origin</th>
              <th className="px-4 py-2 font-medium hidden md:table-cell">Visitor</th>
              <th className="px-4 py-2 font-medium hidden lg:table-cell">Referrer</th>
            </tr>
          </thead>
          <tbody>
            {clicks.map((click) => (
              <tr key={click.id} className="border-b last:border-0">
                <td className="px-4 py-2 text-xs">{fmtDateTime(click.clickedAt)}</td>
                <td className="px-4 py-2">
                  <Badge variant="secondary" className="text-xs">{click.sourceType ?? "direct"}</Badge>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground hidden sm:table-cell">
                  {click.clickOrigin ?? "cd"}
                </td>
                <td className="px-4 py-2 hidden md:table-cell">
                  <Badge variant="outline" className={`text-[10px] ${
                    click.visitorType === "agent" ? "bg-blue-500/20 text-blue-400" :
                    click.visitorType === "human" ? "bg-green-500/20 text-green-400" : ""
                  }`}>
                    {click.visitorType ?? "unknown"}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground hidden lg:table-cell truncate max-w-[200px]">
                  {click.referrer ?? "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <Button size="sm" variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CRM Tab (formerly Settings — now includes billing, access, and edit)
// ---------------------------------------------------------------------------

function CrmTab({
  partner,
  onUpdate,
  onDelete,
  updating,
}: {
  partner: Partner;
  onUpdate: (form: PartnerFormState) => void;
  onDelete: () => void;
  updating: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [welcomeMsg, setWelcomeMsg] = useState<string | null>(null);
  const [welcomeErr, setWelcomeErr] = useState<string | null>(null);

  const welcomeMutation = useMutation({
    mutationFn: () => partnersApi.sendWelcome(partner.slug),
    onSuccess: (res) => {
      setWelcomeMsg(`Sent to ${res.sentTo}`);
      setTimeout(() => setWelcomeMsg(null), 5000);
    },
    onError: (err) => {
      setWelcomeErr(err instanceof Error ? err.message : "Send failed");
      setTimeout(() => setWelcomeErr(null), 5000);
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/partners/${partner.slug}/checkout`, { method: "POST" }).then((r) => r.json()),
    onSuccess: (data) => {
      if (data.checkoutUrl) window.open(data.checkoutUrl, "_blank");
    },
  });

  function copyDashboardLink() {
    if (!partner.dashboardToken) return;
    const url = `${window.location.origin}/partner-dashboard/${partner.slug}?token=${partner.dashboardToken}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  }

  const stripeStatusColor: Record<string, string> = {
    active: "bg-green-500/20 text-green-400",
    past_due: "bg-red-500/20 text-red-400",
    canceled: "bg-gray-500/20 text-gray-400",
    checkout_sent: "bg-yellow-500/20 text-yellow-400",
    trialing: "bg-blue-500/20 text-blue-400",
  };

  return (
    <div className="space-y-4">
      {/* Edit Form */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Partner Details</CardTitle>
          {!editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {editing ? (
            <PartnerForm
              variant="inline"
              initial={formFromPartner(partner)}
              onSave={(form) => { onUpdate(form); setEditing(false); }}
              onCancel={() => setEditing(false)}
              saving={updating}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Click Edit to modify partner details.</p>
          )}
        </CardContent>
      </Card>

      {/* Partner Access */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Partner Access</CardTitle>
          <p className="text-xs text-muted-foreground">
            Dashboard is token-authenticated — no login required for the partner.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copyDashboardLink} disabled={!partner.dashboardToken}>
              {copiedToken ? (
                <><CheckCircle className="h-3.5 w-3.5 mr-1.5 text-green-500" />Copied!</>
              ) : (
                <><Copy className="h-3.5 w-3.5 mr-1.5" />Copy Dashboard Link</>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => welcomeMutation.mutate()}
              disabled={!partner.contactEmail || welcomeMutation.isPending}
              title={!partner.contactEmail ? "Add a contact email first" : ""}
            >
              {welcomeMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                : <Send className="h-3.5 w-3.5 mr-1.5" />}
              {welcomeMutation.isPending ? "Sending..." : "Send Welcome Email"}
            </Button>
          </div>
          {!partner.contactEmail && (
            <p className="text-xs text-amber-500 flex items-center gap-1">
              <Info className="h-3 w-3" /> No contact email — add one in Edit to enable welcome emails.
            </p>
          )}
          {welcomeMsg && <p className="text-xs text-green-500">{welcomeMsg}</p>}
          {welcomeErr && <p className="text-xs text-red-500">{welcomeErr}</p>}
          {partner.dashboardToken && (
            <div className="rounded-md bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground mb-1">Access Token</p>
              <code className="text-xs font-mono break-all">{partner.dashboardToken}</code>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing & Subscription */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            Billing & Subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Tier</p>
              <Badge variant="outline" className="capitalize">{partner.tier}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Status</p>
              <Badge variant="outline" className={`text-xs ${stripeStatusColor[partner.subscriptionStatus ?? ""] ?? ""}`}>
                {partner.subscriptionStatus ?? "no subscription"}
              </Badge>
            </div>
            {partner.monthlyFee != null && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Monthly Fee</p>
                <span className="text-sm font-medium">${(partner.monthlyFee / 100).toFixed(2)}/mo</span>
              </div>
            )}
            {partner.referralFeePerClient != null && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Referral Fee</p>
                <span className="text-sm font-medium">${(partner.referralFeePerClient / 100).toFixed(2)}/client</span>
              </div>
            )}
          </div>
          {partner.currentPeriodEnd && (
            <p className="text-xs text-muted-foreground">
              Period ends: {fmtDateTime(partner.currentPeriodEnd)}
            </p>
          )}
          {partner.stripeCustomerId && (
            <p className="text-xs text-muted-foreground font-mono">
              Stripe: {partner.stripeCustomerId}
            </p>
          )}
          <div className="pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => checkoutMutation.mutate()}
              disabled={checkoutMutation.isPending || !partner.contactEmail}
              title={!partner.contactEmail ? "Add a contact email first" : ""}
            >
              <CreditCard className="h-3.5 w-3.5 mr-1.5" />
              {checkoutMutation.isPending ? "Loading..." : "Send Checkout Link"}
            </Button>
            {!partner.contactEmail && (
              <p className="text-xs text-muted-foreground mt-1">Requires a contact email.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete Partner
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function PartnerDetail() {
  const { slug, tab } = useParams<{ slug: string; tab?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setBreadcrumbs } = useBreadcrumbs();
  const activeTab = tab || "overview";

  const { data, isLoading } = useQuery({
    queryKey: ["partners", "detail", slug],
    queryFn: () => partnersApi.get(slug!),
    enabled: !!slug,
  });

  const partner = data?.partner ?? null;

  useEffect(() => {
    setBreadcrumbs([
      { label: "Partners", href: "/partners" },
      { label: partner?.name ?? slug ?? "Partner" },
    ]);
  }, [setBreadcrumbs, partner, slug]);

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<Partner>) => partnersApi.update(slug!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => partnersApi.delete(slug!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      navigate("/partners");
    },
  });

  function handleTabChange(value: string) {
    navigate(`/partners/${slug}/${value}`, { replace: true });
  }

  function handleUpdate(form: PartnerFormState) {
    updateMutation.mutate(formToInput(form) as Partial<Partner>);
  }

  function handleDelete() {
    if (!window.confirm(`Delete partner "${partner?.name}"? This cannot be undone.`)) return;
    deleteMutation.mutate();
  }

  if (isLoading) return <PageSkeleton variant="list" />;

  if (!partner) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-muted-foreground">Partner not found.</p>
        <Button size="sm" variant="ghost" className="mt-4" onClick={() => navigate("/partners")}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back to Partners
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-semibold">{partner.name}</h1>
            <Badge variant="secondary">{partner.industry}</Badge>
            <Badge variant="outline" className={STATUS_COLORS[partner.status] ?? ""}>{partner.status}</Badge>
            <Badge variant="outline" className="capitalize text-xs">{partner.tier}</Badge>
          </div>
          {partner.location && (
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {partner.location}
            </p>
          )}
          {partner.website && (
            <a href={partner.website} target="_blank" rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-0.5">
              <Globe className="h-3 w-3" />
              {partner.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <PageTabBar items={TABS} value={activeTab} onValueChange={handleTabChange} align="start" />
      </Tabs>

      {/* Tab Content */}
      {activeTab === "overview" && <OverviewTab partner={partner} />}
      {activeTab === "analytics" && <AnalyticsTab slug={partner.slug} />}
      {activeTab === "content" && <ContentTab partner={partner} />}
      {activeTab === "site" && <SiteTab partner={partner} />}
      {activeTab === "clicks" && <ClicksTab slug={partner.slug} />}
      {activeTab === "crm" && (
        <CrmTab
          partner={partner}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          updating={updateMutation.isPending}
        />
      )}
    </div>
  );
}
