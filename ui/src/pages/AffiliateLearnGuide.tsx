import { useEffect, useMemo, useState } from "react";
import { useParams } from "@/lib/router";
import { AffiliateNav } from "@/components/AffiliateNav";
import { getAffiliateToken } from "@/api/affiliates";
import {
  getGuideBySlug,
  SECTION_META,
  type GuideCallout,
  type GuideStep,
  type LearnGuide,
} from "@/content/affiliate-learn";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Clock3,
  Lightbulb,
  AlertTriangle,
  Quote,
  PlayCircle,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { LearnVisual } from "./AffiliateLearnVisual";

export function AffiliateLearnGuide() {
  const { slug } = useParams<{ slug: string }>();
  const authed = Boolean(getAffiliateToken());
  const guide = slug ? getGuideBySlug(slug) : undefined;

  const [idx, setIdx] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    // Sync with URL hash for deep links (e.g. /learn/slug#3).
    if (!guide) return;
    const fromHash = parseInt(window.location.hash.replace("#", ""), 10);
    if (!Number.isNaN(fromHash) && fromHash >= 1 && fromHash <= guide.steps.length) {
      setIdx(fromHash - 1);
    } else {
      setIdx(0);
    }
    setFinished(false);
  }, [guide]);

  useEffect(() => {
    if (!guide) return;
    window.history.replaceState(null, "", `#${idx + 1}`);
    // Browser scroll-anchoring keeps the old scroll position when content swaps;
    // defer past the anchor adjustment, then force top.
    const t = setTimeout(() => {
      const scroller = document.querySelector<HTMLElement>(".h-screen.overflow-y-auto");
      if (scroller) scroller.scrollTop = 0;
      else window.scrollTo(0, 0);
    }, 50);
    return () => clearTimeout(t);
  }, [idx, guide]);

  useEffect(() => {
    if (!guide) return;
    const total = guide.steps.length;
    const onKey = (e: KeyboardEvent) => {
      if (finished) return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        if (idx < total - 1) setIdx((n) => n + 1);
        else setFinished(true);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (idx > 0) setIdx((n) => n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, finished, guide]);

  if (!guide) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        {authed ? (
          <AffiliateNav active="/learn" subtitle="Affiliate Program" title="Learn & Teach" />
        ) : null}
        <main className="max-w-3xl mx-auto px-6 py-16 text-center space-y-4">
          <h1 className="text-2xl font-bold">Guide not found</h1>
          <a
            href="/learn"
            className="inline-flex items-center gap-1.5 text-sm text-[#ff876d] hover:text-[#ff876d]/90 font-medium"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Learn
          </a>
        </main>
      </div>
    );
  }

  const meta = SECTION_META[guide.section];
  const total = guide.steps.length;
  const step = guide.steps[idx];
  const isLast = idx === total - 1;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {authed ? (
        <AffiliateNav active="/learn" subtitle="Affiliate Program" title="Learn & Teach" />
      ) : (
        <header className="bg-card border-b border-border sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground truncate">Affiliate Program · Learn</p>
              <h1 className="text-lg font-bold text-foreground truncate">{guide.title}</h1>
            </div>
            <a href="/" className="text-sm text-[#ff876d] font-medium whitespace-nowrap">
              Apply &rarr;
            </a>
          </div>
        </header>
      )}

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <a
          href="/learn"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          All guides
        </a>

        <GuideHeader guide={guide} sectionLabel={meta.label} sectionOrder={meta.order} />

        {finished ? (
          <FinishedPanel guide={guide} onRestart={() => { setFinished(false); setIdx(0); }} />
        ) : (
          <>
            <ProgressBar current={idx + 1} total={total} />
            <StepView step={step} />
            <StepNav
              idx={idx}
              total={total}
              onPrev={() => setIdx((n) => Math.max(0, n - 1))}
              onNext={() => {
                if (isLast) setFinished(true);
                else setIdx((n) => Math.min(total - 1, n + 1));
              }}
              isLast={isLast}
            />
          </>
        )}
      </main>
    </div>
  );
}

function GuideHeader({
  guide,
  sectionLabel,
  sectionOrder,
}: {
  guide: LearnGuide;
  sectionLabel: string;
  sectionOrder: number;
}) {
  return (
    <header className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest">
        <span className="text-[#ff876d]">0{sectionOrder}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{sectionLabel}</span>
      </div>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
        {guide.title}
      </h1>
      <p className="text-base text-muted-foreground leading-relaxed">{guide.subtitle}</p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
        <Clock3 className="h-3.5 w-3.5" />
        <span>{guide.readingMinutes} min</span>
        <span className="mx-1">·</span>
        <span>{guide.steps.length} steps</span>
      </div>
    </header>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = (current / total) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        <span>
          Step <span className="text-foreground font-bold">{current}</span> of {total}
        </span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-1 w-full rounded-full overflow-hidden bg-border">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: "#ff876d" }}
        />
      </div>
    </div>
  );
}

function StepView({ step }: { step: GuideStep }) {
  return (
    <article className="space-y-6 animate-in fade-in-50 duration-200">
      {step.visual && <LearnVisual visual={step.visual} />}
      {!step.visual && step.screenshot && (
        <figure className="space-y-2">
          <div className="overflow-hidden rounded-xl border border-border bg-card/40">
            <img src={step.screenshot.src} alt={step.screenshot.alt} className="w-full h-auto block" />
          </div>
          {step.screenshot.caption && (
            <figcaption className="text-xs text-muted-foreground italic">
              {step.screenshot.caption}
            </figcaption>
          )}
        </figure>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <span className="inline-block text-[10px] font-mono uppercase tracking-[0.2em] text-[#ff876d]">
            {step.eyebrow}
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-[1.05] text-foreground">
            {step.headline}
          </h2>
          {step.kicker && (
            <p className="text-base sm:text-lg text-muted-foreground leading-snug max-w-[52ch]">
              {renderKicker(step.kicker, step.emphasis)}
            </p>
          )}
        </div>

        {step.analogy && <AnalogyCard analogy={step.analogy} />}
        {step.callout && <Callout callout={step.callout} />}
      </div>
    </article>
  );
}

function AnalogyCard({ analogy }: { analogy: { label?: string; text: string } }) {
  return (
    <aside
      className="flex gap-3 rounded-xl px-4 py-3.5"
      style={{
        background: "rgba(138,180,248,0.06)",
        border: "1px solid rgba(138,180,248,0.25)",
      }}
    >
      <Sparkles className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "#8ab4f8" }} />
      <div className="space-y-0.5 min-w-0">
        <div
          className="text-[10px] font-mono uppercase tracking-widest"
          style={{ color: "#8ab4f8" }}
        >
          {analogy.label ?? "Like"}
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{analogy.text}</p>
      </div>
    </aside>
  );
}

function renderKicker(kicker: string, emphasis?: string) {
  if (!emphasis) return kicker;
  const idx = kicker.indexOf(emphasis);
  if (idx === -1) return kicker;
  return (
    <>
      {kicker.slice(0, idx)}
      <span className="text-foreground font-semibold">{emphasis}</span>
      {kicker.slice(idx + emphasis.length)}
    </>
  );
}

function Callout({ callout }: { callout: GuideCallout }) {
  const styles = {
    tip: {
      Icon: Lightbulb,
      color: "#4A9D7C",
      bg: "rgba(74,157,124,0.08)",
      border: "rgba(74,157,124,0.3)",
      label: "Tip",
    },
    "watch-out": {
      Icon: AlertTriangle,
      color: "#D9A843",
      bg: "rgba(217,168,67,0.08)",
      border: "rgba(217,168,67,0.3)",
      label: "Watch out",
    },
    example: {
      Icon: Quote,
      color: "#ff876d",
      bg: "rgba(255,135,109,0.08)",
      border: "rgba(255,135,109,0.3)",
      label: "Example",
    },
  }[callout.kind];
  const { Icon } = styles;
  return (
    <aside
      className="flex gap-3 rounded-xl px-4 py-3.5"
      style={{ backgroundColor: styles.bg, border: `1px solid ${styles.border}` }}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5" style={{ color: styles.color }} />
      <div className="space-y-1 min-w-0">
        <div
          className="text-[10px] font-mono uppercase tracking-widest"
          style={{ color: styles.color }}
        >
          {styles.label}
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{callout.text}</p>
      </div>
    </aside>
  );
}

function StepNav({
  idx,
  total,
  onPrev,
  onNext,
  isLast,
}: {
  idx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const dots = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);
  return (
    <div className="pt-4 space-y-5">
      <div className="flex justify-center items-center gap-1.5">
        {dots.map((i) => (
          <span
            key={i}
            aria-hidden
            className="h-1.5 rounded-full transition-all"
            style={{
              width: i === idx ? 20 : 6,
              background: i === idx ? "#ff876d" : i < idx ? "rgba(255,135,109,0.4)" : "rgba(255,255,255,0.12)",
            }}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onPrev}
          disabled={idx === 0}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:border-foreground/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <button
          type="button"
          onClick={onNext}
          className="group inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold shadow-lg shadow-black/20 transition-all hover:shadow-xl hover:shadow-black/30 hover:-translate-y-px"
          style={{ background: "#ff876d", color: "#18181B" }}
        >
          {isLast ? "Finish" : "Next"}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

function FinishedPanel({ guide, onRestart }: { guide: LearnGuide; onRestart: () => void }) {
  const related = guide.relatedSlugs
    .map((s) => getGuideBySlug(s))
    .filter((g): g is LearnGuide => Boolean(g));
  return (
    <div
      className="rounded-2xl p-6 sm:p-8 space-y-6"
      style={{
        background: "rgba(74,157,124,0.06)",
        border: "1px solid rgba(74,157,124,0.3)",
      }}
    >
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-6 w-6" style={{ color: "#4A9D7C" }} />
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "#4A9D7C" }}>
            Guide complete
          </div>
          <div className="text-lg font-bold">You're through it.</div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        Keep learning. These guides pair well with what you just read.
      </p>

      {related.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {related.map((g) => (
            <a
              key={g.slug}
              href={`/learn/${g.slug}`}
              className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-all hover:border-[#ff876d]/40"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-[#ff876d] transition-colors line-clamp-2">
                {g.title}
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-[#ff876d] transition-colors" />
            </a>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:border-foreground/30"
        >
          <ArrowLeft className="h-4 w-4" />
          Start over
        </button>
        <a
          href="/learn"
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold"
          style={{ background: "#ff876d", color: "#18181B" }}
        >
          All guides
        </a>
      </div>
    </div>
  );
}

/* Unused but kept to avoid breaking imports from prior versions. */
function _VideoPlaceholder() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-5 py-4">
      <PlayCircle className="h-5 w-5 text-muted-foreground shrink-0" />
      <div className="text-sm text-muted-foreground">Video walk-through coming soon.</div>
    </div>
  );
}
