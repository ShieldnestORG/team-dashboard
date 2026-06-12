// Canonical program-rules content — single source of truth.
// Consumed by:
//   - ui/src/pages/AffiliateProgramRules.tsx  (full page: summary + details)
//   - ui/src/pages/AffiliateDashboard.tsx     (policy-acceptance modal: summary + check)
// Material changes here require re-acknowledgement (see "Changes to these rules").

export interface ProgramRuleCheck {
  question: string;
  options: string[];
  correctIndex: number;
  explain: string;
}

export interface ProgramRule {
  title: string;
  /** One-paragraph version — what the policy modal shows per step. */
  summary: string;
  /** Full detail bullets — what the /program-rules page expands. */
  details: string[];
  /** Comprehension check for the policy-acceptance modal. */
  check: ProgramRuleCheck;
}

export const PROGRAM_RULES: ProgramRule[] = [
  {
    title: "Lead Ownership",
    summary:
      "A valid new business lead you submit is reserved to your account for a limited ownership period.",
    details: [
      "Ownership begins when a lead is accepted by admin as a qualified new business — not at the moment of submission.",
      "If the business signs during the ownership period and your referral remains valid, you receive credit per the commission rules for your tier at the time of conversion.",
      "Ownership does not transfer between affiliates. If ownership lapses without a close, the lead returns to the general pool.",
    ],
    check: {
      question: "When does ownership of a lead begin?",
      options: [
        "The moment I hit submit",
        "When admin accepts it as a qualified new business",
        "When the business makes its first payment",
      ],
      correctIndex: 1,
      explain:
        "Submission starts the review — ownership starts when admin accepts the lead as qualified.",
    },
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
    check: {
      question: "You already know the owner. What do you do when submitting the lead?",
      options: [
        "Log the touch type, warmth level, and date in the lead form",
        "Keep it to myself — relationships are my edge",
        "Skip the form and just tell the owner to mention my name",
      ],
      correctIndex: 0,
      explain:
        "Logged context is what routes coordinated outreach — and it's the evidence that protects your credit.",
    },
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
    check: {
      question: "An owner asks you for 20% off. What do you do?",
      options: [
        "Promise it — discounts close deals",
        "Offer to cover the difference out of your commission",
        "Route the request to your CD sales contact",
      ],
      correctIndex: 2,
      explain:
        "Pricing and terms always run through CD. Unauthorized commitments can disqualify the lead.",
    },
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
    check: {
      question: "What protects your commission credit on a deal?",
      options: [
        "Being first to ever talk to the owner, even if untracked",
        "A valid lead record attributed to you before the close",
        "Following up with the owner every week",
      ],
      correctIndex: 1,
      explain:
        "Attribution is the record that pays you — log warm leads in the dashboard the same day when you can.",
    },
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
    check: {
      question: "Two affiliates submit the same business. Who gets it?",
      options: [
        "Whoever submitted most recently",
        "Both — the commission is split",
        "Admin reviews the timeline and context and makes the final call",
      ],
      correctIndex: 2,
      explain:
        "First valid qualified submission usually wins, but admin reviews the full context on duplicates. Split credit isn't offered.",
    },
  },
];

export const RULES_EXTRA_SECTIONS: { title: string; body: string[] }[] = [
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
