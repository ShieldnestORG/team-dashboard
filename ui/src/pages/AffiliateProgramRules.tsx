import { AffiliateNav } from "@/components/AffiliateNav";
import { getAffiliateToken } from "@/api/affiliates";
import { CDPage, LabelCaps, EditorialCard, Mono } from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO } from "@/lib/cdDesign";
import {
  PROGRAM_RULES as RULES,
  RULES_EXTRA_SECTIONS as EXTRA_SECTIONS,
} from "@/content/affiliate-program-rules";

export function AffiliateProgramRules() {
  const authed = Boolean(getAffiliateToken());

  return (
    <CDPage>
      {authed ? (
        <AffiliateNav active="/program-rules" subtitle="Affiliate" title="Program Rules" />
      ) : (
        <header
          className="sticky top-0 z-20 backdrop-blur-md"
          style={{
            backgroundColor: "rgba(14,14,16,0.85)",
            borderBottom: `1px solid ${CD.border}`,
          }}
        >
          <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-6 py-4">
            <a href="/" className="flex items-center gap-3" style={{ color: CD.ink }}>
              <img src="/apple-touch-icon.png" alt="" className="h-9 w-9" style={{ borderRadius: 8 }} />
              <div>
                <LabelCaps color={CD.accent}>Affiliate</LabelCaps>
                <h1 className="text-lg font-semibold" style={{ color: CD.ink }}>
                  Program Rules
                </h1>
              </div>
            </a>
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

      <main className="mx-auto w-full max-w-[65ch] px-6 py-12 space-y-12">
        <section className="space-y-4">
          <LabelCaps color={CD.accent}>The agreement</LabelCaps>
          <h2
            className="text-4xl font-bold"
            style={{ letterSpacing: "-0.03em", color: CD.ink, lineHeight: 1.05 }}
          >
            Coherence Daddy Affiliate Program Rules.
          </h2>
          <p className="text-base leading-relaxed" style={{ color: CD.muted }}>
            These are the rules every affiliate accepts before submitting leads. They protect
            your credit, keep the program fair for everyone, and make sure Coherence Daddy can
            stand behind what you promise to the owners you bring in.
          </p>
          <Mono style={{ color: CD.mutedSoft, fontSize: "0.75rem" }}>
            Last updated · April 2026
          </Mono>
        </section>

        <section className="space-y-6">
          {RULES.map((rule, i) => (
            <EditorialCard key={rule.title} className="p-6 space-y-3">
              <Mono style={{ color: CD.muted, fontSize: "0.6875rem", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Rule 0{i + 1}
              </Mono>
              <h3 className="text-xl font-semibold" style={{ color: CD.ink, letterSpacing: "-0.01em" }}>
                {rule.title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: CD.ink }}>
                {rule.summary}
              </p>
              <ul className="space-y-2 pt-1">
                {rule.details.map((d) => (
                  <li key={d} className="flex items-start gap-2 text-sm leading-relaxed" style={{ color: CD.muted }}>
                    <span
                      aria-hidden="true"
                      style={{
                        marginTop: 7,
                        width: 4,
                        height: 4,
                        borderRadius: 9999,
                        backgroundColor: CD.accent,
                        flexShrink: 0,
                      }}
                    />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </EditorialCard>
          ))}
        </section>

        <section className="space-y-8">
          {EXTRA_SECTIONS.map((s) => (
            <article key={s.title} className="space-y-3">
              <LabelCaps>{s.title}</LabelCaps>
              {s.body.map((p) => (
                <p key={p} className="text-sm leading-relaxed" style={{ color: CD.muted }}>
                  {p}
                </p>
              ))}
            </article>
          ))}
        </section>

        <section className="pt-4" style={{ borderTop: `1px solid ${CD.border}` }}>
          <p className="text-sm" style={{ color: CD.muted }}>
            Questions?{" "}
            <a
              href="mailto:info@coherencedaddy.com"
              className="font-medium underline-offset-4 hover:underline"
              style={{ color: CD.accent }}
            >
              info@coherencedaddy.com
            </a>
          </p>
        </section>
      </main>
    </CDPage>
  );
}
