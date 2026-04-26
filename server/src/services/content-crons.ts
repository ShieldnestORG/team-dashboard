import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { contentItems, cityIntelligence, partnerCompanies } from "@paperclipai/db";
import { contentService } from "./content.js";
import { seoEngineService } from "./seo-engine.js";
import { autoGenerateAndQueue } from "./x-api/content-bridge.js";
import { publishBlogFromContent, buildPartnerFooter, type PublishTarget } from "./blog-publisher.js";
import { embedPublishedContent } from "./content-embedder.js";
import { runRetweetCycle } from "./x-api/retweet-service.js";
import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Content generation cron jobs
// Pattern: register with central cron-registry, no local setInterval.
// ---------------------------------------------------------------------------

/** Topic pickers can return a structured result to separate the display title from the LLM prompt */
interface TopicResult {
  /** Clean display string for titles (no LLM instructions) */
  display: string;
  /** Full prompt including instructions for LLM generation */
  prompt: string;
}

export interface ContentJobDef {
  name: string;
  schedule: string;
  personality: string;
  ownerAgent: string;
  contentType: string;
  topicPicker?: "intel-alert" | "chain-metrics" | "xrp-focus" | "comparison" | "tokns-promo" | "city-trends";
  useContentBridge?: boolean;
  publishTarget?: PublishTarget;
  // brand controls which X account / publish target this content belongs to
  brand?: string;
  // xAccountSlug routes tweet dispatch to a specific X account (default: 'primary')
  xAccountSlug?: string;
  // topic overrides the topic picker with a fixed string
  topic?: string;
}

export const JOB_DEFS: ContentJobDef[] = [
  // Regular content crons — ownerAgent matches the personality agent responsible
  // brand controls which X account / publish target this content belongs to
  { name: "content:twitter",  schedule: "0 8,11,14,17,20,22 * * *", personality: "blaze",  ownerAgent: "blaze",  contentType: "tweet",      useContentBridge: true, brand: "cd" },
  { name: "content:blog",     schedule: "0 10 * * 2,4",        personality: "cipher", ownerAgent: "cipher", contentType: "blog_post",   publishTarget: "all",  brand: "cd" },
  { name: "content:linkedin", schedule: "0 14 * * 1-5",        personality: "prism",  ownerAgent: "prism",  contentType: "linkedin",                          brand: "cd" },
  { name: "content:discord",  schedule: "0 10,16,21 * * *",    personality: "spark",  ownerAgent: "spark",  contentType: "discord",                           brand: "cd" },
  { name: "content:bluesky",  schedule: "0 14,17,20 * * *",    personality: "spark",  ownerAgent: "spark",  contentType: "bluesky",                           brand: "cd" },
  { name: "content:reddit",   schedule: "0 15 * * *",          personality: "cipher", ownerAgent: "cipher", contentType: "reddit",                            brand: "cd" },
  // Video script generation — text agents write scripts for visual content
  { name: "content:video:trend",  schedule: "0 11,14,18 * * *", personality: "blaze",  ownerAgent: "blaze",  contentType: "video_script", brand: "cd" },
  { name: "content:video:market", schedule: "0 9 * * 1-5",      personality: "prism",  ownerAgent: "prism",  contentType: "video_script", brand: "cd" },
  { name: "content:video:weekly", schedule: "0 10 * * 6",       personality: "prism",  ownerAgent: "prism",  contentType: "video_script", brand: "cd" },
  // Intel-alert content — reactive, triggered by hot intel signals
  { name: "content:intel-alert:twitter",  schedule: "0 */3 * * *", personality: "blaze", ownerAgent: "blaze", contentType: "tweet",   topicPicker: "intel-alert", useContentBridge: true, brand: "cd" },
  { name: "content:intel-alert:bluesky",  schedule: "0 */2 * * *",  personality: "spark", ownerAgent: "spark", contentType: "bluesky", topicPicker: "intel-alert",                        brand: "cd" },
  // TX chain daily — daily chain metrics article published to ShieldNest
  { name: "content:tx-chain-daily", schedule: "0 8 * * *", personality: "prism", ownerAgent: "prism", contentType: "blog_post", topicPicker: "chain-metrics", publishTarget: "sn", brand: "tx" },
  // XRP-focused content — Vanguard personality (institutional XRP analyst) → tokns brand
  { name: "content:xrp:blog",     schedule: "0 9 * * 1,3,5",      personality: "vanguard", ownerAgent: "vanguard", contentType: "blog_post", topicPicker: "xrp-focus", publishTarget: "all", brand: "tokns" },
  { name: "content:xrp:twitter",  schedule: "0 11,16,19 * * *",   personality: "vanguard", ownerAgent: "vanguard", contentType: "tweet",     topicPicker: "xrp-focus", useContentBridge: true,           brand: "tokns" },
  { name: "content:xrp:linkedin", schedule: "0 13 * * 2,4",       personality: "vanguard", ownerAgent: "vanguard", contentType: "linkedin",  topicPicker: "xrp-focus",                                    brand: "tokns" },
  { name: "content:xrp-alert:twitter", schedule: "0 */4 * * *",   personality: "vanguard", ownerAgent: "vanguard", contentType: "tweet",     topicPicker: "intel-alert", useContentBridge: true,          brand: "tokns" },
  // Comparison blogs — Forge personality (AEO-optimized TX vs L1s) → tx brand
  { name: "content:comparison:blog",   schedule: "0 10 * * 3,6",  personality: "forge", ownerAgent: "forge", contentType: "blog_post", topicPicker: "comparison", publishTarget: "all", brand: "tx" },
  // AEO-optimized general content — Forge personality → cd brand
  { name: "content:aeo:blog",          schedule: "0 11 * * 1,4",  personality: "forge", ownerAgent: "forge", contentType: "blog_post", publishTarget: "all",      brand: "cd" },
  // tokns.fi promotional blogs — Forge for structured content → tokns brand
  { name: "content:tokns-promo:blog",  schedule: "0 14 * * 2,5",  personality: "forge", ownerAgent: "forge", contentType: "blog_post", topicPicker: "tokns-promo", publishTarget: "all", brand: "tokns" },
  // Slideshow blogs — animated presentation-style posts (reuses YouTube slide renderer)
  { name: "content:slideshow-blog:cd", schedule: "0 12 * * 3,6",  personality: "cipher", ownerAgent: "cipher", contentType: "slideshow_blog", publishTarget: "cd", brand: "cd" },
  { name: "content:slideshow-blog:sn", schedule: "0 13 * * 2,5",  personality: "prism",  ownerAgent: "prism",  contentType: "slideshow_blog", publishTarget: "sn", brand: "tx" },
  // AEO push crons for @coherencedaddy X account
  {
    name: "content:aeo-tips-cd",
    schedule: "0 9 * * *",
    personality: "prism",
    ownerAgent: "prism",
    contentType: "tweet",
    brand: "cd",
    xAccountSlug: "coherencedaddy",
    useContentBridge: true,
    topic: "Why AEO outperforms SEO in 2026 — AI-powered directory discovery vs traditional search rankings",
  },
  {
    name: "content:directory-spotlight-cd",
    schedule: "0 14 * * 1,3,5",
    personality: "cipher",
    ownerAgent: "cipher",
    contentType: "tweet",
    brand: "directory",
    xAccountSlug: "coherencedaddy",
    useContentBridge: true,
    topic: "Spotlight on innovative AI/ML and DeFi companies in the Coherence Daddy directory",
  },
  {
    name: "content:blog-link-push-cd",
    schedule: "30 16 * * 2,4",
    personality: "blaze",
    ownerAgent: "blaze",
    contentType: "tweet",
    brand: "cd",
    xAccountSlug: "coherencedaddy",
    useContentBridge: true,
    topic: "AEO strategy for 2026: how AI directories are replacing Google for B2B discovery",
  },
  // City-trends blog — Tuesday 9am, day after Monday city intelligence refresh
  {
    name: "content:city-trends:blog",
    schedule: "0 9 * * 2",
    personality: "cipher",
    ownerAgent: "cipher",
    contentType: "blog_post",
    topicPicker: "city-trends",
    publishTarget: "cd",
    brand: "cd",
  },
];

// ---------------------------------------------------------------------------
// Smart topic picker — weighted by recency + engagement, diverse across dirs
// ---------------------------------------------------------------------------

async function pickTopic(db: Db): Promise<string> {
  try {
    // Check which report types have historically produced high-engagement content
    let performanceBoost = new Map<string, number>();
    try {
      const perf = (await db.execute(sql`
        SELECT ci.content_type, AVG(CAST(ci.engagement_score AS FLOAT)) AS avg_score
        FROM content_items ci
        WHERE ci.published_at > NOW() - INTERVAL '30 days'
          AND CAST(ci.engagement_score AS FLOAT) > 0
        GROUP BY ci.content_type
      `)) as unknown as Array<{ content_type: string; avg_score: number }>;
      for (const p of perf) {
        // Normalize: avg_score > 10 gets a 1.5x boost, > 5 gets 1.2x
        const boost = Number(p.avg_score) > 10 ? 1.5 : Number(p.avg_score) > 5 ? 1.2 : 1.0;
        performanceBoost.set(p.content_type, boost);
      }
    } catch { /* non-critical */ }

    const rows = (await db.execute(sql`
      SELECT
        r.headline,
        r.report_type,
        c.directory,
        r.captured_at,
        -- Exponential decay: half-life of ~12 hours
        EXP(-EXTRACT(EPOCH FROM (NOW() - r.captured_at)) / 43200.0) AS recency_score
      FROM intel_reports r
      JOIN intel_companies c ON c.slug = r.company_slug
      WHERE r.captured_at > NOW() - INTERVAL '48 hours'
        AND r.report_type != 'discovery'
      ORDER BY EXP(-EXTRACT(EPOCH FROM (NOW() - r.captured_at)) / 43200.0) DESC
      LIMIT 30
    `)) as unknown as Array<{ headline: string; report_type: string; directory: string; recency_score: number }>;

    if (rows.length > 0) {
      // Ensure directory diversity — pick from different directories
      const byDirectory = new Map<string, typeof rows>();
      for (const row of rows) {
        const dirRows = byDirectory.get(row.directory) ?? [];
        dirRows.push(row);
        byDirectory.set(row.directory, dirRows);
      }

      // Take top candidate from each directory, then pick randomly
      const diverse: typeof rows = [];
      for (const dirRows of byDirectory.values()) {
        if (dirRows.length > 0) diverse.push(dirRows[0]!);
      }

      // If we have diverse options, weighted random pick (boosted by performance data)
      if (diverse.length > 0) {
        const totalWeight = diverse.reduce((sum, r) => {
          const boost = performanceBoost.get(r.report_type) ?? 1.0;
          return sum + Number(r.recency_score) * boost;
        }, 0);
        let rand = Math.random() * totalWeight;
        for (const row of diverse) {
          const boost = performanceBoost.get(row.report_type) ?? 1.0;
          rand -= Number(row.recency_score) * boost;
          if (rand <= 0) return row.headline;
        }
        return diverse[0]!.headline;
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to pick topic from intel reports, using fallback");
  }

  // Fallback topics
  const fallbacks = [
    "blockchain ecosystem updates",
    "DeFi protocol innovations",
    "cryptocurrency market trends",
    "Web3 developer tools",
    "layer 2 scaling solutions",
    "AI model breakthroughs",
    "developer tooling advances",
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)]!;
}

// ---------------------------------------------------------------------------
// Intel alert topic picker — finds hot signals for reactive content
// ---------------------------------------------------------------------------

async function pickIntelAlert(db: Db): Promise<string | null> {
  try {
    // Look for hot signals: big price moves, new releases, high-engagement posts
    const rows = (await db.execute(sql`
      (
        SELECT headline, report_type, captured_at
        FROM intel_reports
        WHERE report_type = 'price'
          AND captured_at > NOW() - INTERVAL '2 hours'
          AND body LIKE '%price_change_24h_pct%'
        ORDER BY captured_at DESC
        LIMIT 5
      )
      UNION ALL
      (
        SELECT headline, report_type, captured_at
        FROM intel_reports
        WHERE report_type = 'github'
          AND headline LIKE '%released%'
          AND captured_at > NOW() - INTERVAL '4 hours'
        ORDER BY captured_at DESC
        LIMIT 3
      )
      UNION ALL
      (
        SELECT headline, report_type, captured_at
        FROM intel_reports
        WHERE report_type IN ('reddit', 'twitter', 'news')
          AND captured_at > NOW() - INTERVAL '2 hours'
        ORDER BY captured_at DESC
        LIMIT 5
      )
    `)) as unknown as Array<{ headline: string; report_type: string; captured_at: string }>;

    if (rows.length === 0) return null;

    // Parse price moves and prioritize big movers
    for (const row of rows) {
      if (row.report_type === "price" && row.headline.includes("%")) {
        // Extract percentage from headline
        const match = row.headline.match(/([-\d.]+)%/);
        if (match && Math.abs(parseFloat(match[1]!)) > 10) {
          return row.headline;
        }
      }
    }

    // Otherwise pick the most recent hot signal
    return rows[0]!.headline;
  } catch (err) {
    logger.warn({ err }, "Failed to pick intel alert topic");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Chain metrics topic picker — builds daily summary from Cosmos LCD intel data
// ---------------------------------------------------------------------------

async function pickChainMetricsTopic(db: Db): Promise<TopicResult | null> {
  try {
    const networks = ["cosmos", "osmosis", "tx-blockchain"];
    const parts: string[] = [];

    for (const network of networks) {
      // Get latest metrics
      const latest = (await db.execute(sql`
        SELECT body, captured_at
        FROM intel_reports
        WHERE company_slug = ${network}
          AND report_type = 'chain-metrics'
        ORDER BY captured_at DESC
        LIMIT 1
      `)) as unknown as Array<{ body: string; captured_at: string }>;

      if (latest.length === 0) continue;

      const payload = JSON.parse(latest[0]!.body) as {
        apr: number | null;
        validator_count?: number | null;
        block_height?: number | null;
      };

      // Get 24h-ago metrics for comparison
      const prev = (await db.execute(sql`
        SELECT body
        FROM intel_reports
        WHERE company_slug = ${network}
          AND report_type = 'chain-metrics'
          AND captured_at < NOW() - INTERVAL '20 hours'
        ORDER BY captured_at DESC
        LIMIT 1
      `)) as unknown as Array<{ body: string }>;

      let deltaStr = "";
      if (prev.length > 0 && payload.apr != null) {
        const prevPayload = JSON.parse(prev[0]!.body) as { apr: number | null };
        if (prevPayload.apr != null) {
          const delta = payload.apr - prevPayload.apr;
          deltaStr = delta >= 0 ? ` (+${delta.toFixed(2)}%)` : ` (${delta.toFixed(2)}%)`;
        }
      }

      let part = `${network}: APR ${payload.apr != null ? payload.apr.toFixed(2) + "%" : "N/A"}${deltaStr}`;

      if (payload.validator_count != null) {
        part += `, ${payload.validator_count} validators`;
      }
      if (payload.block_height != null) {
        part += `, block ${payload.block_height.toLocaleString()}`;
      }

      parts.push(part);
    }

    if (parts.length === 0) {
      logger.info("No chain metrics data available for daily summary");
      return null;
    }

    const display = `TX Blockchain Daily Chain Report: ${parts.join(" | ")}`;
    return {
      display,
      prompt: `${display}. Write a comprehensive daily overview of Cosmos ecosystem activity covering staking, validator health, network performance, and what these metrics mean for the ecosystem.`,
    };
  } catch (err) {
    logger.warn({ err }, "Failed to pick chain metrics topic");
    return null;
  }
}

// ---------------------------------------------------------------------------
// XRP-focused topic picker — pulls XRP/Ripple intel for Vanguard personality
// ---------------------------------------------------------------------------

async function pickXrpTopic(db: Db): Promise<string> {
  try {
    const rows = (await db.execute(sql`
      SELECT headline, report_type, captured_at,
        EXP(-EXTRACT(EPOCH FROM (NOW() - captured_at)) / 43200.0) AS recency_score
      FROM intel_reports
      WHERE company_slug = 'xrpl-ripple'
        AND captured_at > NOW() - INTERVAL '48 hours'
        AND report_type != 'discovery'
      ORDER BY EXP(-EXTRACT(EPOCH FROM (NOW() - captured_at)) / 43200.0) DESC
      LIMIT 10
    `)) as unknown as Array<{ headline: string; report_type: string; recency_score: number }>;

    if (rows.length > 0) {
      // Weighted random pick by recency
      const totalWeight = rows.reduce((sum, r) => sum + Number(r.recency_score), 0);
      let rand = Math.random() * totalWeight;
      for (const row of rows) {
        rand -= Number(row.recency_score);
        if (rand <= 0) return row.headline;
      }
      return rows[0]!.headline;
    }
  } catch (err) {
    logger.warn({ err }, "Failed to pick XRP topic from intel, using fallback");
  }

  const fallbacks = [
    "XRP regulatory developments and SEC implications for crypto markets",
    "XRPL DeFi ecosystem growth and new AMM liquidity pools",
    "Ripple ODL corridor expansion and cross-border payment adoption",
    "XRP price analysis: institutional accumulation and market structure",
    "XRPL NFT ecosystem and tokenization use cases",
    "Ripple partnerships and enterprise blockchain adoption trends",
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)]!;
}

// ---------------------------------------------------------------------------
// Comparison topic picker — TX blockchain vs competitor L1s with real data
// ---------------------------------------------------------------------------

const COMPETITOR_L1S = ["solana", "avalanche-2", "matic-network", "arbitrum", "optimism", "sei-network", "injective-protocol", "celestia"];

async function pickComparisonTopic(db: Db): Promise<TopicResult> {
  try {
    // Get TX chain metrics
    const txMetrics = (await db.execute(sql`
      SELECT body FROM intel_reports
      WHERE company_slug IN ('cosmos', 'tx-blockchain')
        AND report_type = 'chain-metrics'
      ORDER BY captured_at DESC
      LIMIT 2
    `)) as unknown as Array<{ body: string }>;

    let txContext = "";
    if (txMetrics.length > 0) {
      const parsed = JSON.parse(txMetrics[0]!.body) as { apr?: number | null; validator_count?: number | null };
      const parts: string[] = [];
      if (parsed.apr != null) parts.push(`APR ${parsed.apr.toFixed(2)}%`);
      if (parsed.validator_count != null) parts.push(`${parsed.validator_count} validators`);
      if (parts.length > 0) txContext = `TX Blockchain metrics: ${parts.join(", ")}. `;
    }

    // Pick a random competitor and get their latest price data
    const competitor = COMPETITOR_L1S[Math.floor(Math.random() * COMPETITOR_L1S.length)]!;
    const compData = (await db.execute(sql`
      SELECT headline, body FROM intel_reports
      WHERE company_slug = ${competitor}
        AND report_type = 'price'
      ORDER BY captured_at DESC
      LIMIT 1
    `)) as unknown as Array<{ headline: string; body: string }>;

    const compName = competitor.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    let compContext = "";
    if (compData.length > 0) {
      compContext = `Competitor data: ${compData[0]!.headline}. `;
    }

    const display = `TX Blockchain vs ${compName}: Cosmos SDK Comparison`;
    const instruction = `${txContext}${compContext}Write a detailed comparison of TX Blockchain (Cosmos SDK, IBC-enabled) vs ${compName}. Compare: transaction speed, staking APR, validator decentralization, cross-chain interoperability (IBC vs bridges), ecosystem size, and developer experience. Include an HTML comparison table. Show why TX's Cosmos SDK foundation and IBC connectivity give it advantages. Reference app.tokns.fi for staking and portfolio tracking.`;
    return { display, prompt: instruction };
  } catch (err) {
    logger.warn({ err }, "Failed to build comparison topic, using fallback");
  }

  const fallbacks: TopicResult[] = [
    { display: "TX Blockchain vs Solana: Interoperability and Staking Comparison", prompt: "TX Blockchain vs Solana: Which L1 offers better interoperability and staking rewards? Compare IBC cross-chain vs Wormhole bridges, validator economics, and ecosystem growth. Include comparison table." },
    { display: "TX Blockchain vs Ethereum L2s: Sovereign Cosmos Chain Advantages", prompt: "TX Blockchain advantages over Ethereum L2s: Why a sovereign Cosmos SDK chain beats rollups for cross-chain DeFi. Compare finality, fees, IBC connectivity, and sovereignty." },
    { display: "Why TX Blockchain's Cosmos SDK Foundation Matters", prompt: "Why TX Blockchain's Cosmos SDK foundation matters: Comparing TX to monolithic L1s on interoperability, governance, and staking APR. Reference app.tokns.fi for staking." },
    { display: "TX vs Avalanche: IBC vs Subnets", prompt: "TX vs Avalanche: Subnet architecture vs IBC — which cross-chain approach wins? Compare validator requirements, staking yields, and ecosystem composability." },
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)]!;
}

// ---------------------------------------------------------------------------
// tokns.fi promo topic picker — feature spotlights enriched with live data
// ---------------------------------------------------------------------------

async function pickToknsPromoTopic(db: Db): Promise<TopicResult> {
  // Pull latest TX chain metrics for real numbers
  let metricsContext = "";
  try {
    const latest = (await db.execute(sql`
      SELECT body FROM intel_reports
      WHERE company_slug = 'tx-blockchain' AND report_type = 'chain-metrics'
      ORDER BY captured_at DESC LIMIT 1
    `)) as unknown as Array<{ body: string }>;

    if (latest.length > 0) {
      const parsed = JSON.parse(latest[0]!.body) as { apr?: number | null; validator_count?: number | null };
      const parts: string[] = [];
      if (parsed.apr != null) parts.push(`current staking APR is ${parsed.apr.toFixed(2)}%`);
      if (parsed.validator_count != null) parts.push(`${parsed.validator_count} active validators`);
      if (parts.length > 0) metricsContext = ` Live data: ${parts.join(", ")}.`;
    }
  } catch {
    // Non-critical — proceed with static topic
  }

  const topics: TopicResult[] = [
    { display: "How to Stake TX Tokens on tokns.fi", prompt: `How to stake TX tokens on app.tokns.fi: Step-by-step guide to earning passive rewards.${metricsContext} Cover: connecting wallet, choosing a validator (recommend tokns.fi validator), delegating, claiming rewards. Include FAQ section with common staking questions.` },
    { display: "Why tokns.fi Is the Best TX Ecosystem Dashboard", prompt: `Why tokns.fi is the best TX ecosystem dashboard: Feature comparison with alternatives.${metricsContext} Cover: NFT marketplace, multi-wallet tracking, token swaps, staking — all in one app. Include comparison table vs generic block explorers.` },
    { display: "tokns.fi Feature Spotlight: Multi-Wallet Portfolio Tracking", prompt: `app.tokns.fi feature spotlight: Multi-wallet portfolio tracking for the TX ecosystem.${metricsContext} Cover: how to add multiple wallets, track NFTs across wallets, monitor staking rewards, view transaction history. Explain why privacy-first design matters.` },
    { display: "tokns.fi NFT Marketplace Guide", prompt: `tokns.fi NFT marketplace guide: How to buy, sell, and trade TX NFTs.${metricsContext} Cover: listing process, ShieldNest 1% fee advantage, on-chain verification, and how NFT trading supports the ecosystem validator.` },
    { display: "Earning with tokns.fi: Staking and Validator Delegation", prompt: `Earning with tokns.fi: Staking rewards, validator delegation, and ecosystem participation.${metricsContext} Cover: how every TX delegated to the tokns.fi validator funds free community tools and infrastructure. Reference coherencedaddy.com 523+ free tools.` },
    { display: "tokns.fi Token Swaps: Low-Fee Trading on TX Blockchain", prompt: `tokns.fi token swaps: How to swap tokens on the TX blockchain with low fees.${metricsContext} Cover: swap interface, supported pairs, slippage settings, and why Cosmos IBC makes cross-chain swaps possible.` },
  ];
  return topics[Math.floor(Math.random() * topics.length)]!;
}

// ---------------------------------------------------------------------------
// City-trends topic picker — pulls fresh local intel for located partners
// ---------------------------------------------------------------------------

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

async function pickCityTrendTopic(db: Db): Promise<{ display: string; prompt: string } | null> {
  // Find city_intelligence rows that are ready and still fresh, joined to
  // partners that have a location set.
  const partners = await db
    .select({
      location: partnerCompanies.location,
      contentMentions: partnerCompanies.contentMentions,
      name: partnerCompanies.name,
    })
    .from(partnerCompanies)
    .where(
      sql`${partnerCompanies.companyId} = ${COMPANY_ID}
          AND ${partnerCompanies.location} IS NOT NULL
          AND ${partnerCompanies.location} <> ''
          AND ${partnerCompanies.status} IN ('trial', 'active')`,
    );

  if (partners.length === 0) return null;

  // For each partner, find the city_intelligence row
  let bestTopic: { term: string; score: number; city: string; mentionWeight: number } | null = null;

  for (const partner of partners) {
    if (!partner.location) continue;
    const [cityPart, regionPart] = partner.location.split(",").map((s: string) => s.trim());
    if (!cityPart) continue;

    const slug = [cityPart, regionPart ?? "", "us"]
      .map((s) => (s || "").trim().toLowerCase())
      .filter(Boolean)
      .map((s) => s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
      .join("-");

    const rows = await db
      .select({
        trendingTopics: cityIntelligence.trendingTopics,
        city: cityIntelligence.city,
        region: cityIntelligence.region,
      })
      .from(cityIntelligence)
      .where(
        sql`${cityIntelligence.companyId} = ${COMPANY_ID}
            AND ${cityIntelligence.slug} = ${slug}
            AND ${cityIntelligence.collectionStatus} = 'ready'
            AND ${cityIntelligence.freshUntil} > now()`,
      )
      .limit(1);

    const row = rows[0];
    if (!row || !row.trendingTopics || (row.trendingTopics as unknown[]).length === 0) continue;

    const topics = row.trendingTopics as Array<{ term: string; score: number }>;
    // Weight by topic score × inverse of content mentions (boost least-mentioned partners)
    const mentionWeight = 1 / ((partner.contentMentions ?? 0) + 1);
    for (const t of topics.slice(0, 3)) {
      const weighted = t.score * mentionWeight;
      if (!bestTopic || weighted > bestTopic.mentionWeight) {
        const city = [row.city, row.region].filter(Boolean).join(", ");
        bestTopic = { term: t.term, score: t.score, city, mentionWeight: weighted };
      }
    }
  }

  if (!bestTopic) return null;

  return {
    display: `${bestTopic.term} — local trends in ${bestTopic.city}`,
    prompt: `Write a blog post about "${bestTopic.term}" relevant to local businesses and residents in ${bestTopic.city}. Focus on practical local relevance, community impact, and how small businesses can leverage this trend.`,
  };
}

// ---------------------------------------------------------------------------
// Register all content cron jobs
// ---------------------------------------------------------------------------

export function startContentCrons(db: Db) {
  const svc = contentService(db);
  const seoEngine = seoEngineService(db);

  // SEO engine job — daily at 7:03am
  registerCronJob({
    jobName: "content:seo-engine",
    schedule: "3 7 * * *",
    ownerAgent: "sage",
    sourceFile: "content-crons.ts",
    handler: async () => {
      const result = await seoEngine.run();
      logger.info({ result }, "SEO engine cron completed");
      return result;
    },
  });

  // Retweet cycle — retweet ecosystem accounts every 4 hours
  registerCronJob({
    jobName: "content:retweet-cycle",
    schedule: "0 */4 * * *",
    ownerAgent: "blaze",
    sourceFile: "content-crons.ts",
    handler: async () => {
      const result = await runRetweetCycle(db);
      logger.info({ result }, "Retweet cycle completed");
      return result;
    },
  });

  // Register all content generation jobs
  for (const def of JOB_DEFS) {
    registerCronJob({
      jobName: def.name,
      schedule: def.schedule,
      ownerAgent: def.ownerAgent,
      sourceFile: "content-crons.ts",
      handler: async () => {
        // Topic pickers return either a plain string or TopicResult { display, prompt }
        // display = clean title (no LLM instructions), prompt = full LLM input
        let topicRaw: string | TopicResult | null;

        // Fixed topic override (e.g. for @coherencedaddy account crons)
        if (def.topic) {
          topicRaw = def.topic;
        } else if (def.topicPicker === "intel-alert") {
          topicRaw = await pickIntelAlert(db);
          if (!topicRaw) {
            logger.info({ job: def.name, ownerAgent: def.ownerAgent }, "No hot intel signals, skipping alert content");
            return;
          }
        } else if (def.topicPicker === "chain-metrics") {
          topicRaw = await pickChainMetricsTopic(db);
          if (!topicRaw) {
            logger.info({ job: def.name, ownerAgent: def.ownerAgent }, "No chain metrics data, skipping daily chain report");
            return;
          }
        } else if (def.topicPicker === "xrp-focus") {
          topicRaw = await pickXrpTopic(db);
        } else if (def.topicPicker === "comparison") {
          topicRaw = await pickComparisonTopic(db);
        } else if (def.topicPicker === "tokns-promo") {
          topicRaw = await pickToknsPromoTopic(db);
        } else if (def.topicPicker === "city-trends") {
          const cityResult = await pickCityTrendTopic(db);
          if (!cityResult) {
            logger.info({ job: def.name }, "content:city-trends: no fresh city data, skipping");
            return;
          }
          topicRaw = cityResult;
        } else {
          topicRaw = await pickTopic(db);
        }

        // Normalize: structured TopicResult separates display title from LLM prompt
        const topicPrompt = typeof topicRaw === "string" ? topicRaw : topicRaw?.prompt ?? "";
        const topicDisplay = typeof topicRaw === "string" ? topicRaw : topicRaw?.display ?? topicPrompt;

        // Slideshow blog generation — uses presentation renderer pipeline
        if (def.contentType === "slideshow_blog") {
          const target = def.publishTarget || "cd";
          const templateName = target === "sn" ? "tx" as const : "coherencedaddy" as const;
          try {
            const { generateSlideshowBlog } = await import("./blog-slideshow-generator.js");
            const slideshow = await generateSlideshowBlog(topicPrompt || topicDisplay, templateName);
            const category = "ecosystem" as const;
            const publishResult = await publishBlogFromContent(
              slideshow.html, slideshow.title, category, target, "slideshow",
            );
            if (publishResult.success) {
              logger.info(
                { job: def.name, slug: publishResult.slug, title: slideshow.title, slides: slideshow.slideCount, target },
                "Slideshow blog published",
              );
              await embedPublishedContent(db, {
                title: slideshow.title,
                content: slideshow.html,
                slug: publishResult.slug || "",
                category,
                personalityId: def.personality,
              });
            } else {
              logger.warn({ job: def.name, error: publishResult.error, target }, "Slideshow blog publish failed");
            }
          } catch (err) {
            logger.error({ err, job: def.name, target }, "Slideshow blog generation error");
          }
          return;
        }

        // Use enriched content bridge for twitter jobs
        if (def.useContentBridge && def.contentType === "tweet") {
          const companyId = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";
          await autoGenerateAndQueue(db, def.personality, companyId, topicPrompt || undefined, def.xAccountSlug ?? "tx_rizz");
          logger.info(
            { job: def.name, ownerAgent: def.ownerAgent, topic: topicDisplay, isAlert: !!def.topicPicker, xAccountSlug: def.xAccountSlug ?? "tx_rizz" },
            "Content cron completed via content-bridge — tweet queued as draft",
          );
        } else {
          const result = await svc.generate({
            personalityId: def.personality,
            contentType: def.contentType,
            topic: topicPrompt,
            brand: def.brand,
          });
          logger.info(
            { job: def.name, ownerAgent: def.ownerAgent, contentId: result.contentId, topic: topicDisplay, isAlert: !!def.topicPicker },
            "Content cron completed — item queued as pending",
          );

          // Auto-publish blog posts to target(s)
          if (def.contentType === "blog_post") {
            const target = def.publishTarget || "cd";
            const category = def.topicPicker === "chain-metrics" || def.topicPicker === "xrp-focus"
              ? "crypto" as const
              : def.topicPicker === "comparison"
                ? "ecosystem" as const
                : "ecosystem" as const;
            try {
              // Append partner footer if any deployed partners exist
              const partnerFooter = await buildPartnerFooter(db, category);
              const contentWithFooter = partnerFooter
                ? result.content + partnerFooter
                : result.content;
              // Use topicDisplay (clean title) for publishing, NOT topicPrompt (has LLM instructions)
              const publishResult = await publishBlogFromContent(contentWithFooter, topicDisplay, category, target);
              if (publishResult.success) {
                await db
                  .update(contentItems)
                  .set({
                    status: "published",
                    publishedAt: new Date(),
                    updatedAt: new Date(),
                    slug: publishResult.slug ?? null,
                    publishResults: publishResult.publishResults ?? {},
                  })
                  .where(eq(contentItems.id, result.contentId));
                logger.info(
                  { job: def.name, slug: publishResult.slug, title: publishResult.title, target, publishResults: publishResult.publishResults },
                  "Blog post published",
                );
                // Embed published content back into intel for future context enrichment
                await embedPublishedContent(db, {
                  title: publishResult.title || topicDisplay,
                  content: result.content,
                  slug: publishResult.slug || "",
                  category,
                  personalityId: def.personality,
                });
              } else {
                // Record per-target failure results even when the row stays draft —
                // admins need to see WHICH target failed to diagnose.
                if (publishResult.publishResults) {
                  await db
                    .update(contentItems)
                    .set({
                      publishResults: publishResult.publishResults,
                      updatedAt: new Date(),
                    })
                    .where(eq(contentItems.id, result.contentId));
                }
                logger.warn(
                  { job: def.name, error: publishResult.error, target, publishResults: publishResult.publishResults },
                  "Blog publish failed — content stays as draft",
                );
              }
            } catch (publishErr) {
              logger.error({ err: publishErr, job: def.name, target }, "Blog publish error — non-critical, content in draft");
            }
          }
        }
      },
    });
  }

  // Partner site content — MWF at 8am, generates blog posts for partner microsites
  registerCronJob({
    jobName: "content:partner-sites",
    schedule: "0 8 * * 1,3,5",
    ownerAgent: "forge",
    sourceFile: "content-crons.ts",
    handler: async () => {
      const { generateAllPartnerContent } = await import("./partner-site-content.js");
      const generated = await generateAllPartnerContent(db);
      logger.info({ generated }, "Partner site content cron completed");
      return { generated };
    },
  });

  // Partner content publish — MWF at 8:30am (30 min after generation)
  registerCronJob({
    jobName: "content:partner-publish",
    schedule: "30 8 * * 1,3,5",
    ownerAgent: "forge",
    sourceFile: "content-crons.ts",
    handler: async () => {
      const { publishAllDraftContent } = await import("./partner-site-publisher.js");
      const published = await publishAllDraftContent(db);
      logger.info({ published }, "Partner content publish cron completed");
      return { published };
    },
  });

  logger.info({ count: JOB_DEFS.length + 4, cdAccountJobs: 3 }, "Content cron jobs registered");
}
