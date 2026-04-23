export type LearnSection = "foundations" | "product" | "bundle" | "objections";

export type CalloutKind = "tip" | "watch-out" | "example";

export interface GuideCallout {
  kind: CalloutKind;
  text: string;
}

/** Inline HTML/SVG visual rendered at the top of each step. Replaces screenshot placeholders. */
export type Visual =
  | { kind: "google-serp"; query?: string }
  | { kind: "chatgpt-answer"; query?: string; answer?: string }
  | { kind: "score-dial"; score?: number; label?: string }
  | { kind: "trend-spark"; points?: number[]; label?: string }
  | {
      kind: "tier-cards";
      tiers: Array<{ name: string; price: string; blurb?: string }>;
    }
  | {
      kind: "spectrum-bar";
      left: string;
      right: string;
      position?: "left" | "center" | "right";
    }
  | { kind: "bubble"; tone: "said" | "thought" | "response"; text: string }
  | {
      kind: "stack-rows";
      heading?: string;
      rows: Array<{ primary: string; secondary?: string }>;
    }
  | {
      kind: "mock-frame";
      frame: "phone" | "email" | "browser";
      title?: string;
      lines?: string[];
    }
  | { kind: "json-block"; code: string }
  | { kind: "editorial"; headline: string; excerpt: string }
  | { kind: "sage-card"; blurb?: string }
  | { kind: "big-statement"; primary: string; secondary?: string }
  | { kind: "question-card"; number: number; question: string }
  | { kind: "vs-split"; left: { label: string; body: string }; right: { label: string; body: string } }
  | { kind: "emphasis-card"; label?: string; text: string };

export interface GuideStep {
  number: number;
  eyebrow: string;
  /** Punchy 4-10 word statement. Becomes the hero text of the slide. */
  headline: string;
  /** Short supporting sentence — max ~15 words. */
  kicker?: string;
  /** Substring of kicker rendered in accent color. */
  emphasis?: string;
  /** Layman analogy. Plain-English comparison. "Like X, but for Y." */
  analogy?: {
    /** Optional lead-in label ("Think of it like" etc). Defaults to "Like". */
    label?: string;
    text: string;
  };
  /** Inline visual rendered above the text. Preferred over screenshot. */
  visual?: Visual;
  /** Legacy — real screenshots can still be used when available. */
  screenshot?: {
    src: string;
    alt: string;
    caption?: string;
  };
  callout?: GuideCallout;
}

export interface LearnGuide {
  slug: string;
  section: LearnSection;
  title: string;
  subtitle: string;
  readingMinutes: number;
  videoEmbedUrl: string | null;
  steps: GuideStep[];
  relatedSlugs: string[];
}

export const SECTION_META: Record<
  LearnSection,
  { label: string; eyebrow: string; order: number; blurb: string }
> = {
  foundations: {
    label: "Foundations",
    eyebrow: "Start here",
    order: 1,
    blurb: "The concepts every affiliate needs before a single owner conversation.",
  },
  product: {
    label: "Products",
    eyebrow: "What we sell",
    order: 2,
    blurb: "One walk-through per product. Read the one that fits the conversation.",
  },
  bundle: {
    label: "Bundles",
    eyebrow: "Packages",
    order: 3,
    blurb: "Pre-built combinations — the cleanest story for most owner pitches.",
  },
  objections: {
    label: "Objection handling",
    eyebrow: "When they push back",
    order: 4,
    blurb: "Real things owners say, what they actually mean, how to respond.",
  },
};
