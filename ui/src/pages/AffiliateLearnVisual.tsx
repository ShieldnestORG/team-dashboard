import { useRef } from "react";
import type { Visual } from "@/content/affiliate-learn";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/cdMotion";
import { CD, FONT_MONO, FONT_SANS } from "@/lib/cdDesign";

/** Inline HTML/SVG visual renderer. Markup is authored at its final state;
 *  each visual self-animates on mount (the guide remounts per step via key),
 *  and reduced-motion users simply see the static final state. */
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
    case "walkthrough":
      // Rendered by AffiliateLearnWalkthrough.tsx, never routed here.
      return null;
  }
}

/* ─────────── building blocks ─────────── */

function Frame({
  children,
  aspect = "auto",
  pad = "py-10 px-6 sm:px-10",
  frameRef,
}: {
  children: React.ReactNode;
  aspect?: "video" | "square" | "auto";
  pad?: string;
  frameRef?: React.Ref<HTMLDivElement>;
}) {
  const aspectClass =
    aspect === "video" ? "aspect-video" : aspect === "square" ? "aspect-square" : "";
  return (
    <div
      ref={frameRef}
      className={`relative w-full overflow-hidden rounded-xl ${aspectClass} ${pad}`}
      style={{
        background: `linear-gradient(135deg, ${CD.surface} 0%, ${CD.surfaceAlt} 100%)`,
        border: `1px solid ${CD.border}`,
        boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
      }}
    >
      {children}
    </div>
  );
}

/** Shared entrance for the simple card visuals: single fade-up on the frame. */
function useFadeUp() {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      gsap.fromTo(
        scope.current,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.55, ease: "cd" },
      );
    },
    { scope },
  );
  return scope;
}

/* ─────────── visuals ─────────── */

function GoogleSerp({ query = "best plumber near me" }: { query?: string }) {
  const rows = [
    { title: "Joe's Plumbing & Drain — Austin, TX", url: "joesplumbing.com", snippet: "24/7 emergency service. Family-owned since 1987. Free estimates on every job." },
    { title: "Austin Pro Plumbing Services", url: "austinproplumb.com", snippet: "Licensed, insured, top-rated. Residential and commercial." },
    { title: "RapidFix Plumbing Co.", url: "rapidfixplumbers.com", snippet: "Same-day service. Transparent pricing. No hidden fees." },
    { title: "The Plumbing Guys of Austin", url: "plumbingguysatx.com", snippet: "Over 2,000 five-star reviews. Book online in minutes." },
  ];
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      const el = scope.current;
      const queryBar = el.querySelector("[data-query]");
      const resultRows = el.querySelectorAll("[data-row]");
      const caption = el.querySelector("[data-caption]");
      gsap.set(queryBar, { opacity: 0, y: 8 });
      gsap.set(resultRows, { opacity: 0, y: 10 });
      gsap.set(caption, { opacity: 0 });
      const tl = gsap.timeline({ defaults: { ease: "cd" } });
      tl.to(queryBar, { opacity: 1, y: 0, duration: 0.4 })
        .to(resultRows, { opacity: 1, y: 0, duration: 0.45, stagger: 0.07 }, "-=0.1")
        .to(caption, { opacity: 1, duration: 0.4 }, "-=0.15");
    },
    { scope },
  );
  return (
    <Frame frameRef={scope} pad="p-5 sm:p-6">
      <div className="space-y-4">
        <div data-query className="flex items-center gap-2 rounded-full border px-4 py-2" style={{ borderColor: CD.border, background: "rgba(255,255,255,0.03)" }}>
          <span className="text-xs" style={{ color: CD.muted }}>🔍</span>
          <span className="text-sm" style={{ color: CD.ink }}>{query}</span>
        </div>
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.url} data-row className="space-y-1">
              <div className="text-[11px]" style={{ color: CD.muted }}>{r.url}</div>
              <div className="text-sm font-medium" style={{ color: "#8ab4f8" }}>{r.title}</div>
              <div className="text-xs leading-relaxed" style={{ color: CD.muted }}>{r.snippet}</div>
            </div>
          ))}
        </div>
        <div data-caption className="text-[10px] font-mono tracking-widest uppercase pt-2" style={{ color: CD.muted }}>
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
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      const el = scope.current;
      const queryBubble = el.querySelector("[data-query-bubble]");
      const aiRow = el.querySelector("[data-ai-row]");
      const answerEl = el.querySelector<HTMLElement>("[data-answer]");
      const caption = el.querySelector("[data-caption]");
      gsap.set(queryBubble, { opacity: 0, y: 10 });
      gsap.set(aiRow, { opacity: 0, y: 10 });
      gsap.set(caption, { opacity: 0 });
      if (answerEl) answerEl.textContent = "";
      // ~30 chars/sec, capped so long answers never exceed ~2.5s.
      const typeDur = Math.min(2.5, Math.max(0.6, answer.length / 30));
      const proxy = { i: 0 };
      const tl = gsap.timeline({ defaults: { ease: "cd" } });
      tl.to(queryBubble, { opacity: 1, y: 0, duration: 0.45 })
        .to(aiRow, { opacity: 1, y: 0, duration: 0.4 }, "+=0.15");
      if (answerEl) {
        tl.to(
          proxy,
          {
            i: answer.length,
            duration: typeDur,
            ease: "none",
            onUpdate: () => {
              answerEl.textContent = answer.slice(0, Math.round(proxy.i));
            },
          },
          "-=0.1",
        );
      }
      tl.to(caption, { opacity: 1, duration: 0.4 });
    },
    { scope },
  );
  return (
    <Frame frameRef={scope} pad="p-5 sm:p-6">
      <div className="space-y-4">
        <div className="flex justify-end">
          <div
            data-query-bubble
            className="max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm"
            style={{ background: CD.accent, color: CD.surface }}
          >
            {query}
          </div>
        </div>
        <div data-ai-row className="flex gap-3 items-start">
          <div
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
            style={{ background: "#0fa37f", color: "white" }}
          >
            AI
          </div>
          <div
            data-answer
            className="max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed"
            style={{ background: "rgba(255,255,255,0.06)", color: CD.ink, border: `1px solid ${CD.border}` }}
          >
            {answer}
          </div>
        </div>
        <div data-caption className="text-[10px] font-mono tracking-widest uppercase pt-2" style={{ color: CD.muted }}>
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
  const color = score >= 70 ? CD.success : score >= 40 ? CD.accent : CD.danger;
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      const el = scope.current;
      const arc = el.querySelector("[data-arc]");
      const num = el.querySelector("[data-num]");
      if (arc) {
        gsap.fromTo(
          arc,
          { strokeDashoffset: circ },
          { strokeDashoffset: circ - dash, duration: 1.4, ease: "power2.inOut" },
        );
      }
      if (num) {
        const proxy = { v: 0 };
        gsap.to(proxy, {
          v: score,
          duration: 1.4,
          ease: "power2.inOut",
          onUpdate: () => {
            num.textContent = String(Math.round(proxy.v));
          },
          onComplete: () => {
            num.textContent = String(score);
          },
        });
      }
      gsap.fromTo(
        el.querySelector("[data-label]"),
        { opacity: 0 },
        { opacity: 1, duration: 0.5, ease: "cd", delay: 0.3 },
      );
    },
    { scope },
  );
  return (
    <Frame frameRef={scope} pad="p-8">
      <div className="flex flex-col items-center gap-4">
        <svg width="200" height="200" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r={radius} fill="none" stroke={CD.border} strokeWidth="14" />
          <circle
            data-arc
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ - dash}
            transform="rotate(-90 100 100)"
          />
          <text
            data-num
            x="100"
            y="100"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontFamily: FONT_SANS, fontSize: 48, fontWeight: 700, fill: CD.ink }}
          >
            {score}
          </text>
          <text
            x="100"
            y="130"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: 2, fill: CD.muted }}
          >
            / 100
          </text>
        </svg>
        <div data-label className="text-xs font-mono tracking-widest uppercase" style={{ color: CD.muted }}>
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
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      const el = scope.current;
      const line = el.querySelector<SVGPathElement>("[data-line]");
      if (line) {
        const len = line.getTotalLength();
        gsap.fromTo(
          line,
          { strokeDasharray: len, strokeDashoffset: len },
          { strokeDashoffset: 0, duration: 1.1, ease: "power2.inOut" },
        );
      }
      gsap.fromTo(
        el.querySelector("[data-area]"),
        { opacity: 0 },
        { opacity: 1, duration: 0.6, ease: "cd", delay: 0.45 },
      );
      gsap.fromTo(
        el.querySelectorAll("[data-dot]"),
        { opacity: 0 },
        { opacity: 1, duration: 0.25, ease: "cd", stagger: 1.1 / points.length },
      );
      gsap.fromTo(
        el.querySelector("[data-delta]"),
        { opacity: 0 },
        { opacity: 1, duration: 0.5, ease: "cd", delay: 0.8 },
      );
    },
    { scope },
  );
  return (
    <Frame frameRef={scope} pad="p-6">
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div className="text-xs font-mono tracking-widest uppercase" style={{ color: CD.muted }}>
            {label}
          </div>
          <div data-delta className="text-sm font-semibold" style={{ color: CD.success }}>
            ↑ {points[points.length - 1] - points[0]} pts
          </div>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
          <defs>
            <linearGradient id="trend-g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CD.accent} stopOpacity="0.4" />
              <stop offset="100%" stopColor={CD.accent} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path data-area d={areaPath} fill="url(#trend-g)" />
          <path data-line d={path} fill="none" stroke={CD.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, i) => {
            const x = i * stepX;
            const y = height - ((p - min) / range) * height;
            return <circle data-dot key={i} cx={x} cy={y} r={3} fill={CD.accent} />;
          })}
        </svg>
      </div>
    </Frame>
  );
}

function TierCards({ tiers }: { tiers: Array<{ name: string; price: string; blurb?: string }> }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      const cards = scope.current.querySelectorAll("[data-card]");
      const featured = scope.current.querySelector("[data-featured]");
      gsap.set(cards, { opacity: 0, y: 14 });
      const tl = gsap.timeline();
      tl.to(cards, { opacity: 1, y: 0, duration: 0.5, ease: "cd", stagger: 0.08 });
      if (featured) {
        tl.to(featured, { scale: 1.02, duration: 0.22, ease: "power2.inOut" }, ">-0.05")
          .to(featured, { scale: 1, duration: 0.3, ease: "power2.inOut" });
      }
    },
    { scope },
  );
  return (
    <Frame frameRef={scope} pad="p-5 sm:p-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tiers.map((t, i) => {
          const featured = i === tiers.length - 1;
          return (
            <div
              key={t.name}
              data-card
              {...(featured ? { "data-featured": "" } : {})}
              className="rounded-lg p-4 flex flex-col gap-2"
              style={{
                background: featured ? "rgba(255,107,74,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${featured ? "rgba(255,107,74,0.35)" : CD.border}`,
              }}
            >
              <div
                className="text-[10px] font-mono tracking-widest uppercase"
                style={{ color: featured ? CD.accent : CD.muted }}
              >
                {t.name}
              </div>
              <div className="text-xl font-bold leading-none" style={{ color: CD.ink }}>
                {t.price}
              </div>
              {t.blurb && (
                <div className="text-xs leading-snug" style={{ color: CD.muted }}>
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
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      const el = scope.current;
      const labels = el.querySelector("[data-labels]");
      const track = el.querySelector("[data-track]");
      const marker = el.querySelector<HTMLElement>("[data-marker]");
      gsap.set([labels, track], { opacity: 0 });
      // Start the marker at the bar's center; keep the class-based -50% Y centering.
      if (marker && track) {
        gsap.set(marker, {
          yPercent: -50,
          x: ((50 - pct) / 100) * (track as HTMLElement).clientWidth,
        });
      }
      const tl = gsap.timeline({ defaults: { ease: "cd" } });
      tl.to(labels, { opacity: 1, duration: 0.45 })
        .to(track, { opacity: 1, duration: 0.45 }, "-=0.2");
      if (marker) {
        tl.to(marker, { x: 0, duration: 0.9, ease: "cd" }, "-=0.1");
      }
    },
    { scope },
  );
  return (
    <Frame frameRef={scope} pad="p-8">
      <div className="space-y-6">
        <div data-labels className="flex items-center justify-between text-xs font-mono tracking-widest uppercase">
          <span style={{ color: CD.muted }}>{left}</span>
          <span style={{ color: CD.muted }}>{right}</span>
        </div>
        <div data-track className="relative h-2 rounded-full overflow-hidden" style={{ background: CD.border }}>
          <div
            className="absolute inset-y-0 left-0"
            style={{ background: `linear-gradient(90deg, rgba(74,157,124,0.7), ${CD.accent})`, width: "100%" }}
          />
          <div
            data-marker
            className="absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2"
            style={{ left: `calc(${pct}% - 8px)`, background: CD.ink, borderColor: CD.accent }}
          />
        </div>
      </div>
    </Frame>
  );
}

function Bubble({ tone, text }: { tone: "said" | "thought" | "response"; text: string }) {
  const config = {
    said: { bg: "rgba(255,255,255,0.06)", border: CD.border, color: CD.ink, tag: "They said", tagColor: CD.muted, align: "start", shape: "rounded-tl-sm" },
    thought: { bg: "rgba(74,157,124,0.08)", border: "rgba(74,157,124,0.3)", color: CD.ink, tag: "What it means", tagColor: CD.success, align: "start", shape: "rounded-tl-sm italic" },
    response: { bg: "rgba(255,107,74,0.08)", border: "rgba(255,107,74,0.35)", color: CD.ink, tag: "How to respond", tagColor: CD.accent, align: "end", shape: "rounded-br-sm" },
  }[tone];
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      const el = scope.current;
      gsap.fromTo(
        el.querySelector("[data-tag]"),
        { opacity: 0 },
        { opacity: 1, duration: 0.4, ease: "cd" },
      );
      gsap.fromTo(
        el.querySelector("[data-bubble]"),
        { opacity: 0, scale: 0.92 },
        { opacity: 1, scale: 1, duration: 0.55, ease: "back.out(1.4)", delay: 0.1 },
      );
    },
    { scope },
  );
  return (
    <Frame frameRef={scope} pad="p-6 sm:p-8">
      <div className={`flex flex-col gap-2`} style={{ alignItems: config.align === "end" ? "flex-end" : "flex-start" }}>
        <div
          data-tag
          className="text-[10px] font-mono tracking-widest uppercase"
          style={{ color: config.tagColor }}
        >
          {config.tag}
        </div>
        <div
          data-bubble
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
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      const rowEls = scope.current.querySelectorAll("[data-row]");
      gsap.fromTo(
        rowEls,
        { opacity: 0.4 },
        { opacity: 1, duration: 0.5, ease: "cd", stagger: 0.1 },
      );
      // Transient accent tint on the border, settling back to the authored color.
      gsap.to(rowEls, {
        keyframes: [
          { borderColor: "rgba(255,107,74,0.45)", duration: 0.25 },
          { borderColor: CD.border, duration: 0.45 },
        ],
        ease: "power2.inOut",
        stagger: 0.1,
      });
    },
    { scope },
  );
  return (
    <Frame frameRef={scope} pad="p-5 sm:p-6">
      <div className="space-y-3">
        {heading && (
          <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: CD.muted }}>
            {heading}
          </div>
        )}
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div
              key={i}
              data-row
              className="flex items-center justify-between gap-3 rounded-lg px-4 py-3"
              style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${CD.border}` }}
            >
              <span className="text-sm font-medium" style={{ color: CD.ink }}>
                {row.primary}
              </span>
              {row.secondary && (
                <span className="text-xs font-mono" style={{ color: CD.muted }}>
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
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      const lineEls = scope.current.querySelectorAll("[data-line]");
      gsap.set(lineEls, { opacity: 0, y: 8 });
      const tl = gsap.timeline({ defaults: { ease: "cd" } });
      tl.fromTo(scope.current, { opacity: 0 }, { opacity: 1, duration: 0.45 })
        .to(lineEls, { opacity: 1, y: 0, duration: 0.4, stagger: 0.06 }, "-=0.1");
    },
    { scope },
  );
  return (
    <Frame frameRef={scope} pad="p-5 sm:p-6">
      <div className="space-y-3">
        {frame === "browser" && (
          <div data-line className="flex items-center gap-1.5 pb-2" style={{ borderBottom: `1px solid ${CD.border}` }}>
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#ff5f57" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#febc2e" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#28c840" }} />
            </div>
            <div className="flex-1 text-center text-[11px] font-mono" style={{ color: CD.muted }}>
              {headerConfig.browser?.suffix}
            </div>
          </div>
        )}
        {frame === "email" && (
          <div data-line className="space-y-1 pb-2" style={{ borderBottom: `1px solid ${CD.border}` }}>
            <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: CD.muted }}>
              {headerConfig.email?.prefix} {headerConfig.email?.suffix}
            </div>
            {title && (
              <div className="text-sm font-semibold" style={{ color: CD.ink }}>
                {title}
              </div>
            )}
          </div>
        )}
        {frame === "phone" && title && (
          <div data-line className="text-center text-sm font-semibold pb-2" style={{ color: CD.ink, borderBottom: `1px solid ${CD.border}` }}>
            {title}
          </div>
        )}
        <div className="space-y-2">
          {lines.length === 0 ? (
            <div data-line className="text-sm" style={{ color: CD.muted }}>
              {title ?? ""}
            </div>
          ) : (
            lines.map((l, i) => (
              <div key={i} data-line className="text-sm leading-relaxed" style={{ color: CD.ink }}>
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
  const scope = useFadeUp();
  return (
    <Frame frameRef={scope} pad="p-5 sm:p-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono tracking-widest uppercase" style={{ color: CD.accent }}>
            GET /intel/score
          </span>
          <span className="text-[10px] font-mono" style={{ color: CD.muted }}>
            200 OK
          </span>
        </div>
        <pre
          className="overflow-x-auto text-xs leading-relaxed p-4 rounded-lg font-mono"
          style={{ background: "rgba(0,0,0,0.35)", color: CD.ink, border: `1px solid ${CD.border}` }}
        >
          {code}
        </pre>
      </div>
    </Frame>
  );
}

function Editorial({ headline, excerpt }: { headline: string; excerpt: string }) {
  const scope = useFadeUp();
  return (
    <Frame frameRef={scope} pad="p-5 sm:p-7">
      <div className="space-y-3">
        <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: CD.accent }}>
          TEXAS BUSINESS WATCH · EDITORIAL
        </div>
        <div className="text-xl sm:text-2xl font-bold leading-tight tracking-tight" style={{ color: CD.ink }}>
          {headline}
        </div>
        <div className="text-sm leading-relaxed" style={{ color: CD.muted }}>
          {excerpt}
        </div>
        <div className="text-[10px] font-mono" style={{ color: CD.muted }}>
          — Filed by the editorial team
        </div>
      </div>
    </Frame>
  );
}

function SageCard({ blurb = "Dedicated account manager. Your single point of contact." }: { blurb?: string }) {
  const scope = useFadeUp();
  return (
    <Frame frameRef={scope} pad="p-8">
      <div className="flex items-center gap-5">
        <div
          className="h-20 w-20 shrink-0 rounded-full flex items-center justify-center text-2xl font-bold"
          style={{
            background: `linear-gradient(135deg, ${CD.accent}, #b85340)`,
            color: CD.surface,
          }}
        >
          S
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: CD.accent }}>
            Account Manager
          </div>
          <div className="text-2xl font-bold tracking-tight" style={{ color: CD.ink }}>
            Sage
          </div>
          <div className="text-sm leading-snug max-w-[32ch]" style={{ color: CD.muted }}>
            {blurb}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function BigStatement({ primary, secondary }: { primary: string; secondary?: string }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      const el = scope.current;
      gsap.fromTo(
        el.querySelector("[data-primary]"),
        { opacity: 0, scale: 0.96 },
        { opacity: 1, scale: 1, duration: 0.7, ease: "cd" },
      );
      const sec = el.querySelector("[data-secondary]");
      if (sec) {
        gsap.fromTo(
          sec,
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.55, ease: "cd", delay: 0.3 },
        );
      }
    },
    { scope },
  );
  return (
    <Frame frameRef={scope} pad="p-8 sm:p-12">
      <div className="space-y-3 text-center">
        <div data-primary className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight" style={{ color: CD.ink }}>
          {primary}
        </div>
        {secondary && (
          <div data-secondary className="text-sm sm:text-base" style={{ color: CD.muted }}>
            {secondary}
          </div>
        )}
      </div>
    </Frame>
  );
}

function QuestionCard({ number, question }: { number: number; question: string }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      const el = scope.current;
      gsap.fromTo(
        el.querySelector("[data-chip]"),
        { opacity: 0, scale: 0.5 },
        { opacity: 1, scale: 1, duration: 0.55, ease: "back.out(1.4)" },
      );
      gsap.fromTo(
        el.querySelectorAll("[data-q]"),
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.5, ease: "cd", delay: 0.15, stagger: 0.06 },
      );
    },
    { scope },
  );
  return (
    <Frame frameRef={scope} pad="p-6 sm:p-8">
      <div className="flex items-start gap-5">
        <div
          data-chip
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-2xl font-bold"
          style={{
            background: "rgba(255,107,74,0.12)",
            border: `2px solid ${CD.accent}`,
            color: CD.accent,
          }}
        >
          {number}
        </div>
        <div className="space-y-2 min-w-0">
          <div data-q className="text-[10px] font-mono tracking-widest uppercase" style={{ color: CD.muted }}>
            Discovery question
          </div>
          <div data-q className="text-lg sm:text-xl font-semibold leading-snug" style={{ color: CD.ink }}>
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
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      const el = scope.current;
      const vs = el.querySelector("[data-vs]");
      // The chip is centered via Tailwind -translate-x/y-1/2; re-assert that
      // centering with xPercent/yPercent so the scale tween doesn't clobber it.
      if (vs) gsap.set(vs, { xPercent: -50, yPercent: -50, scale: 0, opacity: 0 });
      const tl = gsap.timeline({ defaults: { ease: "cd" } });
      tl.fromTo(
        el.querySelector("[data-left]"),
        { opacity: 0, x: -16 },
        { opacity: 1, x: 0, duration: 0.55 },
        0,
      ).fromTo(
        el.querySelector("[data-right]"),
        { opacity: 0, x: 16 },
        { opacity: 1, x: 0, duration: 0.55 },
        0,
      );
      if (vs) {
        tl.to(vs, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(1.4)" }, 0.4);
      }
    },
    { scope },
  );
  return (
    <Frame frameRef={scope} pad="p-5 sm:p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative">
        <div
          data-vs
          className="hidden sm:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-9 w-9 items-center justify-center rounded-full font-mono text-xs font-bold z-10"
          style={{ background: CD.surface, border: `1px solid ${CD.border}`, color: CD.muted }}
        >
          VS
        </div>
        <div data-left className="rounded-lg p-5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${CD.border}` }}>
          <div className="text-[10px] font-mono tracking-widest uppercase pb-2" style={{ color: CD.muted }}>
            {left.label}
          </div>
          <div className="text-base font-medium leading-snug" style={{ color: CD.ink }}>
            {left.body}
          </div>
        </div>
        <div
          data-right
          className="rounded-lg p-5"
          style={{ background: "rgba(255,107,74,0.08)", border: `1px solid rgba(255,107,74,0.35)` }}
        >
          <div className="text-[10px] font-mono tracking-widest uppercase pb-2" style={{ color: CD.accent }}>
            {right.label}
          </div>
          <div className="text-base font-medium leading-snug" style={{ color: CD.ink }}>
            {right.body}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function EmphasisCard({ label = "Memorize this", text }: { label?: string; text: string }) {
  const scope = useFadeUp();
  return (
    <Frame frameRef={scope} pad="p-8 sm:p-10">
      <div className="space-y-4">
        <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: CD.accent }}>
          {label}
        </div>
        <div
          className="text-xl sm:text-2xl font-semibold leading-snug"
          style={{
            color: CD.ink,
            borderLeft: `3px solid ${CD.accent}`,
            paddingLeft: 18,
          }}
        >
          "{text}"
        </div>
      </div>
    </Frame>
  );
}
