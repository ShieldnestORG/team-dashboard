import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { ownedSites, ownedSiteMetrics } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Owned utility-site registry + metrics aggregation.
// Mirrors the structure of creditscore.ts / bundle-entitlements.ts.
// ---------------------------------------------------------------------------

export type OwnedSiteStatus =
  | "building"
  | "live"
  | "adsense_pending"
  | "monetized"
  | "killed";

export interface CreateSiteArgs {
  companyId: string;
  slug: string;
  domain: string;
  displayName: string;
  primaryTool?: string;
  niche?: string;
  status?: OwnedSiteStatus;
  adsenseAccountId?: string;
  gaPropertyId?: string;
  gscSiteUrl?: string;
  notes?: string;
}

export interface SiteRollup {
  siteId: string;
  sessions30d: number;
  pageviews30d: number;
  adRevenueCents30d: number;
  adImpressions30d: number;
  rpmCentsAvg30d: number;
  outboundToCoherence30d: number;
  outboundToTokns30d: number;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function ownedSitesService(db: Db) {
  async function listSites(companyId: string) {
    const sites = await db
      .select()
      .from(ownedSites)
      .where(eq(ownedSites.companyId, companyId))
      .orderBy(desc(ownedSites.createdAt));

    if (sites.length === 0) return [];

    const since = isoDaysAgo(30);
    const rollups = await db
      .select({
        siteId: ownedSiteMetrics.siteId,
        sessions: sql<number>`COALESCE(SUM(${ownedSiteMetrics.sessions}), 0)::int`,
        pageviews: sql<number>`COALESCE(SUM(${ownedSiteMetrics.pageviews}), 0)::int`,
        adRevenueCents: sql<number>`COALESCE(SUM(${ownedSiteMetrics.adRevenueCents}), 0)::int`,
        adImpressions: sql<number>`COALESCE(SUM(${ownedSiteMetrics.adImpressions}), 0)::int`,
        rpmAvg: sql<number>`COALESCE(AVG(${ownedSiteMetrics.rpmCents}), 0)::int`,
        outboundCD: sql<number>`COALESCE(SUM(${ownedSiteMetrics.outboundClicksToCoherence}), 0)::int`,
        outboundTokns: sql<number>`COALESCE(SUM(${ownedSiteMetrics.outboundClicksToTokns}), 0)::int`,
      })
      .from(ownedSiteMetrics)
      .where(gte(ownedSiteMetrics.date, since))
      .groupBy(ownedSiteMetrics.siteId);

    const byId = new Map<string, (typeof rollups)[number]>();
    for (const r of rollups) byId.set(r.siteId, r);

    return sites.map((s) => {
      const r = byId.get(s.id);
      const rollup: SiteRollup = {
        siteId: s.id,
        sessions30d: r?.sessions ?? 0,
        pageviews30d: r?.pageviews ?? 0,
        adRevenueCents30d: r?.adRevenueCents ?? 0,
        adImpressions30d: r?.adImpressions ?? 0,
        rpmCentsAvg30d: r?.rpmAvg ?? 0,
        outboundToCoherence30d: r?.outboundCD ?? 0,
        outboundToTokns30d: r?.outboundTokns ?? 0,
      };
      return { ...s, rollup };
    });
  }

  async function getSiteBySlug(companyId: string, slug: string) {
    const rows = await db
      .select()
      .from(ownedSites)
      .where(and(eq(ownedSites.companyId, companyId), eq(ownedSites.slug, slug)))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getSiteDetail(companyId: string, slug: string, rangeDays = 90) {
    const site = await getSiteBySlug(companyId, slug);
    if (!site) return null;

    const since = isoDaysAgo(rangeDays);
    const series = await db
      .select()
      .from(ownedSiteMetrics)
      .where(
        and(eq(ownedSiteMetrics.siteId, site.id), gte(ownedSiteMetrics.date, since)),
      )
      .orderBy(ownedSiteMetrics.date);

    return { site, series };
  }

  async function createSite(args: CreateSiteArgs) {
    const [row] = await db
      .insert(ownedSites)
      .values({
        companyId: args.companyId,
        slug: args.slug,
        domain: args.domain,
        displayName: args.displayName,
        primaryTool: args.primaryTool ?? null,
        niche: args.niche ?? null,
        status: args.status ?? "building",
        adsenseAccountId: args.adsenseAccountId ?? null,
        gaPropertyId: args.gaPropertyId ?? null,
        gscSiteUrl: args.gscSiteUrl ?? null,
        notes: args.notes ?? null,
      })
      .returning();
    return row!;
  }

  async function updateSite(
    companyId: string,
    slug: string,
    updates: Partial<CreateSiteArgs> & { launchedAt?: Date | null },
  ) {
    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.domain !== undefined) setValues.domain = updates.domain;
    if (updates.displayName !== undefined) setValues.displayName = updates.displayName;
    if (updates.primaryTool !== undefined) setValues.primaryTool = updates.primaryTool;
    if (updates.niche !== undefined) setValues.niche = updates.niche;
    if (updates.status !== undefined) {
      setValues.status = updates.status;
      if (updates.status === "monetized" || updates.status === "live") {
        setValues.launchedAt = updates.launchedAt ?? new Date();
      }
    }
    if (updates.adsenseAccountId !== undefined)
      setValues.adsenseAccountId = updates.adsenseAccountId;
    if (updates.gaPropertyId !== undefined) setValues.gaPropertyId = updates.gaPropertyId;
    if (updates.gscSiteUrl !== undefined) setValues.gscSiteUrl = updates.gscSiteUrl;
    if (updates.notes !== undefined) setValues.notes = updates.notes;

    const [row] = await db
      .update(ownedSites)
      .set(setValues)
      .where(and(eq(ownedSites.companyId, companyId), eq(ownedSites.slug, slug)))
      .returning();
    return row ?? null;
  }

  async function recordMetrics(row: {
    siteId: string;
    date: string;
    source: "ga4" | "adsense" | "manual";
    sessions?: number;
    pageviews?: number;
    adImpressions?: number;
    adRevenueCents?: number;
    rpmCents?: number;
    outboundClicksToCoherence?: number;
    outboundClicksToTokns?: number;
  }) {
    await db
      .insert(ownedSiteMetrics)
      .values({
        siteId: row.siteId,
        date: row.date,
        source: row.source,
        sessions: row.sessions ?? 0,
        pageviews: row.pageviews ?? 0,
        adImpressions: row.adImpressions ?? 0,
        adRevenueCents: row.adRevenueCents ?? 0,
        rpmCents: row.rpmCents ?? 0,
        outboundClicksToCoherence: row.outboundClicksToCoherence ?? 0,
        outboundClicksToTokns: row.outboundClicksToTokns ?? 0,
      })
      .onConflictDoUpdate({
        target: [
          ownedSiteMetrics.siteId,
          ownedSiteMetrics.date,
          ownedSiteMetrics.source,
        ],
        set: {
          sessions: row.sessions ?? 0,
          pageviews: row.pageviews ?? 0,
          adImpressions: row.adImpressions ?? 0,
          adRevenueCents: row.adRevenueCents ?? 0,
          rpmCents: row.rpmCents ?? 0,
          outboundClicksToCoherence: row.outboundClicksToCoherence ?? 0,
          outboundClicksToTokns: row.outboundClicksToTokns ?? 0,
          capturedAt: new Date(),
        },
      });
  }

  // Sync stubs — wired to real GA4 / AdSense / GSC clients in a follow-up
  // once we have credentials provisioned in company_secrets. For now they
  // return a shape the cron + route can call without blowing up.
  async function syncMetricsFromGa4(
    siteId: string,
  ): Promise<{ ok: boolean; rowsUpserted: number; reason?: string }> {
    logger.info({ siteId }, "owned-sites: GA4 sync stub (credentials not yet wired)");
    return { ok: false, rowsUpserted: 0, reason: "ga4_credentials_not_configured" };
  }

  async function syncMetricsFromAdSense(
    siteId: string,
  ): Promise<{ ok: boolean; rowsUpserted: number; reason?: string }> {
    logger.info({ siteId }, "owned-sites: AdSense sync stub (credentials not yet wired)");
    return { ok: false, rowsUpserted: 0, reason: "adsense_credentials_not_configured" };
  }

  async function syncAll(companyId: string): Promise<{
    sitesProcessed: number;
    ga4Results: Array<{ siteId: string; ok: boolean; rowsUpserted: number }>;
    adsenseResults: Array<{ siteId: string; ok: boolean; rowsUpserted: number }>;
  }> {
    const targets = await db
      .select({ id: ownedSites.id, status: ownedSites.status })
      .from(ownedSites)
      .where(
        and(
          eq(ownedSites.companyId, companyId),
          sql`${ownedSites.status} IN ('live', 'adsense_pending', 'monetized')`,
        ),
      );

    const ga4Results: Array<{ siteId: string; ok: boolean; rowsUpserted: number }> = [];
    const adsenseResults: Array<{ siteId: string; ok: boolean; rowsUpserted: number }> =
      [];

    for (const t of targets) {
      const g = await syncMetricsFromGa4(t.id);
      ga4Results.push({ siteId: t.id, ok: g.ok, rowsUpserted: g.rowsUpserted });
      const a = await syncMetricsFromAdSense(t.id);
      adsenseResults.push({ siteId: t.id, ok: a.ok, rowsUpserted: a.rowsUpserted });
    }

    return { sitesProcessed: targets.length, ga4Results, adsenseResults };
  }

  return {
    listSites,
    getSiteBySlug,
    getSiteDetail,
    createSite,
    updateSite,
    recordMetrics,
    syncMetricsFromGa4,
    syncMetricsFromAdSense,
    syncAll,
  };
}
