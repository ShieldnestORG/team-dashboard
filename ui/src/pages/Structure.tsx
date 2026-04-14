import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useTheme } from "../context/ThemeContext";
import { structureApi } from "../api/structure";
import type { StructureRevision } from "../api/structure";
import { queryKeys } from "../lib/queryKeys";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Clock,
  Maximize2,
  Minimize2,
  Move,
  Copy,
  Check,
} from "lucide-react";

// ── Theme Config ────────────────────────────────────────────────────────────

const DARK_THEME_VARS = {
  background: "#18181b",
  primaryColor: "#3b82f6",
  primaryTextColor: "#f8fafc",
  primaryBorderColor: "#3b82f6",
  secondaryColor: "#27272a",
  secondaryTextColor: "#e2e8f0",
  secondaryBorderColor: "#3f3f46",
  tertiaryColor: "#1e293b",
  tertiaryTextColor: "#cbd5e1",
  tertiaryBorderColor: "#334155",
  noteBkgColor: "#1e293b",
  noteTextColor: "#e2e8f0",
  noteBorderColor: "#475569",
  lineColor: "#64748b",
  textColor: "#e2e8f0",
  mainBkg: "#27272a",
  nodeBorder: "#3f3f46",
  clusterBkg: "#1e1e22",
  clusterBorder: "#3f3f46",
  titleColor: "#f1f5f9",
  edgeLabelBackground: "#27272a",
  nodeTextColor: "#f1f5f9",
};

const LIGHT_THEME_VARS = {
  background: "#ffffff",
  primaryColor: "#3b82f6",
  primaryTextColor: "#1e293b",
  primaryBorderColor: "#3b82f6",
  secondaryColor: "#f1f5f9",
  secondaryTextColor: "#334155",
  secondaryBorderColor: "#cbd5e1",
  tertiaryColor: "#f8fafc",
  tertiaryTextColor: "#475569",
  tertiaryBorderColor: "#e2e8f0",
  noteBkgColor: "#f8fafc",
  noteTextColor: "#334155",
  noteBorderColor: "#cbd5e1",
  lineColor: "#94a3b8",
  textColor: "#334155",
  mainBkg: "#f8fafc",
  nodeBorder: "#cbd5e1",
  clusterBkg: "#f1f5f9",
  clusterBorder: "#e2e8f0",
  titleColor: "#0f172a",
  edgeLabelBackground: "#ffffff",
  nodeTextColor: "#1e293b",
};

// ── Default Diagram ─────────────────────────────────────────────────────────

const DEFAULT_DIAGRAM = `graph TB
  %% ═══════════════════════════════════════════════════════
  %% ECOSYSTEM OVERVIEW — Last audited 2026-04-12 (directory subdomain + SERVE_UI enabled)
  %% ═══════════════════════════════════════════════════════

  subgraph Ecosystem["Coherence Daddy Ecosystem"]
    direction TB

    subgraph PublicSites["Public-Facing Properties"]
      direction TB
      CD(["coherencedaddy.com"]):::siteNode
      CDTools(["523+ Free Tools"])
      CDDirectorySub(["directory.coherencedaddy.com"]):::siteNode
      CDDirectory(["Blockchain Directory — 532 cos"])
      CDBlog(["Blog + RSS"])
      CDReels(["Public Reels"])
      CDSitemap(["Sitemap — pages/intel/reels"])
      CDPartnerDir(["Partner Directory"])
      CDShop(["shop.coherencedaddy.com"]):::siteNode
    end

    subgraph OtherProps["Ecosystem Properties"]
      direction TB
      Tokns(["tokns.fi"]):::siteNode
      ToknsApp(["app.tokns.fi"])
      TXChain(["TX Blockchain — Cosmos SDK"]):::siteNode
      ShieldNest(["shieldnest.org — builds CD infra"]):::siteNode
      YourArchi(["yourarchi.com"]):::siteNode
    end

    subgraph TDash["Team Dashboard — Control Plane"]
      direction TB

      APP(["Express API :3200 — 40+ route groups"]):::entryNode

      subgraph Core["Core Business"]
        direction TB
        Companies(["Companies"])
        Agents(["Agents"])
        Projects(["Projects"])
        Issues(["Issues"])
        Goals(["Goals"])
        Routines(["Routines + Triggers"])
        Approvals(["Approvals"])
        Activity(["Activity Log"])
        Secrets(["Secret Management"])
        CompanySkills(["Company Skills"])
        Dashboard(["Dashboard Service"])
      end

      subgraph AgentTeam["Agent Team — 15 folders, 17 roles"]
        direction TB
        Atlas(["Atlas — CEO"])
        Nova(["Nova — CTO"])
        Sage(["Sage — CMO"])
        River(["River — PM"])
        Pixel(["Pixel — Designer"])
        Core2(["Core — Backend Dev"])
        Flux(["Flux — Frontend Dev"])
        Bridge(["Bridge — Full-Stack Dev"])
        Echo(["Echo — Data Engineer"])
        Mermaid2(["Mermaid — Structure Agent"])
        MoltbookAgent(["Moltbook — Social Presence"])
        Blaze(["Blaze — Hot-Take Analyst"])
        Cipher(["Cipher — Technical Writer"])
        Spark(["Spark — Community Builder"])
        Prism(["Prism — Trend Reporter"])
        VanguardForge(["Vanguard + Forge — XRP/AEO"])
      end

      subgraph Execution["Agent Execution"]
        direction TB
        Heartbeat(["Heartbeat — 30s tick"])
        WorkspaceRuntime(["Workspace Runtime"])
        ExecWorkspaces(["Exec Workspaces"])
        AgentInstructions(["Instructions"])
        IssueWakeup(["Issue Wakeup"])
        LLMAdapters(["7 LLM Adapters"])
      end

      subgraph ContentPipeline["Content Pipeline"]
        direction TB
        ContentSvc(["Content Service — 6 personalities"])
        ContentCrons{{"Content Crons — 24 jobs"}}
        ContentDB[("content_items")]
        VisualContent(["Visual Content"])
        VisualDB[("visual_content_items + assets")]
        VisualJobs(["Visual Jobs — 15s polling"])
        Templates(["6 Personality Templates"])
        VideoAssembler(["Video Assembler — FFmpeg"])
        SEOEngine(["SEO Engine — Claude-powered"])
        BlogPublisher(["Blog Publisher — CD + ShieldNest"])
        SlideshowGen(["Slideshow Blog Generator"])
        PubYT(["YouTube Shorts — active"])
        PubTikTok(["TikTok — active"])
        PubInstaStub(["Instagram Reels — stub"]):::readyNode
        PubXVideoStub(["X Video — stub"]):::readyNode
        CanvaMediaCron(["Canva Media Cron — ready"]):::readyNode
        FeedbackSvc(["Feedback Service"])
        FeedbackDB[("content_feedback")]
        ContentEmbedder(["Content Embedder — BGE-M3"])
        QualitySignalsDB[("content_quality_signals")]
        PerfTracking(["Performance Tracking"])
        MediaDrop(["Media Drop — File Upload"])
        MediaDropDB[("media_drops")]
      end

      subgraph YouTubePipeline["YouTube Automation Pipeline"]
        direction TB
        YTStrategy(["Content Strategy — Ollama"])
        YTScriptWriter(["Script Writer — Ollama"])
        YTSEOOpt(["SEO Optimizer — tags, chapters"])
        YTThumbnail(["Thumbnail Generator — Grok/Gemini"])
        YTTTS(["TTS — Grok xAI (Rex voice)"])
        YTPresRenderer(["Presentation Renderer — Playwright"])
        YTSiteWalker(["Site-Walker — Playwright browser agent"])
        YTWalkthroughWriter(["Walkthrough Writer — Ollama"])
        YTVideoAssembler(["Video Assembler — FFmpeg"])
        YTPublishQueue(["Publish Queue — auto-upload"])
        YTAnalytics(["Analytics — YouTube API + Ollama"])
        YTCrons{{"YT Crons — 5 jobs"}}
        YTStratDB[("yt_content_strategies")]
        YTSEODB[("yt_seo_data")]
        YTProdDB[("yt_productions")]
        YTQueueDB[("yt_publish_queue")]
        YTAnalyticsDB[("yt_analytics")]
      end

      subgraph VisualBack["Visual Backends"]
        direction TB
        GeminiBack(["Gemini — 2.5 Flash Image (Nano Banana)"])
        GrokBack(["Grok — grok-imagine-image + video"])
        CanvaBack(["Canva — Python bridge"])
        CanvaConnect(["Canva Connect — OAuth + API"])
      end

      subgraph XEcosystem["X / Twitter Ecosystem"]
        direction TB
        XClient(["X API v2 Client"])
        XOAuth(["X OAuth 2.0 PKCE"])
        RateLimiter(["Dollar-Based Rate Limiter"])
        ContentBridge(["Content Bridge — post gen"])
        EngagementEngine(["Engagement Engine"])
        RetweetSvc(["Retweet Service"])
        XMedia(["X Media Upload"])
        XAnalytics(["X Analytics"])
        XEngagementDB[("x_engagement_log")]
        XTweetDB[("x_tweet_analytics")]
        XOAuthDB[("x_oauth_tokens")]
      end

      subgraph AutoReplyEngine["Auto-Reply Engine"]
        direction TB
        AutoReplySvc(["Auto-Reply Service"])
        AutoReplyCron{{"Poll Cron — configurable"}}
        AutoReplyDB[("auto_reply_settings + config + log")]
      end

      subgraph IntelEngine["Intel Engine"]
        direction TB
        IntelSvc(["Intel Service — 4 directories"])
        IntelCrons{{"Intel Crons — 8 jobs"}}
        IntelDiscovery(["Intel Discovery — CoinGecko + GitHub"])
        IntelQuality(["Intel Quality — dedup + scoring"])
        Embeddings[("Vector Embeddings — BGE-M3")]
        TrendScanner(["Trend Scanner — 4 sources"])
        TrendCrons{{"Trend Crons — 6hr"}}
        Mintscan(["Mintscan — Cosmos chain metrics"])
        IntelDB[("intel_companies + intel_reports")]
      end

      subgraph PluginApps["Plugin Apps — 4 plugins"]
        direction TB
        DiscordBot(["Discord — 8 tools, 2 jobs"])
        TwitterPlugin(["Twitter/X — 14 tools, 4 jobs"])
        FirecrawlPlugin(["Firecrawl — 9 tools, 2 jobs"])
        MoltbookPlugin(["Moltbook — 11 tools, 3 jobs"])
      end

      subgraph MCPServer["MCP Server"]
        direction TB
        MCPTools(["36 Tools — 10 Entities"])
        MCPTransport(["Stdio Transport"])
      end

      subgraph PluginSys["Plugin System"]
        direction TB
        PluginRegistry(["Registry"])
        PluginLoader(["Loader"])
        PluginLifecycle(["Lifecycle Manager"])
        PluginWorkerMgr(["Worker Manager"])
        PluginJobScheduler{{"Job Scheduler — 30s tick"}}
        PluginToolDispatch(["Tool Dispatcher"])
        PluginEventBus(["Event Bus"])
        PluginStateDB[("plugin_state + jobs + logs")]
      end

      subgraph Monitor["Monitoring & Alerting"]
        direction TB
        Alerting(["SMTP Alerting — Proton Mail"])
        AlertCrons{{"Alert Crons — 4 jobs"}}
        EvalStore[("Eval Store — promptfoo")]
        EvalCrons{{"Eval Cron — daily 6am"}}
        LogStore[("Log Store — 14d retention")]
        SiteMetrics(["Site Metrics Ingest"])
        MaintCrons{{"Maintenance — 2 jobs"}}
        VPSMonitor(["VPS Monitor"])
        SSLMonitor(["SSL Cert Monitor — 6hr"])
        CronMgmt(["Cron Management — UI + API"])
        CronDB[("system_crons")]
      end

      subgraph Finance["Financial"]
        direction TB
        Costs(["Cost Events"])
        FinanceRpt(["Finance Reports"])
        Budgets(["Budget Enforcement"])
        QuotaWindows(["Quota Windows"])
      end

      subgraph PartnerNet["AEO Partner Network"]
        direction TB
        PartnerOnboard(["Partner Onboarding — Firecrawl + Ollama"])
        PartnerSvc(["Partner Content Service"])
        PartnerDB[("partnerCompanies + Clicks")]
        PartnerRedirect(["Redirect /go/:slug"])
        PartnerMicrosite(["Partner Microsites"])
        PartnerDashboard(["Partner Dashboard — token-auth"])
        PartnerReports(["Partner Reports — monthly"])
        PartnerSiteContent[("partner_site_content")]
        PartnerDirectory(["Trusted Companies API — /partner-directory"])
      end

      subgraph MoltbookEngine["Moltbook Social Engine"]
        direction TB
        MoltbookSvc(["Moltbook Engine — Ollama + safety"])
        MoltbookCrons{{"Moltbook Crons — 5 jobs"}}
        MoltbookFeedDB[("moltbook_feed + embeddings")]
        MoltbookPostsDB[("moltbook_posts")]
        MoltbookStatsDB[("moltbook_stats")]
        MoltbookPerf(["Performance Tracker"])
      end
    end
  end

  subgraph Infra["Infrastructure"]
    direction TB

    subgraph VPS1["VPS_1 — 31.220.61.12 (31GB RAM)"]
      direction TB
      Nginx(["nginx — api.coherencedaddy.com"])
      SSLCert(["SSL — Let's Encrypt + Certbot"])
      Docker(["Docker Container"])
      ExpressRuntime(["Express.js :3100"])
      AgentRuntime(["Agent Runtime"])
      Nginx --> ExpressRuntime
    end

    subgraph VPS3["VPS_3 — 147.79.78.251 (15GB RAM)"]
      direction TB
      EmbedSvc(["BGE-M3 Embeddings :8000"])
    end

    subgraph VPS2["VPS_2 — 168.231.127.180"]
      direction TB
      FirecrawlSvc(["Firecrawl — Scraping"])
      DirectoryAPI(["Directory API :4000"])
    end

    subgraph VercelInfra["Vercel"]
      direction TB
      VercelUI(["React SPA — ui/dist"])
      VercelDirect(["Direct → api.coherencedaddy.com"])
    end

    subgraph NeonInfra["Neon"]
      direction TB
      NeonDB[("PostgreSQL — 73+ tables")]
    end

    subgraph OllamaCloud["Ollama Cloud"]
      direction TB
      OllamaSvc(["ollama.com/api — gemma4:31b"])
    end

    subgraph ExtAPIs["External APIs"]
      direction TB
      GeminiAPI(["Google Gemini API"])
      GrokAPI(["xAI / Grok API"])
      AnthropicAPI(["Anthropic Claude API"])
      CoinGecko(["CoinGecko"])
      HackerNews(["Hacker News"])
      GitHubAPI(["GitHub API"])
      XAPIv2(["X / Twitter API v2"])
      MoltbookAPI(["Moltbook — moltbook.com"])
      DiscordAPI(["Discord API"])
      CanvaAPI(["Canva API"])
      BingNewsAPI(["Bing News API v7"])
      GoogleTrendsRSS(["Google Trends RSS"])
      RedditAPI(["Reddit"])
      IndexNowAPI(["IndexNow — search ping"])
      YouTubeAPI(["YouTube Data API v3"])
      TikTokAPI(["TikTok Content API"])
      MintscanAPI(["Mintscan — Cosmostation"])
      StripeAPI(["Stripe — payments"])
      GrokTTS(["Grok TTS — xAI API (Rex voice)"])
      PrintifyAPI(["Printify — print-on-demand"])
    end
  end

  %% ═══════════════════════════════════════════════════════
  %% CROSS-PROJECT CONNECTIONS
  %% ═══════════════════════════════════════════════════════

  %% Team Dashboard → Infrastructure
  APP --> Docker
  Docker --> ExpressRuntime
  ExpressRuntime --> NeonDB
  ExpressRuntime --> AgentRuntime

  %% Vercel serves public frontend
  VercelUI -->|"serves"| CD
  VercelRewrites -->|"/api/* proxy"| ExpressRuntime

  %% coherencedaddy.com consumes Team Dashboard APIs
  CDDirectorySub -->|"subdomain"| CDDirectory
  CDDirectory -->|"Intel API"| IntelSvc
  CDBlog -->|"SEO content"| SEOEngine
  CDReels -->|"/api/reels"| VisualContent
  CD -->|"site metrics"| SiteMetrics
  CDPartnerDir -->|"/api/partner-directory"| PartnerSvc

  %% Content pipeline → Ollama Cloud
  ContentSvc --> OllamaSvc
  ContentSvc --> Embeddings
  SEOEngine --> TrendScanner
  SEOEngine --> BlogPublisher
  SEOEngine -->|"fallback"| AnthropicAPI
  BlogPublisher --> OllamaSvc
  BlogPublisher -->|"IndexNow"| IndexNowAPI
  Embeddings --> EmbedSvc
  TrendScanner --> CoinGecko
  TrendScanner --> HackerNews
  TrendScanner --> BingNewsAPI
  TrendScanner --> GoogleTrendsRSS

  %% Intel → External
  IntelSvc --> FirecrawlSvc
  IntelSvc --> GitHubAPI
  IntelSvc --> RedditAPI
  IntelSvc --> CoinGecko
  IntelQuality --> Embeddings
  Mintscan --> MintscanAPI
  Mintscan --> TXChain

  %% Visual backends → External APIs
  GeminiBack --> GeminiAPI
  GrokBack --> GrokAPI
  CanvaConnect --> CanvaAPI

  %% Agent execution
  Agents --> Heartbeat
  Heartbeat --> WorkspaceRuntime
  Heartbeat --> LLMAdapters
  LLMAdapters --> OllamaSvc
  LLMAdapters --> AnthropicAPI
  Issues --> IssueWakeup
  IssueWakeup --> Heartbeat

  %% Core flows
  Companies --> Agents
  Companies --> Projects
  Projects --> Issues
  Issues --> Approvals

  %% Content flows
  ContentCrons --> ContentSvc
  ContentCrons -->|"slideshow blogs"| SlideshowGen
  SlideshowGen --> BlogPublisher
  ContentSvc --> Templates
  ContentSvc --> ContentDB
  ContentDB --> FeedbackSvc
  FeedbackSvc --> FeedbackDB
  FeedbackDB -->|"training"| ContentSvc
  FeedbackSvc -->|"penalties"| QualitySignalsDB
  QualitySignalsDB -->|"downrank"| IntelQuality
  ContentEmbedder -->|"embed output"| IntelDB
  BlogPublisher -->|"on publish"| ContentEmbedder
  ContentEmbedder --> Embeddings
  SEOEngine -->|"vector context"| IntelQuality
  ContentDB --> PerfTracking
  PerfTracking -->|"boost topics"| ContentCrons
  VisualContent --> VisualJobs
  VisualContent --> VisualDB
  VisualContent --> VisualBack
  VideoAssembler --> VisualContent

  %% Platform publishers → APIs
  PubYT --> YouTubeAPI
  PubTikTok --> TikTokAPI
  ContentSvc --> PubYT
  ContentSvc --> PubTikTok

  %% YouTube Pipeline flows
  YTStrategy --> OllamaSvc
  YTScriptWriter --> OllamaSvc
  YTThumbnail --> VisualBack
  YTTTS --> GrokTTS
  YTSiteWalker --> YTWalkthroughWriter
  YTWalkthroughWriter --> OllamaSvc
  YTSiteWalker --> YTTTS
  YTPresRenderer --> YTVideoAssembler
  YTVideoAssembler --> YTPublishQueue
  YTPublishQueue --> YouTubeAPI
  YTAnalytics --> YouTubeAPI
  YTAnalytics --> OllamaSvc
  YTCrons --> YTStrategy
  YTCrons --> YTPublishQueue
  YTCrons --> YTAnalytics
  YTStrategy --> YTStratDB
  YTSEOOpt --> YTSEODB
  YTPublishQueue --> YTQueueDB
  YTAnalytics --> YTAnalyticsDB

  %% X ecosystem flows
  XClient --> XAPIv2
  XOAuth --> XAPIv2
  ContentBridge --> XClient
  ContentBridge --> OllamaSvc
  ContentBridge --> Embeddings
  EngagementEngine --> XClient
  EngagementEngine --> Embeddings
  RetweetSvc --> XClient
  XMedia --> XAPIv2
  ContentBridge --> XTweetDB
  EngagementEngine --> XEngagementDB
  XOAuth --> XOAuthDB

  %% Intel flows
  IntelCrons --> IntelSvc
  TrendCrons --> TrendScanner
  IntelDiscovery --> IntelSvc
  IntelSvc --> IntelDB

  %% Auto-Reply flows
  AutoReplyCron --> AutoReplySvc
  AutoReplySvc --> XClient
  AutoReplySvc --> RateLimiter
  AutoReplySvc --> OllamaSvc
  AutoReplySvc --> AutoReplyDB

  %% Partner flows
  PartnerSvc --> PartnerDB
  PartnerRedirect --> PartnerSvc
  PartnerSvc --> ContentSvc
  PartnerMicrosite --> PartnerSiteContent
  PartnerReports --> Alerting

  %% Media flows
  MediaDrop --> MediaDropDB

  %% Monitoring
  MaintCrons --> ContentDB
  VPSMonitor --> Alerting
  AlertCrons --> Alerting
  EvalCrons --> EvalStore
  Heartbeat --> LogStore
  CronMgmt --> CronDB

  %% Plugin flows
  PluginLoader --> PluginRegistry
  PluginLifecycle --> PluginWorkerMgr
  PluginJobScheduler --> PluginLifecycle
  PluginToolDispatch --> PluginWorkerMgr
  PluginLifecycle --> PluginStateDB
  DiscordBot --> PluginLifecycle
  TwitterPlugin --> PluginLifecycle
  FirecrawlPlugin --> PluginLifecycle
  MoltbookPlugin --> PluginLifecycle
  DiscordBot --> DiscordAPI
  TwitterPlugin --> XClient
  FirecrawlPlugin --> FirecrawlSvc

  %% MCP Server
  MCPTools --> ExpressRuntime

  %% Financial
  Heartbeat --> Costs
  Budgets --> QuotaWindows
  Costs --> FinanceRpt

  %% Shop / E-commerce
  CDShop -->|"payments"| StripeAPI
  CDShop -->|"fulfillment"| PrintifyAPI

  %% Ecosystem cross-links
  Tokns -->|"validator"| TXChain
  ToknsApp -->|"staking + swaps"| TXChain
  DirectoryAPI -->|"data sync"| FirecrawlSvc

  %% Moltbook engine flows
  MoltbookCrons --> MoltbookSvc
  MoltbookSvc --> MoltbookFeedDB
  MoltbookSvc --> MoltbookPostsDB
  MoltbookSvc --> MoltbookStatsDB
  MoltbookSvc --> OllamaSvc
  MoltbookSvc --> Embeddings
  MoltbookSvc --> MoltbookAPI
  MoltbookPerf --> MoltbookSvc
  MoltbookPlugin --> MoltbookAPI

  %% Agent team reporting
  Atlas --> Nova
  Atlas --> Sage
  Atlas --> River
  Atlas --> Pixel
  Nova --> Core2
  Nova --> Flux
  Nova --> Bridge
  Nova --> Echo
  Nova --> Mermaid2
  Sage --> Blaze
  Sage --> Cipher
  Sage --> Spark
  Sage --> Prism
  Sage --> VanguardForge
  Sage --> MoltbookAgent

  %% ═══════════════════════════════════════════════════════
  %% STYLING
  %% ═══════════════════════════════════════════════════════

  classDef entryNode fill:#f59e0b,stroke:#d97706,stroke-width:3px,color:#451a03,font-weight:bold
  classDef siteNode fill:#6366f1,stroke:#4f46e5,stroke-width:2px,color:#eef2ff,font-weight:bold
  classDef cronNode fill:#7c3aed,stroke:#6d28d9,color:#f5f3ff,stroke-width:2px
  classDef storeNode fill:#0891b2,stroke:#0e7490,color:#ecfeff,stroke-width:2px
  classDef readyNode fill:#94a3b8,stroke:#64748b,stroke-width:2px,stroke-dasharray:5 5,color:#f8fafc,font-style:italic

  class ContentCrons,IntelCrons,TrendCrons,AlertCrons,EvalCrons,PluginJobScheduler,AutoReplyCron,MaintCrons,MoltbookCrons cronNode
  class NeonDB,Embeddings,EvalStore,LogStore,ContentDB,VisualDB,FeedbackDB,AutoReplyDB,PartnerDB,MediaDropDB,XEngagementDB,XTweetDB,XOAuthDB,IntelDB,CronDB,PluginStateDB,MoltbookFeedDB,MoltbookPostsDB,MoltbookStatsDB,PartnerSiteContent,QualitySignalsDB storeNode

  style Ecosystem fill:transparent,stroke:#6366f1,stroke-width:2px,stroke-dasharray:5 5,color:#a5b4fc
  style PublicSites fill:#eef2ff,stroke:#6366f1,stroke-width:2px,color:#312e81
  style OtherProps fill:#faf5ff,stroke:#7c3aed,stroke-width:2px,color:#4c1d95
  style TDash fill:#f0fdf4,stroke:#22c55e,stroke-width:2px,color:#14532d
  style Core fill:#dbeafe,stroke:#3b82f6,stroke-width:2px,color:#1e3a5f
  style AgentTeam fill:#fefce8,stroke:#eab308,stroke-width:2px,color:#713f12
  style Execution fill:#fce7f3,stroke:#ec4899,stroke-width:2px,color:#5f1e3a
  style ContentPipeline fill:#dcfce7,stroke:#22c55e,stroke-width:2px,color:#1e5f3a
  style VisualBack fill:#d1fae5,stroke:#10b981,stroke-width:2px,color:#1e5f3a
  style XEcosystem fill:#fef9c3,stroke:#ca8a04,stroke-width:2px,color:#713f12
  style IntelEngine fill:#ffedd5,stroke:#f97316,stroke-width:2px,color:#5f3a1e
  style PartnerNet fill:#fef3c7,stroke:#f59e0b,stroke-width:2px,color:#78350f
  style PluginSys fill:#f3e8ff,stroke:#a855f7,stroke-width:2px,color:#3a1e5f
  style Monitor fill:#fee2e2,stroke:#ef4444,stroke-width:2px,color:#5f1e1e
  style Finance fill:#ccfbf1,stroke:#14b8a6,stroke-width:2px,color:#1e5f5f
  style Infra fill:#f8fafc,stroke:#64748b,stroke-width:2px,color:#1e293b
  style AutoReplyEngine fill:#fff7ed,stroke:#ea580c,stroke-width:2px,color:#7c2d12
  style PluginApps fill:#ede9fe,stroke:#7c3aed,stroke-width:2px,color:#3a1e5f
  style MCPServer fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0c4a6e
  style MoltbookEngine fill:#fce7f3,stroke:#ec4899,stroke-width:2px,color:#5f1e3a
  style VPS1 fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f
  style VPS2 fill:#f1f5f9,stroke:#94a3b8,stroke-width:2px,color:#334155
  style VPS3 fill:#ecfdf5,stroke:#10b981,stroke-width:2px,color:#064e3b
  style OllamaCloud fill:#fff7ed,stroke:#f97316,stroke-width:2px,color:#7c2d12
  style VercelInfra fill:#e0e7ff,stroke:#4f46e5,stroke-width:2px,color:#312e81
  style NeonInfra fill:#cffafe,stroke:#0891b2,stroke-width:2px,color:#164e63
  style ExtAPIs fill:#fff7ed,stroke:#ea580c,stroke-width:2px,color:#7c2d12
`;

// ── Mermaid Loader ──────────────────────────────────────────────────────────

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let elkRegistered = false;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

async function ensureMermaidReady(darkMode: boolean) {
  const mermaid = await loadMermaid();

  if (!elkRegistered) {
    try {
      const elkModule = await import("@mermaid-js/layout-elk");
      const loaders = elkModule.default ?? elkModule;
      if (typeof mermaid.registerLayoutLoaders === "function") {
        mermaid.registerLayoutLoaders(loaders);
      }
      elkRegistered = true;
    } catch {
      // ELK not available, fall back to dagre
    }
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: darkMode ? DARK_THEME_VARS : LIGHT_THEME_VARS,
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    suppressErrorRendering: true,
    flowchart: {
      defaultRenderer: elkRegistered ? ("elk" as "elk") : undefined,
      nodeSpacing: 50,
      rankSpacing: 60,
      curve: "cardinal",
      diagramPadding: 20,
      htmlLabels: true,
      wrappingWidth: 180,
    },
  });

  return mermaid;
}

function postProcessSvg(svgString: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return svgString;

  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.maxWidth = "none";
  svg.style.minWidth = "800px";

  return new XMLSerializer().serializeToString(svg);
}

// ── Diagram Viewer (pan/zoom) ───────────────────────────────────────────────

function DiagramViewer({
  source,
  darkMode,
  isFullscreen,
  onToggleFullscreen,
  diagramMeta,
}: {
  source: string;
  darkMode: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  diagramMeta?: { revisionNumber: number; updatedAt: string } | null;
}) {
  const renderId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentScale, setCurrentScale] = useState(1);
  const [copied, setCopied] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleCopyMermaid = useCallback(() => {
    navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [source]);

  useEffect(() => {
    let active = true;
    setSvg(null);
    setError(null);

    ensureMermaidReady(darkMode)
      .then(async (mermaid) => {
        const rendered = await mermaid.render(
          `structure-${renderId}`,
          source,
        );
        if (!active) return;
        setSvg(postProcessSvg(rendered.svg));
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to render diagram",
        );
      });

    return () => {
      active = false;
    };
  }, [darkMode, renderId, source]);

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggleFullscreen();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFullscreen, onToggleFullscreen]);

  if (error) {
    return (
      <div className="space-y-4 p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          Diagram render error: {error}
        </div>
        <pre className="max-h-96 overflow-auto rounded-lg border bg-muted p-4 text-xs">
          {source}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span className="text-sm">Rendering architecture diagram...</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative h-full w-full" style={{ touchAction: "none" }}>
      <TransformWrapper
        initialScale={0.85}
        minScale={0.1}
        maxScale={8}
        centerOnInit
        wheel={{ step: 0.08 }}
        pinch={{ step: 5 }}
        doubleClick={{ disabled: true }}
        limitToBounds={false}
        onTransformed={(_ref, state) => setCurrentScale(state.scale)}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            {/* Floating toolbar */}
            <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-xl border border-border/50 bg-background/80 px-2 py-1.5 shadow-lg backdrop-blur-md">
              <button
                onClick={() => zoomOut()}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(currentScale * 100)}%
              </span>
              <button
                onClick={() => zoomIn()}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <div className="mx-1 h-4 w-px bg-border" />
              <button
                onClick={() => resetTransform()}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Reset view"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                onClick={onToggleFullscreen}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={handleCopyMermaid}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Copy Mermaid source"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
              {diagramMeta && (
                <>
                  <div className="mx-1 h-4 w-px bg-border" />
                  <span className="px-1 text-[11px] text-muted-foreground">
                    v{diagramMeta.revisionNumber}
                  </span>
                </>
              )}
            </div>

            {/* Hint overlay */}
            <div className="pointer-events-none absolute left-4 bottom-4 z-10 flex items-center gap-1.5 rounded-lg bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground/60 backdrop-blur-sm">
              <Move className="h-3 w-3" />
              Drag to pan &middot; Scroll to zoom
            </div>

            <TransformComponent
              wrapperStyle={{ width: "100%", height: "100%" }}
              contentStyle={{ width: "fit-content", height: "fit-content" }}
            >
              <div
                className="p-8"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}

// ── Revisions List ──────────────────────────────────────────────────────────

function RevisionsList({ revisions }: { revisions: StructureRevision[] }) {
  if (revisions.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No revisions yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {revisions.map((rev) => (
        <Card key={rev.id}>
          <CardContent className="flex items-center gap-4 py-3">
            <Badge variant="outline" className="shrink-0 tabular-nums">
              v{rev.revisionNumber}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {rev.changeSummary || "No summary"}
              </p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {new Date(rev.createdAt).toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Page Component ──────────────────────────────────────────────────────────

export function Structure() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId } = useCompany();
  const { theme } = useTheme();
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Structure" }]);
  }, [setBreadcrumbs]);

  const {
    data: diagramData,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.structure.diagram(selectedCompanyId ?? ""),
    queryFn: () => structureApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: revisionsData } = useQuery({
    queryKey: queryKeys.structure.revisions(selectedCompanyId ?? ""),
    queryFn: () => structureApi.revisions(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const diagramSource = diagramData?.diagram?.body ?? DEFAULT_DIAGRAM;
  const darkMode = theme === "dark";
  const revisions = revisionsData?.revisions ?? [];
  const diagramMeta = diagramData?.diagram
    ? {
        revisionNumber: diagramData.diagram.revisionNumber,
        updatedAt: diagramData.diagram.updatedAt,
      }
    : null;

  const toggleFullscreen = useCallback(() => setIsFullscreen((f) => !f), []);

  if (!selectedCompanyId) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Select a company to view structure
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load structure diagram
      </div>
    );
  }

  // Fullscreen mode — edge-to-edge
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Architecture Structure</span>
          </div>
          <button
            onClick={toggleFullscreen}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <DiagramViewer
            source={diagramSource}
            darkMode={darkMode}
            isFullscreen
            onToggleFullscreen={toggleFullscreen}
            diagramMeta={diagramMeta}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col -m-4 md:-m-6">
      {/* Header area with padding restored */}
      <div className="shrink-0 space-y-4 px-4 pt-4 md:px-6 md:pt-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <GitBranch className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Architecture Structure</h1>
            <p className="text-xs text-muted-foreground">
              Backend service topology, data flows, and cron schedules
            </p>
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="revisions">
              Revisions
              {revisions.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs">
                  {revisions.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0 flex-1">
            {/* This div closes in the parent flex */}
          </TabsContent>

          <TabsContent value="revisions" className="mt-4 px-0 md:px-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Revision History</CardTitle>
              </CardHeader>
              <CardContent>
                <RevisionsList revisions={revisions} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Diagram fills remaining space */}
      <div className="flex-1 min-h-[500px] border-t">
        <DiagramViewer
          source={diagramSource}
          darkMode={darkMode}
          isFullscreen={false}
          onToggleFullscreen={toggleFullscreen}
          diagramMeta={diagramMeta}
        />
      </div>
    </div>
  );
}
