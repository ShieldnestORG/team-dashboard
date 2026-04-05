import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { contentFeedback, contentItems } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

export interface FeedbackInput {
  companyId: string;
  contentItemId: string;
  contentType: "text" | "visual";
  rating: "like" | "dislike";
  comment?: string;
  createdByUserId?: string;
}

export interface FeedbackItem {
  id: string;
  contentItemId: string;
  contentType: string;
  rating: string;
  comment: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface FeedbackStats {
  byPersonality: Array<{
    personalityId: string;
    platform: string;
    likes: number;
    dislikes: number;
    total: number;
  }>;
  totals: {
    likes: number;
    dislikes: number;
    total: number;
  };
}

export function contentFeedbackService(db: Db) {
  async function add(input: FeedbackInput): Promise<FeedbackItem> {
    if (input.rating !== "like" && input.rating !== "dislike") {
      throw new Error(`Invalid rating: ${input.rating}. Must be "like" or "dislike"`);
    }

    const [row] = await db
      .insert(contentFeedback)
      .values({
        companyId: input.companyId,
        contentItemId: input.contentItemId,
        contentType: input.contentType,
        rating: input.rating,
        comment: input.comment ?? null,
        createdByUserId: input.createdByUserId ?? null,
      })
      .returning();

    logger.info(
      { contentItemId: input.contentItemId, rating: input.rating, contentType: input.contentType },
      "Content feedback submitted",
    );

    return {
      id: row.id,
      contentItemId: row.contentItemId,
      contentType: row.contentType,
      rating: row.rating,
      comment: row.comment,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async function getForItem(contentItemId: string): Promise<FeedbackItem[]> {
    const rows = await db
      .select()
      .from(contentFeedback)
      .where(eq(contentFeedback.contentItemId, contentItemId))
      .orderBy(desc(contentFeedback.createdAt));

    return rows.map((row) => ({
      id: row.id,
      contentItemId: row.contentItemId,
      contentType: row.contentType,
      rating: row.rating,
      comment: row.comment,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async function getStats(companyId: string): Promise<FeedbackStats> {
    // Aggregate feedback by personality and platform (text content only has personalities)
    const rows = await db
      .select({
        personalityId: contentItems.personalityId,
        platform: contentItems.platform,
        rating: contentFeedback.rating,
        cnt: count(),
      })
      .from(contentFeedback)
      .innerJoin(contentItems, eq(contentFeedback.contentItemId, contentItems.id))
      .where(
        and(
          eq(contentFeedback.companyId, companyId),
          eq(contentFeedback.contentType, "text"),
        ),
      )
      .groupBy(contentItems.personalityId, contentItems.platform, contentFeedback.rating);

    // Build per-personality stats
    const grouped = new Map<string, { likes: number; dislikes: number }>();
    let totalLikes = 0;
    let totalDislikes = 0;

    for (const row of rows) {
      const key = `${row.personalityId}::${row.platform}`;
      const entry = grouped.get(key) ?? { likes: 0, dislikes: 0 };
      const c = Number(row.cnt);
      if (row.rating === "like") {
        entry.likes += c;
        totalLikes += c;
      } else {
        entry.dislikes += c;
        totalDislikes += c;
      }
      grouped.set(key, entry);
    }

    const byPersonality = Array.from(grouped.entries()).map(([key, val]) => {
      const [personalityId, platform] = key.split("::");
      return {
        personalityId,
        platform,
        likes: val.likes,
        dislikes: val.dislikes,
        total: val.likes + val.dislikes,
      };
    });

    return {
      byPersonality,
      totals: {
        likes: totalLikes,
        dislikes: totalDislikes,
        total: totalLikes + totalDislikes,
      },
    };
  }

  return { add, getForItem, getStats };
}
