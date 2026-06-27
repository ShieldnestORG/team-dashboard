// ---------------------------------------------------------------------------
// Digest assembler — the orchestration that turns raw fetched signals into a
// published-shape TrendDigest while honouring every rule of the hardened
// method. Read top to bottom, the order IS the method:
//
//   1. Map each signal to a candidate, code-inserting EVERY number as a
//      DigestStat from a fetched field (Rule 1).
//   2. Derive saturation inputs from those fetched numbers + optional SERP /
//      AI-answer enrichment, then COMPUTE the verdict (Rule 3).
//   3. Generate the one grounded prose line, source attached (Rule 2), which
//      self-checks against the number guard (Rule 1).
//   4. Run the citation gate, which strips unsupported claims, tags provenance
//      ✅/🟡/⚠ (Rules 4, 5), and yields the ad-friendly set (✅ only, Rule 5).
//   5. Emit a `pending` digest — never auto-published (Rule 7 lives at the
//      route/cron layer).
//
// Saturation enrichment (SERP domain-concentration / keyword-difficulty,
// AI-answer concentration) is INJECTED and optional: absent it, the scorer
// degrades gracefully and the whole thing runs offline. That keeps Serper /
// the 5-engine answer-check as bolt-ons, not hard dependencies.
// ---------------------------------------------------------------------------

import type { TrendSignals } from "../trend-scanner.js";
import {
  adFriendlyIds,
  runCitationGate,
  type CitationJudge,
  type GateInput,
} from "./citation-gate.js";
import { generateWhyItsHot, type ProseModel } from "./why-its-hot.js";
import { computeSaturation } from "./saturation.js";
import type {
  DigestItem,
  DigestStat,
  SaturationInputs,
  SourceRef,
  TrendDigest,
} from "./types.js";

export interface EnrichContext {
  title: string;
  category: string;
  keyword: string;
}

export interface AssembleOptions {
  /** Run timestamp (defaults to now). */
  now?: Date;
  /** Forwarded to the grounded-prose generator (tests inject fake models). */
  proseModels?: ProseModel[];
  /** Forwarded to the citation gate (tests inject a fake judge). */
  judge?: CitationJudge;
  /**
   * Optional saturation enrichment — SERP domain-concentration / keyword
   * difficulty (Serper) and AI-answer concentration (5-engine answer-check).
   * Returns only the inputs it has; the scorer renormalizes. Cap any expensive
   * call (e.g. the 5-engine check) to the top items INSIDE this function.
   */
  enrichSaturation?: (ctx: EnrichContext) => Promise<Partial<SaturationInputs>>;
  /** Max items in the digest (default 12). */
  maxItems?: number;
}

interface RawCandidate {
  id: string;
  title: string;
  category: string;
  keyword: string;
  whatsHotText: string;
  source: SourceRef;
  stats: DigestStat[];
  /** Grounding text the prose must restate + the gate verifies against. */
  sourceText: string;
  /** Saturation inputs derivable from fetched numbers alone. */
  baseInputs: SaturationInputs;
}

// --- formatting (code-inserted display strings, Rule 1) --------------------

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}
function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  if (n > 0 && n < 1) return `$${n.toPrecision(3)}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}
function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

// --- candidate builders ----------------------------------------------------

function techCandidates(
  signals: TrendSignals,
  fetchedAt: string,
  categoryCounts: Map<string, number>,
): RawCandidate[] {
  return (signals.trending_tech ?? []).map((t, i) => {
    const isHn = /news\.ycombinator\.com/.test(t.url);
    const source: SourceRef = {
      url: t.url,
      title: t.title,
      publisher: isHn ? "Hacker News" : hostOf(t.url),
      fetchedAt,
      dateline: null,
    };
    const stats: DigestStat[] = [
      { label: "HN points", value: t.score, display: fmtInt(t.score), unit: "points", source },
      { label: "comments", value: t.comments, display: fmtInt(t.comments), unit: "comments", source },
    ];
    const coverage = clamp01((categoryCounts.get(t.category) ?? 1) / 5);
    return {
      id: `tech-${slugify(t.title)}-${i}`,
      title: t.title,
      category: t.category,
      keyword: t.title,
      whatsHotText: `${t.title} — ${fmtInt(t.score)} points, ${fmtInt(t.comments)} comments on Hacker News`,
      source,
      stats,
      sourceText: t.title,
      baseInputs: {
        // HN score as a velocity proxy (a 300-point story is white-hot).
        velocity: clamp01(t.score / 300),
        coverage,
      },
    };
  });
}

function cryptoCandidates(
  signals: TrendSignals,
  fetchedAt: string,
): RawCandidate[] {
  const source = (coin: string): SourceRef => ({
    url: `https://www.coingecko.com/en/coins/${coin}`,
    title: coin,
    publisher: "CoinGecko",
    fetchedAt,
    dateline: null,
  });
  return (signals.crypto_movers ?? []).slice(0, 8).map((c, i) => {
    const s = source(c.coin);
    const stats: DigestStat[] = [
      { label: "24h change", value: c.change_24h, display: fmtPct(c.change_24h), unit: "%", source: s },
      { label: "price", value: c.price, display: fmtPrice(c.price), unit: "USD", source: s },
      { label: "24h volume", value: c.volume, display: fmtPrice(c.volume), unit: "USD", source: s },
    ];
    return {
      id: `crypto-${slugify(c.coin)}-${i}`,
      title: c.coin,
      category: "Crypto",
      keyword: c.coin,
      whatsHotText: `${c.coin} moved ${fmtPct(c.change_24h)} in 24h (price ${fmtPrice(c.price)}), per CoinGecko`,
      source: s,
      stats,
      sourceText: `${c.coin} 24h change ${fmtPct(c.change_24h)}, price ${fmtPrice(c.price)}, 24h volume ${fmtPrice(c.volume)} (CoinGecko).`,
      baseInputs: {
        // A ±30% daily move is surging; sign drives momentum.
        velocity: clamp01((c.change_24h + 30) / 60),
      },
    };
  });
}

/** Count how many distinct feeds mention a keyword — a real corroboration count. */
function corroborationCount(keyword: string, signals: TrendSignals): number {
  const k = keyword.toLowerCase();
  const feeds: string[][] = [
    (signals.trending_tech ?? []).map((t) => t.title.toLowerCase()),
    (signals.crypto_movers ?? []).map((c) => c.coin.toLowerCase()),
    (signals.google_trends ?? []).map(
      (g) => `${g.keyword} ${g.related.join(" ")}`.toLowerCase(),
    ),
    (signals.bing_news ?? []).map(
      (b) => `${b.title} ${b.description}`.toLowerCase(),
    ),
  ];
  let count = 0;
  for (const feed of feeds) {
    if (feed.some((text) => text.includes(k))) count++;
  }
  return Math.max(1, count);
}

function reuseAngle(verdict: DigestItem["saturation"]["verdict"], title: string): string {
  switch (verdict) {
    case "RIDE":
      return `Publish a take on "${title}" now while the space is still open.`;
    case "COATTAIL":
      return `Reference the dominant players on "${title}" and add your own niche angle.`;
    case "DIFFERENTIATE":
      return `Find an underserved sub-angle of "${title}" — the obvious take is crowded.`;
    case "AVOID":
    default:
      return `"${title}" is fading and crowded — repurpose the idea elsewhere rather than chasing it.`;
  }
}

/**
 * Assemble a `pending` TrendDigest from fetched signals. Pure orchestration:
 * deterministic given injected leaf functions (prose models, judge,
 * enrichment), so it is fully testable offline.
 */
export async function assembleDigest(
  signals: TrendSignals,
  opts: AssembleOptions = {},
): Promise<TrendDigest> {
  const now = opts.now ?? new Date();
  const fetchedAt = signals.timestamp || now.toISOString();
  const maxItems = opts.maxItems ?? 12;

  const categoryCounts = new Map<string, number>();
  for (const t of signals.trending_tech ?? [])
    categoryCounts.set(t.category, (categoryCounts.get(t.category) ?? 0) + 1);

  const candidates = [
    ...techCandidates(signals, fetchedAt, categoryCounts),
    ...cryptoCandidates(signals, fetchedAt),
  ].slice(0, maxItems);

  // Build items: enrich saturation → compute verdict → grounded prose.
  const gateInputs: GateInput[] = [];
  for (const c of candidates) {
    let inputs: SaturationInputs = { ...c.baseInputs };
    if (opts.enrichSaturation) {
      try {
        const extra = await opts.enrichSaturation({
          title: c.title,
          category: c.category,
          keyword: c.keyword,
        });
        inputs = { ...inputs, ...extra };
      } catch {
        // enrichment is best-effort; absence degrades gracefully
      }
    }
    const saturation = computeSaturation(inputs);

    const allowedNumbers = c.stats.map((s) => s.value);
    const whyItsHot = await generateWhyItsHot(
      {
        title: c.title,
        category: c.category,
        sourceText: c.sourceText,
        source: c.source,
        allowedNumbers,
      },
      { models: opts.proseModels },
    );

    const item: DigestItem = {
      id: c.id,
      title: c.title,
      category: c.category,
      whatsHot: { text: c.whatsHotText, source: c.source },
      whyItsHot,
      stats: c.stats,
      saturation,
      reuseAngle: reuseAngle(saturation.verdict, c.title),
      provenance: "unverified", // set by the gate
    };

    gateInputs.push({
      item,
      groundingText: c.sourceText,
      sourceCount: corroborationCount(c.keyword, signals),
    });
  }

  const items = await runCitationGate(gateInputs, { judge: opts.judge });

  return {
    digestDate: fetchedAt.slice(0, 10),
    generatedAt: now.toISOString(),
    status: "pending",
    items,
    adFriendlyItemIds: adFriendlyIds(items),
  };
}
