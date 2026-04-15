import { eq, and, sql, inArray, asc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { partnerCompanies } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { getCityContextForPartner } from "./city-collector.js";

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

// Brand → allowed industry set. undefined means no restriction.
const BRAND_INDUSTRY_ALLOW: Record<string, string[] | undefined> = {
  cd: undefined, // all partners
  directory: undefined, // all partners
  tokns: ["tech", "auto", "retail"], // crypto/fintech-adjacent — keep partners relevant; finance-type industries
  tx: ["tech", "auto", "retail"],
  shieldnest: ["tech", "education", "realestate"],
};

// Tag-level filter for brands with tighter restrictions.
// Partners whose `industry` field maps to a conceptually matching tag set.
const BRAND_INDUSTRY_TAGS: Record<string, string[]> = {
  tokns: ["crypto", "fintech", "defi", "blockchain", "nft", "tech", "auto", "retail"],
  tx: ["crypto", "fintech", "defi", "blockchain", "nft", "tech"],
  shieldnest: ["tech", "security", "privacy", "devtools", "saas", "education"],
};

/**
 * Returns true if a partner's industry is allowed for the given brand.
 * - cd / directory / default: all partners pass
 * - tokns / tx: only tech/finance-adjacent industries
 * - shieldnest: only tech/security-adjacent industries
 */
function isBrandMatch(industry: string, brand?: string): boolean {
  if (!brand || brand === "cd" || brand === "directory") return true;

  const allowed = BRAND_INDUSTRY_TAGS[brand];
  if (!allowed) return true; // unknown brand → allow all

  const industryLower = industry.toLowerCase();
  // Direct industry name match or keyword overlap
  return allowed.some((tag) => industryLower.includes(tag) || tag.includes(industryLower));
}

/**
 * Find active partners whose industry matches the given topic keywords.
 * When `brand` is provided, further restrict to partners relevant to that brand.
 * Returns least-mentioned partners first for fair rotation.
 */
export async function findRelevantPartners(
  db: Db,
  topic: string,
  brand?: string,
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
    .limit(limit * 4); // over-fetch so brand filter has candidates to work with

  // Apply brand filter in-memory (industry is a plain text column, not jsonb)
  const filtered = brand
    ? partners.filter((p) => isBrandMatch(p.industry, brand))
    : partners;

  return filtered.slice(0, limit);
}

/**
 * Build a partner mention context string for injection into content prompts.
 * `brand` is accepted for future per-brand customisation of the CTA text.
 */
export function buildPartnerContext(
  partners: (typeof partnerCompanies.$inferSelect)[],
  brand?: string, // eslint-disable-line @typescript-eslint/no-unused-vars — reserved for future use
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
 *
 * @param brand - optional brand slug ('cd' | 'tokns' | 'tx' | 'shieldnest' | 'directory')
 *                When provided, restricts partners to those relevant to that brand's audience.
 */
export async function getPartnerInjection(
  db: Db,
  topic: string,
  brand?: string,
): Promise<string> {
  try {
    const partners = await findRelevantPartners(db, topic, brand);
    if (partners.length === 0) return "";

    const context = buildPartnerContext(partners, brand);

    // Track mentions for each partner
    for (const p of partners) {
      await trackPartnerMention(db, p.slug);
    }

    // Enrich with city intelligence for the first located partner that has
    // a collected city row. Keeps the prompt grounded in real local signals.
    let cityContext: string | null = null;
    for (const p of partners) {
      cityContext = await getCityContextForPartner(db, p.location).catch(() => null);
      if (cityContext) break;
    }

    logger.info(
      { partnerSlugs: partners.map((p) => p.slug), topic, brand, hasCityContext: Boolean(cityContext) },
      "Injected partner context into content prompt",
    );

    return cityContext ? `${context}\n\n${cityContext}` : context;
  } catch (err) {
    logger.error({ err, topic }, "Failed to build partner injection context");
    return "";
  }
}
