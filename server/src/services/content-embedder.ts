import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Content Embedder — saves published content back into intel_reports with
// BGE-M3 embeddings so the knowledge base grows from its own output.
// ---------------------------------------------------------------------------

/**
 * Embed a published blog post / content piece back into intel_reports.
 * This creates a feedback loop: generated content enriches future generation.
 */
export async function embedPublishedContent(
  db: Db,
  opts: {
    title: string;
    content: string;   // HTML or plain text
    slug: string;
    category: string;
    personalityId?: string;
  },
): Promise<void> {
  try {
    const { getEmbedding } = await import("./intel-embeddings.js");

    // Strip HTML tags for embedding
    const plainText = opts.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const textForEmbedding = `${opts.title} ${plainText}`.slice(0, 2000);
    const body = plainText.slice(0, 500);

    const embedding = await getEmbedding(textForEmbedding);
    const embeddingStr = `[${embedding.join(",")}]`;

    await db.execute(sql`
      INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
      VALUES (
        'coherence-daddy',
        'generated-content',
        ${opts.title},
        ${body},
        ${`https://coherencedaddy.com/blog/${opts.slug}`},
        ${embeddingStr}::vector
      )
    `);

    logger.info(
      { title: opts.title, slug: opts.slug, personality: opts.personalityId },
      "Content embedder: published content saved to intel knowledge base",
    );
  } catch (err) {
    // Non-critical — don't fail the publish pipeline
    logger.warn({ err, title: opts.title }, "Content embedder: failed to embed published content");
  }
}
