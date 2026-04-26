import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { socialAccounts, socialAutomations, systemCrons } from "@paperclipai/db";
import { JOB_DEFS, type ContentJobDef } from "../content-crons.js";
import { contentTypeToPlatform } from "./platform-map.js";
import { logger } from "../../middleware/logger.js";

// Resolve the social_account row that a given JOB_DEF posts to.
// Strategy: match (brand, platform[, xAccountSlug for X handles]).
async function resolveAccountId(db: Db, def: ContentJobDef, companyId: string): Promise<string | null> {
  const platform = contentTypeToPlatform(def.contentType);
  if (!platform) return null;
  const brand = def.brand ?? "cd";

  // For X, prefer matching on handle = xAccountSlug if provided.
  if (platform === "x" && def.xAccountSlug) {
    const rows = await db
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.companyId, companyId),
          eq(socialAccounts.brand, brand),
          eq(socialAccounts.platform, "x"),
          eq(socialAccounts.handle, def.xAccountSlug),
        ),
      )
      .limit(1);
    if (rows[0]) return rows[0].id;
  }

  const rows = await db
    .select({ id: socialAccounts.id })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.companyId, companyId),
        eq(socialAccounts.brand, brand),
        eq(socialAccounts.platform, platform),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

// Upsert one social_automations row per JOB_DEF, keyed by JOB_DEF.name (sourceRef).
// Pulls live runtime state (lastRunAt/nextRunAt/enabled) from system_crons.
export async function syncSocialAutomations(db: Db, companyId: string): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0;
  let skipped = 0;

  // Pre-fetch system_crons state for all known job names.
  const cronRows = await db
    .select({
      jobName: systemCrons.jobName,
      enabled: systemCrons.enabled,
      lastRunAt: systemCrons.lastRunAt,
      nextRunAt: systemCrons.nextRunAt,
    })
    .from(systemCrons);
  const cronByName = new Map(cronRows.map((r) => [r.jobName, r]));

  for (const def of JOB_DEFS) {
    const platform = contentTypeToPlatform(def.contentType);
    if (!platform) {
      skipped++;
      continue;
    }
    const accountId = await resolveAccountId(db, def, companyId);
    const live = cronByName.get(def.name);

    await db
      .insert(socialAutomations)
      .values({
        socialAccountId: accountId,
        kind: def.useContentBridge ? "cron_post" : "cron_post",
        cronExpr: def.schedule,
        personalityId: def.personality,
        contentType: def.contentType,
        sourceRef: def.name,
        enabled: live?.enabled ?? true,
        lastRunAt: live?.lastRunAt ? new Date(live.lastRunAt) : null,
        nextRunAt: live?.nextRunAt ? new Date(live.nextRunAt) : null,
        notes: def.topic ?? null,
      })
      .onConflictDoUpdate({
        target: socialAutomations.sourceRef,
        set: {
          socialAccountId: accountId,
          cronExpr: def.schedule,
          personalityId: def.personality,
          contentType: def.contentType,
          enabled: live?.enabled ?? true,
          lastRunAt: live?.lastRunAt ? new Date(live.lastRunAt) : null,
          nextRunAt: live?.nextRunAt ? new Date(live.nextRunAt) : null,
          notes: def.topic ?? null,
          updatedAt: sql`now()`,
        },
      });
    upserted++;
  }

  logger.info({ upserted, skipped }, "social_automations sync complete");
  return { upserted, skipped };
}
