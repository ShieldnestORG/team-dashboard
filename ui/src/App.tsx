import { lazy, Suspense } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Layout } from "./components/Layout";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { authApi } from "./api/auth";
import { healthApi } from "./api/health";
import { queryKeys } from "./lib/queryKeys";
import { useCompany } from "./context/CompanyContext";
import { useBoardAccess } from "./hooks/useBoardAccess";
import { useDialog } from "./context/DialogContext";
import { loadLastInboxTab } from "./lib/inbox";
import { shouldRedirectCompanylessRouteToOnboarding } from "./lib/onboarding-route";

// Page components are lazy-loaded so the entry bundle only ships the shell
// (providers, layout, guards, sidebar). Each page's own chunk is fetched on
// first navigation to it. See PageLoading below for the shared fallback.
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const DailyBrief = lazy(() => import("./pages/DailyBrief").then((m) => ({ default: m.DailyBrief })));
const Inspiration = lazy(() => import("./pages/Inspiration").then((m) => ({ default: m.Inspiration })));
const Companies = lazy(() => import("./pages/Companies").then((m) => ({ default: m.Companies })));
const Agents = lazy(() => import("./pages/Agents").then((m) => ({ default: m.Agents })));
const AgentDetail = lazy(() => import("./pages/AgentDetail").then((m) => ({ default: m.AgentDetail })));
const Projects = lazy(() => import("./pages/Projects").then((m) => ({ default: m.Projects })));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail").then((m) => ({ default: m.ProjectDetail })));
const Issues = lazy(() => import("./pages/Issues").then((m) => ({ default: m.Issues })));
const IssueDetail = lazy(() => import("./pages/IssueDetail").then((m) => ({ default: m.IssueDetail })));
const Routines = lazy(() => import("./pages/Routines").then((m) => ({ default: m.Routines })));
const RoutineDetail = lazy(() => import("./pages/RoutineDetail").then((m) => ({ default: m.RoutineDetail })));
const ExecutionWorkspaceDetail = lazy(() => import("./pages/ExecutionWorkspaceDetail").then((m) => ({ default: m.ExecutionWorkspaceDetail })));
const Goals = lazy(() => import("./pages/Goals").then((m) => ({ default: m.Goals })));
const GoalDetail = lazy(() => import("./pages/GoalDetail").then((m) => ({ default: m.GoalDetail })));
const Approvals = lazy(() => import("./pages/Approvals").then((m) => ({ default: m.Approvals })));
const ApprovalDetail = lazy(() => import("./pages/ApprovalDetail").then((m) => ({ default: m.ApprovalDetail })));
const Costs = lazy(() => import("./pages/Costs").then((m) => ({ default: m.Costs })));
const Activity = lazy(() => import("./pages/Activity").then((m) => ({ default: m.Activity })));
const Members = lazy(() => import("./pages/Members").then((m) => ({ default: m.Members })));
const Inbox = lazy(() => import("./pages/Inbox").then((m) => ({ default: m.Inbox })));
const CompanySettings = lazy(() => import("./pages/CompanySettings").then((m) => ({ default: m.CompanySettings })));
const CompanySkills = lazy(() => import("./pages/CompanySkills").then((m) => ({ default: m.CompanySkills })));
const CompanyExport = lazy(() => import("./pages/CompanyExport").then((m) => ({ default: m.CompanyExport })));
const CompanyImport = lazy(() => import("./pages/CompanyImport").then((m) => ({ default: m.CompanyImport })));
const DesignGuide = lazy(() => import("./pages/DesignGuide").then((m) => ({ default: m.DesignGuide })));
const InstanceGeneralSettings = lazy(() => import("./pages/InstanceGeneralSettings").then((m) => ({ default: m.InstanceGeneralSettings })));
const InstanceSettings = lazy(() => import("./pages/InstanceSettings").then((m) => ({ default: m.InstanceSettings })));
const InstanceExperimentalSettings = lazy(() => import("./pages/InstanceExperimentalSettings").then((m) => ({ default: m.InstanceExperimentalSettings })));
const PluginManager = lazy(() => import("./pages/PluginManager").then((m) => ({ default: m.PluginManager })));
const PluginSettings = lazy(() => import("./pages/PluginSettings").then((m) => ({ default: m.PluginSettings })));
const PluginPage = lazy(() => import("./pages/PluginPage").then((m) => ({ default: m.PluginPage })));
const RunTranscriptUxLab = lazy(() => import("./pages/RunTranscriptUxLab").then((m) => ({ default: m.RunTranscriptUxLab })));
const TwitterDashboard = lazy(() => import("./pages/TwitterDashboard").then((m) => ({ default: m.TwitterDashboard })));
const ContentHub = lazy(() => import("./pages/content-hub/ContentHub").then((m) => ({ default: m.ContentHub })));
const SocialsLayout = lazy(() => import("./pages/socials/SocialsLayout").then((m) => ({ default: m.SocialsLayout })));
const SocialsContentLayout = lazy(() => import("./pages/socials/SocialsContentLayout").then((m) => ({ default: m.SocialsContentLayout })));
const LaunchMonitor = lazy(() => import("./pages/socials/LaunchMonitor").then((m) => ({ default: m.LaunchMonitor })));
const TxEcosystem = lazy(() => import("./pages/TxEcosystem").then((m) => ({ default: m.TxEcosystem })));
const Tokns = lazy(() => import("./pages/Tokns"));
const SystemHealth = lazy(() => import("./pages/SystemHealth").then((m) => ({ default: m.SystemHealth })));
const ContentReview = lazy(() => import("./pages/ContentReview").then((m) => ({ default: m.ContentReview })));
const CreditScoreReview = lazy(() => import("./pages/CreditScoreReview").then((m) => ({ default: m.CreditScoreReview })));
const ContentAnalytics = lazy(() => import("./pages/ContentAnalytics").then((m) => ({ default: m.ContentAnalytics })));
const SiteAnalytics = lazy(() => import("./pages/SiteAnalytics").then((m) => ({ default: m.SiteAnalytics })));
const OwnedSites = lazy(() => import("./pages/OwnedSites").then((m) => ({ default: m.OwnedSites })));
const Structure = lazy(() => import("./pages/Structure").then((m) => ({ default: m.Structure })));
const TopicTakeoverFlow = lazy(() => import("./pages/TopicTakeoverFlow").then((m) => ({ default: m.TopicTakeoverFlow })));
const Intel = lazy(() => import("./pages/Intel").then((m) => ({ default: m.Intel })));
const KnowledgeGraph = lazy(() => import("./pages/KnowledgeGraph").then((m) => ({ default: m.KnowledgeGraph })));
const CityCollector = lazy(() => import("./pages/CityCollector").then((m) => ({ default: m.CityCollector })));
const RepoUpdates = lazy(() => import("./pages/RepoUpdates").then((m) => ({ default: m.RepoUpdates })));
const AutomationHealth = lazy(() => import("./pages/AutomationHealth").then((m) => ({ default: m.AutomationHealth })));
const IntelPricing = lazy(() => import("./pages/IntelPricing").then((m) => ({ default: m.IntelPricing })));
const IntelBillingSuccess = lazy(() => import("./pages/IntelBillingSuccess").then((m) => ({ default: m.IntelBillingSuccess })));
const IntelBilling = lazy(() => import("./pages/IntelBilling").then((m) => ({ default: m.IntelBilling })));
const WatchtowerAdmin = lazy(() => import("./pages/WatchtowerAdmin").then((m) => ({ default: m.WatchtowerAdmin })));
const UniversityAdmin = lazy(() => import("./pages/UniversityAdmin").then((m) => ({ default: m.UniversityAdmin })));
const UniversityAgentsAdmin = lazy(() => import("./pages/UniversityAgentsAdmin").then((m) => ({ default: m.UniversityAgentsAdmin })));
const SessionsAdmin = lazy(() => import("./pages/SessionsAdmin").then((m) => ({ default: m.SessionsAdmin })));
const UniversityEmailAnalytics = lazy(() => import("./pages/UniversityEmailAnalytics").then((m) => ({ default: m.UniversityEmailAnalytics })));
const Funnels = lazy(() => import("./pages/Funnels").then((m) => ({ default: m.Funnels })));
const DirectoryPricing = lazy(() => import("./pages/DirectoryPricing").then((m) => ({ default: m.DirectoryPricing })));
const Bundles = lazy(() => import("./pages/Bundles").then((m) => ({ default: m.Bundles })));
const Discord = lazy(() => import("./pages/Discord").then((m) => ({ default: m.Discord })));
const AutoReply = lazy(() => import("./pages/AutoReply").then((m) => ({ default: m.AutoReply })));
const CronManagement = lazy(() => import("./pages/CronManagement").then((m) => ({ default: m.CronManagement })));
const AgentOps = lazy(() => import("./pages/AgentOps").then((m) => ({ default: m.AgentOps })));
const ApiDashboard = lazy(() => import("./pages/ApiDashboard").then((m) => ({ default: m.ApiDashboard })));
const YouTubePipeline = lazy(() => import("./pages/YouTubePipeline").then((m) => ({ default: m.YouTubePipeline })));
const YouTubeVideos = lazy(() => import("./pages/YouTubeVideos").then((m) => ({ default: m.YouTubeVideos })));
const VideoEdit = lazy(() => import("./pages/VideoEdit").then((m) => ({ default: m.VideoEdit })));
const MarketingPushes = lazy(() => import("./pages/MarketingPushes").then((m) => ({ default: m.MarketingPushes })));
const Partners = lazy(() => import("./pages/Partners").then((m) => ({ default: m.Partners })));
const AffiliatesAdmin = lazy(() => import("./pages/AffiliatesAdmin").then((m) => ({ default: m.AffiliatesAdmin })));
const PartnerDetail = lazy(() => import("./pages/PartnerDetail").then((m) => ({ default: m.PartnerDetail })));
const PartnerDashboard = lazy(() => import("./pages/PartnerDashboard").then((m) => ({ default: m.PartnerDashboard })));
const AffiliateLanding = lazy(() => import("./pages/AffiliateLanding").then((m) => ({ default: m.AffiliateLanding })));
const AffiliateDashboard = lazy(() => import("./pages/AffiliateDashboard").then((m) => ({ default: m.AffiliateDashboard })));
const AffiliateEarnings = lazy(() => import("./pages/AffiliateEarnings").then((m) => ({ default: m.AffiliateEarnings })));
const AffiliatePayouts = lazy(() => import("./pages/AffiliatePayouts").then((m) => ({ default: m.AffiliatePayouts })));
const AffiliateTiers = lazy(() => import("./pages/AffiliateTiers").then((m) => ({ default: m.AffiliateTiers })));
const AffiliateLearn = lazy(() => import("./pages/AffiliateLearn").then((m) => ({ default: m.AffiliateLearn })));
const AffiliateLearnGuide = lazy(() => import("./pages/AffiliateLearnGuide").then((m) => ({ default: m.AffiliateLearnGuide })));
const AffiliateProgramRules = lazy(() => import("./pages/AffiliateProgramRules").then((m) => ({ default: m.AffiliateProgramRules })));
const AffiliateClawbacks = lazy(() => import("./pages/AffiliateClawbacks").then((m) => ({ default: m.AffiliateClawbacks })));
const AffiliateLeaderboard = lazy(() => import("./pages/AffiliateLeaderboard").then((m) => ({ default: m.AffiliateLeaderboard })));
const AffiliatePromo = lazy(() => import("./pages/AffiliatePromo").then((m) => ({ default: m.AffiliatePromo })));
const AffiliateMerch = lazy(() => import("./pages/AffiliateMerch").then((m) => ({ default: m.AffiliateMerch })));
const AffiliateLeadDetail = lazy(() => import("./pages/AffiliateLeadDetail").then((m) => ({ default: m.AffiliateLeadDetail })));
const AffiliateProspectDetail = lazy(() => import("./pages/AffiliateProspectDetail").then((m) => ({ default: m.AffiliateProspectDetail })));
const AffiliateResetPassword = lazy(() => import("./pages/AffiliateResetPassword").then((m) => ({ default: m.AffiliateResetPassword })));
const AffiliateAdminCommissions = lazy(() => import("./pages/AffiliateAdminCommissions").then((m) => ({ default: m.AffiliateAdminCommissions })));
const AffiliateAdminPayouts = lazy(() => import("./pages/AffiliateAdminPayouts").then((m) => ({ default: m.AffiliateAdminPayouts })));
const AffiliateAdminClawbacks = lazy(() => import("./pages/AffiliateAdminClawbacks").then((m) => ({ default: m.AffiliateAdminClawbacks })));
const AffiliateAdminLeads = lazy(() => import("./pages/AffiliateAdminLeads").then((m) => ({ default: m.AffiliateAdminLeads })));
const AffiliateAdminLeadDetail = lazy(() => import("./pages/AffiliateAdminLeadDetail").then((m) => ({ default: m.AffiliateAdminLeadDetail })));
const AffiliateAdminCompliance = lazy(() => import("./pages/AffiliateAdminCompliance").then((m) => ({ default: m.AffiliateAdminCompliance })));
const AffiliateAdminEngagement = lazy(() => import("./pages/AffiliateAdminEngagement").then((m) => ({ default: m.AffiliateAdminEngagement })));
const AffiliateAdminTiers = lazy(() => import("./pages/AffiliateAdminTiers").then((m) => ({ default: m.AffiliateAdminTiers })));
const AffiliateAdminCampaigns = lazy(() => import("./pages/AffiliateAdminCampaigns").then((m) => ({ default: m.AffiliateAdminCampaigns })));
const AffiliateAdminMerch = lazy(() => import("./pages/AffiliateAdminMerch").then((m) => ({ default: m.AffiliateAdminMerch })));
const HouseAdsAdmin = lazy(() => import("./pages/HouseAdsAdmin").then((m) => ({ default: m.HouseAdsAdmin })));
const ShopSharersAdmin = lazy(() => import("./pages/ShopSharersAdmin").then((m) => ({ default: m.ShopSharersAdmin })));
const OrgChart = lazy(() => import("./pages/OrgChart").then((m) => ({ default: m.OrgChart })));
const NewAgent = lazy(() => import("./pages/NewAgent").then((m) => ({ default: m.NewAgent })));
const AuthPage = lazy(() => import("./pages/Auth").then((m) => ({ default: m.AuthPage })));
const ResetPasswordPage = lazy(() => import("./pages/ResetPassword").then((m) => ({ default: m.ResetPasswordPage })));
const BoardClaimPage = lazy(() => import("./pages/BoardClaim").then((m) => ({ default: m.BoardClaimPage })));
const CliAuthPage = lazy(() => import("./pages/CliAuth").then((m) => ({ default: m.CliAuthPage })));
const InviteLandingPage = lazy(() => import("./pages/InviteLanding").then((m) => ({ default: m.InviteLandingPage })));
const NotFoundPage = lazy(() => import("./pages/NotFound").then((m) => ({ default: m.NotFoundPage })));

function PageLoading() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function BootstrapPendingPage({ hasActiveInvite = false }: { hasActiveInvite?: boolean }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Instance setup required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {hasActiveInvite
            ? "No instance admin exists yet. A bootstrap invite is already active. Check your Team Dashboard startup logs for the first admin invite URL, or run this command to rotate it:"
            : "No instance admin exists yet. Run this command in your Team Dashboard environment to generate the first admin invite URL:"}
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
{`pnpm paperclipai auth bootstrap-ceo`}
        </pre>
      </div>
    </div>
  );
}

function CloudAccessGate() {
  const location = useLocation();
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data as
        | { deploymentMode?: "local_trusted" | "authenticated"; bootstrapStatus?: "ready" | "bootstrap_pending" }
        | undefined;
      return data?.deploymentMode === "authenticated" && data.bootstrapStatus === "bootstrap_pending"
        ? 2000
        : false;
    },
    refetchIntervalInBackground: true,
  });

  const isAuthenticatedMode = healthQuery.data?.deploymentMode === "authenticated";
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    enabled: isAuthenticatedMode,
    retry: false,
  });

  if (healthQuery.isLoading || (isAuthenticatedMode && sessionQuery.isLoading)) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  if (healthQuery.error) {
    return (
      <div className="mx-auto max-w-xl py-10 text-sm text-destructive">
        {healthQuery.error instanceof Error ? healthQuery.error.message : "Failed to load app state"}
      </div>
    );
  }

  if (isAuthenticatedMode && healthQuery.data?.bootstrapStatus === "bootstrap_pending") {
    return <BootstrapPendingPage hasActiveInvite={healthQuery.data.bootstrapInviteActive} />;
  }

  if (isAuthenticatedMode && !sessionQuery.data) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }

  return <Outlet />;
}

function boardRoutes() {
  return (
    <Route element={<MarketingRouteGate />}>
      <Route index element={<BoardIndexRedirect />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="onboarding" element={<OnboardingRoutePage />} />
      <Route path="companies" element={<Companies />} />
      <Route path="company/settings" element={<CompanySettings />} />
      <Route path="company/export/*" element={<CompanyExport />} />
      <Route path="company/import" element={<CompanyImport />} />
      <Route path="skills/*" element={<CompanySkills />} />
      <Route path="settings" element={<LegacySettingsRedirect />} />
      <Route path="settings/*" element={<LegacySettingsRedirect />} />
      <Route path="plugins/:pluginId" element={<PluginPage />} />
      <Route path="org" element={<OrgChart />} />
      <Route path="agents" element={<Navigate to="/agents/all" replace />} />
      <Route path="agents/all" element={<Agents />} />
      <Route path="agents/active" element={<Agents />} />
      <Route path="agents/paused" element={<Agents />} />
      <Route path="agents/error" element={<Agents />} />
      <Route path="agents/new" element={<NewAgent />} />
      <Route path="agents/:agentId" element={<AgentDetail />} />
      <Route path="agents/:agentId/:tab" element={<AgentDetail />} />
      <Route path="agents/:agentId/runs/:runId" element={<AgentDetail />} />
      <Route path="projects" element={<Projects />} />
      <Route path="projects/:projectId" element={<ProjectDetail />} />
      <Route path="projects/:projectId/overview" element={<ProjectDetail />} />
      <Route path="projects/:projectId/issues" element={<ProjectDetail />} />
      <Route path="projects/:projectId/issues/:filter" element={<ProjectDetail />} />
      <Route path="projects/:projectId/configuration" element={<ProjectDetail />} />
      <Route path="projects/:projectId/budget" element={<ProjectDetail />} />
      <Route path="issues" element={<Issues />} />
      <Route path="issues/all" element={<Navigate to="/issues" replace />} />
      <Route path="issues/active" element={<Navigate to="/issues" replace />} />
      <Route path="issues/backlog" element={<Navigate to="/issues" replace />} />
      <Route path="issues/done" element={<Navigate to="/issues" replace />} />
      <Route path="issues/recent" element={<Navigate to="/issues" replace />} />
      <Route path="issues/:issueId" element={<IssueDetail />} />
      <Route path="routines" element={<Routines />} />
      <Route path="routines/:routineId" element={<RoutineDetail />} />
      <Route path="execution-workspaces/:workspaceId" element={<ExecutionWorkspaceDetail />} />
      <Route path="goals" element={<Goals />} />
      <Route path="goals/:goalId" element={<GoalDetail />} />
      <Route path="approvals" element={<Navigate to="/approvals/pending" replace />} />
      <Route path="approvals/pending" element={<Approvals />} />
      <Route path="approvals/all" element={<Approvals />} />
      <Route path="approvals/:approvalId" element={<ApprovalDetail />} />
      <Route path="costs" element={<Costs />} />
      <Route path="activity" element={<Activity />} />
      <Route path="members" element={<Members />} />
      <Route path="socials" element={<SocialsContentLayout />}>
        <Route index element={<SocialsLayout />} />
        <Route path="content" element={<ContentReview />} />
        <Route path="analytics" element={<ContentAnalytics />} />
        <Route path="twitter" element={<TwitterDashboard />} />
        <Route path="discord" element={<Discord />} />
        <Route path="youtube" element={<YouTubePipeline />} />
        <Route path="pushes" element={<MarketingPushes />} />
        <Route path="house-ads" element={<HouseAdsAdmin />} />
        <Route path="auto-reply" element={<AutoReply />} />
        <Route path="launch-monitor" element={<LaunchMonitor />} />
      </Route>
      <Route path="content-hub" element={<ContentHub />} />
      <Route path="twitter" element={<Navigate to="/socials/twitter" replace />} />
      <Route path="discord" element={<Navigate to="/socials/discord" replace />} />
      <Route path="tx-ecosystem" element={<TokProductRoute page="tx-ecosystem" />} />
      <Route path="tokns" element={<TokProductRoute page="tokns" />} />
      <Route path="auto-reply" element={<Navigate to="/socials/auto-reply" replace />} />
      <Route path="system-health" element={<SystemHealth />} />
      <Route path="api-routes" element={<ApiDashboard />} />
      <Route path="agent-ops" element={<AgentOps />} />
      <Route path="crons" element={<CronManagement />} />
      <Route path="content-review" element={<Navigate to="/socials/content" replace />} />
      <Route path="creditscore-review" element={<Navigate to="/creditscore-review/leads" replace />} />
      <Route path="creditscore-review/leads" element={<CreditScoreReview />} />
      <Route path="creditscore-review/drafts" element={<CreditScoreReview />} />
      <Route path="creditscore-review/impls" element={<CreditScoreReview />} />
      <Route path="creditscore-review/scans" element={<CreditScoreReview />} />
      <Route path="creditscore-review/docs" element={<CreditScoreReview />} />
      <Route path="content-analytics" element={<Navigate to="/socials/analytics" replace />} />
      <Route path="site-analytics" element={<SiteAnalytics />} />
      <Route path="owned-sites" element={<OwnedSites />} />
      <Route path="structure" element={<Structure />} />
      <Route path="topic-takeover" element={<TopicTakeoverFlow />} />
      <Route path="marketing-pushes" element={<Navigate to="/socials/pushes" replace />} />
      <Route path="affiliates" element={<AffiliatesAdmin />} />
      <Route path="affiliates/leads" element={<AffiliateAdminLeads />} />
      <Route path="affiliates/leads/:id" element={<AffiliateAdminLeadDetail />} />
      <Route path="affiliates/attribution" element={<AffiliateAdminLeads />} />
      <Route path="affiliates/commissions" element={<AffiliateAdminCommissions />} />
      <Route path="affiliates/payouts" element={<AffiliateAdminPayouts />} />
      <Route path="affiliates/clawbacks" element={<AffiliateAdminClawbacks />} />
      <Route path="affiliates/compliance" element={<AffiliateAdminCompliance />} />
      <Route path="affiliates/engagement" element={<AffiliateAdminEngagement />} />
      <Route path="affiliates/tiers" element={<AffiliateAdminTiers />} />
      <Route path="affiliates/campaigns" element={<AffiliateAdminCampaigns />} />
      <Route path="affiliates/merch" element={<AffiliateAdminMerch />} />
      <Route path="house-ads" element={<Navigate to="/socials/house-ads" replace />} />
      <Route path="shop-sharers" element={<ShopSharersAdmin />} />
      <Route path="partners" element={<Partners />} />
      <Route path="partners/:slug" element={<PartnerDetail />} />
      <Route path="partners/:slug/:tab" element={<PartnerDetail />} />
      <Route path="youtube" element={<Navigate to="/socials/youtube" replace />} />
      <Route path="youtube/videos" element={<YouTubeVideos />} />
      <Route path="video-edit" element={<VideoEdit />} />
      <Route path="intel" element={<Intel />} />
      <Route path="intel/:tab" element={<Intel />} />
      <Route path="intel-billing" element={<IntelBilling />} />
      <Route path="watchtower" element={<WatchtowerAdmin />} />
      <Route path="university" element={<UniversityAdmin />} />
      <Route path="community-agents" element={<UniversityAgentsAdmin />} />
      <Route path="sessions" element={<SessionsAdmin />} />
      <Route path="university-emails" element={<UniversityEmailAnalytics />} />
      <Route path="funnels" element={<Funnels />} />
      <Route path="daily-brief" element={<DailyBrief />} />
      <Route path="inspiration" element={<Inspiration />} />
      <Route path="knowledge-graph" element={<KnowledgeGraph />} />
      <Route path="cities" element={<CityCollector />} />
      <Route path="repo-updates" element={<RepoUpdates />} />
      <Route path="automation-health" element={<AutomationHealth />} />
      <Route path="inbox" element={<InboxRootRedirect />} />
      <Route path="inbox/mine" element={<Inbox />} />
      <Route path="inbox/recent" element={<Inbox />} />
      <Route path="inbox/unread" element={<Inbox />} />
      <Route path="inbox/all" element={<Inbox />} />
      <Route path="inbox/new" element={<Navigate to="/inbox/mine" replace />} />
      <Route path="design-guide" element={<DesignGuide />} />
      <Route path="tests/ux/runs" element={<RunTranscriptUxLab />} />
      <Route path=":pluginRoutePath" element={<PluginPage />} />
      <Route path="*" element={<NotFoundPage scope="board" />} />
    </Route>
  );
}

/**
 * Board route roots a marketing-only user can open. Every root here must be
 * backed by the server's marketing-role-gate API allowlist
 * (server/src/middleware/marketing-role-gate.ts) — a route whose data calls
 * the gate 403s must NOT be listed, or the user's first screen is a wall of
 * failed requests. Dashboard/Inbox are deliberately absent: their reads
 * (/api/companies/:id/dashboard, approvals, heartbeats, issues) are blocked
 * server-side; marketing users land on the Content Hub instead. This
 * client-side gate is a courtesy — the middleware is the real enforcement.
 */
const MARKETING_ROUTE_ROOTS = new Set(["socials", "content-hub", "daily-brief", "inspiration"]);

function MarketingRouteGate() {
  const { isMarketingOnly, isLoading } = useBoardAccess();
  const location = useLocation();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();

  // Until the access snapshot resolves we don't know whether this user is
  // marketing-scoped. Hold rendering so a blocked page never mounts and
  // fires a burst of 403 requests during the loading window.
  if (isLoading) return null;
  if (!isMarketingOnly) return <Outlet />;

  const segments = location.pathname.split("/").filter(Boolean);
  const relative =
    companyPrefix && segments[0]?.toUpperCase() === companyPrefix.toUpperCase()
      ? segments.slice(1)
      : segments;
  // The bare board index is allowed: BoardIndexRedirect immediately sends
  // marketing users to the Content Hub.
  if (relative.length === 0) return <Outlet />;
  const root = relative[0]!.toLowerCase();
  if (MARKETING_ROUTE_ROOTS.has(root)) return <Outlet />;

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">You don't have access to this page</h1>
        <p className="mt-2 text-base text-muted-foreground">
          Your account is set up for marketing work — kits, socials, and voice snippets. Ask Mark
          if you need more.
        </p>
        <div className="mt-4">
          <Button asChild>
            <Link to="/content-hub">Go to the Content Hub</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Tokns + TX Ecosystem live under the TOK (Tokns) project — see
 * docs/tokns-project.md. Old links under other prefixes (/CD/tokns, bare
 * /tokns via Layout's auto-correct) redirect to the TOK-prefixed path.
 * Loop-proof: under /TOK the active prefix matches, so the page renders.
 * If no TOK company exists yet (fresh instance), render the page in place
 * instead of redirecting into an invalid-prefix 404.
 *
 * The redirect target carries an explicit known prefix, so the router
 * wrapper's Navigate leaves it untouched (extractCompanyPrefixFromPath
 * recognizes TOK once the company exists — and the redirect only fires then).
 */
function TokProductRoute({ page }: { page: "tokns" | "tx-ecosystem" }) {
  const { companies } = useCompany();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();
  const location = useLocation();

  const tokExists = companies.some((company) => company.issuePrefix.toUpperCase() === "TOK");
  const activePrefix = companyPrefix?.toUpperCase() ?? null;
  if (tokExists && activePrefix !== "TOK") {
    return <Navigate to={`/TOK/${page}${location.search}${location.hash}`} replace />;
  }

  return page === "tokns" ? <Tokns /> : <TxEcosystem />;
}

function BoardIndexRedirect() {
  const { companies, loading } = useCompany();
  const { isMarketingOnly, isLoading: accessLoading } = useBoardAccess();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();

  // The board index redirect is relative, so it must only fire when the
  // ":companyPrefix" segment is a real company. For a bare board path like
  // /dashboard the segment is a route root, and redirecting relative to it
  // would double the segment (/dashboard/dashboard) before Layout's
  // auto-correct effect gets a chance to prepend the real prefix.
  if (loading || accessLoading) return null;
  if (
    companyPrefix &&
    !companies.some((company) => company.issuePrefix.toUpperCase() === companyPrefix.toUpperCase())
  ) {
    return null;
  }

  // Marketing-only users land on the Content Hub — the Dashboard's data
  // reads are blocked by the server's marketing-role gate.
  return <Navigate to={isMarketingOnly ? "content-hub" : "dashboard"} replace />;
}

function InboxRootRedirect() {
  return <Navigate to={`/inbox/${loadLastInboxTab()}`} replace />;
}

function LegacySettingsRedirect() {
  const location = useLocation();
  return <Navigate to={`/instance/settings/general${location.search}${location.hash}`} replace />;
}

function OnboardingRoutePage() {
  const { companies } = useCompany();
  const { openOnboarding } = useDialog();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();
  const matchedCompany = companyPrefix
    ? companies.find((company) => company.issuePrefix.toUpperCase() === companyPrefix.toUpperCase()) ?? null
    : null;

  const title = matchedCompany
    ? `Add another agent to ${matchedCompany.name}`
    : companies.length > 0
      ? "Create another company"
      : "Create your first company";
  const description = matchedCompany
    ? "Run onboarding again to add an agent and a starter task for this company."
    : companies.length > 0
      ? "Run onboarding again to create another company and seed its first agent."
      : "Get started by creating a company and your first agent.";

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-4">
          <Button
            onClick={() =>
              matchedCompany
                ? openOnboarding({ initialStep: 2, companyId: matchedCompany.id })
                : openOnboarding()
            }
          >
            {matchedCompany ? "Add Agent" : "Start Onboarding"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CompanyRootRedirect() {
  const { companies, selectedCompany, loading } = useCompany();
  const location = useLocation();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    return <NoCompaniesStartPage />;
  }

  // Land on the board INDEX, not /dashboard directly: BoardIndexRedirect is
  // role-aware (marketing-only users go to the Content Hub, everyone else to
  // the Dashboard). Hardcoding /dashboard here made a marketing user's very
  // first screen the no-access card.
  return <Navigate to={`/${targetCompany.issuePrefix}`} replace />;
}

function UnprefixedBoardRedirect() {
  const location = useLocation();
  const { companies, selectedCompany, loading } = useCompany();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    return <NoCompaniesStartPage />;
  }

  return (
    <Navigate
      to={`/${targetCompany.issuePrefix}${location.pathname}${location.search}${location.hash}`}
      replace
    />
  );
}

function NoCompaniesStartPage() {
  const { openOnboarding } = useDialog();

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Create your first company</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Get started by creating a company.
        </p>
        <div className="mt-4">
          <Button onClick={() => openOnboarding()}>New Company</Button>
        </div>
      </div>
    </div>
  );
}

const IS_AFFILIATES_SUBDOMAIN =
  typeof window !== "undefined" &&
  (window.location.hostname.startsWith("affiliates.") ||
    ((window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
      new URLSearchParams(window.location.search).get("affiliate") === "1"));

function AffiliateSite() {
  return (
    <div className="h-screen overflow-y-auto">
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route index element={<AffiliateLanding />} />
          <Route path="dashboard" element={<AffiliateDashboard />} />
          <Route path="earnings" element={<AffiliateEarnings />} />
          <Route path="payouts" element={<AffiliatePayouts />} />
          <Route path="clawbacks" element={<AffiliateClawbacks />} />
          <Route path="tiers" element={<AffiliateTiers />} />
          <Route path="learn" element={<AffiliateLearn />} />
          <Route path="learn/:slug" element={<AffiliateLearnGuide />} />
          <Route path="program-rules" element={<AffiliateProgramRules />} />
          <Route path="affiliate-program-rules" element={<Navigate to="/program-rules" replace />} />
          <Route path="leaderboard" element={<AffiliateLeaderboard />} />
          <Route path="promo" element={<AffiliatePromo />} />
          <Route path="merch" element={<AffiliateMerch />} />
          <Route path="prospects/:slug" element={<AffiliateProspectDetail />} />
          <Route path="affiliate/leads/:id" element={<AffiliateLeadDetail />} />
          <Route path="reset-password" element={<AffiliateResetPassword />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}

export function App() {
  if (IS_AFFILIATES_SUBDOMAIN) {
    return <AffiliateSite />;
  }

  return (
    <>
      <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="auth" element={<AuthPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="board-claim/:token" element={<BoardClaimPage />} />
        <Route path="cli-auth/:id" element={<CliAuthPage />} />
        <Route path="invite/:token" element={<InviteLandingPage />} />
        <Route path="partner-dashboard/:slug" element={<PartnerDashboard />} />
        <Route path="affiliate/leads/:id" element={<AffiliateLeadDetail />} />
        <Route path="intel/pricing" element={<IntelPricing />} />
        <Route path="directory-pricing" element={<DirectoryPricing />} />
        <Route path="bundles" element={<Bundles />} />
        <Route path="billing/success" element={<IntelBillingSuccess />} />

        <Route element={<CloudAccessGate />}>
          <Route index element={<CompanyRootRedirect />} />
          <Route path="onboarding" element={<OnboardingRoutePage />} />
          <Route path="instance" element={<Navigate to="/instance/settings/general" replace />} />
          <Route path="instance/settings" element={<Layout />}>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="general" element={<InstanceGeneralSettings />} />
            <Route path="heartbeats" element={<InstanceSettings />} />
            <Route path="experimental" element={<InstanceExperimentalSettings />} />
            <Route path="plugins" element={<PluginManager />} />
            <Route path="plugins/:pluginId" element={<PluginSettings />} />
          </Route>
          <Route path="companies" element={<UnprefixedBoardRedirect />} />
          <Route path="issues" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/:issueId" element={<UnprefixedBoardRedirect />} />
          <Route path="routines" element={<UnprefixedBoardRedirect />} />
          <Route path="routines/:routineId" element={<UnprefixedBoardRedirect />} />
          <Route path="skills/*" element={<UnprefixedBoardRedirect />} />
          <Route path="settings" element={<LegacySettingsRedirect />} />
          <Route path="settings/*" element={<LegacySettingsRedirect />} />
          <Route path="agents" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/new" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/runs/:runId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/overview" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues/:filter" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/configuration" element={<UnprefixedBoardRedirect />} />
          <Route path="tests/ux/runs" element={<UnprefixedBoardRedirect />} />
          <Route path="partners" element={<UnprefixedBoardRedirect />} />
          <Route path="partners/:slug" element={<UnprefixedBoardRedirect />} />
          <Route path="partners/:slug/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="affiliates" element={<UnprefixedBoardRedirect />} />
          <Route path="affiliates/leads" element={<UnprefixedBoardRedirect />} />
          <Route path="affiliates/leads/:id" element={<UnprefixedBoardRedirect />} />
          <Route path="affiliates/attribution" element={<UnprefixedBoardRedirect />} />
          <Route path="affiliates/commissions" element={<UnprefixedBoardRedirect />} />
          <Route path="affiliates/payouts" element={<UnprefixedBoardRedirect />} />
          <Route path="creditscore-review" element={<UnprefixedBoardRedirect />} />
          <Route path="creditscore-review/leads" element={<UnprefixedBoardRedirect />} />
          <Route path="creditscore-review/drafts" element={<UnprefixedBoardRedirect />} />
          <Route path="creditscore-review/impls" element={<UnprefixedBoardRedirect />} />
          <Route path="creditscore-review/scans" element={<UnprefixedBoardRedirect />} />
          <Route path="creditscore-review/docs" element={<UnprefixedBoardRedirect />} />
          <Route path=":companyPrefix" element={<Layout />}>
            {boardRoutes()}
          </Route>
          <Route path="*" element={<NotFoundPage scope="global" />} />
        </Route>
      </Routes>
      </Suspense>
      <OnboardingWizard />
    </>
  );
}
