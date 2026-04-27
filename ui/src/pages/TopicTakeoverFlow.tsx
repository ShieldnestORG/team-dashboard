import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/lib/router";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

/**
 * Topic Takeover — Animated Machination View
 *
 * Renders the topic-takeover roadmap (initiatives A/B/D + E/F/G/H/I + utility
 * pivots) as a stylized factory flow: nodes are processing stations, edges
 * carry pulsing particles that represent the data each station produces
 * (SERP candidates, enriched companies, blog posts, audits).
 *
 * Doc: docs/products/topic-takeover-roadmap.md
 */

type Phase = 1 | 2 | 3 | 4;

type NodeKind = "ingest" | "directory" | "content" | "outbound" | "product" | "utility" | "store";

interface FlowNode {
  id: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: NodeKind;
  phase: Phase;
  doc?: string;
}

interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  curve?: number; // px of curvature
  speed?: number; // 0..1 multiplier
  density?: number; // particle count
  color?: string;
}

const NODES: FlowNode[] = [
  { id: "A", label: "A · SERP Ingest", sub: "Firecrawl → directory_pending", x: 60, y: 280, w: 200, h: 76, kind: "ingest", phase: 1, doc: "directory-serp-ingest-prd.md" },
  { id: "echo", label: "Echo Enrichment", sub: "GitHub · Twitter · RSS · CoinGecko", x: 320, y: 280, w: 200, h: 76, kind: "ingest", phase: 1 },

  { id: "E", label: "E · Restaking", sub: "EigenLayer / LRT / AVS", x: 600, y: 80, w: 180, h: 76, kind: "directory", phase: 2, doc: "eigenlayer-avs-directory-prd.md" },
  { id: "H", label: "H · Cosmos IBC", sub: "Chains · Relayers · Apps", x: 600, y: 200, w: 180, h: 76, kind: "directory", phase: 2, doc: "cosmos-ibc-directory-prd.md" },
  { id: "F", label: "F · FaithTech", sub: "508(c)(1)(A) moat", x: 600, y: 320, w: 180, h: 76, kind: "directory", phase: 2, doc: "faith-tech-directory-prd.md" },
  { id: "I", label: "I · DevTools Pulse", sub: "Live signals · momentum", x: 600, y: 440, w: 180, h: 76, kind: "directory", phase: 3, doc: "devtools-live-signals-prd.md" },

  { id: "B", label: "B · Outbound AEO", sub: "Cold-email · Resend", x: 880, y: 200, w: 180, h: 76, kind: "outbound", phase: 3 },

  { id: "G", label: "G · AEO Cluster", sub: "48-rule content cluster", x: 880, y: 360, w: 180, h: 76, kind: "content", phase: 1, doc: "aeo-content-cluster-prd.md" },

  { id: "CS", label: "CreditScore", sub: "Free audit → paid funnel", x: 1140, y: 280, w: 180, h: 76, kind: "product", phase: 3, doc: "creditscore-prd.md" },

  { id: "D", label: "D · Niche Harvest", sub: "Backlog table", x: 60, y: 460, w: 200, h: 76, kind: "ingest", phase: 4, doc: "tool-niche-harvest-prd.md" },
  { id: "U_TC", label: "tokencount.dev", sub: "→ LLM cost optimizer", x: 320, y: 420, w: 200, h: 64, kind: "utility", phase: 3, doc: "utility-network/tokencount-pivot-brief.md" },
  { id: "U_DC", label: "dailycompound.app", sub: "→ Crypto yield calc", x: 320, y: 500, w: 200, h: 64, kind: "utility", phase: 2, doc: "utility-network/dailycompound-pivot-brief.md" },

  { id: "STORE", label: "directory.coherencedaddy.com", sub: "Public storefront", x: 1140, y: 80, w: 220, h: 76, kind: "store", phase: 2 },
];

const EDGES: FlowEdge[] = [
  { from: "A", to: "echo", density: 5, speed: 1.0 },
  { from: "echo", to: "E", density: 4, speed: 0.9, curve: -40 },
  { from: "echo", to: "H", density: 4, speed: 0.9, curve: -10 },
  { from: "echo", to: "F", density: 4, speed: 0.9, curve: 10 },
  { from: "echo", to: "I", density: 3, speed: 0.7, curve: 40 },

  { from: "E", to: "STORE", density: 3, speed: 0.8, curve: -10 },
  { from: "H", to: "STORE", density: 3, speed: 0.8, curve: -20 },
  { from: "F", to: "STORE", density: 3, speed: 0.8, curve: -30 },

  { from: "E", to: "B", density: 4, speed: 1.0, curve: 30 },
  { from: "H", to: "B", density: 4, speed: 1.0 },
  { from: "F", to: "B", density: 4, speed: 1.0, curve: -30 },
  { from: "I", to: "G", density: 3, speed: 0.7, curve: -20, label: "Pulse → posts" },

  { from: "G", to: "B", density: 5, speed: 1.1, curve: -20, label: "anchors" },
  { from: "B", to: "CS", density: 6, speed: 1.2, curve: 0, label: "conversions" },
  { from: "G", to: "CS", density: 4, speed: 1.0, curve: 20 },

  { from: "D", to: "U_TC", density: 2, speed: 0.5, curve: -10 },
  { from: "D", to: "U_DC", density: 2, speed: 0.5, curve: 10 },
  { from: "U_DC", to: "E", density: 2, speed: 0.6, curve: -120, label: "live APRs" },
  { from: "U_TC", to: "G", density: 2, speed: 0.6, curve: -80 },
];

const KIND_STYLES: Record<NodeKind, { fill: string; stroke: string; accent: string }> = {
  ingest: { fill: "#0b1220", stroke: "#3b82f6", accent: "#60a5fa" },
  directory: { fill: "#0a1a14", stroke: "#10b981", accent: "#34d399" },
  content: { fill: "#1a1408", stroke: "#f59e0b", accent: "#fbbf24" },
  outbound: { fill: "#1a0a14", stroke: "#ec4899", accent: "#f472b6" },
  product: { fill: "#1a0820", stroke: "#a855f7", accent: "#c084fc" },
  utility: { fill: "#0a1820", stroke: "#06b6d4", accent: "#22d3ee" },
  store: { fill: "#101010", stroke: "#fafafa", accent: "#ffffff" },
};

const PHASE_LABELS: Record<Phase, string> = {
  1: "Phase 1 — Foundations",
  2: "Phase 2 — Directory Expansion",
  3: "Phase 3 — Content + Signals",
  4: "Phase 4 — Compounding",
};

const VIEW_W = 1400;
const VIEW_H = 600;

function nodeAnchor(n: FlowNode, side: "left" | "right" | "top" | "bottom" | "center" = "center") {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  if (side === "left") return { x: n.x, y: cy };
  if (side === "right") return { x: n.x + n.w, y: cy };
  if (side === "top") return { x: cx, y: n.y };
  if (side === "bottom") return { x: cx, y: n.y + n.h };
  return { x: cx, y: cy };
}

function edgePath(from: FlowNode, to: FlowNode, curve = 0): string {
  const fromSide = to.x > from.x + from.w ? "right" : to.x + to.w < from.x ? "left" : to.y > from.y ? "bottom" : "top";
  const toSide = to.x > from.x + from.w ? "left" : to.x + to.w < from.x ? "right" : to.y > from.y ? "top" : "bottom";
  const a = nodeAnchor(from, fromSide as never);
  const b = nodeAnchor(to, toSide as never);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + curve;
  return `M ${a.x},${a.y} Q ${mx},${my} ${b.x},${b.y}`;
}

export function TopicTakeoverFlow() {
  const [running, setRunning] = useState(true);
  const [phaseFilter, setPhaseFilter] = useState<Phase | "all">("all");
  const [hovered, setHovered] = useState<string | null>(null);
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});
  const [now, setNow] = useState(0);
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Topic Takeover" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const start = performance.now();
    const loop = (t: number) => {
      setNow(t - start);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const visibleNodes = useMemo(
    () => NODES.filter((n) => phaseFilter === "all" || n.phase === phaseFilter),
    [phaseFilter]
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => EDGES.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to)),
    [visibleIds]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Topic Takeover · Flow Machine</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live view of the SERP-ingest → directory → outbound → CreditScore funnel.
            Particles represent data flowing between stations.{" "}
            <Link to="/docs/products/topic-takeover-roadmap.md" className="underline underline-offset-2">
              roadmap doc →
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setRunning((r) => !r)}
            className="px-3 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted/50 transition"
          >
            {running ? "⏸ Pause" : "▶ Play"}
          </button>
          {(["all", 1, 2, 3, 4] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPhaseFilter(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition ${
                phaseFilter === p
                  ? "bg-foreground text-background border-foreground"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              {p === "all" ? "All phases" : `Phase ${p}`}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-[#06080c] overflow-hidden relative">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-auto block"
          style={{ background: "radial-gradient(ellipse at 50% 0%, #0a1018 0%, #06080c 60%)" }}
        >
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#0f1620" strokeWidth="1" />
            </pattern>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
            </marker>
          </defs>

          <rect width={VIEW_W} height={VIEW_H} fill="url(#grid)" opacity={0.5} />

          {/* edges */}
          <g>
            {visibleEdges.map((e, i) => {
              const from = NODES.find((n) => n.id === e.from)!;
              const to = NODES.find((n) => n.id === e.to)!;
              const d = edgePath(from, to, e.curve ?? 0);
              const id = `${e.from}-${e.to}-${i}`;
              const dim = hovered && hovered !== e.from && hovered !== e.to ? 0.15 : 1;
              const accent = e.color ?? KIND_STYLES[from.kind].accent;
              return (
                <g key={id} opacity={dim}>
                  <path
                    ref={(el) => {
                      pathRefs.current[id] = el;
                    }}
                    d={d}
                    fill="none"
                    stroke="#1f2937"
                    strokeWidth={1.5}
                    markerEnd="url(#arrow)"
                  />
                  {e.label && (
                    <text
                      fontSize="10"
                      fill="#64748b"
                      textAnchor="middle"
                      dy={-4}
                    >
                      <textPath href={`#path-${id}`} startOffset="50%">
                        {e.label}
                      </textPath>
                    </text>
                  )}
                  <path id={`path-${id}`} d={d} fill="none" stroke="none" />
                  <Particles
                    pathId={id}
                    pathRef={pathRefs}
                    count={e.density ?? 3}
                    speed={e.speed ?? 1}
                    color={accent}
                    now={now}
                  />
                </g>
              );
            })}
          </g>

          {/* nodes */}
          <g>
            {visibleNodes.map((n) => {
              const s = KIND_STYLES[n.kind];
              const isHover = hovered === n.id;
              const pulse = 0.5 + 0.5 * Math.sin(now / 600 + n.x * 0.01);
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  onMouseEnter={() => setHovered(n.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    width={n.w}
                    height={n.h}
                    rx={10}
                    fill={s.fill}
                    stroke={s.stroke}
                    strokeWidth={isHover ? 2.5 : 1.5}
                    opacity={0.95}
                    filter={isHover ? "url(#glow)" : undefined}
                  />
                  <circle cx={12} cy={12} r={4} fill={s.accent} opacity={0.4 + 0.6 * pulse} />
                  <text x={26} y={16} fontSize="13" fontWeight={600} fill="#e2e8f0">
                    {n.label}
                  </text>
                  <text x={12} y={42} fontSize="10.5" fill="#94a3b8">
                    {n.sub}
                  </text>
                  <text x={12} y={62} fontSize="9" fill={s.accent} opacity={0.7}>
                    {PHASE_LABELS[n.phase].toUpperCase()}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* legend overlay */}
        <div className="absolute left-3 bottom-3 flex flex-wrap gap-2 text-[10px]">
          {(["ingest", "directory", "content", "outbound", "product", "utility", "store"] as NodeKind[]).map((k) => (
            <div key={k} className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/40 border border-white/5">
              <span className="w-2 h-2 rounded-full" style={{ background: KIND_STYLES[k].accent }} />
              <span className="text-white/70 capitalize">{k}</span>
            </div>
          ))}
        </div>
      </div>

      {hovered && (
        <NodeDetail node={NODES.find((n) => n.id === hovered)!} />
      )}

      <div className="text-xs text-muted-foreground">
        Source: <code>docs/products/topic-takeover-roadmap.md</code> · five new initiatives (E–I)
        chained off the existing SERP-ingest pipeline.
      </div>
    </div>
  );
}

function Particles({
  pathId,
  pathRef,
  count,
  speed,
  color,
  now,
}: {
  pathId: string;
  pathRef: React.MutableRefObject<Record<string, SVGPathElement | null>>;
  count: number;
  speed: number;
  color: string;
  now: number;
}) {
  const path = pathRef.current[pathId];
  if (!path || typeof path.getTotalLength !== "function") return null;
  const len = path.getTotalLength();
  const period = 4000 / Math.max(0.1, speed);
  return (
    <g>
      {Array.from({ length: count }).map((_, i) => {
        const phase = (i / count) * period;
        const t = ((now + phase) % period) / period;
        const pt = path.getPointAtLength(t * len);
        const fade = t < 0.05 ? t / 0.05 : t > 0.95 ? (1 - t) / 0.05 : 1;
        return (
          <circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={2.5}
            fill={color}
            opacity={fade}
            style={{ filter: "drop-shadow(0 0 4px currentColor)", color }}
          />
        );
      })}
    </g>
  );
}

function NodeDetail({ node }: { node: FlowNode }) {
  const s = KIND_STYLES[node.kind];
  return (
    <div
      className="rounded-lg border p-4 flex items-start gap-4"
      style={{ background: `${s.fill}cc`, borderColor: s.stroke }}
    >
      <div className="w-1 self-stretch rounded" style={{ background: s.accent }} />
      <div className="flex-1">
        <div className="text-sm font-semibold text-foreground">{node.label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{node.sub}</div>
        <div className="text-[10px] uppercase tracking-wider mt-2" style={{ color: s.accent }}>
          {PHASE_LABELS[node.phase]} · {node.kind}
        </div>
      </div>
      {node.doc && (
        <a
          href={`/docs/products/${node.doc}`}
          className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground shrink-0"
        >
          Open PRD →
        </a>
      )}
    </div>
  );
}

export default TopicTakeoverFlow;
