import type { Visual } from "@/content/affiliate-learn";

const ACCENT = "#ff876d";
const INK = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.55)";
const SURFACE = "rgba(255,255,255,0.04)";
const SURFACE_ALT = "rgba(255,255,255,0.07)";
const BORDER = "rgba(255,255,255,0.10)";

/** Inline HTML/SVG visual renderer. Pure presentation, no state. */
export function LearnVisual({ visual }: { visual: Visual }) {
  switch (visual.kind) {
    case "google-serp":
      return <GoogleSerp query={visual.query} />;
    case "chatgpt-answer":
      return <ChatGptAnswer query={visual.query} answer={visual.answer} />;
    case "score-dial":
      return <ScoreDial score={visual.score ?? 72} label={visual.label} />;
    case "trend-spark":
      return <TrendSpark points={visual.points} label={visual.label} />;
    case "tier-cards":
      return <TierCards tiers={visual.tiers} />;
    case "spectrum-bar":
      return (
        <SpectrumBar
          left={visual.left}
          right={visual.right}
          position={visual.position ?? "center"}
        />
      );
    case "bubble":
      return <Bubble tone={visual.tone} text={visual.text} />;
    case "stack-rows":
      return <StackRows heading={visual.heading} rows={visual.rows} />;
    case "mock-frame":
      return (
        <MockFrame
          frame={visual.frame}
          title={visual.title}
          lines={visual.lines}
        />
      );
    case "json-block":
      return <JsonBlock code={visual.code} />;
    case "editorial":
      return <Editorial headline={visual.headline} excerpt={visual.excerpt} />;
    case "sage-card":
      return <SageCard blurb={visual.blurb} />;
    case "big-statement":
      return <BigStatement primary={visual.primary} secondary={visual.secondary} />;
    case "question-card":
      return <QuestionCard number={visual.number} question={visual.question} />;
    case "vs-split":
      return <VsSplit left={visual.left} right={visual.right} />;
    case "emphasis-card":
      return <EmphasisCard label={visual.label} text={visual.text} />;
  }
}

/* ─────────── building blocks ─────────── */

function Frame({
  children,
  aspect = "auto",
  pad = "py-10 px-6 sm:px-10",
}: {
  children: React.ReactNode;
  aspect?: "video" | "square" | "auto";
  pad?: string;
}) {
  const aspectClass =
    aspect === "video" ? "aspect-video" : aspect === "square" ? "aspect-square" : "";
  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl ${aspectClass} ${pad}`}
      style={{
        background: `linear-gradient(135deg, ${SURFACE} 0%, ${SURFACE_ALT} 100%)`,
        border: `1px solid ${BORDER}`,
        boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
      }}
    >
      {children}
    </div>
  );
}

/* ─────────── visuals ─────────── */

function GoogleSerp({ query = "best plumber near me" }: { query?: string }) {
  const rows = [
    { title: "Joe's Plumbing & Drain — Austin, TX", url: "joesplumbing.com", snippet: "24/7 emergency service. Family-owned since 1987. Free estimates on every job." },
    { title: "Austin Pro Plumbing Services", url: "austinproplumb.com", snippet: "Licensed, insured, top-rated. Residential and commercial." },
    { title: "RapidFix Plumbing Co.", url: "rapidfixplumbers.com", snippet: "Same-day service. Transparent pricing. No hidden fees." },
    { title: "The Plumbing Guys of Austin", url: "plumbingguysatx.com", snippet: "Over 2,000 five-star reviews. Book online in minutes." },
  ];
  return (
    <Frame pad="p-5 sm:p-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-full border px-4 py-2" style={{ borderColor: BORDER, background: "rgba(255,255,255,0.03)" }}>
          <span className="text-xs" style={{ color: MUTED }}>🔍</span>
          <span className="text-sm" style={{ color: INK }}>{query}</span>
        </div>
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.url} className="space-y-1">
              <div className="text-[11px]" style={{ color: MUTED }}>{r.url}</div>
              <div className="text-sm font-medium" style={{ color: "#8ab4f8" }}>{r.title}</div>
              <div className="text-xs leading-relaxed" style={{ color: MUTED }}>{r.snippet}</div>
            </div>
          ))}
        </div>
        <div className="text-[10px] font-mono tracking-widest uppercase pt-2" style={{ color: MUTED }}>
          10 blue links — classic SERP
        </div>
      </div>
    </Frame>
  );
}

function ChatGptAnswer({
  query = "I've got a leak under my sink in Austin, who should I call?",
  answer = "For a sink leak in Austin, I'd recommend Joe's Plumbing & Drain. They're family-owned, offer 24/7 emergency service, and have excellent reviews for quick sink and pipe repairs.",
}: {
  query?: string;
  answer?: string;
}) {
  return (
    <Frame pad="p-5 sm:p-6">
      <div className="space-y-4">
        <div className="flex justify-end">
          <div
            className="max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm"
            style={{ background: ACCENT, color: "#18181B" }}
          >
            {query}
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <div
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
            style={{ background: "#0fa37f", color: "white" }}
          >
            AI
          </div>
          <div
            className="max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed"
            style={{ background: "rgba(255,255,255,0.06)", color: INK, border: `1px solid ${BORDER}` }}
          >
            {answer}
          </div>
        </div>
        <div className="text-[10px] font-mono tracking-widest uppercase pt-2" style={{ color: MUTED }}>
          One answer. No scroll.
        </div>
      </div>
    </Frame>
  );
}

function ScoreDial({ score = 72, label = "Your Credit Score" }: { score?: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const radius = 80;
  const circ = 2 * Math.PI * radius;
  const dash = circ * pct;
  const color = score >= 70 ? "#4A9D7C" : score >= 40 ? ACCENT : "#D94343";
  return (
    <Frame pad="p-8">
      <div className="flex flex-col items-center gap-4">
        <svg width="200" height="200" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r={radius} fill="none" stroke={BORDER} strokeWidth="14" />
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ - dash}`}
            transform="rotate(-90 100 100)"
          />
          <text
            x="100"
            y="100"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontFamily: "Geist, sans-serif", fontSize: 48, fontWeight: 700, fill: INK }}
          >
            {score}
          </text>
          <text
            x="100"
            y="130"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontFamily: "Geist Mono, monospace", fontSize: 10, letterSpacing: 2, fill: MUTED }}
          >
            / 100
          </text>
        </svg>
        <div className="text-xs font-mono tracking-widest uppercase" style={{ color: MUTED }}>
          {label}
        </div>
      </div>
    </Frame>
  );
}

function TrendSpark({
  points = [42, 48, 45, 52, 58, 63, 66, 72, 78, 82],
  label = "30-day trend",
}: {
  points?: number[];
  label?: string;
}) {
  const width = 360;
  const height = 140;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p - min) / range) * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath = `${path} L ${width} ${height} L 0 ${height} Z`;
  return (
    <Frame pad="p-6">
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div className="text-xs font-mono tracking-widest uppercase" style={{ color: MUTED }}>
            {label}
          </div>
          <div className="text-sm font-semibold" style={{ color: "#4A9D7C" }}>
            ↑ {points[points.length - 1] - points[0]} pts
          </div>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
          <defs>
            <linearGradient id="trend-g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity="0.4" />
              <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#trend-g)" />
          <path d={path} fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, i) => {
            const x = i * stepX;
            const y = height - ((p - min) / range) * height;
            return <circle key={i} cx={x} cy={y} r={3} fill={ACCENT} />;
          })}
        </svg>
      </div>
    </Frame>
  );
}

function TierCards({ tiers }: { tiers: Array<{ name: string; price: string; blurb?: string }> }) {
  return (
    <Frame pad="p-5 sm:p-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tiers.map((t, i) => {
          const featured = i === tiers.length - 1;
          return (
            <div
              key={t.name}
              className="rounded-lg p-4 flex flex-col gap-2"
              style={{
                background: featured ? "rgba(255,135,109,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${featured ? "rgba(255,135,109,0.35)" : BORDER}`,
              }}
            >
              <div
                className="text-[10px] font-mono tracking-widest uppercase"
                style={{ color: featured ? ACCENT : MUTED }}
              >
                {t.name}
              </div>
              <div className="text-xl font-bold leading-none" style={{ color: INK }}>
                {t.price}
              </div>
              {t.blurb && (
                <div className="text-xs leading-snug" style={{ color: MUTED }}>
                  {t.blurb}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function SpectrumBar({
  left,
  right,
  position = "center",
}: {
  left: string;
  right: string;
  position?: "left" | "center" | "right";
}) {
  const pct = position === "left" ? 15 : position === "right" ? 85 : 50;
  return (
    <Frame pad="p-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between text-xs font-mono tracking-widest uppercase">
          <span style={{ color: MUTED }}>{left}</span>
          <span style={{ color: MUTED }}>{right}</span>
        </div>
        <div className="relative h-2 rounded-full overflow-hidden" style={{ background: BORDER }}>
          <div
            className="absolute inset-y-0 left-0"
            style={{ background: `linear-gradient(90deg, rgba(74,157,124,0.7), ${ACCENT})`, width: "100%" }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2"
            style={{ left: `calc(${pct}% - 8px)`, background: INK, borderColor: ACCENT }}
          />
        </div>
      </div>
    </Frame>
  );
}

function Bubble({ tone, text }: { tone: "said" | "thought" | "response"; text: string }) {
  const config = {
    said: { bg: "rgba(255,255,255,0.06)", border: BORDER, color: INK, tag: "They said", tagColor: MUTED, align: "start", shape: "rounded-tl-sm" },
    thought: { bg: "rgba(74,157,124,0.08)", border: "rgba(74,157,124,0.3)", color: INK, tag: "What it means", tagColor: "#4A9D7C", align: "start", shape: "rounded-tl-sm italic" },
    response: { bg: "rgba(255,135,109,0.08)", border: "rgba(255,135,109,0.35)", color: INK, tag: "How to respond", tagColor: ACCENT, align: "end", shape: "rounded-br-sm" },
  }[tone];
  return (
    <Frame pad="p-6 sm:p-8">
      <div className={`flex flex-col gap-2`} style={{ alignItems: config.align === "end" ? "flex-end" : "flex-start" }}>
        <div
          className="text-[10px] font-mono tracking-widest uppercase"
          style={{ color: config.tagColor }}
        >
          {config.tag}
        </div>
        <div
          className={`max-w-[90%] rounded-2xl px-5 py-4 text-base sm:text-lg leading-relaxed ${config.shape}`}
          style={{ background: config.bg, color: config.color, border: `1px solid ${config.border}` }}
        >
          {text}
        </div>
      </div>
    </Frame>
  );
}

function StackRows({
  heading,
  rows,
}: {
  heading?: string;
  rows: Array<{ primary: string; secondary?: string }>;
}) {
  return (
    <Frame pad="p-5 sm:p-6">
      <div className="space-y-3">
        {heading && (
          <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: MUTED }}>
            {heading}
          </div>
        )}
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-lg px-4 py-3"
              style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}` }}
            >
              <span className="text-sm font-medium" style={{ color: INK }}>
                {row.primary}
              </span>
              {row.secondary && (
                <span className="text-xs font-mono" style={{ color: MUTED }}>
                  {row.secondary}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

function MockFrame({
  frame,
  title,
  lines = [],
}: {
  frame: "phone" | "email" | "browser";
  title?: string;
  lines?: string[];
}) {
  const headerConfig = {
    phone: null,
    email: { prefix: "From:", suffix: "Coherence Daddy <reports@coherencedaddy.com>" },
    browser: { prefix: "", suffix: "coherencedaddy.com" },
  };
  return (
    <Frame pad="p-5 sm:p-6">
      <div className="space-y-3">
        {frame === "browser" && (
          <div className="flex items-center gap-1.5 pb-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#ff5f57" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#febc2e" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#28c840" }} />
            </div>
            <div className="flex-1 text-center text-[11px] font-mono" style={{ color: MUTED }}>
              {headerConfig.browser?.suffix}
            </div>
          </div>
        )}
        {frame === "email" && (
          <div className="space-y-1 pb-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: MUTED }}>
              {headerConfig.email?.prefix} {headerConfig.email?.suffix}
            </div>
            {title && (
              <div className="text-sm font-semibold" style={{ color: INK }}>
                {title}
              </div>
            )}
          </div>
        )}
        {frame === "phone" && title && (
          <div className="text-center text-sm font-semibold pb-2" style={{ color: INK, borderBottom: `1px solid ${BORDER}` }}>
            {title}
          </div>
        )}
        <div className="space-y-2">
          {lines.length === 0 ? (
            <div className="text-sm" style={{ color: MUTED }}>
              {title ?? ""}
            </div>
          ) : (
            lines.map((l, i) => (
              <div key={i} className="text-sm leading-relaxed" style={{ color: INK }}>
                {l}
              </div>
            ))
          )}
        </div>
      </div>
    </Frame>
  );
}

function JsonBlock({ code }: { code: string }) {
  return (
    <Frame pad="p-5 sm:p-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono tracking-widest uppercase" style={{ color: ACCENT }}>
            GET /intel/score
          </span>
          <span className="text-[10px] font-mono" style={{ color: MUTED }}>
            200 OK
          </span>
        </div>
        <pre
          className="overflow-x-auto text-xs leading-relaxed p-4 rounded-lg font-mono"
          style={{ background: "rgba(0,0,0,0.35)", color: INK, border: `1px solid ${BORDER}` }}
        >
          {code}
        </pre>
      </div>
    </Frame>
  );
}

function Editorial({ headline, excerpt }: { headline: string; excerpt: string }) {
  return (
    <Frame pad="p-5 sm:p-7">
      <div className="space-y-3">
        <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: ACCENT }}>
          TEXAS BUSINESS WATCH · EDITORIAL
        </div>
        <div className="text-xl sm:text-2xl font-bold leading-tight tracking-tight" style={{ color: INK }}>
          {headline}
        </div>
        <div className="text-sm leading-relaxed" style={{ color: MUTED }}>
          {excerpt}
        </div>
        <div className="text-[10px] font-mono" style={{ color: MUTED }}>
          — Filed by the editorial team
        </div>
      </div>
    </Frame>
  );
}

function SageCard({ blurb = "Dedicated account manager. Your single point of contact." }: { blurb?: string }) {
  return (
    <Frame pad="p-8">
      <div className="flex items-center gap-5">
        <div
          className="h-20 w-20 shrink-0 rounded-full flex items-center justify-center text-2xl font-bold"
          style={{
            background: `linear-gradient(135deg, ${ACCENT}, #b85340)`,
            color: "#18181B",
          }}
        >
          S
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: ACCENT }}>
            Account Manager
          </div>
          <div className="text-2xl font-bold tracking-tight" style={{ color: INK }}>
            Sage
          </div>
          <div className="text-sm leading-snug max-w-[32ch]" style={{ color: MUTED }}>
            {blurb}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function BigStatement({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <Frame pad="p-8 sm:p-12">
      <div className="space-y-3 text-center">
        <div className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight" style={{ color: INK }}>
          {primary}
        </div>
        {secondary && (
          <div className="text-sm sm:text-base" style={{ color: MUTED }}>
            {secondary}
          </div>
        )}
      </div>
    </Frame>
  );
}

function QuestionCard({ number, question }: { number: number; question: string }) {
  return (
    <Frame pad="p-6 sm:p-8">
      <div className="flex items-start gap-5">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-2xl font-bold"
          style={{
            background: "rgba(255,135,109,0.12)",
            border: `2px solid ${ACCENT}`,
            color: ACCENT,
          }}
        >
          {number}
        </div>
        <div className="space-y-2 min-w-0">
          <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: MUTED }}>
            Discovery question
          </div>
          <div className="text-lg sm:text-xl font-semibold leading-snug" style={{ color: INK }}>
            {question}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function VsSplit({
  left,
  right,
}: {
  left: { label: string; body: string };
  right: { label: string; body: string };
}) {
  return (
    <Frame pad="p-5 sm:p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative">
        <div
          className="hidden sm:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-9 w-9 items-center justify-center rounded-full font-mono text-xs font-bold z-10"
          style={{ background: "#18181B", border: `1px solid ${BORDER}`, color: MUTED }}
        >
          VS
        </div>
        <div className="rounded-lg p-5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}` }}>
          <div className="text-[10px] font-mono tracking-widest uppercase pb-2" style={{ color: MUTED }}>
            {left.label}
          </div>
          <div className="text-base font-medium leading-snug" style={{ color: INK }}>
            {left.body}
          </div>
        </div>
        <div
          className="rounded-lg p-5"
          style={{ background: "rgba(255,135,109,0.08)", border: `1px solid rgba(255,135,109,0.35)` }}
        >
          <div className="text-[10px] font-mono tracking-widest uppercase pb-2" style={{ color: ACCENT }}>
            {right.label}
          </div>
          <div className="text-base font-medium leading-snug" style={{ color: INK }}>
            {right.body}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function EmphasisCard({ label = "Memorize this", text }: { label?: string; text: string }) {
  return (
    <Frame pad="p-8 sm:p-10">
      <div className="space-y-4">
        <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: ACCENT }}>
          {label}
        </div>
        <div
          className="text-xl sm:text-2xl font-semibold leading-snug"
          style={{
            color: INK,
            borderLeft: `3px solid ${ACCENT}`,
            paddingLeft: 18,
          }}
        >
          "{text}"
        </div>
      </div>
    </Frame>
  );
}
