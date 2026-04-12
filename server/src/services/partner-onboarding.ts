// ---------------------------------------------------------------------------
// Partner Onboarding Pipeline
//
// Automatically scrapes a partner's website, extracts business intel,
// classifies their industry, finds competitors, and populates all Phase 2
// fields. Triggered fire-and-forget on partner create/update.
// ---------------------------------------------------------------------------

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { partnerCompanies } from "@paperclipai/db";
import { callOllamaGenerate } from "./ollama-client.js";
import { logger } from "../middleware/logger.js";

const FIRECRAWL_URL =
  process.env.FIRECRAWL_URL || "http://168.231.127.180:3002";

// Known industry categories (must stay in sync with partner-content.ts)
const KNOWN_INDUSTRIES = [
  "fitness", "dining", "wellness", "auto", "salon",
  "retail", "tech", "realestate", "education",
];

// ---------------------------------------------------------------------------
// Firecrawl HTTP helpers
// ---------------------------------------------------------------------------

async function firecrawlScrape(
  url: string,
): Promise<{ markdown: string; metadata: Record<string, unknown> }> {
  const res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer self-hosted" },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: 30000,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`Firecrawl scrape failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    success: boolean;
    data?: { markdown?: string; metadata?: Record<string, unknown> };
  };

  if (!data.success || !data.data?.markdown) {
    throw new Error("Firecrawl scrape returned no content");
  }

  return {
    markdown: data.data.markdown.slice(0, 50_000), // cap at 50k chars
    metadata: data.data.metadata ?? {},
  };
}

async function firecrawlSearch(
  query: string,
  limit = 3,
): Promise<Array<{ url: string; title: string; markdown: string }>> {
  try {
    const res = await fetch(`${FIRECRAWL_URL}/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer self-hosted" },
      body: JSON.stringify({
        query,
        limit,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as {
      success: boolean;
      data?: Array<{ url?: string; title?: string; markdown?: string }>;
    };

    if (!data.success || !data.data) return [];

    return data.data
      .filter((d) => d.url && d.markdown)
      .map((d) => ({
        url: d.url!,
        title: d.title ?? d.url!,
        markdown: (d.markdown ?? "").slice(0, 10_000),
      }));
  } catch (err) {
    logger.warn({ err }, "Firecrawl search failed, skipping competitor analysis");
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ollama: extract structured business intel from scraped content
// ---------------------------------------------------------------------------

interface ExtractedIntel {
  industry: string;
  description: string;
  services: string[];
  targetKeywords: string[];
  tagline: string;
  brandColors?: { primary: string; secondary: string; accent: string };
  contactInfo?: { phone?: string; address?: string; email?: string };
}

async function extractBusinessIntel(
  markdown: string,
  partnerName: string,
  currentIndustry: string,
): Promise<ExtractedIntel> {
  const prompt = `Analyze this business website content and extract structured information.

Business name: ${partnerName}
Current industry classification: ${currentIndustry}

Available industry categories: ${KNOWN_INDUSTRIES.join(", ")}

Website content:
---
${markdown.slice(0, 20_000)}
---

Return ONLY a JSON object with these fields:
{
  "industry": "best matching category from the list above (if none fit well, pick the closest match)",
  "description": "concise 1-2 sentence business description based on what the site actually says",
  "services": ["service1", "service2", ...],
  "targetKeywords": ["keyword1", "keyword2", ...] (8-12 SEO keywords relevant to this business),
  "tagline": "catchy one-liner under 80 chars for directory listing",
  "brandColors": { "primary": "#hex", "secondary": "#hex", "accent": "#hex" } or null if not found,
  "contactInfo": { "phone": "...", "address": "...", "email": "..." } or null if not found
}`;

  const raw = await callOllamaGenerate(prompt);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse business intel JSON from Ollama");
  }

  const parsed = JSON.parse(jsonMatch[0]) as ExtractedIntel;

  // Validate industry is a known category
  if (!KNOWN_INDUSTRIES.includes(parsed.industry)) {
    // Find closest match or default to "retail"
    parsed.industry = KNOWN_INDUSTRIES.find((i) =>
      parsed.industry?.toLowerCase().includes(i),
    ) ?? "retail";
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Competitor analysis
// ---------------------------------------------------------------------------

interface CompetitorInfo {
  name: string;
  url: string;
  summary: string;
}

async function findCompetitors(
  industry: string,
  location: string | null,
  partnerName: string,
): Promise<CompetitorInfo[]> {
  const query = location
    ? `${industry} businesses near ${location}`
    : `${industry} businesses online`;

  const results = await firecrawlSearch(query, 5);
  if (results.length === 0) return [];

  // Summarize each competitor with Ollama
  const competitors: CompetitorInfo[] = [];
  for (const result of results.slice(0, 3)) {
    try {
      const summaryPrompt = `Summarize this business in 1-2 sentences. What do they offer and what makes them stand out?

Business: ${result.title}
URL: ${result.url}
Content:
${result.markdown.slice(0, 5000)}

Return ONLY a brief 1-2 sentence summary.`;

      const summary = await callOllamaGenerate(summaryPrompt);
      competitors.push({
        name: result.title.slice(0, 100),
        url: result.url,
        summary: summary.slice(0, 300),
      });
    } catch {
      competitors.push({
        name: result.title.slice(0, 100),
        url: result.url,
        summary: "Could not generate summary.",
      });
    }
  }

  return competitors;
}

// ---------------------------------------------------------------------------
// Main onboarding pipeline
// ---------------------------------------------------------------------------

export async function runPartnerOnboarding(
  db: Db,
  partnerSlug: string,
): Promise<void> {
  logger.info({ slug: partnerSlug }, "Starting partner onboarding pipeline");

  // Load partner
  const [partner] = await db
    .select()
    .from(partnerCompanies)
    .where(eq(partnerCompanies.slug, partnerSlug))
    .limit(1);

  if (!partner) {
    logger.error({ slug: partnerSlug }, "Partner not found for onboarding");
    return;
  }

  if (!partner.website) {
    logger.warn({ slug: partnerSlug }, "Partner has no website, skipping onboarding");
    return;
  }

  // Set status to scraping
  await db
    .update(partnerCompanies)
    .set({ onboardingStatus: "scraping", onboardingError: null, updatedAt: new Date() })
    .where(eq(partnerCompanies.id, partner.id));

  try {
    // Step 1: Scrape the partner's website
    const { markdown, metadata } = await firecrawlScrape(partner.website);
    logger.info(
      { slug: partnerSlug, chars: markdown.length },
      "Scraped partner website",
    );

    // Step 2: Update status to analyzing
    await db
      .update(partnerCompanies)
      .set({ onboardingStatus: "analyzing", updatedAt: new Date() })
      .where(eq(partnerCompanies.id, partner.id));

    // Step 3: Extract business intelligence
    const intel = await extractBusinessIntel(markdown, partner.name, partner.industry);
    logger.info(
      { slug: partnerSlug, industry: intel.industry, keywords: intel.targetKeywords.length },
      "Extracted business intelligence",
    );

    // Step 4: Find competitors
    const competitors = await findCompetitors(
      intel.industry,
      partner.location,
      partner.name,
    );
    logger.info(
      { slug: partnerSlug, competitorCount: competitors.length },
      "Competitor analysis complete",
    );

    // Step 5: Build baseline analytics
    const baseline = {
      capturedAt: new Date().toISOString(),
      topKeywords: intel.targetKeywords,
      competitorSites: competitors,
      businessSummary: intel.description,
      sourceUrl: partner.website,
      scrapedChars: markdown.length,
    };

    // Step 6: Merge services (keep existing + add new ones)
    const existingServices = (partner.services as string[]) ?? [];
    const mergedServices = [
      ...new Set([...existingServices, ...intel.services]),
    ].slice(0, 20);

    // Step 7: Update partner with all extracted data
    const updates: Record<string, unknown> = {
      onboardingStatus: "complete",
      onboardingError: null,
      onboardingCompletedAt: new Date(),
      targetKeywords: intel.targetKeywords,
      tagline: intel.tagline,
      services: mergedServices,
      baselineAnalytics: baseline,
      baselineCapturedAt: new Date(),
      updatedAt: new Date(),
    };

    // Auto-classify industry if admin set "other" or it doesn't match known categories
    if (
      partner.industry === "other" ||
      !KNOWN_INDUSTRIES.includes(partner.industry)
    ) {
      updates.industry = intel.industry;
    }

    // Only overwrite description if current one is sparse
    if (
      !partner.description ||
      partner.description.length < 50 ||
      partner.description.toLowerCase().includes("for sale")
    ) {
      updates.description = intel.description;
    }

    // Set brand colors if extracted and not already set
    if (intel.brandColors && !partner.brandColors) {
      updates.brandColors = intel.brandColors;
    }

    // Set contact info if extracted and not already set
    if (intel.contactInfo) {
      if (intel.contactInfo.phone && !partner.phone) {
        updates.phone = intel.contactInfo.phone;
      }
      if (intel.contactInfo.address && !partner.address) {
        updates.address = intel.contactInfo.address;
      }
      if (intel.contactInfo.email && !partner.contactEmail) {
        updates.contactEmail = intel.contactInfo.email;
      }
    }

    await db
      .update(partnerCompanies)
      .set(updates)
      .where(eq(partnerCompanies.id, partner.id));

    logger.info(
      { slug: partnerSlug, industry: updates.industry ?? partner.industry },
      "Partner onboarding complete",
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, slug: partnerSlug }, "Partner onboarding failed");

    await db
      .update(partnerCompanies)
      .set({
        onboardingStatus: "failed",
        onboardingError: errorMsg.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(partnerCompanies.id, partner.id));
  }
}
