import { AffiliateNav } from "@/components/AffiliateNav";
import { getAffiliateToken } from "@/api/affiliates";
import { LEARN_GUIDES, SECTION_META, type LearnGuide, type LearnSection } from "@/content/affiliate-learn";
import { BookOpen, ArrowUpRight, Clock3 } from "lucide-react";

const SECTION_ORDER: LearnSection[] = ["foundations", "product", "bundle", "objections"];

export function AffiliateLearn() {
  const authed = Boolean(getAffiliateToken());

  return (
    <div className="min-h-screen bg-background text-foreground">
      {authed ? (
        <AffiliateNav active="/learn" subtitle="Affiliate Program" title="Learn & Teach" />
      ) : (
        <header className="bg-card border-b border-border sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Affiliate Program</p>
              <h1 className="text-lg font-bold text-foreground">Learn &amp; Teach</h1>
            </div>
            <a
              href="/"
              className="text-sm text-[#ff876d] hover:text-[#ff876d]/90 font-medium"
            >
              Apply &rarr;
            </a>
          </div>
        </header>
      )}

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-12">
        <section className="max-w-3xl space-y-4">
          <div className="flex items-center gap-2 text-xs font-medium text-[#ff876d] uppercase tracking-wider">
            <BookOpen className="h-3.5 w-3.5" />
            <span>Curriculum</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight">
            Read these before your next owner visit.
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed">
            Short walk-through guides for everything you need to know — the concepts, the
            products, the bundles, and the real things owners say when you pitch them.
            Step-by-step, plain English, no jargon. Skim what you need, come back for the rest.
          </p>
        </section>

        {SECTION_ORDER.map((section) => (
          <SectionBlock
            key={section}
            section={section}
            guides={LEARN_GUIDES.filter((g) => g.section === section)}
          />
        ))}
      </main>
    </div>
  );
}

function SectionBlock({ section, guides }: { section: LearnSection; guides: LearnGuide[] }) {
  const meta = SECTION_META[section];
  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          0{meta.order} · {meta.eyebrow}
        </span>
        <h3 className="text-2xl font-bold tracking-tight text-foreground">{meta.label}</h3>
        <p className="text-sm text-muted-foreground max-w-2xl">{meta.blurb}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {guides.map((g) => (
          <GuideCard key={g.slug} guide={g} />
        ))}
      </div>
    </section>
  );
}

function GuideCard({ guide }: { guide: LearnGuide }) {
  return (
    <a
      href={`/learn/${guide.slug}`}
      className="group relative flex flex-col gap-2 rounded-lg border border-border bg-card p-5 transition-all hover:border-[#ff876d]/40 hover:bg-card/80"
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-base font-semibold leading-snug text-foreground group-hover:text-[#ff876d] transition-colors">
          {guide.title}
        </h4>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-[#ff876d] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all" />
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
        {guide.subtitle}
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock3 className="h-3 w-3" />
        <span>{guide.readingMinutes} min read</span>
        <span className="mx-1">·</span>
        <span>{guide.steps.length} steps</span>
      </div>
    </a>
  );
}
