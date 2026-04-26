import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { contentItems, socialAutomations, socialAccounts } from "@paperclipai/db";
import { contentTypeToPlatform, type SocialPlatform } from "./platform-map.js";

export interface CalendarEvent {
  id: string;            // contentItemId or `cron:<sourceRef>:<isoTime>`
  source: "content" | "cron-projection";
  when: string;          // ISO timestamp
  brand: string;
  platform: SocialPlatform | "blog";
  status: string;        // 'scheduled' | 'published' | 'failed' | 'projected'
  title: string;
  contentItemId?: string;
  socialAccountId?: string | null;
  automated: boolean;
}

export interface CalendarRange {
  from: Date;
  to: Date;
  brand?: string;
  platform?: string;
  companyId: string;
}

// Real published / pending content items in [from, to].
async function loadContentEvents(db: Db, range: CalendarRange): Promise<CalendarEvent[]> {
  const where = [
    eq(contentItems.companyId, range.companyId),
    gte(contentItems.createdAt, range.from),
  ];
  if (range.brand) where.push(eq(contentItems.brand, range.brand));

  const rows = await db
    .select({
      id: contentItems.id,
      brand: contentItems.brand,
      platform: contentItems.platform,
      contentType: contentItems.contentType,
      status: contentItems.status,
      reviewStatus: contentItems.reviewStatus,
      topic: contentItems.topic,
      publishedAt: contentItems.publishedAt,
      createdAt: contentItems.createdAt,
    })
    .from(contentItems)
    .where(and(...where))
    .orderBy(desc(contentItems.createdAt))
    .limit(500);

  return rows
    .map((r): CalendarEvent | null => {
      const when = r.publishedAt ?? r.createdAt;
      if (!when) return null;
      const whenDate = new Date(when);
      if (whenDate > range.to) return null;
      const platform =
        contentTypeToPlatform(r.contentType) ??
        (r.contentType === "blog_post" || r.contentType === "slideshow_blog" ? "blog" : null);
      if (!platform) return null;
      if (range.platform && platform !== range.platform) return null;
      return {
        id: r.id,
        source: "content",
        when: whenDate.toISOString(),
        brand: r.brand,
        platform,
        status: r.publishedAt
          ? "published"
          : r.reviewStatus === "approved"
            ? "scheduled"
            : r.reviewStatus,
        title: r.topic.slice(0, 120),
        contentItemId: r.id,
        automated: true,
      };
    })
    .filter((x): x is CalendarEvent => x !== null);
}

// Future projections from social_automations (no extra cron-parser dep —
// we just surface nextRunAt that's already maintained by cron-registry).
async function loadProjections(db: Db, range: CalendarRange): Promise<CalendarEvent[]> {
  const rows = await db
    .select({
      sourceRef: socialAutomations.sourceRef,
      cronExpr: socialAutomations.cronExpr,
      contentType: socialAutomations.contentType,
      nextRunAt: socialAutomations.nextRunAt,
      enabled: socialAutomations.enabled,
      socialAccountId: socialAutomations.socialAccountId,
      brand: socialAccounts.brand,
      platform: socialAccounts.platform,
    })
    .from(socialAutomations)
    .leftJoin(socialAccounts, eq(socialAccounts.id, socialAutomations.socialAccountId));

  const events: CalendarEvent[] = [];
  for (const r of rows) {
    if (!r.enabled || !r.nextRunAt) continue;
    const when = new Date(r.nextRunAt);
    if (when < range.from || when > range.to) continue;
    const brand = r.brand ?? "cd";
    if (range.brand && brand !== range.brand) continue;
    const platform =
      (r.platform as SocialPlatform | null) ??
      (r.contentType ? contentTypeToPlatform(r.contentType) : null);
    if (!platform) continue;
    if (range.platform && platform !== range.platform) continue;
    events.push({
      id: `cron:${r.sourceRef}:${when.toISOString()}`,
      source: "cron-projection",
      when: when.toISOString(),
      brand,
      platform,
      status: "projected",
      title: r.sourceRef,
      socialAccountId: r.socialAccountId,
      automated: true,
    });
  }
  return events;
}

export async function loadCalendar(db: Db, range: CalendarRange): Promise<CalendarEvent[]> {
  const [content, projections] = await Promise.all([
    loadContentEvents(db, range),
    loadProjections(db, range),
  ]);
  return [...content, ...projections].sort((a, b) => a.when.localeCompare(b.when));
}
