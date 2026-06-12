import { useMemo } from "react";
import { Link } from "@/lib/router";
import { AffiliateNav } from "@/components/AffiliateNav";
import { getAffiliateToken } from "@/api/affiliates";
import {
  LEARN_GUIDES,
  SECTION_META,
  type LearnGuide,
  type LearnSection,
} from "@/content/affiliate-learn";
import { getGuideBySlug } from "@/content/affiliate-learn";
import { getGuideProgress, getGuideState, getProgressSummary } from "@/lib/learnProgress";
import { ArrowRight, ArrowUpRight, CheckCircle2, Clock3 } from "lucide-react";
import {
  CDPage,
  EditorialCard,
  LabelCaps,
  Mono,
  Cascade,
} from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO } from "@/lib/cdDesign";

const SECTION_ORDER: LearnSection[] = ["foundations", "product", "bundle", "objections"];

export function AffiliateLearn() {
  const authed = Boolean(getAffiliateToken());

  return (
    <CDPage>
      {authed ? (
        <AffiliateNav active="/learn" subtitle="Affiliate" title="Learn & Teach" />
      ) : (
        <header
          className="sticky top-0 z-20 backdrop-blur-md"
          style={{
            backgroundColor: "rgba(14,14,16,0.85)",
            borderBottom: `1px solid ${CD.border}`,
          }}
        >
          <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-6 py-4">
            <div>
              <LabelCaps color={CD.accent}>Affiliate</LabelCaps>
              <h1 className="text-lg font-semibold" style={{ color: CD.ink }}>
                Learn &amp; Teach
              </h1>
            </div>
            <a
              href="/"
              style={{
                fontFamily: FONT_MONO,
                fontSize: "0.6875rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: CD.accent,
              }}
            >
              Apply →
            </a>
          </div>
        </header>
      )}

      <main className="mx-auto w-full max-w-[1200px] px-6 py-12 space-y-14">
        <section className="max-w-3xl space-y-4">
          <LabelCaps color={CD.accent}>Curriculum</LabelCaps>
          <h2
            className="text-4xl font-bold"
            style={{ letterSpacing: "-0.03em", color: CD.ink, lineHeight: 1.05 }}
          >
            Read these before your next owner visit.
          </h2>
          <p className="text-base leading-relaxed" style={{ color: CD.muted }}>
            Short walk-through guides for everything you need to know — the concepts, the
            products, the bundles, and the real things owners say when you pitch them.
            Step-by-step, plain English, no jargon.
          </p>
          <ProgressStrip />
        </section>

        {SECTION_ORDER.map((section, i) => (
          <Cascade key={section} index={i}>
            <SectionBlock
              section={section}
              guides={LEARN_GUIDES.filter((g) => g.section === section)}
            />
          </Cascade>
        ))}
      </main>
    </CDPage>
  );
}

function ProgressStrip() {
  const summary = useMemo(
    () => getProgressSummary(LEARN_GUIDES.map((g) => g.slug)),
    [],
  );
  if (summary.completed === 0 && !summary.resumeSlug) return null;
  const resumeGuide = summary.resumeSlug ? getGuideBySlug(summary.resumeSlug) : undefined;
  const pct = (summary.completed / summary.total) * 100;
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl px-4 py-3"
      style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${CD.borderStrong}` }}
    >
      <Mono style={{ color: CD.ink, fontSize: "0.75rem" }}>
        {summary.completed} of {summary.total} complete
      </Mono>
      <div
        className="h-1 w-28 overflow-hidden rounded-full"
        style={{ background: CD.border }}
        aria-hidden
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CD.accent }} />
      </div>
      {resumeGuide && (
        <Link
          to={`/learn/${resumeGuide.slug}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium"
          style={{ color: CD.accent }}
        >
          Continue: {resumeGuide.title}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

function SectionBlock({ section, guides }: { section: LearnSection; guides: LearnGuide[] }) {
  const meta = SECTION_META[section];
  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-1">
        <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
          0{meta.order} · {meta.eyebrow}
        </Mono>
        <h3
          className="text-2xl font-semibold"
          style={{ letterSpacing: "-0.02em", color: CD.ink }}
        >
          {meta.label}
        </h3>
        <p className="max-w-2xl text-sm" style={{ color: CD.muted }}>
          {meta.blurb}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {guides.map((g) => (
          <GuideCard key={g.slug} guide={g} />
        ))}
      </div>
    </section>
  );
}

function GuideCard({ guide }: { guide: LearnGuide }) {
  const state = getGuideState(guide.slug);
  const progress = state === "in-progress" ? getGuideProgress(guide.slug) : null;
  return (
    <Link
      to={`/learn/${guide.slug}`}
      className="group block transition-colors"
      style={{ textDecoration: "none" }}
    >
      <EditorialCard
        className="h-full p-5"
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        <div className="flex items-start justify-between gap-3">
          <h4
            className="text-base font-semibold leading-snug transition-colors"
            style={{ color: CD.ink }}
          >
            {guide.title}
          </h4>
          {state === "completed" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: CD.success }} />
          ) : (
            <ArrowUpRight
              className="h-4 w-4 shrink-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              style={{ color: CD.muted }}
            />
          )}
        </div>
        <p className="text-sm leading-relaxed line-clamp-3" style={{ color: CD.muted }}>
          {guide.subtitle}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Clock3 className="h-3 w-3" style={{ color: CD.muted }} />
          <Mono style={{ color: CD.muted, fontSize: "0.6875rem" }}>
            {guide.readingMinutes} min · {guide.steps.length} steps
          </Mono>
          {state === "completed" && (
            <Mono style={{ color: CD.success, fontSize: "0.6875rem" }}>· Completed</Mono>
          )}
          {state === "in-progress" && progress && (
            <Mono style={{ color: CD.accent, fontSize: "0.6875rem" }}>
              · In progress — step {progress.lastStep + 1}
            </Mono>
          )}
        </div>
      </EditorialCard>
    </Link>
  );
}
