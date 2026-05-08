import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";

export interface PlatformCap {
  platform: string;
  maxGeneratedPerDay: number;
  maxPublishedPerDay: number;
  enabled: boolean;
}

export interface CapCheck {
  allowed: boolean;
  used: number;
  cap: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: PlatformCap | null; expiresAt: number }>();

// Maps a cap-platform key to the value stored in content_items.platform.
// content_items uses "twitter" for the X platform; everything else lines up.
function capPlatformToContentPlatform(platform: string): string {
  if (platform === "x") return "twitter";
  return platform;
}

export async function getCap(db: Db, platform: string): Promise<PlatformCap | null> {
  const now = Date.now();
  const hit = cache.get(platform);
  if (hit && hit.expiresAt > now) return hit.value;

  const rows = (await db.execute(sql`
    SELECT
      platform,
      max_generated_per_day AS "maxGeneratedPerDay",
      max_published_per_day AS "maxPublishedPerDay",
      enabled
    FROM platform_caps
    WHERE platform = ${platform}
    LIMIT 1
  `)) as unknown as PlatformCap[];

  const value = rows[0] ?? null;
  cache.set(platform, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

export function invalidatePlatformCapCache(platform?: string): void {
  if (platform) cache.delete(platform);
  else cache.clear();
}

export async function canGenerate(db: Db, platform: string): Promise<CapCheck> {
  const cap = await getCap(db, platform);
  if (!cap || !cap.enabled) {
    return { allowed: true, used: 0, cap: cap?.maxGeneratedPerDay ?? Infinity };
  }
  const contentPlatform = capPlatformToContentPlatform(platform);
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM content_items
    WHERE platform = ${contentPlatform}
      AND date_trunc('day', created_at AT TIME ZONE 'utc')
          = date_trunc('day', now() AT TIME ZONE 'utc')
  `)) as unknown as Array<{ cnt: number }>;
  const used = Number(rows[0]?.cnt ?? 0);
  return { allowed: used < cap.maxGeneratedPerDay, used, cap: cap.maxGeneratedPerDay };
}

export async function canPublish(db: Db, platform: string): Promise<CapCheck> {
  const cap = await getCap(db, platform);
  if (!cap || !cap.enabled) {
    return { allowed: true, used: 0, cap: cap?.maxPublishedPerDay ?? Infinity };
  }
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM social_posts sp
    JOIN social_accounts sa ON sa.id = sp.social_account_id
    WHERE sa.platform = ${platform}
      AND sp.status = 'posted'
      AND sp.posted_at IS NOT NULL
      AND date_trunc('day', sp.posted_at AT TIME ZONE 'utc')
          = date_trunc('day', now() AT TIME ZONE 'utc')
  `)) as unknown as Array<{ cnt: number }>;
  const used = Number(rows[0]?.cnt ?? 0);
  return { allowed: used < cap.maxPublishedPerDay, used, cap: cap.maxPublishedPerDay };
}

export async function listCaps(db: Db): Promise<PlatformCap[]> {
  const rows = (await db.execute(sql`
    SELECT
      id,
      platform,
      max_generated_per_day AS "maxGeneratedPerDay",
      max_published_per_day AS "maxPublishedPerDay",
      enabled,
      notes,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM platform_caps
    ORDER BY platform ASC
  `)) as unknown as PlatformCap[];
  return rows;
}
