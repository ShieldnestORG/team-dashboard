import { eq, and, sql, inArray, asc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { partnerCompanies } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  fitness: [
    "gym", "fitness", "workout", "exercise", "health", "wellness",
    "training", "muscle", "cardio", "strength", "weight", "body",
  ],
  dining: [
    "restaurant", "food", "dining", "eat", "meal", "cuisine",
    "chef", "menu", "cook",
  ],
  wellness: [
    "wellness", "meditation", "yoga", "mindfulness", "health",
    "self-care", "mental health", "therapy", "spa",
  ],
  auto: [
    "car", "auto", "vehicle", "mechanic", "repair", "oil change",
    "tire", "automotive",
  ],
  salon: [
    "hair", "salon", "beauty", "style", "barber", "spa", "nail", "skincare",
  ],
  retail: [
    "shop", "store", "buy", "product", "sale", "merchandise",
  ],
  tech: [
    "technology", "software", "app", "digital", "computer", "IT", "tech",
  ],
  realestate: [
    "real estate", "property", "home", "house", "apartment", "rent", "mortgage",
  ],
  education: [
    "education", "learning", "school", "course", "training", "class", "tutor",
  ],
};

/**
 * Find active partners whose industry matches the given topic keywords.
 * Returns least-mentioned partners first for fair rotation.
 */
export async function findRelevantPartners(
  db: Db,
  topic: string,
  limit = 2,
) {
  const topicLower = topic.toLowerCase();

  // Determine which industries match the topic
  const matchedIndustries: string[] = [];
  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (keywords.some((kw) => topicLower.includes(kw))) {
      matchedIndustries.push(industry);
    }
  }

  if (matchedIndustries.length === 0) {
    return [];
  }

  const partners = await db
    .select()
    .from(partnerCompanies)
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        inArray(partnerCompanies.status, ["trial", "active"]),
        inArray(partnerCompanies.industry, matchedIndustries),
      ),
    )
    .orderBy(asc(partnerCompanies.contentMentions))
    .limit(limit);

  return partners;
}

/**
 * Build a partner mention context string for injection into content prompts.
 */
export function buildPartnerContext(
  partners: (typeof partnerCompanies.$inferSelect)[],
): string {
  if (partners.length === 0) return "";

  const partnerLines = partners
    .map((p) => {
      const servicesStr =
        p.description ||
        (p.services && p.services.length > 0
          ? p.services.join(", ")
          : "local business");
      const hasMicrosite = p.siteUrl && p.siteDeployStatus === "deployed";
      const redirectLink = hasMicrosite
        ? `https://coherencedaddy.com/go/${p.slug}?src=cd`
        : `https://coherencedaddy.com/go/${p.slug}`;
      const micrositeNote = hasMicrosite
        ? ` Check out their dedicated page at ${p.siteUrl}.`
        : "";
      return `- ${p.name} (${p.industry}, ${p.location || "local"}): ${servicesStr}. Website: ${p.website || "N/A"}.${micrositeNote} Redirect link: ${redirectLink}`;
    })
    .join("\n");

  return `\n\n--- PARTNER MENTIONS ---
When relevant and natural, include a mention of these local businesses in your content:
${partnerLines}

Guidelines for partner mentions:
- Only mention if genuinely relevant to the topic
- Keep mentions natural — don't force them
- Use the redirect link (coherencedaddy.com/go/slug) instead of their direct website
- If the partner has a dedicated microsite, link to it rather than their main website
- Include the tracked redirect link: https://coherencedaddy.com/go/{slug}?src=cd
- Maximum 1-2 partner mentions per piece of content
- For blog posts: mention in a relevant paragraph or "recommended" section
- For tweets: only mention if directly relevant (don't dilute the tweet)
--- END PARTNER MENTIONS ---`;
}

/**
 * Increment the contentMentions counter for a partner by slug.
 */
export async function trackPartnerMention(db: Db, partnerSlug: string) {
  await db
    .update(partnerCompanies)
    .set({
      contentMentions: sql`${partnerCompanies.contentMentions} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        eq(partnerCompanies.slug, partnerSlug),
      ),
    );
}

/**
 * Main entry point: find relevant partners for a topic, build the prompt
 * injection context, and track mentions. Returns empty string if no
 * partners match.
 */
export async function getPartnerInjection(
  db: Db,
  topic: string,
): Promise<string> {
  try {
    const partners = await findRelevantPartners(db, topic);
    if (partners.length === 0) return "";

    const context = buildPartnerContext(partners);

    // Track mentions for each partner
    for (const p of partners) {
      await trackPartnerMention(db, p.slug);
    }

    logger.info(
      { partnerSlugs: partners.map((p) => p.slug), topic },
      "Injected partner context into content prompt",
    );

    return context;
  } catch (err) {
    logger.error({ err, topic }, "Failed to build partner injection context");
    return "";
  }
}
