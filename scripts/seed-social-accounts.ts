/**
 * Seed social_accounts from known sources:
 *   - x_oauth_tokens (one row per account_slug)
 *   - canva_oauth_tokens
 *   - hardcoded list of public-facing handles advertised on
 *     coherencedaddy-landing/components/sticky-footer.tsx and elsewhere.
 *
 * Idempotent: skips rows where (companyId, brand, platform, handle) already exists.
 *
 * Usage:
 *   npx tsx scripts/seed-social-accounts.ts
 */

import { and, eq } from "drizzle-orm";
import {
  createDb,
  socialAccounts,
  xOauthTokens,
  canvaOauthTokens,
} from "@paperclipai/db";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID ?? "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

interface Seed {
  brand: string;
  platform: string;
  handle: string;
  displayName?: string;
  profileUrl?: string;
  connectionType?: "oauth" | "api_key" | "manual" | "none";
  oauthRef?: string;
  status?: "active" | "dormant" | "paused" | "deprecated";
  automationMode?: "full_auto" | "assisted" | "manual" | "none";
  automationNotes?: string;
  tags?: string[];
}

// Public-facing handles from coherencedaddy-landing footer + known accounts.
const STATIC_SEEDS: Seed[] = [
  { brand: "cd", platform: "x", handle: "coherencedaddy", profileUrl: "https://x.com/coherencedaddy", connectionType: "oauth", oauthRef: "x_oauth_tokens:coherencedaddy", automationMode: "full_auto", automationNotes: "AEO push crons (aeo-tips-cd, directory-spotlight-cd, blog-link-push-cd)" },
  { brand: "cd", platform: "discord", handle: "TtaK7WTP5", profileUrl: "https://discord.gg/TtaK7WTP5", connectionType: "manual", automationMode: "assisted", automationNotes: "content:discord cron generates posts; manual paste" },
  { brand: "cd", platform: "github", handle: "Coherence-Daddy", profileUrl: "https://github.com/Coherence-Daddy", connectionType: "manual", automationMode: "manual", automationNotes: "Public share-ready content org" },
  { brand: "cd", platform: "reddit", handle: "tbd", connectionType: "manual", automationMode: "assisted", automationNotes: "content:reddit cron generates drafts; manual post" },
  { brand: "cd", platform: "linkedin", handle: "tbd", connectionType: "manual", automationMode: "assisted", automationNotes: "content:linkedin cron generates drafts; manual post" },
  { brand: "cd", platform: "bluesky", handle: "tbd", connectionType: "manual", automationMode: "assisted", automationNotes: "content:bluesky cron generates drafts" },
  { brand: "cd", platform: "instagram", handle: "tbd", connectionType: "manual", automationMode: "manual" },
  { brand: "cd", platform: "facebook", handle: "tbd", connectionType: "manual", automationMode: "manual" },
  { brand: "cd", platform: "tiktok", handle: "tbd", connectionType: "manual", automationMode: "manual" },
  { brand: "cd", platform: "devto", handle: "tbd", connectionType: "manual", automationMode: "manual" },
  { brand: "cd", platform: "hn", handle: "tbd", connectionType: "manual", automationMode: "manual" },
  { brand: "cd", platform: "substack", handle: "tbd", connectionType: "manual", automationMode: "manual", tags: ["wishlist"] },
  { brand: "cd", platform: "skool", handle: "tbd", connectionType: "manual", automationMode: "manual", tags: ["wishlist"] },
  { brand: "cd", platform: "youtube", handle: "tbd", connectionType: "manual", automationMode: "assisted", automationNotes: "content:video:* crons generate scripts; pipeline produces videos" },
  // tokns brand
  { brand: "tokns", platform: "x", handle: "primary", connectionType: "oauth", oauthRef: "x_oauth_tokens:primary", automationMode: "full_auto", automationNotes: "content:xrp:twitter, content:xrp-alert:twitter (Vanguard)" },
  // tx brand
  { brand: "tx", platform: "x", handle: "tbd", connectionType: "manual", automationMode: "manual" },
];

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is required. Set it in .env or as an environment variable.");
    process.exit(1);
  }
  const db = createDb(dbUrl);
  let inserted = 0;
  let skipped = 0;

  // 1. Static seeds
  for (const s of STATIC_SEEDS) {
    const existing = await db
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.companyId, COMPANY_ID),
          eq(socialAccounts.brand, s.brand),
          eq(socialAccounts.platform, s.platform),
          eq(socialAccounts.handle, s.handle),
        ),
      )
      .limit(1);
    if (existing[0]) {
      skipped++;
      continue;
    }
    await db.insert(socialAccounts).values({
      companyId: COMPANY_ID,
      brand: s.brand,
      platform: s.platform,
      handle: s.handle,
      displayName: s.displayName ?? null,
      profileUrl: s.profileUrl ?? null,
      connectionType: s.connectionType ?? "manual",
      oauthRef: s.oauthRef ?? null,
      status: s.status ?? "active",
      automationMode: s.automationMode ?? "manual",
      automationNotes: s.automationNotes ?? null,
      tags: s.tags ?? [],
    });
    inserted++;
  }

  // 2. Each x_oauth_tokens row → ensure a matching social_accounts row.
  const xRows = await db
    .select({
      accountSlug: xOauthTokens.accountSlug,
      xUsername: xOauthTokens.xUsername,
      companyId: xOauthTokens.companyId,
    })
    .from(xOauthTokens);
  for (const r of xRows) {
    if (r.companyId !== COMPANY_ID) continue;
    const handle = r.xUsername || r.accountSlug;
    const existing = await db
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.companyId, COMPANY_ID),
          eq(socialAccounts.platform, "x"),
          eq(socialAccounts.handle, handle),
        ),
      )
      .limit(1);
    if (existing[0]) {
      skipped++;
      continue;
    }
    await db.insert(socialAccounts).values({
      companyId: COMPANY_ID,
      brand: r.accountSlug === "coherencedaddy" ? "cd" : "tokns",
      platform: "x",
      handle,
      displayName: r.xUsername,
      profileUrl: `https://x.com/${r.xUsername}`,
      connectionType: "oauth",
      oauthRef: `x_oauth_tokens:${r.accountSlug}`,
      status: "active",
      automationMode: "full_auto",
      tags: ["from-oauth-token"],
    });
    inserted++;
  }

  // 3. canva_oauth_tokens — design tool, not a "social" but worth tracking.
  const canvaRows = await db
    .select({ id: canvaOauthTokens.id, companyId: canvaOauthTokens.companyId })
    .from(canvaOauthTokens);
  for (const r of canvaRows) {
    if (r.companyId !== COMPANY_ID) continue;
    const existing = await db
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.companyId, COMPANY_ID),
          eq(socialAccounts.platform, "canva"),
        ),
      )
      .limit(1);
    if (existing[0]) {
      skipped++;
      continue;
    }
    // canva isn't in PLATFORMS list, but we still seed it for completeness.
    await db.insert(socialAccounts).values({
      companyId: COMPANY_ID,
      brand: "cd",
      platform: "canva",
      handle: "primary",
      connectionType: "oauth",
      oauthRef: `canva_oauth_tokens:${r.id}`,
      status: "active",
      automationMode: "manual",
      automationNotes: "Design tool — used by visual content pipeline",
      tags: ["design-tool"],
    });
    inserted++;
  }

  console.log(`Seed complete — inserted=${inserted} skipped=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
