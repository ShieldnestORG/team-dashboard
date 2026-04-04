import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";

// ── Default Diagram ─────────────────────────────────────────────────────────

const DEFAULT_DIAGRAM = `graph TB
  %% ── Express App Entry ──
  APP["Express App<br/>server/src/app.ts"]

  subgraph Core["Core Business Services"]
    style Core fill:#dbeafe,stroke:#3b82f6,stroke-width:2px,color:#1e3a5f
    Companies["Companies"]
    Agents["Agents"]
    Projects["Projects"]
    Issues["Issues"]
    Goals["Goals"]
    Routines["Routines"]
    Approvals["Approvals"]
    Secrets["Secrets"]
    Access["Access Control"]
    Dashboard["Dashboard"]
    SidebarBadges["Sidebar Badges"]
    InstanceSettings["Instance Settings"]
    Activity["Activity Log"]
  end

  subgraph Execution["Agent Execution"]
    style Execution fill:#fce7f3,stroke:#ec4899,stroke-width:2px,color:#5f1e3a
    Heartbeat["Heartbeat<br/><i>3,800+ lines</i>"]
    WorkspaceRuntime["Workspace Runtime"]
    ExecWorkspaces["Execution Workspaces"]
    WorkspaceOps["Workspace Operations"]
    AgentInstructions["Agent Instructions"]
    AgentPermissions["Agent Permissions"]
    HireHook["Hire Hook"]
    IssueWakeup["Issue Wakeup"]
  end

  subgraph Content["Content Pipeline"]
    style Content fill:#dcfce7,stroke:#22c55e,stroke-width:2px,color:#1e5f3a
    ContentSvc["Content Service<br/><i>Ollama LLM</i>"]
    ContentCrons["Content Crons<br/><i>9 scheduled jobs</i>"]
    VisualContent["Visual Content"]
    VisualJobs["Visual Jobs"]
    ContentTemplates["Personality Templates<br/><i>Blaze / Cipher / Spark / Prism</i>"]
    VideoAssembler["Video Assembler"]
    Watermark["Watermark"]
    SEOEngine["SEO Engine"]
    PlatformPublishers["Platform Publishers"]
  end

  subgraph VisualBackends["Visual Backends"]
    style VisualBackends fill:#d1fae5,stroke:#10b981,stroke-width:2px,color:#1e5f3a
    GeminiBackend["Gemini<br/><i>Imagen 3 + Veo 2</i>"]
    GrokBackend["Grok / xAI<br/><i>grok-2-image</i>"]
    CanvaBackend["Canva"]
  end

  subgraph Intel["Intel Engine"]
    style Intel fill:#ffedd5,stroke:#f97316,stroke-width:2px,color:#5f3a1e
    IntelSvc["Intel Service<br/><i>Price / News / Twitter / GitHub / Reddit</i>"]
    IntelCrons["Intel Crons<br/><i>5 scheduled jobs</i>"]
    IntelEmbeddings["Intel Embeddings<br/><i>BGE-M3 vectors</i>"]
    TrendScanner["Trend Scanner"]
    TrendCrons["Trend Crons<br/><i>every 6 hours</i>"]
  end

  subgraph Plugins["Plugin System"]
    style Plugins fill:#f3e8ff,stroke:#a855f7,stroke-width:2px,color:#3a1e5f
    PluginRegistry["Plugin Registry"]
    PluginLoader["Plugin Loader"]
    PluginLifecycle["Lifecycle Manager"]
    PluginWorkerMgr["Worker Manager<br/><i>child processes</i>"]
    PluginJobScheduler["Job Scheduler<br/><i>30s tick</i>"]
    PluginJobStore["Job Store"]
    PluginToolDispatch["Tool Dispatcher"]
    PluginHostServices["Host Services"]
    PluginEventBus["Event Bus"]
    PluginDevWatcher["Dev Watcher"]
  end

  subgraph Monitoring["Monitoring & Alerting"]
    style Monitoring fill:#fee2e2,stroke:#ef4444,stroke-width:2px,color:#5f1e1e
    Alerting["Alerting<br/><i>SMTP email</i>"]
    AlertCrons["Alert Crons<br/><i>health check 5m / digest 7am</i>"]
    EvalStore["Eval Store"]
    EvalCrons["Eval Crons<br/><i>promptfoo 6am daily</i>"]
    LogStore["Log Store"]
    RunLogStore["Run Log Store"]
    SiteMetrics["Site Metrics"]
  end

  subgraph Financial["Financial"]
    style Financial fill:#ccfbf1,stroke:#14b8a6,stroke-width:2px,color:#1e5f5f
    Costs["Cost Events"]
    Finance["Finance Reporting"]
    Budgets["Budget Enforcement"]
    QuotaWindows["Quota Windows"]
  end

  subgraph External["External Services"]
    style External fill:#f1f5f9,stroke:#94a3b8,stroke-width:2px,color:#334155
    Neon["Neon PostgreSQL"]
    Ollama["Ollama LLM<br/><i>qwen2.5:1.5b</i>"]
    Firecrawl["Firecrawl<br/><i>scraping</i>"]
    EmbedSvc["Embedding Service<br/><i>BGE-M3</i>"]
    GeminiAPI["Gemini API"]
    GrokAPI["Grok / xAI API"]
  end

  %% ── App → Route connections ──
  APP --> Core
  APP --> Execution
  APP --> Content
  APP --> Intel
  APP --> Plugins
  APP --> Monitoring
  APP --> Financial

  %% ── Core internal flows ──
  Companies --> Agents
  Companies --> Projects
  Projects --> Issues
  Issues --> Approvals
  Issues --> Activity
  Agents --> AgentInstructions
  Agents --> AgentPermissions

  %% ── Execution flows ──
  Heartbeat --> WorkspaceRuntime
  Heartbeat --> ExecWorkspaces
  Heartbeat --> WorkspaceOps
  Heartbeat --> Budgets
  Heartbeat --> Costs
  Issues --> IssueWakeup
  IssueWakeup --> Heartbeat
  Agents --> Heartbeat
  Approvals --> HireHook

  %% ── Content flows ──
  ContentCrons --> ContentSvc
  ContentSvc --> ContentTemplates
  ContentSvc --> Ollama
  ContentSvc --> IntelEmbeddings
  ContentCrons --> SEOEngine
  SEOEngine --> TrendScanner
  VisualContent --> VisualJobs
  VisualContent --> VisualBackends
  GeminiBackend --> GeminiAPI
  GrokBackend --> GrokAPI
  VideoAssembler --> VisualContent
  ContentSvc --> PlatformPublishers

  %% ── Intel flows ──
  IntelCrons --> IntelSvc
  IntelSvc --> IntelEmbeddings
  IntelEmbeddings --> EmbedSvc
  TrendCrons --> TrendScanner
  TrendScanner --> IntelSvc

  %% ── Plugin flows ──
  PluginLoader --> PluginRegistry
  PluginLifecycle --> PluginWorkerMgr
  PluginJobScheduler --> PluginJobStore
  PluginJobScheduler --> PluginLifecycle
  PluginToolDispatch --> PluginWorkerMgr
  PluginHostServices --> PluginWorkerMgr
  PluginEventBus --> PluginLifecycle
  PluginDevWatcher --> PluginLoader

  %% ── Monitoring flows ──
  AlertCrons --> Alerting
  EvalCrons --> EvalStore
  Heartbeat --> RunLogStore

  %% ── Financial flows ──
  Heartbeat --> Costs
  Budgets --> QuotaWindows
  Costs --> Finance

  %% ── External connections ──
  APP --> Neon
  IntelSvc --> Firecrawl

  %% ── Node styling ──
  style APP fill:#fbbf24,stroke:#d97706,stroke-width:3px,color:#451a03
`;

// ── Mermaid Renderer ────────────────────────────────────────────────────────

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

function MermaidRenderer({
  source,
  darkMode,
  zoom,
}: {
  source: string;
  darkMode: boolean;
  zoom: number;
}) {
  const renderId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSvg(null);
    setError(null);

    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: darkMode ? "dark" : "default",
          fontFamily: "inherit",
          suppressErrorRendering: true,
        });
        const rendered = await mermaid.render(
          `structure-diagram-${renderId}`,
          source,
        );
        if (!active) return;
        setSvg(rendered.svg);
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

  if (error) {
    return (
      <div className="space-y-4">
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
      <div className="flex h-96 items-center justify-center">
        <div className="text-sm text-muted-foreground">
          Rendering diagram...
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border bg-card">
      <div
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "top left",
          transition: "transform 150ms ease",
        }}
        className="p-6"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
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
  const [zoom, setZoom] = useState(1);
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

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.25));
  const handleZoomReset = () => setZoom(1);
  const toggleFullscreen = () => setIsFullscreen((f) => !f);

  if (!selectedCompanyId) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Select a company to view structure
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-[600px] animate-pulse rounded-lg bg-muted" />
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

  const diagramContent = (
    <>
      {/* Zoom controls */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={handleZoomOut}
          className="rounded-md border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          className="rounded-md border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={handleZoomReset}
          className="rounded-md border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Reset zoom"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <div className="flex-1" />
        <button
          onClick={toggleFullscreen}
          className="rounded-md border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Toggle fullscreen"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        {diagramData?.diagram && (
          <span className="text-xs text-muted-foreground">
            v{diagramData.diagram.revisionNumber} &middot; updated{" "}
            {new Date(diagramData.diagram.updatedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      <MermaidRenderer source={diagramSource} darkMode={darkMode} zoom={zoom} />
    </>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 overflow-auto bg-background p-6">
        {diagramContent}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <GitBranch className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Architecture Structure</h1>
          <p className="text-sm text-muted-foreground">
            Backend service topology, data flows, and cron schedules
          </p>
        </div>
      </div>

      {/* Tabs */}
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

        <TabsContent value="overview" className="mt-4">
          {diagramContent}
        </TabsContent>

        <TabsContent value="revisions" className="mt-4">
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
  );
}
