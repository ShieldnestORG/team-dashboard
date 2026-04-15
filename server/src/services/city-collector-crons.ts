/**
 * City Collector cron scheduler — weekly refresh of partner cities.
 *
 * Runs Monday at 4:13am local. For each partner_companies.location we can
 * parse into a city, re-collect if the cached row is stale
 * (fresh_until < now). Bursty on Monday morning, quiet the rest of the week.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { partnerCompanies, cityIntelligence } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { collectCity, buildCitySlug } from "./city-collector.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

async function refreshPartnerCities(db: Db): Promise<{
  attempted: number;
  refreshed: number;
  skipped: number;
  failed: number;
}> {
  const partners = (await db
    .select({ location: partnerCompanies.location })
    .from(partnerCompanies)
    .where(sql`${partnerCompanies.location} IS NOT NULL AND ${partnerCompanies.location} <> ''`)) as Array<{
    location: string | null;
  }>;

  const seen = new Set<string>();
  let attempted = 0;
  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of partners) {
    if (!p.location) continue;
    const [cityPart, regionPart] = p.location.split(",").map((s) => s.trim());
    if (!cityPart) continue;
    const slug = buildCitySlug({ city: cityPart, region: regionPart, country: "US" });
    if (seen.has(slug)) continue;
    seen.add(slug);
    attempted++;

    const existing = (await db
      .select({ freshUntil: cityIntelligence.freshUntil })
      .from(cityIntelligence)
      .where(
        sql`${cityIntelligence.companyId} = ${COMPANY_ID} AND ${cityIntelligence.slug} = ${slug}`,
      )
      .limit(1)) as Array<{ freshUntil: Date | null }>;

    const row = existing[0];
    const now = new Date();
    if (row?.freshUntil && row.freshUntil > now) {
      skipped++;
      continue;
    }

    try {
      const result = await collectCity(db, {
        city: cityPart,
        region: regionPart ?? null,
        country: "US",
      });
      if (result.status === "ready") refreshed++;
      else failed++;
    } catch (err) {
      logger.warn({ err, slug }, "cities:refresh-partners: city collect failed");
      failed++;
    }
  }

  return { attempted, refreshed, skipped, failed };
}

export function startCityCollectorCrons(db: Db): void {
  registerCronJob({
    jobName: "cities:refresh-partners",
    schedule: "13 4 * * 1",
    ownerAgent: "echo",
    sourceFile: "city-collector-crons.ts",
    handler: async () => {
      return await refreshPartnerCities(db);
    },
  });

  logger.info({ count: 1 }, "City collector cron jobs registered");
}
