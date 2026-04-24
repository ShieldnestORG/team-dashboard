import { eq, and, inArray } from "drizzle-orm";
import { partnerCompanies, createDb } from "@paperclipai/db";

const COMPANY_ID = "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";
const SLUGS = [
  "sacred-wild",
  "artisan-metal-works",
  "tokns",
  "mark-joseph-jr-co",
  "house-of-exegesis",
  "exegesis-ventures",
  "get-probed",
];

const db = createDb(process.env.DATABASE_URL!);
const rows = await db
  .select()
  .from(partnerCompanies)
  .where(
    and(
      eq(partnerCompanies.companyId, COMPANY_ID),
      inArray(partnerCompanies.slug, SLUGS),
    ),
  );

for (const r of rows) {
  console.log(`\n=== ${r.slug} (#${r.featuredOrder}, status=${r.status}, featured=${r.featured}) ===`);
  console.log(`  industry: ${r.industry}`);
  console.log(`  location: ${r.location ?? "—"}`);
  console.log(`  tagline: ${r.tagline ?? "—"}`);
  console.log(`  description: ${(r.description ?? "—").slice(0, 120)}${(r.description ?? "").length > 120 ? "…" : ""}`);
  console.log(`  services: ${JSON.stringify(r.services)}`);
  console.log(`  logoUrl: ${r.logoUrl ?? "—"}`);
  console.log(`  brandColors: ${JSON.stringify(r.brandColors)}`);
  console.log(`  targetKeywords: ${JSON.stringify(r.targetKeywords)}`);
  console.log(`  onboardingStatus: ${r.onboardingStatus}, error: ${r.onboardingError ?? "—"}`);
}
process.exit(0);
