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
  { value: "settings", label: "Settings" },
];

// ---------------------------------------------------------------------------
// Helper: format date
// ---------------------------------------------------------------------------

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

function OverviewTab({ partner }: { partner: Partner }) {
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
          {partner.description && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Description</p>
              <p className="text-sm">{partner.description}</p>
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
          <InfoRow icon={Building} label="Address" value={partner.address} />
          <InfoRow icon={Phone} label="Phone" value={partner.phone} />
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

      {/* Contact & Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Contact & Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <InfoRow icon={User} label="Contact" value={partner.contactName} />
          <InfoRow icon={Mail} label="Email" value={
            partner.contactEmail ? (
              <a href={`mailto:${partner.contactEmail}`} className="text-primary hover:underline">
                {partner.contactEmail}
              </a>
            ) : null
          } />
          <div className="pt-2 border-t flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Status:</span>
              <Badge variant="outline" className={`text-xs ${STATUS_COLORS[partner.status] ?? ""}`}>
                {partner.status}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Tier:</span>
              <Badge variant="outline" className="text-xs">{partner.tier}</Badge>
            </div>
          </div>
          <div className="pt-2 border-t space-y-2">
            {partner.referralFeePerClient != null && (
              <InfoRow icon={DollarSign} label="Referral Fee" value={`$${(partner.referralFeePerClient / 100).toFixed(2)}/client/mo`} />
            )}
            {partner.monthlyFee != null && (
              <InfoRow icon={DollarSign} label="Monthly Fee" value={`$${(partner.monthlyFee / 100).toFixed(2)}/mo`} />
            )}
          </div>
          <div className="pt-2 border-t">
            <InfoRow icon={Clock} label="Partner Since" value={
              partner.partnerSince ? new Date(partner.partnerSince).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : null
            } />
          </div>
          {partner.socialHandles && Object.keys(partner.socialHandles).length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1.5">Social</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(partner.socialHandles).map(([platform, handle]) => (
                  <Badge key={platform} variant="secondary" className="text-xs">
                    {platform}: {handle}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {partner.targetKeywords && partner.targetKeywords.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                <Target className="h-3 w-3" /> Target Keywords
              </p>
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
              <div className="flex items-center gap-2">
                {Object.entries(partner.brandColors).map(([name, color]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded border" style={{ backgroundColor: color }} />
                    <span className="text-xs text-muted-foreground">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Onboarding Status */}
      <OnboardingStatus partner={partner} />

      {/* Quick Stats */}
      <Card className="lg:col-span-2">
        <CardContent className="py-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{partner.totalClicks.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total Clicks</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{partner.contentMentions.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Content Mentions</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{partner.totalClicks > 0 ? "Active" : "New"}</p>
              <p className="text-xs text-muted-foreground">Traffic Status</p>
            </div>
          </div>
        </CardContent>
      </Card>
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
    <Card className="lg:col-span-2">
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`rounded-md p-2 ${cfg.color.split(" ")[0]}`}>
              <StatusIcon className={`h-5 w-5 ${cfg.color.split(" ")[1]} ${cfg.spinning ? "animate-spin" : ""}`} />
            </div>
            <div>
              <p className="text-sm font-medium">{cfg.label}</p>
              {status === "complete" && partner.onboardingCompletedAt && (
                <p className="text-xs text-muted-foreground">
                  {fmtDateTime(partner.onboardingCompletedAt)}
                </p>
              )}
              {status === "failed" && partner.onboardingError && (
                <p className="text-xs text-red-400 max-w-md truncate">{partner.onboardingError}</p>
              )}
              {status === "none" && (
                <p className="text-xs text-muted-foreground">
                  Scan this partner's website to auto-populate keywords, industry, and competitor data.
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

function InfoRow({ icon: Icon, label, value }: { icon: typeof Globe; label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
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
      {/* Stats */}
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

      {/* Clicks by Day */}
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

      {/* Traffic Sources */}
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
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
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
// Content Tab (Placeholder for Phase 3)
// ---------------------------------------------------------------------------

function ContentTab({ partner }: { partner: Partner }) {
  const { data, isLoading } = useQuery({
    queryKey: ["partners", "site-content", partner.slug, "all"],
    queryFn: () => partnersApi.site.getContent(partner.slug, { limit: 50 }),
  });

  const items = data?.content ?? [];
  const total = data?.total ?? 0;

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
            <p className="text-2xl font-bold">{partner.contentPostCount}</p>
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

      {/* Content List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Site Content ({total})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : items.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No content generated for {partner.name}'s site yet.
                Agents will auto-generate blog posts based on the partner's target keywords and industry.
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
                      {item.metaDescription && (
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">{item.metaDescription}</span>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-xs shrink-0 ml-2 ${
                    item.status === "published" ? "bg-green-500/20 text-green-400" :
                    item.status === "queued" ? "bg-yellow-500/20 text-yellow-400" :
                    item.status === "failed" ? "bg-red-500/20 text-red-400" :
                    ""
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
// Site Tab (Placeholder for Phase 2)
// ---------------------------------------------------------------------------

const DEPLOY_STATUS_COLORS: Record<string, string> = {
  none: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  building: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  deployed: "bg-green-500/20 text-green-400 border-green-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  suspended: "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

function SiteTab({ partner }: { partner: Partner }) {
  const { data: contentData, isLoading: contentLoading } = useQuery({
    queryKey: ["partners", "site-content", partner.slug],
    queryFn: () => partnersApi.site.getContent(partner.slug, { limit: 10 }),
  });

  const siteContent = contentData?.content ?? [];
  const hasDeployedSite = partner.siteDeployStatus === "deployed" && partner.siteUrl;

  return (
    <div className="space-y-4">
      {/* Site Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            Microsite Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={`text-xs ${DEPLOY_STATUS_COLORS[partner.siteDeployStatus] ?? ""}`}>
              {partner.siteDeployStatus}
            </Badge>
            {partner.siteLastDeployedAt && (
              <span className="text-xs text-muted-foreground">
                Last deployed: {fmtDateTime(partner.siteLastDeployedAt)}
              </span>
            )}
          </div>

          {hasDeployedSite && (
            <a
              href={partner.siteUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {partner.siteUrl!.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}

          {partner.siteRepoUrl && (
            <a
              href={partner.siteRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              GitHub Repo <ExternalLink className="h-3 w-3" />
            </a>
          )}

          {partner.siteDeployStatus === "none" && (
            <p className="text-xs text-muted-foreground">
              No microsite deployed yet. Agents will build a dedicated landing page
              and blog for {partner.name} with SEO/AEO optimization.
            </p>
          )}

          {partner.website && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Current website</p>
              <a
                href={partner.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                {partner.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Baseline Analytics */}
      {partner.baselineAnalytics && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Baseline Analytics</CardTitle>
            <p className="text-xs text-muted-foreground">
              Captured {partner.baselineCapturedAt ? fmtDateTime(partner.baselineCapturedAt) : "unknown"}
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-center">
              {partner.baselineAnalytics.monthlyVisitors != null && (
                <div>
                  <p className="text-xl font-bold">{partner.baselineAnalytics.monthlyVisitors.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Monthly Visitors</p>
                </div>
              )}
              {partner.baselineAnalytics.domainAuthority != null && (
                <div>
                  <p className="text-xl font-bold">{partner.baselineAnalytics.domainAuthority}</p>
                  <p className="text-xs text-muted-foreground">Domain Authority</p>
                </div>
              )}
            </div>
            {partner.baselineAnalytics.topKeywords && partner.baselineAnalytics.topKeywords.length > 0 && (
              <div className="mt-3 pt-3 border-t">
                <p className="text-xs text-muted-foreground mb-1.5">Top Keywords</p>
                <div className="flex flex-wrap gap-1.5">
                  {partner.baselineAnalytics.topKeywords.map((kw) => (
                    <Badge key={kw} variant="outline" className="text-xs">{kw}</Badge>
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
            Site Content ({contentData?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {contentLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : siteContent.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No content generated for this partner's site yet.
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
                    item.status === "queued" ? "bg-yellow-500/20 text-yellow-400" :
                    ""
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
                  <Badge variant="secondary" className="text-xs">
                    {click.sourceType ?? "direct"}
                  </Badge>
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
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button size="sm" variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------

function SettingsTab({
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

  function handleCopyDashboardLink() {
    if (!partner.dashboardToken) return;
    const url = `${window.location.origin}/partner-dashboard/${partner.slug}?token=${partner.dashboardToken}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  }

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
              onSave={(form) => {
                onUpdate(form);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
              saving={updating}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Click Edit to modify partner details.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Dashboard Access */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Dashboard Access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Share this link with the partner so they can view their performance metrics.
          </p>
          <Button size="sm" variant="outline" onClick={handleCopyDashboardLink} disabled={!partner.dashboardToken}>
            {copiedToken ? (
              <>
                <CheckCircle className="h-3.5 w-3.5 mr-1.5 text-green-500" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Copy Dashboard Link
              </>
            )}
          </Button>
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

  // ---- Query ---------------------------------------------------------------

  const { data, isLoading } = useQuery({
    queryKey: ["partners", "detail", slug],
    queryFn: () => partnersApi.get(slug!),
    enabled: !!slug,
  });

  const partner = data?.partner ?? null;

  // ---- Breadcrumbs ---------------------------------------------------------

  useEffect(() => {
    setBreadcrumbs([
      { label: "Partners", href: "/partners" },
      { label: partner?.name ?? slug ?? "Partner" },
    ]);
  }, [setBreadcrumbs, partner, slug]);

  // ---- Mutations -----------------------------------------------------------

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

  // ---- Handlers ------------------------------------------------------------

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

  // ---- Render --------------------------------------------------------------

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
            <Badge variant="outline" className={STATUS_COLORS[partner.status] ?? ""}>
              {partner.status}
            </Badge>
          </div>
          {partner.location && (
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {partner.location}
            </p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <PageTabBar
          items={TABS}
          value={activeTab}
          onValueChange={handleTabChange}
          align="start"
        />
      </Tabs>

      {/* Tab Content */}
      {activeTab === "overview" && <OverviewTab partner={partner} />}
      {activeTab === "analytics" && <AnalyticsTab slug={partner.slug} />}
      {activeTab === "content" && <ContentTab partner={partner} />}
      {activeTab === "site" && <SiteTab partner={partner} />}
      {activeTab === "clicks" && <ClicksTab slug={partner.slug} />}
      {activeTab === "settings" && (
        <SettingsTab
          partner={partner}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          updating={updateMutation.isPending}
        />
      )}
    </div>
  );
}
