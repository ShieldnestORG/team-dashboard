/**
 * Synthesize Partner Logos — 2026-04-24
 *
 * For partners whose websites expose no usable logo asset (favicon returns
 * SPA HTML or 404, no og:image, no apple-touch-icon), generate a clean
 * initials-based avatar via ui-avatars.com using a thematic color picked
 * from the partner's industry + services. Also sets a derived 3-color
 * brandColors palette.
 *
 * Idempotent: only updates partners whose logoUrl currently points at the
 * domain root favicon (i.e. our earlier favicon-fallback). Pass --force
 * to overwrite anything.
 *
 * Usage:
 *   cd server && npx tsx scripts/synthesize-partner-logos.ts [--force]
 */

import { eq, and, inArray } from "drizzle-orm";
import { partnerCompanies, createDb } from "@paperclipai/db";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ??
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

const FORCE = process.argv.includes("--force");

// Thematic primary color picked per partner based on their industry,
// services, and brand voice (from the LLM-generated description /
// tagline). Hand-picked to feel intentional rather than random.
const THEMATIC: Record<string, string> = {
  "sacred-wild":        "#7C3AED", // violet — ritual / wellness / fire
  "house-of-exegesis":  "#4F46E5", // indigo — digital church / flow-state
  "exegesis-ventures":  "#0F766E", // teal — AI / robotics / future-tech
  "mark-joseph-jr-co":  "#1E40AF", // royal blue — cybersecurity / trust
  "get-probed":         "#9333EA", // magenta-violet — cosmic / playa art
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace(/^#/, "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function darken(hex: string, amount = 0.15): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}
function complementary(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  // Rotate hue 180° via simple RGB inversion shift then re-tint to keep saturation reasonable.
  return rgbToHex(255 - r, 255 - g, 255 - b);
}

function buildAvatarUrl(name: string, primaryHex: string): string {
  const bg = primaryHex.replace(/^#/, "");
  const params = new URLSearchParams({
    name,
    size: "256",
    background: bg,
    color: "fff",
    bold: "true",
    format: "png",
  });
  return `https://ui-avatars.com/api/?${params.toString()}`;
}

function isSyntheticEligible(partner: typeof partnerCompanies.$inferSelect): boolean {
  if (!partner.logoUrl) return true;
  // Favicon fallback at the domain root is what we set when nothing better was found.
  if (/\/favicon\.ico$/.test(partner.logoUrl)) return true;
  return false;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const db = createDb(process.env.DATABASE_URL);

  const slugs = Object.keys(THEMATIC);
  const rows = await db
    .select()
    .from(partnerCompanies)
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        inArray(partnerCompanies.slug, slugs),
      ),
    );

  for (const partner of rows) {
    console.log(`\n=== ${partner.slug} ===`);
    const eligible = FORCE || isSyntheticEligible(partner);
    if (!eligible) {
      console.log(`  skip — already has a real logo: ${partner.logoUrl}`);
      continue;
    }

    const primary = THEMATIC[partner.slug];
    if (!primary) {
      console.log("  skip — no thematic color mapped");
      continue;
    }

    const logoUrl = buildAvatarUrl(partner.name, primary);
    const brandColors = {
      primary,
      secondary: darken(primary, 0.18),
      accent: complementary(primary),
    };

    console.log(`  logo: ${logoUrl}`);
    console.log(`  colors: ${JSON.stringify(brandColors)}`);

    await db
      .update(partnerCompanies)
      .set({
        logoUrl,
        brandColors,
        updatedAt: new Date(),
      })
      .where(eq(partnerCompanies.id, partner.id));
    console.log("  ✓ updated");
  }

  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
