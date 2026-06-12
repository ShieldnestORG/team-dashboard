import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "@/lib/router";
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
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { CDPage } from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO } from "@/lib/cdDesign";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/cdMotion";
import {
  getGuideProgress,
  recordCheckPassed,
  recordCompleted,
  recordStep,
} from "@/lib/learnProgress";
import { LearnVisual } from "./AffiliateLearnVisual";
import { WalkthroughVisual } from "./AffiliateLearnWalkthrough";

// Step position lives in the URL hash (#1..#N, #done), so browser back/forward
// step through the guide and deep links keep working.
function parseStepHash(hash: string, total: number): number | null {
  const n = parseInt(hash.replace("#", ""), 10);
  if (Number.isNaN(n) || n < 1 || n > total) return null;
  return n - 1;
}

export function AffiliateLearnGuide() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const authed = Boolean(getAffiliateToken());
  const guide = slug ? getGuideBySlug(slug) : undefined;
  const total = guide?.steps.length ?? 0;

  const finished = location.hash === "#done";
  const idx = useMemo(
    () => (finished ? total - 1 : (parseStepHash(location.hash, total) ?? 0)),
    [location.hash, finished, total],
  );

  // Per-step recall-check results — seeded from stored progress so revisits
  // don't re-lock Next on already-passed checks.
  const [passedChecks, setPassedChecks] = useState<Record<number, boolean>>({});
  useEffect(() => {
    const stored = slug ? getGuideProgress(slug)?.passedChecks : undefined;
    setPassedChecks(
      stored ? Object.fromEntries(stored.map((i) => [i, true])) : {},
    );
  }, [slug]);

  // Normalize a missing/invalid hash without stacking a history entry —
  // resuming at the furthest step reached on a previous unfinished visit.
  useEffect(() => {
    if (!guide || finished) return;
    if (parseStepHash(location.hash, total) === null) {
      const stored = slug ? getGuideProgress(slug) : null;
      const resume = stored && !stored.completedAt ? Math.min(stored.lastStep, total - 1) : 0;
      navigate(`#${resume + 1}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide, location.hash, finished, total]);

  useEffect(() => {
    // Browser scroll-anchoring keeps the old scroll position when content swaps;
    // defer past the anchor adjustment, then force top.
    const t = setTimeout(() => window.scrollTo(0, 0), 50);
    return () => clearTimeout(t);
  }, [idx, finished, guide]);

  // Persist progress.
  useEffect(() => {
    if (!guide || !slug) return;
    if (finished) recordCompleted(slug);
    else recordStep(slug, idx);
  }, [slug, guide, idx, finished]);

  const step = guide?.steps[idx];
  const isLast = idx === total - 1;
  const checkPassed = !step?.check || Boolean(passedChecks[idx]);

  const goPrev = () => {
    if (idx > 0) navigate(`#${idx}`);
  };
  const goNext = () => {
    if (!checkPassed) return;
    if (isLast) navigate("#done");
    else navigate(`#${idx + 2}`);
  };

  useEffect(() => {
    if (!guide) return;
    const onKey = (e: KeyboardEvent) => {
      if (finished) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, finished, guide, checkPassed]);

  if (!guide) {
    return (
      <CDPage>
        {authed ? (
          <AffiliateNav active="/learn" subtitle="Affiliate Program" title="Learn & Teach" />
        ) : null}
        <main className="mx-auto max-w-3xl px-6 py-16 text-center space-y-4">
          <h1 className="text-2xl font-bold">Guide not found</h1>
          <Link
            to="/learn"
            className="inline-flex items-center gap-1.5 text-sm font-medium"
            style={{ color: CD.accent }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Learn
          </Link>
        </main>
      </CDPage>
    );
  }

  const meta = SECTION_META[guide.section];

  return (
    <CDPage>
      {authed ? (
        <AffiliateNav active="/learn" subtitle="Affiliate Program" title="Learn & Teach" />
      ) : (
        <PublicHeader title={guide.title} />
      )}

      <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        <Link
          to="/learn"
          className="inline-flex items-center gap-1.5 text-sm transition-colors"
          style={{ color: CD.muted }}
        >
          <ArrowLeft className="h-4 w-4" />
          All guides
        </Link>

        <GuideHeader guide={guide} sectionLabel={meta.label} sectionOrder={meta.order} />

        {guide.videoEmbedUrl && (
          <div
            className="aspect-video w-full overflow-hidden rounded-xl"
            style={{ border: `1px solid ${CD.borderStrong}`, background: CD.surface }}
          >
            <iframe
              src={guide.videoEmbedUrl}
              title={`${guide.title} — video walk-through`}
              className="h-full w-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}

        {/* Screen-reader step announcements */}
        <div aria-live="polite" className="sr-only">
          {finished
            ? `Guide complete: ${guide.title}`
            : step
              ? `Step ${idx + 1} of ${total}: ${step.headline}`
              : null}
        </div>

        {finished ? (
          <FinishedPanel guide={guide} onRestart={() => navigate("#1")} />
        ) : step ? (
          <>
            <ProgressBar current={idx + 1} total={total} />
            <StepView
              key={idx}
              step={step}
              checkPassed={Boolean(passedChecks[idx])}
              onCheckPassed={() => {
                setPassedChecks((m) => ({ ...m, [idx]: true }));
                if (slug) recordCheckPassed(slug, idx);
              }}
            />
            <StepNav
              idx={idx}
              total={total}
              onPrev={goPrev}
              onNext={goNext}
              isLast={isLast}
              nextLocked={!checkPassed}
            />
          </>
        ) : null}
      </main>
    </CDPage>
  );
}

function PublicHeader({ title }: { title: string }) {
  return (
    <header
      className="sticky top-0 z-20 backdrop-blur-md"
      style={{ background: "rgba(14,14,16,0.85)", borderBottom: `1px solid ${CD.border}` }}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <p
            className="truncate"
            style={{
              fontFamily: FONT_MONO,
              fontSize: "0.6875rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: CD.mutedSoft,
            }}
          >
            Affiliate Program · Learn
          </p>
          <h1 className="truncate text-lg font-bold">{title}</h1>
        </div>
        <a href="/" className="whitespace-nowrap text-sm font-medium" style={{ color: CD.accent }}>
          Apply &rarr;
        </a>
      </div>
    </header>
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
      <div
        className="flex items-center gap-2"
        style={{
          fontFamily: FONT_MONO,
          fontSize: "0.6875rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: CD.accent }}>0{sectionOrder}</span>
        <span style={{ color: CD.mutedSoft }}>·</span>
        <span style={{ color: CD.mutedSoft }}>{sectionLabel}</span>
      </div>
      <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{guide.title}</h1>
      <p className="text-base leading-relaxed" style={{ color: CD.muted }}>
        {guide.subtitle}
      </p>
      <div className="flex items-center gap-2 pt-1 text-xs" style={{ color: CD.mutedSoft }}>
        <Clock3 className="h-3.5 w-3.5" />
        <span style={{ fontFamily: FONT_MONO }}>{guide.readingMinutes} min</span>
        <span className="mx-1">·</span>
        <span style={{ fontFamily: FONT_MONO }}>{guide.steps.length} steps</span>
      </div>
    </header>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = (current / total) * 100;
  return (
    <div className="space-y-2">
      <div
        className="flex items-center justify-between"
        style={{
          fontFamily: FONT_MONO,
          fontSize: "0.625rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: CD.mutedSoft,
        }}
      >
        <span>
          Step <span style={{ color: CD.ink, fontWeight: 700 }}>{current}</span> of {total}
        </span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: CD.border }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: CD.accent,
            transition: "width 480ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          }}
        />
      </div>
    </div>
  );
}

function StepView({
  step,
  checkPassed,
  onCheckPassed,
}: {
  step: GuideStep;
  checkPassed: boolean;
  onCheckPassed: () => void;
}) {
  const scope = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      gsap.fromTo(
        scope.current.querySelectorAll("[data-enter]"),
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.48, ease: "cd", stagger: 0.06 },
      );
    },
    { scope },
  );

  return (
    <article ref={scope} className="space-y-6">
      {step.visual &&
        (step.visual.kind === "walkthrough" ? (
          <div data-enter>
            <WalkthroughVisual visual={step.visual} />
          </div>
        ) : (
          <div data-enter>
            <LearnVisual visual={step.visual} />
          </div>
        ))}
      {!step.visual && step.screenshot && (
        <figure className="space-y-2" data-enter>
          <div
            className="overflow-hidden rounded-xl"
            style={{ border: `1px solid ${CD.border}`, background: CD.surface }}
          >
            <img src={step.screenshot.src} alt={step.screenshot.alt} className="block h-auto w-full" />
          </div>
          {step.screenshot.caption && (
            <figcaption className="text-xs italic" style={{ color: CD.mutedSoft }}>
              {step.screenshot.caption}
            </figcaption>
          )}
        </figure>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <span
            className="inline-block"
            data-enter
            style={{
              fontFamily: FONT_MONO,
              fontSize: "0.625rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: CD.accent,
            }}
          >
            {step.eyebrow}
          </span>
          <h2
            className="text-3xl font-bold tracking-tight sm:text-4xl"
            style={{ lineHeight: 1.05 }}
            data-enter
          >
            {step.headline}
          </h2>
          {step.kicker && (
            <p
              className="max-w-[52ch] text-base leading-snug sm:text-lg"
              style={{ color: CD.muted }}
              data-enter
            >
              {renderKicker(step.kicker, step.emphasis)}
            </p>
          )}
        </div>

        {step.analogy && (
          <div data-enter>
            <AnalogyCard analogy={step.analogy} />
          </div>
        )}
        {step.callout && (
          <div data-enter>
            <Callout callout={step.callout} />
          </div>
        )}
        {step.check && (
          <div data-enter>
            <CheckCard check={step.check} passed={checkPassed} onPassed={onCheckPassed} />
          </div>
        )}
      </div>
    </article>
  );
}

function AnalogyCard({ analogy }: { analogy: { label?: string; text: string } }) {
  return (
    <aside
      className="flex gap-3 rounded-xl px-4 py-3.5"
      style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${CD.borderStrong}` }}
    >
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0" style={{ color: CD.accent }} />
      <div className="min-w-0 space-y-0.5">
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: "0.625rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: CD.mutedSoft,
          }}
        >
          {analogy.label ?? "Like"}
        </div>
        <p className="text-sm leading-relaxed" style={{ color: CD.ink }}>
          {analogy.text}
        </p>
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
      <span style={{ color: CD.ink, fontWeight: 600 }}>{emphasis}</span>
      {kicker.slice(idx + emphasis.length)}
    </>
  );
}

function Callout({ callout }: { callout: GuideCallout }) {
  const styles = {
    tip: {
      Icon: Lightbulb,
      color: CD.success,
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
      color: CD.accent,
      bg: "rgba(255,107,74,0.08)",
      border: "rgba(255,107,74,0.3)",
      label: "Example",
    },
  }[callout.kind];
  const { Icon } = styles;
  return (
    <aside
      className="flex gap-3 rounded-xl px-4 py-3.5"
      style={{ backgroundColor: styles.bg, border: `1px solid ${styles.border}` }}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: styles.color }} />
      <div className="min-w-0 space-y-1">
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: "0.625rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: styles.color,
          }}
        >
          {styles.label}
        </div>
        <p className="text-sm leading-relaxed" style={{ color: CD.ink }}>
          {callout.text}
        </p>
      </div>
    </aside>
  );
}

function CheckCard({
  check,
  passed,
  onPassed,
}: {
  check: NonNullable<GuideStep["check"]>;
  passed: boolean;
  onPassed: () => void;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const [wrongPicks, setWrongPicks] = useState<number[]>([]);

  const pick = (i: number) => {
    if (passed) return;
    const el = scope.current?.querySelector<HTMLElement>(`[data-option="${i}"]`);
    if (i === check.correctIndex) {
      onPassed();
      if (el && !prefersReducedMotion()) {
        gsap.fromTo(el, { scale: 0.96 }, { scale: 1, duration: 0.6, ease: "elastic.out(1, 0.45)" });
      }
    } else {
      setWrongPicks((w) => (w.includes(i) ? w : [...w, i]));
      if (el && !prefersReducedMotion()) {
        gsap.fromTo(
          el,
          { x: 0 },
          { keyframes: [{ x: -7 }, { x: 6 }, { x: -4 }, { x: 2 }, { x: 0 }], duration: 0.4 },
        );
      }
    }
  };

  return (
    <div
      ref={scope}
      className="space-y-3 rounded-xl px-4 py-4"
      style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${CD.borderStrong}` }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: "0.625rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: CD.accent,
        }}
      >
        Quick check
      </div>
      <p className="text-sm font-semibold leading-snug">{check.question}</p>
      <div className="space-y-2" role="group" aria-label="Answer options">
        {check.options.map((opt, i) => {
          const isCorrectPick = passed && i === check.correctIndex;
          const isWrongPick = wrongPicks.includes(i);
          return (
            <button
              key={i}
              type="button"
              data-option={i}
              onClick={() => pick(i)}
              disabled={passed}
              className="block w-full rounded-lg px-3.5 py-2.5 text-left text-sm transition-colors"
              style={{
                border: `1px solid ${
                  isCorrectPick ? CD.success : isWrongPick ? CD.danger : CD.borderStrong
                }`,
                background: isCorrectPick ? "rgba(74,157,124,0.08)" : "transparent",
                color: isWrongPick ? CD.mutedSoft : CD.ink,
                cursor: passed ? "default" : "pointer",
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {passed && check.explain && (
        <p className="flex items-start gap-2 text-sm leading-relaxed" style={{ color: CD.muted }}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: CD.success }} />
          {check.explain}
        </p>
      )}
    </div>
  );
}

function StepNav({
  idx,
  total,
  onPrev,
  onNext,
  isLast,
  nextLocked,
}: {
  idx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  isLast: boolean;
  nextLocked: boolean;
}) {
  const dots = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);
  return (
    <div className="space-y-5 pt-4">
      <div className="flex items-center justify-center gap-1.5">
        {dots.map((i) => (
          <span
            key={i}
            aria-hidden
            className="h-1.5 rounded-full transition-all"
            style={{
              width: i === idx ? 20 : 6,
              background:
                i === idx ? CD.accent : i < idx ? "rgba(255,107,74,0.4)" : "rgba(255,255,255,0.12)",
            }}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onPrev}
          disabled={idx === 0}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          style={{ border: `1px solid ${CD.borderStrong}`, background: CD.surface, color: CD.ink }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={nextLocked}
          title={nextLocked ? "Answer the quick check to continue" : undefined}
          className="group inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: CD.accent, color: CD.canvas }}
        >
          {isLast ? "Finish" : "Next"}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      <p
        className="hidden text-center sm:block"
        style={{
          fontFamily: FONT_MONO,
          fontSize: "0.625rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: CD.mutedSoft,
        }}
      >
        ← → keys to navigate
      </p>
    </div>
  );
}

function FinishedPanel({ guide, onRestart }: { guide: LearnGuide; onRestart: () => void }) {
  const related = guide.relatedSlugs
    .map((s) => getGuideBySlug(s))
    .filter((g): g is LearnGuide => Boolean(g));
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion() || !scope.current) return;
      gsap.fromTo(
        scope.current.querySelectorAll("[data-enter]"),
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.48, ease: "cd", stagger: 0.06 },
      );
    },
    { scope },
  );

  return (
    <div
      ref={scope}
      className="space-y-6 rounded-2xl p-6 sm:p-8"
      style={{ background: "rgba(74,157,124,0.06)", border: "1px solid rgba(74,157,124,0.3)" }}
    >
      <div className="flex items-center gap-3" data-enter>
        <CheckCircle2 className="h-6 w-6" style={{ color: CD.success }} />
        <div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: "0.625rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: CD.success,
            }}
          >
            Guide complete
          </div>
          <div className="text-lg font-bold">You're through it.</div>
        </div>
      </div>

      <p className="text-sm leading-relaxed" style={{ color: CD.muted }} data-enter>
        Keep learning. These guides pair well with what you just read.
      </p>

      {related.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-enter>
          {related.map((g) => (
            <Link
              key={g.slug}
              to={`/learn/${g.slug}`}
              className="group flex items-center justify-between gap-3 rounded-lg px-4 py-3 transition-all"
              style={{ border: `1px solid ${CD.borderStrong}`, background: CD.surface }}
            >
              <span className="line-clamp-2 text-sm font-medium transition-colors group-hover:text-[#FF6B4A]">
                {g.title}
              </span>
              <ArrowUpRight
                className="h-4 w-4 shrink-0 transition-colors group-hover:text-[#FF6B4A]"
                style={{ color: CD.mutedSoft }}
              />
            </Link>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2" data-enter>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium"
          style={{ border: `1px solid ${CD.borderStrong}`, background: CD.surface, color: CD.ink }}
        >
          <ArrowLeft className="h-4 w-4" />
          Start over
        </button>
        <Link
          to="/learn"
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold"
          style={{ background: CD.accent, color: CD.canvas }}
        >
          All guides
        </Link>
      </div>
    </div>
  );
}
