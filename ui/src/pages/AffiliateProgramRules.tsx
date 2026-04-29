import { AffiliateNav } from "@/components/AffiliateNav";
import { getAffiliateToken } from "@/api/affiliates";

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
    <div className="min-h-screen bg-background text-foreground">
      {authed ? (
        <AffiliateNav active="" subtitle="Affiliate Program" title="Program Rules" />
      ) : (
        <header className="bg-card border-b border-border sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
            <a href="/" className="flex items-center gap-3">
              <img
                src="/brand/face-coral.svg"
                alt="Coherence Daddy"
                className="h-9 w-9"
              />
              <div>
                <p className="text-xs text-muted-foreground">Affiliate Program</p>
                <h1 className="text-lg font-bold text-foreground">Program Rules</h1>
              </div>
            </a>
            <a
              href="/"
              className="text-sm text-[#FF6B4A] hover:text-[#FF6B4A]/90 font-medium"
            >
              Apply →
            </a>
          </div>
        </header>
      )}

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-10">
        <section className="space-y-3">
          <p className="text-xs uppercase tracking-widest text-[#FF6B4A] font-semibold">
            The agreement
          </p>
          <h2 className="text-3xl font-bold tracking-tight">
            Coherence Daddy Affiliate Program Rules
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed">
            These are the rules every affiliate accepts before submitting leads. They protect your
            credit, keep the program fair for everyone, and make sure Coherence Daddy can stand behind
            what you promise to the owners you bring in. Read them once carefully — and come back
            any time you want a refresher.
          </p>
          <p className="text-xs text-muted-foreground">
            Last updated: April 2026
          </p>
        </section>

        <section className="space-y-8">
          {RULES.map((rule, i) => (
            <article
              key={rule.title}
              className="rounded-xl border border-border bg-card/50 p-6 space-y-3"
            >
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Rule 0{i + 1}
                </span>
              </div>
              <h3 className="text-xl font-semibold text-foreground">{rule.title}</h3>
              <p className="text-sm text-foreground leading-relaxed">{rule.summary}</p>
              <ul className="space-y-2 pt-1">
                {rule.details.map((d) => (
                  <li
                    key={d}
                    className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed"
                  >
                    <span
                      className="mt-[0.45rem] inline-block h-1.5 w-1.5 rounded-full bg-[#FF6B4A] flex-shrink-0"
                      aria-hidden="true"
                    />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="space-y-6 pt-2">
          {EXTRA_SECTIONS.map((s) => (
            <article key={s.title} className="space-y-2">
              <h3 className="text-base font-semibold text-foreground">{s.title}</h3>
              {s.body.map((p) => (
                <p key={p} className="text-sm text-muted-foreground leading-relaxed">
                  {p}
                </p>
              ))}
            </article>
          ))}
        </section>

        <section className="pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Questions?{" "}
            <a
              href="mailto:info@coherencedaddy.com"
              className="text-[#FF6B4A] hover:text-[#FF6B4A]/90 font-medium"
            >
              info@coherencedaddy.com
            </a>
          </p>
        </section>
      </main>
    </div>
  );
}
