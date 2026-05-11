import { AffiliateNav } from "@/components/AffiliateNav";
import { getAffiliateToken } from "@/api/affiliates";
import { CDPage, LabelCaps, EditorialCard, Mono } from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO } from "@/lib/cdDesign";

interface Rule {
  title: string;
  summary: string;
  details: string[];
}

const RULES: Rule[] = [
  {
    title: "Lead Ownership",
    summary:
      "A valid new business lead you submit is reserved to your account for a limited ownership period.",
    details: [
      "Ownership begins when a lead is accepted by admin as a qualified new business — not at the moment of submission.",
      "If the business signs during the ownership period and your referral remains valid, you receive credit per the commission rules for your tier at the time of conversion.",
      "Ownership does not transfer between affiliates. If ownership lapses without a close, the lead returns to the general pool.",
    ],
  },
  {
    title: "Warm Introductions",
    summary:
      "If you know the owner or have already spoken with them, log that context when you submit the lead.",
    details: [
      "Warm referrals move faster and get coordinated outreach so we don't double-touch the owner.",
      "Record the touch type (in person / call / text / email / DM), the warmth level, and the date of the last touch.",
      "Notes stay internal — they help the Coherence Daddy sales team pick up where you left off.",
    ],
  },
  {
    title: "Closing Support",
    summary:
      "You can introduce, follow up, and support a deal — but you cannot promise pricing, discounts, guarantees, or custom terms unless Coherence Daddy approves them.",
    details: [
      "Coherence Daddy sets product pricing, bundle discounts, and contract terms. All commitments run through the CD sales team.",
      "If an owner asks for a custom arrangement, route the request to your sales contact — don't commit on CD's behalf.",
      "Unauthorized commitments can disqualify a lead from earning commission and, in repeated cases, your account.",
    ],
  },
  {
    title: "Shared Credit",
    summary:
      "Most deals close through a mix of your relationship and the CD sales process. Credit is protected when your referral is valid and tracked correctly.",
    details: [
      "Your commission applies when the lead record is properly attributed to you before the close date and the business converts on a qualifying product.",
      "Referral links, QR codes, and in-dashboard submissions all track attribution. In-person warm leads should be logged through your affiliate dashboard the same day when possible.",
      "Split credit across affiliates is not offered today — the first valid, qualified submission wins the lead.",
    ],
  },
  {
    title: "Duplicate Leads",
    summary:
      "The first valid qualified submission usually wins ownership. Duplicates and edge cases are reviewed by admin.",
    details: [
      "If two affiliates submit the same business, admin reviews the timeline and the context (warmth, first-touch date, prior CD relationship) and makes the final call.",
      "Submitting a lead you know another affiliate is already working is not grounds for ownership — please coordinate instead.",
      "Fraudulent or spammy submissions are removed and may trigger account review.",
    ],
  },
];

const EXTRA_SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "Commissions and payouts",
    body: [
      "Commission rate is set by your current affiliate tier at the time the deal closes. Tiers unlock as your lifetime earnings and active partner count grow — see the Tiers page for exact thresholds.",
      "Payouts run on the published payout cadence. Pending commissions convert to Approved once the deal passes the refund window, then to Scheduled, then to Paid.",
      "Valid payment details must be on file before a Scheduled commission can become Paid.",
    ],
  },
  {
    title: "Account conduct",
    body: [
      "Represent Coherence Daddy and its products honestly. Do not make performance claims or guarantees outside of published marketing materials.",
      "Do not impersonate CD staff, spoof owner communications, or purchase paid traffic against CD-owned brand terms.",
      "Accounts that violate conduct rules may be suspended, and commissions associated with violations may be reversed.",
    ],
  },
  {
    title: "Changes to these rules",
    body: [
      "Coherence Daddy may update these rules as the program evolves. Material changes will be surfaced the next time you log in and will require re-acknowledgement.",
      "Questions about a specific situation? Email info@coherencedaddy.com and a member of the affiliate team will follow up.",
    ],
  },
];

export function AffiliateProgramRules() {
  const authed = Boolean(getAffiliateToken());

  return (
    <CDPage>
      {authed ? (
        <AffiliateNav active="" subtitle="Affiliate" title="Program Rules" />
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
