/**
 * Ecosystem partners + free Watchtower — 2026-10-11
 *
 * Owner, 2026-10-11: "make all of these partner companies on our coherencedaddy put them on
 * the watchtower for free, partner network". "These" = Starwise Ventures, Exegesis Ventures,
 * Mark Joseph Jr Co and Upright Prospects (company sites rebuilt 2026-10-10/11).
 *
 * 1. Partner Network: adds starwise-ventures and upright-prospects as free, active, featured
 *    proof-tier partners, the same shape seed-partners-2026-04-24.ts used. exegesis-ventures and
 *    mark-joseph-jr-co are already free featured partners from that seed and are left alone.
 *    Copy, keywords and logos come from each company's own site rather than the AI onboarding
 *    pipeline, so onboarding is marked complete. For Firecrawl competitor baselines later, run
 *    retry-partner-onboarding.ts; note it overwrites the tagline.
 * 2. Watchtower: one comped subscription per brand (status active, no Stripe ids, the same shape
 *    as the Rogue Defender subscription), weekly, plus prompt version 1, as
 *    watchtower-stripe-handler.ts does for a paid signup. Digests go to info@<domain>.
 *    Prompts are discovery questions that never name the brand: Watchtower counts a mention
 *    when the brand name or domain appears in the answer, so a question that names the brand
 *    would count the engine repeating the question.
 *
 * Idempotent: a partner slug, or a Watchtower subscription for the same domain, is skipped.
 * Dry run by default; pass --apply to write.
 *
 * Usage:
 *   cd server && npx tsx scripts/seed-ecosystem-partners-2026-10-11.ts          # dry run
 *   cd server && npx tsx scripts/seed-ecosystem-partners-2026-10-11.ts --apply  # write
 *
 * Requires DATABASE_URL.
 */

import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  createDb,
  partnerCompanies,
  watchtowerPromptVersions,
  watchtowerSubscriptions,
} from "@paperclipai/db";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ?? "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";
const APPLY = process.argv.includes("--apply");
const ACTOR_LABEL = "seed-ecosystem-partners-2026-10-11";

// The four company sites share one palette (the evntrace design system tokens).
const BRAND_COLORS = { primary: "#0E0E10", secondary: "#F8F7F4", accent: "#FF6B4A" };

type PartnerSeed = {
  slug: string;
  name: string;
  industry: string; // one of KNOWN_INDUSTRIES in services/partner-onboarding.ts
  website: string;
  contactEmail: string;
  tagline: string;
  description: string;
  services: string[];
  targetKeywords: string[];
  logoUrl: string;
};

const PARTNERS: PartnerSeed[] = [
  {
    slug: "starwise-ventures",
    name: "Starwise Ventures",
    industry: "tech",
    website: "https://starwiseventures.com",
    contactEmail: "info@starwiseventures.com",
    tagline: "Software built for stewardship, not speculation.",
    description:
      "Starwise Ventures builds focused software made to stay useful for a long time, including Evntrace, Coherence Daddy, tokns and Cliqs. Building since 2023.",
    services: ["Software development", "Long-term product stewardship"],
    targetKeywords: [
      "Starwise Ventures",
      "software built for stewardship",
      "Evntrace",
      "tokns",
      "Cliqs",
    ],
    logoUrl: "https://starwiseventures.com/brand/starwise-mark.png",
  },
  {
    slug: "upright-prospects",
    name: "Upright Prospects",
    industry: "realestate",
    website: "https://uprightprospectsllc.com",
    contactEmail: "info@uprightprospectsllc.com",
    tagline: "Buying homes, building affordable living.",
    description:
      "Upright Prospects LLC buys homes and turns them into affordable places to live. Selling a house, or looking for an affordable home? Get in touch.",
    services: ["Home buying", "Affordable living"],
    targetKeywords: [
      "Upright Prospects",
      "we buy houses",
      "sell my house",
      "affordable living",
      "affordable homes",
    ],
    logoUrl: "https://uprightprospectsllc.com/brand/upright-mark.png",
  },
];

type WatchtowerSeed = { brandName: string; domain: string; email: string; prompts: string[] };

const WATCHTOWER: WatchtowerSeed[] = [
  {
    brandName: "Starwise Ventures",
    domain: "starwiseventures.com",
    email: "info@starwiseventures.com",
    prompts: [
      "Which companies build software for stewardship rather than speculation?",
      "Who builds Evntrace, tokns and Cliqs?",
      "What small software companies build long-lasting tools without ad-driven engagement?",
      "Who is behind the Coherence Daddy software?",
      "Recommend a software company that builds tools for the TX blockchain.",
    ],
  },
  {
    brandName: "Exegesis Ventures",
    domain: "exegesisventures.com",
    email: "info@exegesisventures.com",
    prompts: [
      "Which organizations are working to preserve humanity as AI and robotics reshape the world?",
      "Who is studying the shift from biology to silicon-powered AI?",
      "What ventures focus on keeping human values at the center of AI development?",
      "Which groups use data and technology to protect human dignity in the age of AI?",
      "Recommend organizations building technology that serves communities, not only markets.",
    ],
  },
  {
    brandName: "Mark Joseph Jr Co",
    domain: "markjosephjrco.com",
    email: "info@markjosephjrco.com",
    prompts: [
      "Who offers hands-on computer security help for individuals and small organizations?",
      "Which organizations combine community aid with cybersecurity training?",
      "Where can people learn computer and security skills from a community-focused company?",
      "Recommend a small company that helps neighborhoods with technology and security.",
      "Who helps small organizations protect their devices, accounts and data?",
    ],
  },
  {
    brandName: "Upright Prospects",
    domain: "uprightprospectsllc.com",
    email: "info@uprightprospectsllc.com",
    prompts: [
      "Which companies buy houses and turn them into affordable places to live?",
      "I want to sell my house to a company focused on affordable living. Who should I contact?",
      "What real estate companies work on affordable housing for working people?",
      "Who buys homes to provide affordable living for others?",
      "Recommend a fair, plain-dealing home buyer that keeps homes affordable.",
    ],
  },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = createDb(process.env.DATABASE_URL);
  console.log(APPLY ? "Mode: APPLY (writing)" : "Mode: dry run (pass --apply to write)");

  // ── 1. Partner Network ─────────────────────────────────────────────────────
  const featured = await db
    .select({ featuredOrder: partnerCompanies.featuredOrder })
    .from(partnerCompanies)
    .where(and(eq(partnerCompanies.companyId, COMPANY_ID), eq(partnerCompanies.featured, true)));
  let nextOrder = featured.reduce((max, r) => Math.max(max, r.featuredOrder ?? 0), 0);

  const existingSlugs = new Set(
    (
      await db
        .select({ slug: partnerCompanies.slug })
        .from(partnerCompanies)
        .where(
          and(
            eq(partnerCompanies.companyId, COMPANY_ID),
            inArray(
              partnerCompanies.slug,
              PARTNERS.map((p) => p.slug),
            ),
          ),
        )
    ).map((r) => r.slug),
  );

  for (const p of PARTNERS) {
    if (existingSlugs.has(p.slug)) {
      console.log(`[partner skip] ${p.slug}: already exists`);
      continue;
    }
    nextOrder += 1;
    console.log(`[partner ${APPLY ? "insert" : "would insert"}] ${p.slug}: featured #${nextOrder}, ${p.website}`);
    if (!APPLY) continue;
    const now = new Date();
    await db.insert(partnerCompanies).values({
      companyId: COMPANY_ID,
      slug: p.slug,
      name: p.name,
      industry: p.industry,
      website: p.website,
      contactEmail: p.contactEmail,
      description: p.description,
      tagline: p.tagline,
      services: p.services,
      targetKeywords: p.targetKeywords,
      logoUrl: p.logoUrl,
      brandColors: BRAND_COLORS,
      tier: "proof",
      status: "active",
      monthlyFee: null,
      referralFeePerClient: null,
      featured: true,
      featuredOrder: nextOrder,
      dashboardToken: randomUUID(),
      onboardingStatus: "complete",
      onboardingCompletedAt: now,
    });
  }

  // ── 2. Watchtower (comped, no Stripe) ──────────────────────────────────────
  const existingDomains = new Set(
    (
      await db
        .select({ domain: watchtowerSubscriptions.domain })
        .from(watchtowerSubscriptions)
        .where(
          inArray(
            watchtowerSubscriptions.domain,
            WATCHTOWER.map((w) => w.domain),
          ),
        )
    ).map((r) => r.domain),
  );

  for (const w of WATCHTOWER) {
    if (existingDomains.has(w.domain)) {
      console.log(`[watchtower skip] ${w.domain}: a subscription already exists`);
      continue;
    }
    console.log(`[watchtower ${APPLY ? "insert" : "would insert"}] ${w.brandName} (${w.domain}): ${w.prompts.length} prompts, digest to ${w.email}`);
    if (!APPLY) continue;
    const [row] = await db
      .insert(watchtowerSubscriptions)
      .values({
        brandName: w.brandName,
        domain: w.domain,
        prompts: w.prompts,
        status: "active",
        frequency: "weekly",
        plan: "watchtower_monthly",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        email: w.email,
      })
      .returning({ id: watchtowerSubscriptions.id });
    await db.insert(watchtowerPromptVersions).values({
      subscriptionId: row!.id,
      prompts: w.prompts,
      createdByActorType: "system",
      createdByActorLabel: ACTOR_LABEL,
    });
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
