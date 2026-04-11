// ---------------------------------------------------------------------------
// Partner-Specific Content Generation Service
//
// Generates blog posts FOR partner microsites (not injecting into CD content).
// Each partner gets standalone SEO/AEO-optimized articles targeting their
// industry, services, and keywords. All links use tracked redirects.
// ---------------------------------------------------------------------------

import { eq, and, desc, count } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { partnerCompanies, partnerSiteContent } from "@paperclipai/db";
import { callOllamaGenerate } from "./ollama-client.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

// ---------------------------------------------------------------------------
// Industry prompt templates
// ---------------------------------------------------------------------------

const INDUSTRY_PROMPTS: Record<string, string> = {
  fitness: `You are an expert health and fitness content writer. Write engaging, practical articles about workouts, nutrition, recovery, and healthy living. Include actionable tips readers can apply today.`,
  dining: `You are a food and dining content writer. Write appetizing articles about cuisine, local dining, cooking tips, and food culture. Make the reader hungry and curious.`,
  wellness: `You are a wellness and self-care content writer. Write calming, insightful articles about meditation, mindfulness, mental health, stress management, and holistic well-being.`,
  auto: `You are an automotive content writer. Write practical articles about vehicle maintenance, car care tips, driving safety, and automotive technology.`,
  salon: `You are a beauty and style content writer. Write trendy, informative articles about hair care, skincare, beauty tips, and personal grooming.`,
  retail: `You are a retail and shopping content writer. Write engaging articles about product trends, shopping tips, seasonal buying guides, and consumer advice.`,
  tech: `You are a technology content writer. Write accessible articles about software, digital tools, tech trends, and practical technology advice for businesses.`,
  realestate: `You are a real estate content writer. Write informative articles about home buying, selling, market trends, property investment, and neighborhood guides.`,
  education: `You are an education content writer. Write inspiring articles about learning, skill development, educational technology, and career advancement.`,
  other: `You are a versatile business content writer. Write engaging, informative articles relevant to the business's industry and target audience.`,
};

// ---------------------------------------------------------------------------
// Topic picker — rotates through partner's target keywords
// ---------------------------------------------------------------------------

async function pickTopic(db: Db, partnerId: string, keywords: string[]): Promise<string> {
  if (!keywords.length) return "industry tips and advice";

  // Check recently used topics to avoid repetition
  const recent = await db
    .select({ title: partnerSiteContent.title })
    .from(partnerSiteContent)
    .where(eq(partnerSiteContent.partnerId, partnerId))
    .orderBy(desc(partnerSiteContent.createdAt))
    .limit(5);

  const recentTitles = recent.map((r) => r.title.toLowerCase());

  // Pick a keyword that hasn't been used recently
  for (const kw of keywords) {
    if (!recentTitles.some((t) => t.includes(kw.toLowerCase()))) {
      return kw;
    }
  }

  // All keywords used recently — pick random one
  return keywords[Math.floor(Math.random() * keywords.length)];
}

// ---------------------------------------------------------------------------
// Generate a blog post for a partner's microsite
// ---------------------------------------------------------------------------

export async function generatePartnerBlogPost(
  db: Db,
  partnerId: string,
): Promise<{ id: string; title: string } | null> {
  const [partner] = await db
    .select()
    .from(partnerCompanies)
    .where(eq(partnerCompanies.id, partnerId))
    .limit(1);

  if (!partner) {
    logger.warn({ partnerId }, "Partner not found for content generation");
    return null;
  }

  const keywords = (partner.targetKeywords as string[]) ?? [];
  const topic = await pickTopic(db, partnerId, keywords);

  const industryPrompt = INDUSTRY_PROMPTS[partner.industry] ?? INDUSTRY_PROMPTS.other;

  const redirectUrl = `https://coherencedaddy.com/go/${partner.slug}?src=microsite&utm_source=coherencedaddy&utm_medium=aeo&utm_campaign=partner`;

  const prompt = `${industryPrompt}

You are writing for ${partner.name}${partner.location ? ` in ${partner.location}` : ""}.
${partner.description ? `About the business: ${partner.description}` : ""}
${partner.services?.length ? `Services offered: ${(partner.services as string[]).join(", ")}` : ""}
${partner.targetAudience ? `Target audience: ${partner.targetAudience}` : ""}

Write a 400-600 word SEO-optimized blog post about: ${topic}

Requirements:
- Write in a friendly, authoritative tone
- Include practical, actionable advice
- Naturally mention ${partner.name} and their services where relevant
- Include a call-to-action linking to: ${redirectUrl}
- Use proper HTML formatting (h2, h3, p, ul, li tags)
- Do NOT use h1 (the title will be rendered separately)

Output format — return ONLY a JSON object:
{
  "title": "SEO-friendly title under 70 chars",
  "description": "Meta description under 160 chars",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "content": "<h2>...</h2><p>...</p>..."
}`;

  try {
    const raw = await callOllamaGenerate(prompt);

    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error({ partnerId, raw: raw.slice(0, 200) }, "Failed to parse partner content JSON");
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      title: string;
      description: string;
      keywords: string[];
      content: string;
    };

    if (!parsed.title || !parsed.content) {
      logger.error({ partnerId }, "Missing title or content in partner blog post");
      return null;
    }

    // Slugify title for URL
    const slug = parsed.title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 80);

    const [item] = await db
      .insert(partnerSiteContent)
      .values({
        partnerId,
        companyId: COMPANY_ID,
        slug,
        title: parsed.title,
        contentType: "blog_post",
        body: parsed.content,
        metaDescription: parsed.description,
        keywords: parsed.keywords,
        status: "draft",
      })
      .returning();

    // Update content tracking counters
    await db
      .update(partnerCompanies)
      .set({
        contentPostCount: (partner.contentPostCount ?? 0) + 1,
        lastContentGeneratedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(partnerCompanies.id, partnerId));

    logger.info(
      { partnerId, slug: partner.slug, contentId: item.id, title: parsed.title },
      "Generated partner blog post",
    );

    return { id: item.id, title: parsed.title };
  } catch (err) {
    logger.error({ err, partnerId }, "Failed to generate partner blog post");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generate content for all active partners with deployed sites
// ---------------------------------------------------------------------------

export async function generateAllPartnerContent(db: Db): Promise<number> {
  const partners = await db
    .select()
    .from(partnerCompanies)
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        eq(partnerCompanies.siteDeployStatus, "deployed"),
      ),
    );

  // Also include active/trial partners without a deployed site (pre-generate content)
  const preGenPartners = await db
    .select()
    .from(partnerCompanies)
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        eq(partnerCompanies.status, "active"),
      ),
    );

  // Merge and deduplicate
  const allPartners = new Map<string, typeof partners[0]>();
  for (const p of [...partners, ...preGenPartners]) {
    allPartners.set(p.id, p);
  }

  let generated = 0;
  for (const partner of allPartners.values()) {
    const result = await generatePartnerBlogPost(db, partner.id);
    if (result) generated++;
  }

  logger.info({ generated, total: allPartners.size }, "Partner content generation cycle complete");
  return generated;
}
