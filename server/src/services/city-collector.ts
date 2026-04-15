/**
 * City Collector — multi-source local intelligence pipeline.
 *
 * Given a city, we pull signals from five data paths in parallel, merge +
 * deduplicate + rank via Ollama, then store the result as one row in
 * `city_intelligence`. Three ranked top-50 buckets per city:
 *
 *   - topSearches    — most-looked-up things locally
 *   - serviceDemand  — what kinds of help/work locals want done
 *   - trendingTopics — local news + social trends
 *
 * Sources:
 *   1. Firecrawl `search`   — raw web-search scraping (broad)
 *   2. Google Trends RSS    — trending queries (US-geo)
 *   3. Bing News API        — city-filtered news
 *   4. Reddit search        — r/{city} + query filter for service demand
 *   5. Yelp via Firecrawl   — service category demand proxies
 *
 * The pipeline is tolerant: a failed source doesn't kill the run. If Ollama
 * is unavailable we fall back to a simple rank-by-count merge so the row still
 * materializes.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { cityIntelligence } from "@paperclipai/db";
import type { CityItem, CityRawSource } from "@paperclipai/db";
import { callOllamaGenerate } from "./ollama-client.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

const FIRECRAWL_URL =
  process.env.FIRECRAWL_URL || "https://firecrawl.coherencedaddy.com";
const BING_NEWS_API_URL = "https://api.bing.microsoft.com/v7.0/news/search";
const BING_NEWS_KEY = process.env.BING_NEWS_KEY || "";
const GOOGLE_TRENDS_RSS_URL = "https://trends.google.com/trending/rss?geo=US";
const FRESHNESS_DAYS = 30;
const TOP_K = 50;
const PER_SOURCE_FETCH_TIMEOUT_MS = 25_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CityQuery {
  city: string;
  region?: string | null;
  country?: string | null;
}

export interface CityCollectionResult {
  slug: string;
  status: "ready" | "error";
  topSearches: CityItem[];
  serviceDemand: CityItem[];
  trendingTopics: CityItem[];
  rawSources: CityRawSource[];
  durationMs: number;
  error?: string;
}

interface RawSignal {
  term: string;
  source: string;
  bucketHint?: "searches" | "demand" | "trending";
  weight?: number;
}

// ---------------------------------------------------------------------------
// Public: buildCitySlug — deterministic slug used as dedup key
// ---------------------------------------------------------------------------

export function buildCitySlug(q: CityQuery): string {
  const parts = [q.city, q.region ?? "", q.country ?? "US"]
    .map((s) => (s || "").trim().toLowerCase())
    .filter(Boolean)
    .map((s) =>
      s
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    );
  return parts.join("-");
}

// ---------------------------------------------------------------------------
// Fetch with timeout helper
// ---------------------------------------------------------------------------

async function withTimeout<T>(
  label: string,
  promise: Promise<T>,
  ms = PER_SOURCE_FETCH_TIMEOUT_MS,
): Promise<T | null> {
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timeout`)), ms),
      ),
    ]);
  } catch (err) {
    logger.warn({ err, label }, "city-collector: source failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source 1: Firecrawl search
// ---------------------------------------------------------------------------

export async function firecrawlSearch(query: string, limit = 10): Promise<
  Array<{ title: string; url: string; content: string }>
> {
  const res = await fetch(`${FIRECRAWL_URL}/v1/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer self-hosted",
    },
    body: JSON.stringify({ query, limit, scrapeOptions: { formats: ["markdown"] } }),
    signal: AbortSignal.timeout(PER_SOURCE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    success?: boolean;
    data?: Array<{ title?: string; url?: string; markdown?: string; content?: string }>;
  };
  return (data.data ?? [])
    .map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: r.markdown ?? r.content ?? "",
    }))
    .filter((r) => r.url);
}

async function collectFirecrawlSearches(q: CityQuery): Promise<{
  signals: RawSignal[];
  source: CityRawSource;
}> {
  const cityLabel = [q.city, q.region].filter(Boolean).join(", ");
  const queries = [
    `best things to do in ${cityLabel}`,
    `top services in ${cityLabel}`,
    `${cityLabel} small business needs`,
    `${cityLabel} local events`,
    `what people search for in ${cityLabel}`,
  ];

  const signals: RawSignal[] = [];
  let totalResults = 0;
  let firstUrl = "";

  for (const query of queries) {
    const results = (await withTimeout(`firecrawl-search:${query}`, firecrawlSearch(query, 8))) ?? [];
    totalResults += results.length;
    if (!firstUrl && results[0]?.url) firstUrl = results[0].url;

    for (const r of results) {
      if (r.title) {
        signals.push({
          term: r.title.slice(0, 160),
          source: "firecrawl-search",
          bucketHint: "searches",
          weight: 1,
        });
      }
      // Pull a few salient phrases out of body content
      const snippets = (r.content || "")
        .split(/[\n\r]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 15 && s.length < 140)
        .slice(0, 3);
      for (const snip of snippets) {
        signals.push({
          term: snip,
          source: "firecrawl-search",
          bucketHint: "searches",
          weight: 0.5,
        });
      }
    }
  }

  return {
    signals,
    source: {
      source: "firecrawl-search",
      url: firstUrl || `${FIRECRAWL_URL}/v1/search`,
      fetchedAt: new Date().toISOString(),
      itemCount: totalResults,
    },
  };
}

// ---------------------------------------------------------------------------
// Source 2: Google Trends RSS (US-geo). Keyword-filtered by city name.
// ---------------------------------------------------------------------------

async function collectGoogleTrends(q: CityQuery): Promise<{
  signals: RawSignal[];
  source: CityRawSource;
}> {
  const res = await fetch(GOOGLE_TRENDS_RSS_URL, {
    signal: AbortSignal.timeout(PER_SOURCE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    return {
      signals: [],
      source: {
        source: "google-trends",
        url: GOOGLE_TRENDS_RSS_URL,
        fetchedAt: new Date().toISOString(),
        itemCount: 0,
      },
    };
  }
  const xml = await res.text();
  const signals: RawSignal[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const cityLower = q.city.toLowerCase();
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]!;
    const title = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || "";
    const newsItems = block.match(
      /<ht:news_item_title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/ht:news_item_title>/g,
    ) || [];
    const related = newsItems.map((n) =>
      n.replace(/<\/?ht:news_item_title>|<!\[CDATA\[|\]\]>/g, ""),
    );
    const combined = `${title} ${related.join(" ")}`.toLowerCase();
    // Either the trend mentions the city, or it's a general US trend — keep
    // both but weight city-specific higher.
    const cityHit = combined.includes(cityLower);
    if (title) {
      signals.push({
        term: title,
        source: "google-trends",
        bucketHint: "trending",
        weight: cityHit ? 1.5 : 0.6,
      });
    }
    for (const rel of related.slice(0, 2)) {
      if (rel) {
        signals.push({
          term: rel,
          source: "google-trends",
          bucketHint: "trending",
          weight: cityHit ? 1 : 0.3,
        });
      }
    }
  }
  return {
    signals,
    source: {
      source: "google-trends",
      url: GOOGLE_TRENDS_RSS_URL,
      fetchedAt: new Date().toISOString(),
      itemCount: signals.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Source 3: Bing News (city-filtered)
// ---------------------------------------------------------------------------

async function collectBingNews(q: CityQuery): Promise<{
  signals: RawSignal[];
  source: CityRawSource;
}> {
  if (!BING_NEWS_KEY) {
    return {
      signals: [],
      source: {
        source: "bing-news",
        url: BING_NEWS_API_URL,
        fetchedAt: new Date().toISOString(),
        itemCount: 0,
      },
    };
  }
  const cityLabel = [q.city, q.region].filter(Boolean).join(" ");
  const url = `${BING_NEWS_API_URL}?q=${encodeURIComponent(cityLabel)}&count=20&freshness=Week&mkt=en-US`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": BING_NEWS_KEY },
    signal: AbortSignal.timeout(PER_SOURCE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    return {
      signals: [],
      source: {
        source: "bing-news",
        url,
        fetchedAt: new Date().toISOString(),
        itemCount: 0,
      },
    };
  }
  const data = (await res.json()) as {
    value?: Array<{ name: string; description: string; url: string }>;
  };
  const articles = data.value ?? [];
  const signals: RawSignal[] = [];
  for (const a of articles) {
    signals.push({
      term: a.name,
      source: "bing-news",
      bucketHint: "trending",
      weight: 1,
    });
    if (a.description) {
      signals.push({
        term: a.description.slice(0, 140),
        source: "bing-news",
        bucketHint: "trending",
        weight: 0.5,
      });
    }
  }
  return {
    signals,
    source: {
      source: "bing-news",
      url,
      fetchedAt: new Date().toISOString(),
      itemCount: articles.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Source 4: Reddit search — r/{city} + demand-phrase query. No auth required.
// ---------------------------------------------------------------------------

const DEMAND_PHRASES = [
  "looking for",
  "recommend",
  "need help",
  "anyone know",
  "best place to",
  "where can I",
];

async function collectReddit(q: CityQuery): Promise<{
  signals: RawSignal[];
  source: CityRawSource;
}> {
  const subreddit = q.city.replace(/[^a-zA-Z0-9]/g, "");
  const signals: RawSignal[] = [];
  let totalCount = 0;
  let firstUrl = "";

  for (const phrase of DEMAND_PHRASES) {
    const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(phrase)}&restrict_sr=on&limit=10&sort=new`;
    if (!firstUrl) firstUrl = url;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "coherence-daddy-city-collector/1.0" },
        signal: AbortSignal.timeout(PER_SOURCE_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        data?: { children?: Array<{ data?: { title?: string; selftext?: string } }> };
      };
      const children = data.data?.children ?? [];
      totalCount += children.length;
      for (const c of children) {
        const title = c.data?.title?.trim();
        if (title) {
          signals.push({
            term: title,
            source: "reddit",
            bucketHint: "demand",
            weight: 1.2,
          });
        }
      }
    } catch (err) {
      logger.debug({ err, phrase, subreddit }, "city-collector: reddit query failed");
    }
  }

  return {
    signals,
    source: {
      source: "reddit",
      url: firstUrl,
      fetchedAt: new Date().toISOString(),
      itemCount: totalCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Source 5: Yelp category pages via Firecrawl scrape — proxy for service demand
// ---------------------------------------------------------------------------

export async function firecrawlScrape(url: string): Promise<string | null> {
  try {
    const res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer self-hosted",
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
      signal: AbortSignal.timeout(PER_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { success?: boolean; data?: { markdown?: string } };
    if (!data.success || !data.data?.markdown) return null;
    return data.data.markdown.slice(0, 20_000);
  } catch {
    return null;
  }
}

async function collectYelp(q: CityQuery): Promise<{
  signals: RawSignal[];
  source: CityRawSource;
}> {
  const findDesc = encodeURIComponent("popular services");
  const findLoc = encodeURIComponent(
    [q.city, q.region].filter(Boolean).join(", "),
  );
  const url = `https://www.yelp.com/search?find_desc=${findDesc}&find_loc=${findLoc}`;
  const md = await firecrawlScrape(url);
  const signals: RawSignal[] = [];
  if (md) {
    // Pull out bolded category labels — Yelp search pages surface these heavily
    const labelRegex = /\*\*([^*]{3,60})\*\*/g;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = labelRegex.exec(md)) !== null && count < 40) {
      const term = m[1]!.trim();
      if (/^[A-Z]/.test(term)) {
        signals.push({
          term,
          source: "yelp",
          bucketHint: "demand",
          weight: 0.8,
        });
        count++;
      }
    }
  }
  return {
    signals,
    source: {
      source: "yelp",
      url,
      fetchedAt: new Date().toISOString(),
      itemCount: signals.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Merge + rank via Ollama. Falls back to frequency-based ranking on failure.
// ---------------------------------------------------------------------------

interface BucketOutput {
  topSearches: CityItem[];
  serviceDemand: CityItem[];
  trendingTopics: CityItem[];
}

function simpleBucketize(raw: RawSignal[], runTimestamp: string): BucketOutput {
  // Dedup by lowercase term, sum weight as score, hint → bucket
  const acc = new Map<string, { term: string; score: number; source: string; hint?: string }>();
  for (const s of raw) {
    const key = s.term.toLowerCase();
    if (!key) continue;
    const prev = acc.get(key);
    if (prev) {
      prev.score += s.weight ?? 1;
    } else {
      acc.set(key, { term: s.term, score: s.weight ?? 1, source: s.source, hint: s.bucketHint });
    }
  }
  const all = Array.from(acc.values()).sort((a, b) => b.score - a.score);

  const bucket = (hint: string): CityItem[] =>
    all
      .filter((a) => a.hint === hint)
      .slice(0, TOP_K)
      .map((a, i) => ({
        term: a.term,
        rank: i + 1,
        score: Math.round(a.score * 100) / 100,
        source: a.source,
        collectedAt: runTimestamp,
      }));

  // If a bucket is under-filled, top it up from un-hinted entries
  const fill = (existing: CityItem[]): CityItem[] => {
    if (existing.length >= TOP_K) return existing;
    const need = TOP_K - existing.length;
    const used = new Set(existing.map((e) => e.term.toLowerCase()));
    const extras = all
      .filter((a) => !used.has(a.term.toLowerCase()))
      .slice(0, need)
      .map<CityItem>((a, i) => ({
        term: a.term,
        rank: existing.length + i + 1,
        score: Math.round(a.score * 100) / 100,
        source: a.source,
        collectedAt: runTimestamp,
      }));
    return [...existing, ...extras];
  };

  return {
    topSearches: fill(bucket("searches")),
    serviceDemand: fill(bucket("demand")),
    trendingTopics: fill(bucket("trending")),
  };
}

async function ollamaRerank(
  cityLabel: string,
  raw: RawSignal[],
  runTimestamp: string,
): Promise<BucketOutput | null> {
  // Send a compact candidate list to Ollama for classification + dedup.
  // We cap the candidate list to 400 to stay within the model's context.
  const candidates = Array.from(
    new Map(
      raw.slice(0, 400).map((s) => [s.term.toLowerCase(), s.term]),
    ).values(),
  );

  if (candidates.length < 10) return null;

  const prompt = `You are classifying local-area signals for the city "${cityLabel}".
Given the candidate list below, produce three ranked lists of up to 50 items each:

1. top_searches — things people look up most in this area (attractions, activities, landmarks, events)
2. service_demand — work, help, or services locals actively want (recommendations, "looking for", "best X")
3. trending_topics — local news and social trends good for marketing hooks

Rules:
- Reuse exact terms from the candidate list. Do not invent new ones.
- Deduplicate semantically similar items.
- Each item must appear in at most one bucket.
- Return JSON only. No markdown fences.

Output schema:
{"top_searches":["..."],"service_demand":["..."],"trending_topics":["..."]}

Candidates:
${candidates.map((c, i) => `${i + 1}. ${c}`).join("\n")}
`;

  try {
    const raw2 = await callOllamaGenerate(prompt);
    const cleaned = raw2
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as {
      top_searches?: string[];
      service_demand?: string[];
      trending_topics?: string[];
    };

    const weightByTerm = new Map<string, { score: number; source: string }>();
    for (const s of raw) {
      const k = s.term.toLowerCase();
      const prev = weightByTerm.get(k);
      if (prev) {
        prev.score += s.weight ?? 1;
      } else {
        weightByTerm.set(k, { score: s.weight ?? 1, source: s.source });
      }
    }

    const toItems = (terms: string[] | undefined): CityItem[] => {
      if (!Array.isArray(terms)) return [];
      return terms.slice(0, TOP_K).map<CityItem>((term, i) => {
        const meta = weightByTerm.get(term.toLowerCase());
        return {
          term,
          rank: i + 1,
          score: meta ? Math.round(meta.score * 100) / 100 : 1,
          source: meta?.source ?? "ollama",
          collectedAt: runTimestamp,
        };
      });
    };

    return {
      topSearches: toItems(parsed.top_searches),
      serviceDemand: toItems(parsed.service_demand),
      trendingTopics: toItems(parsed.trending_topics),
    };
  } catch (err) {
    logger.warn({ err }, "city-collector: Ollama rerank failed, using fallback");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public: collectCity — orchestrates one collection run
// ---------------------------------------------------------------------------

export async function collectCity(
  db: Db,
  q: CityQuery,
): Promise<CityCollectionResult> {
  const started = Date.now();
  const slug = buildCitySlug(q);
  const cityLabel = [q.city, q.region].filter(Boolean).join(", ");

  logger.info({ slug, city: q.city }, "city-collector: starting");

  // Mark row as running (insert-or-update with status=running)
  await db
    .insert(cityIntelligence)
    .values({
      companyId: COMPANY_ID,
      slug,
      city: q.city,
      region: q.region ?? null,
      country: q.country ?? "US",
      collectionStatus: "running",
      collectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [cityIntelligence.companyId, cityIntelligence.slug],
      set: {
        collectionStatus: "running",
        collectionError: null,
      },
    });

  try {
    const [firecrawl, gTrends, bing, reddit, yelp] = await Promise.all([
      withTimeout("firecrawl-search", collectFirecrawlSearches(q)),
      withTimeout("google-trends", collectGoogleTrends(q)),
      withTimeout("bing-news", collectBingNews(q)),
      withTimeout("reddit", collectReddit(q)),
      withTimeout("yelp", collectYelp(q)),
    ]);

    const rawSignals: RawSignal[] = [];
    const rawSources: CityRawSource[] = [];
    for (const part of [firecrawl, gTrends, bing, reddit, yelp]) {
      if (!part) continue;
      rawSignals.push(...part.signals);
      rawSources.push(part.source);
    }

    logger.info(
      { slug, signalCount: rawSignals.length, sources: rawSources.length },
      "city-collector: sources collected",
    );

    const runTimestamp = new Date().toISOString();
    const reranked = await ollamaRerank(cityLabel, rawSignals, runTimestamp);
    const allEmpty = (b: BucketOutput) =>
      b.topSearches.length === 0 && b.serviceDemand.length === 0 && b.trendingTopics.length === 0;
    const bucketed: BucketOutput =
      reranked && !allEmpty(reranked) ? reranked : simpleBucketize(rawSignals, runTimestamp);

    const durationMs = Date.now() - started;
    const freshUntil = new Date(Date.now() + FRESHNESS_DAYS * 24 * 60 * 60 * 1000);

    await db
      .update(cityIntelligence)
      .set({
        topSearches: bucketed.topSearches,
        serviceDemand: bucketed.serviceDemand,
        trendingTopics: bucketed.trendingTopics,
        rawSources,
        collectedAt: new Date(),
        freshUntil,
        collectionDurationMs: durationMs,
        collectionStatus: "ready",
        collectionError: null,
      })
      .where(
        sql`${cityIntelligence.companyId} = ${COMPANY_ID} AND ${cityIntelligence.slug} = ${slug}`,
      );

    logger.info(
      {
        slug,
        durationMs,
        topSearches: bucketed.topSearches.length,
        serviceDemand: bucketed.serviceDemand.length,
        trendingTopics: bucketed.trendingTopics.length,
      },
      "city-collector: complete",
    );

    return {
      slug,
      status: "ready",
      topSearches: bucketed.topSearches,
      serviceDemand: bucketed.serviceDemand,
      trendingTopics: bucketed.trendingTopics,
      rawSources,
      durationMs,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, slug }, "city-collector: failed");

    await db
      .update(cityIntelligence)
      .set({
        collectionStatus: "error",
        collectionError: errorMsg,
        collectionDurationMs: Date.now() - started,
      })
      .where(
        sql`${cityIntelligence.companyId} = ${COMPANY_ID} AND ${cityIntelligence.slug} = ${slug}`,
      );

    return {
      slug,
      status: "error",
      topSearches: [],
      serviceDemand: [],
      trendingTopics: [],
      rawSources: [],
      durationMs: Date.now() - started,
      error: errorMsg,
    };
  }
}

// ---------------------------------------------------------------------------
// Public: generatePitch — Ollama pitch generator grounded in collected data
// ---------------------------------------------------------------------------

export interface PitchInput {
  productOrService: string;
  audience?: string;
}

export interface PitchVariant {
  length: "short" | "medium" | "long";
  text: string;
}

export async function generatePitch(
  citySlug: string,
  db: Db,
  input: PitchInput,
): Promise<{ variants: PitchVariant[]; city: string } | null> {
  const rows = (await db
    .select()
    .from(cityIntelligence)
    .where(
      sql`${cityIntelligence.companyId} = ${COMPANY_ID} AND ${cityIntelligence.slug} = ${citySlug}`,
    )) as Array<typeof cityIntelligence.$inferSelect>;

  const row = rows[0];
  if (!row) return null;

  const top = (row.topSearches ?? []).slice(0, 10).map((s) => s.term);
  const demand = (row.serviceDemand ?? []).slice(0, 10).map((s) => s.term);
  const trending = (row.trendingTopics ?? []).slice(0, 10).map((s) => s.term);

  const cityLabel = [row.city, row.region].filter(Boolean).join(", ");

  const prompt = `Write three sales pitch variants for a business called or offering "${input.productOrService}" in ${cityLabel}.
${input.audience ? `Audience: ${input.audience}.` : ""}
Ground the pitches in real local signals:

Top local searches: ${top.join("; ")}
Local service demand: ${demand.join("; ")}
Trending locally: ${trending.join("; ")}

Output format (JSON only, no markdown fences):
{"short":"1-2 sentences","medium":"3-4 sentences","long":"6-8 sentences"}
Tone: confident, warm, never salesy. Reference specific local signals where it makes sense.
`;

  let parsed: { short?: string; medium?: string; long?: string } = {};
  try {
    const raw = await callOllamaGenerate(prompt);
    parsed = JSON.parse(
      raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim(),
    );
  } catch (err) {
    logger.warn({ err, citySlug }, "city-collector: pitch generation failed");
    return null;
  }

  const variants: PitchVariant[] = [
    { length: "short", text: parsed.short ?? "" },
    { length: "medium", text: parsed.medium ?? "" },
    { length: "long", text: parsed.long ?? "" },
  ];
  return {
    city: cityLabel,
    variants: variants.filter((v) => v.text),
  };
}

// ---------------------------------------------------------------------------
// Public helper: getCityContextForPartner — loads the top 10 from each bucket
// for use by partner-content.ts prompt builder.
// ---------------------------------------------------------------------------

export async function getCityContextForPartner(
  db: Db,
  location: string | null | undefined,
): Promise<string | null> {
  if (!location) return null;
  // Try to parse as "City, State"
  const [cityPart, regionPart] = location.split(",").map((s) => s.trim());
  if (!cityPart) return null;
  const slug = buildCitySlug({ city: cityPart, region: regionPart ?? null, country: "US" });

  const rows = (await db
    .select()
    .from(cityIntelligence)
    .where(
      sql`${cityIntelligence.companyId} = ${COMPANY_ID} AND ${cityIntelligence.slug} = ${slug} AND ${cityIntelligence.collectionStatus} = 'ready'`,
    )
    .limit(1)) as Array<typeof cityIntelligence.$inferSelect>;

  const row = rows[0];
  if (!row) return null;

  const top = (row.topSearches ?? []).slice(0, 10).map((s) => `- ${s.term}`).join("\n");
  const demand = (row.serviceDemand ?? []).slice(0, 10).map((s) => `- ${s.term}`).join("\n");
  const trending = (row.trendingTopics ?? []).slice(0, 10).map((s) => `- ${s.term}`).join("\n");

  return `Local signals for ${row.city}${row.region ? `, ${row.region}` : ""}:\n\nTop searches:\n${top}\n\nService demand:\n${demand}\n\nTrending:\n${trending}`;
}
