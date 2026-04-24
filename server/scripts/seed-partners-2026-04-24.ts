/**
 * Seed Free / Featured Partners — 2026-04-24
 *
 * Adds 7 partner companies as free, active, homepage-featured partners.
 * Idempotent: skips any slug that already exists. After insert, runs the
 * onboarding pipeline (scrape → industry classify → description → logo)
 * sequentially for each new row.
 *
 * Usage:
 *   cd server && npx tsx scripts/seed-partners-2026-04-24.ts
 *
 * Requires DATABASE_URL (and FIRECRAWL_URL / Ollama envs for onboarding).
 */

import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { partnerCompanies, createDb } from "@paperclipai/db";
import { runPartnerOnboarding } from "../src/services/partner-onboarding.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ??
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// industry is required (NOT NULL); onboarding will reclassify against the
// KNOWN_INDUSTRIES list. We seed with a best-guess starting value.
type Seed = {
  name: string;
  slug: string;
  website: string;
  industry: string;
};

const SEEDS: Seed[] = [
  { name: "Sacred Wild",        slug: "sacred-wild",        website: "https://sacredwild.shop",      industry: "wellness" },
  { name: "Artisan Metal Works", slug: "artisan-metal-works", website: "https://artisanmetal.works",  industry: "retail"   },
  { name: "Tokns",              slug: "tokns",              website: "https://tokns.fi",             industry: "tech"     },
  { name: "Mark Joseph Jr Co",  slug: "mark-joseph-jr-co",  website: "https://markjosephjrco.com",   industry: "tech"     },
  { name: "House of Exegesis",  slug: "house-of-exegesis",  website: "https://houseofexegesis.com",  industry: "education"},
  { name: "Exegesis Ventures",  slug: "exegesis-ventures",  website: "https://exegesisventures.com", industry: "tech"     },
  { name: "Get Probed",         slug: "get-probed",         website: "https://getprobed.org",        industry: "wellness" },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const db = createDb(process.env.DATABASE_URL);

  // Determine starting featuredOrder so we don't collide with existing
  // featured partners.
  const existingFeatured = await db
    .select({
      slug: partnerCompanies.slug,
      featuredOrder: partnerCompanies.featuredOrder,
    })
    .from(partnerCompanies)
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        eq(partnerCompanies.featured, true),
      ),
    );
  const maxOrder = existingFeatured.reduce(
    (max, r) => Math.max(max, r.featuredOrder ?? 0),
    0,
  );

  const inserted: { slug: string; website: string }[] = [];

  for (let i = 0; i < SEEDS.length; i++) {
    const seed = SEEDS[i];

    const [existing] = await db
      .select({ id: partnerCompanies.id, featured: partnerCompanies.featured })
      .from(partnerCompanies)
      .where(
        and(
          eq(partnerCompanies.companyId, COMPANY_ID),
          eq(partnerCompanies.slug, seed.slug),
        ),
      )
      .limit(1);

    if (existing) {
      console.log(`[skip] ${seed.slug} — already exists`);
      continue;
    }

    const dashboardToken = randomUUID();
    const featuredOrder = maxOrder + i + 1;

    await db.insert(partnerCompanies).values({
      companyId: COMPANY_ID,
      slug: seed.slug,
      name: seed.name,
      industry: seed.industry,
      website: seed.website,
      tier: "proof",
      status: "active",
      monthlyFee: null,
      referralFeePerClient: null,
      featured: true,
      featuredOrder,
      dashboardToken,
      onboardingStatus: "pending",
    });

    console.log(
      `[insert] ${seed.slug} — featured#${featuredOrder} — ${seed.website}`,
    );
    inserted.push({ slug: seed.slug, website: seed.website });
  }

  if (inserted.length === 0) {
    console.log("Nothing to onboard. Done.");
    return;
  }

  console.log(`\nRunning onboarding pipeline for ${inserted.length} partners…`);
  for (const row of inserted) {
    try {
      console.log(`  • ${row.slug}: scraping ${row.website}`);
      await runPartnerOnboarding(db, row.slug);
      console.log(`  ✓ ${row.slug}: onboarding complete`);
    } catch (err) {
      console.error(`  ✗ ${row.slug}: onboarding failed —`, (err as Error).message);
    }
  }

  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
