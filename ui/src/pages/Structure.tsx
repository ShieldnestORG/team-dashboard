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
  APP(["Express App"]):::entryNode

  subgraph Core["Core Business"]
    direction TB
    Companies(["Companies"])
    Agents(["Agents"])
    Projects(["Projects"])
    Issues(["Issues"])
    Goals(["Goals"])
    Routines(["Routines"])
    Approvals(["Approvals"])
    Access(["Access Control"])
    Dashboard(["Dashboard"])
    Activity(["Activity"])
  end

  subgraph Execution["Agent Execution"]
    direction TB
    Heartbeat(["Heartbeat"])
    WorkspaceRuntime(["Workspace Runtime"])
    ExecWorkspaces(["Exec Workspaces"])
    WorkspaceOps(["Workspace Ops"])
    AgentInstructions(["Instructions"])
    AgentPerms(["Permissions"])
    IssueWakeup(["Issue Wakeup"])
  end

  subgraph ContentPipeline["Content Pipeline"]
    direction TB
    ContentSvc(["Content Service"])
    ContentCrons{{"Content Crons"}}
    VisualContent(["Visual Content"])
    VisualJobs(["Visual Jobs"])
    Templates(["Templates"])
    VideoAssembler(["Video Assembler"])
    SEOEngine(["SEO Engine"])
    Publishers(["Publishers"])
  end

  subgraph VisualBack["Visual Backends"]
    direction TB
    Gemini(["Gemini"])
    Grok(["Grok / xAI"])
    Canva(["Canva"])
  end

  subgraph IntelEngine["Intel Engine"]
    direction TB
    IntelSvc(["Intel Service"])
    IntelCrons{{"Intel Crons"}}
    Embeddings[("Embeddings")]
    TrendScanner(["Trend Scanner"])
    TrendCrons{{"Trend Crons"}}
  end

  subgraph PluginSys["Plugin System"]
    direction TB
    Registry(["Registry"])
    Loader(["Loader"])
    Lifecycle(["Lifecycle"])
    WorkerMgr(["Worker Manager"])
    JobScheduler{{"Job Scheduler"}}
    JobStore[("Job Store")]
    ToolDispatch(["Tool Dispatcher"])
    HostServices(["Host Services"])
    EventBus(["Event Bus"])
  end

  subgraph Monitor["Monitoring"]
    direction TB
    Alerting(["Alerting"])
    AlertCrons{{"Alert Crons"}}
    EvalStore[("Eval Store")]
    EvalCrons{{"Eval Crons"}}
    LogStore[("Log Store")]
    SiteMetrics(["Site Metrics"])
  end

  subgraph Finance["Financial"]
    direction TB
    Costs(["Costs"])
    FinanceRpt(["Finance"])
    Budgets(["Budgets"])
    QuotaWindows(["Quota Windows"])
  end

  subgraph Extern["External Services"]
    direction TB
    Neon[("Neon PostgreSQL")]
    Ollama(["Ollama LLM"])
    Firecrawl(["Firecrawl"])
    EmbedSvc(["Embed Service"])
    GeminiAPI(["Gemini API"])
    GrokAPI(["Grok API"])
  end

  %% ── App connections ──
  APP --> Core
  APP --> Execution
  APP --> ContentPipeline
  APP --> IntelEngine
  APP --> PluginSys
  APP --> Monitor
  APP --> Finance

  %% ── Core flows ──
  Companies --> Agents
  Companies --> Projects
  Projects --> Issues
  Issues --> Approvals
  Issues --> Activity
  Agents --> AgentInstructions
  Agents --> AgentPerms

  %% ── Execution flows ──
  Agents --> Heartbeat
  Heartbeat --> WorkspaceRuntime
  Heartbeat --> ExecWorkspaces
  Heartbeat --> WorkspaceOps
  Heartbeat --> Budgets
  Heartbeat --> Costs
  Issues --> IssueWakeup
  IssueWakeup --> Heartbeat

  %% ── Content flows ──
  ContentCrons --> ContentSvc
  ContentSvc --> Templates
  ContentSvc --> Ollama
  ContentSvc --> Embeddings
  ContentCrons --> SEOEngine
  SEOEngine --> TrendScanner
  VisualContent --> VisualJobs
  VisualContent --> VisualBack
  Gemini --> GeminiAPI
  Grok --> GrokAPI
  VideoAssembler --> VisualContent
  ContentSvc --> Publishers

  %% ── Intel flows ──
  IntelCrons --> IntelSvc
  IntelSvc --> Embeddings
  Embeddings --> EmbedSvc
  TrendCrons --> TrendScanner
  TrendScanner --> IntelSvc

  %% ── Plugin flows ──
  Loader --> Registry
  Lifecycle --> WorkerMgr
  JobScheduler --> JobStore
  JobScheduler --> Lifecycle
  ToolDispatch --> WorkerMgr
  HostServices --> WorkerMgr
  EventBus --> Lifecycle

  %% ── Monitoring flows ──
  AlertCrons --> Alerting
  EvalCrons --> EvalStore
  Heartbeat --> LogStore

  %% ── Financial flows ──
  Budgets --> QuotaWindows
  Costs --> FinanceRpt

  %% ── External connections ──
  APP --> Neon
  IntelSvc --> Firecrawl

  %% ── Styling ──
  classDef entryNode fill:#f59e0b,stroke:#d97706,stroke-width:3px,color:#451a03,font-weight:bold
  classDef cronNode fill:#7c3aed,stroke:#6d28d9,color:#f5f3ff,stroke-width:2px
  classDef storeNode fill:#0891b2,stroke:#0e7490,color:#ecfeff,stroke-width:2px

  class ContentCrons,IntelCrons,TrendCrons,AlertCrons,EvalCrons,JobScheduler cronNode
  class Neon,Embeddings,EvalStore,LogStore,JobStore storeNode

  style Core fill:#dbeafe,stroke:#3b82f6,stroke-width:2px,color:#1e3a5f
  style Execution fill:#fce7f3,stroke:#ec4899,stroke-width:2px,color:#5f1e3a
  style ContentPipeline fill:#dcfce7,stroke:#22c55e,stroke-width:2px,color:#1e5f3a
  style VisualBack fill:#d1fae5,stroke:#10b981,stroke-width:2px,color:#1e5f3a
  style IntelEngine fill:#ffedd5,stroke:#f97316,stroke-width:2px,color:#5f3a1e
  style PluginSys fill:#f3e8ff,stroke:#a855f7,stroke-width:2px,color:#3a1e5f
  style Monitor fill:#fee2e2,stroke:#ef4444,stroke-width:2px,color:#5f1e1e
  style Finance fill:#ccfbf1,stroke:#14b8a6,stroke-width:2px,color:#1e5f5f
  style Extern fill:#f1f5f9,stroke:#94a3b8,stroke-width:2px,color:#334155
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
  const wrapperRef = useRef<HTMLDivElement>(null);

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
        maxScale={4}
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
