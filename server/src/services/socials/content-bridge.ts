import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { contentItems, socialAccounts, socialPosts } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";
import { contentTypeToPlatform, type SocialPlatform } from "./platform-map.js";

export type AutomationMode = "manual" | "assisted" | "full_auto" | "none";

export interface EnqueueResult {
  enqueued: boolean;
  reason?: string;
  socialPostId?: string;
}

interface ResolvedAccount {
  id: string;
  brand: string;
  platform: SocialPlatform;
  status: string;
  automationMode: AutomationMode;
}

// Platform character caps — used by flagContent for the assisted gate.
// Conservative defaults; falls back to no-cap if unknown.
const PLATFORM_CAPS: Partial<Record<SocialPlatform, number>> = {
  x: 280,
  bluesky: 300,
  linkedin: 3000,
};

const BANNED_PHRASES: string[] = [];

export function flagContent(text: string, platform: SocialPlatform): string | null {
  const cap = PLATFORM_CAPS[platform];
  if (cap && text.length > cap) {
    return `text length ${text.length} exceeds ${platform} cap ${cap}`;
  }
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      return `banned phrase detected: ${phrase}`;
    }
  }
  return null;
}

export async function isDuplicateRecent(
  db: Db,
  companyId: string,
  text: string,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM content_items
     WHERE company_id = ${companyId}
       AND content = ${text}
       AND created_at > NOW() - INTERVAL '7 days'
     LIMIT 1
  `) as unknown as Array<unknown>;
  return rows.length > 0;
}

export async function resolveAccountForContent(
  db: Db,
  companyId: string,
  brand: string,
  contentType: string,
): Promise<ResolvedAccount | null> {
  const platform = contentTypeToPlatform(contentType);
  if (!platform) return null;

  const rows = await db
    .select({
      id: socialAccounts.id,
      brand: socialAccounts.brand,
      platform: socialAccounts.platform,
      status: socialAccounts.status,
      automationMode: socialAccounts.automationMode,
    })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.companyId, companyId),
        eq(socialAccounts.brand, brand),
        eq(socialAccounts.platform, platform),
        eq(socialAccounts.archived, false),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    brand: row.brand,
    platform: row.platform as SocialPlatform,
    status: row.status,
    automationMode: row.automationMode as AutomationMode,
  };
}

export interface EnqueueOptions {
  /**
   * Internal storage objectKeys for media to attach to this post. The relayer
   * stages each non-public entry to the public R2 bucket and replaces it with
   * the resulting public URL before dispatch (see social-relayer.ts).
   *
   * Seeded into socialPosts.mediaUrls. When omitted, the post has no media
   * (text-only) — preserving the prior `mediaUrls: []` behavior.
   *
   * TODO(media-source-decision): content_items has no column or FK linking a
   * content row to its media (no content_items.media_drop_id, no join table to
   * media_drops). So the bridge cannot AUTO-derive which uploaded media belongs
   * to a given content item — that needs a product decision about which source
   * is canonical (media_drops? a new content_items column? the visual pipeline?).
   * Until that's decided, the media reference must be supplied EXPLICITLY here by
   * the caller. This is the clean single path; auto-linkage is deferred.
   */
  mediaObjectKeys?: string[];
}

export async function enqueueApprovedContent(
  db: Db,
  contentItemId: string,
  opts: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const [item] = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.id, contentItemId))
    .limit(1);

  if (!item) {
    return { enqueued: false, reason: "content item not found" };
  }

  const existing = await db.execute(sql`
    SELECT id FROM social_posts
     WHERE payload->>'contentItemId' = ${contentItemId}
     LIMIT 1
  `) as unknown as Array<{ id: string }>;
  if (existing.length > 0) {
    return { enqueued: false, reason: "already enqueued", socialPostId: existing[0].id };
  }

  const account = await resolveAccountForContent(
    db,
    item.companyId,
    item.brand ?? "cd",
    item.contentType,
  );
  if (!account) {
    return { enqueued: false, reason: "no active account" };
  }
  if (account.status !== "active") {
    return { enqueued: false, reason: `account status is ${account.status}` };
  }

  const mediaUrls = (opts.mediaObjectKeys ?? []).filter(
    (k): k is string => typeof k === "string" && k.length > 0,
  );

  const [inserted] = await db
    .insert(socialPosts)
    .values({
      socialAccountId: account.id,
      text: item.content,
      mediaUrls,
      altTexts: [],
      scheduledAt: new Date(),
      status: "scheduled",
      payload: { contentItemId: item.id },
    })
    .returning({ id: socialPosts.id });

  logger.info(
    { contentItemId, socialPostId: inserted.id, accountId: account.id, platform: account.platform },
    "content-bridge enqueued approved content to social_posts",
  );

  return { enqueued: true, socialPostId: inserted.id };
}
