/**
 * One-off cleanup: fix content_items rows whose content exceeds the platform
 * char limit. Defaults to bluesky (300 chars).
 *
 * Two modes:
 *  --regenerate (preferred for bluesky): re-run each row through Ollama with
 *                                        the new strict-prompt enforcement.
 *                                        Updates row in place. Slower.
 *  default:                              smartTruncate at sentence/word
 *                                        boundary. Fast, lossy.
 *
 * Flags:
 *   --dry-run            no writes, prints what would happen
 *   --platform=<name>    bluesky | twitter | ... (default: bluesky)
 *   --limit=<n>          override platform char limit
 *   --max-rows=<n>       only process the first N over-limit rows (testing)
 *   --regenerate         use Ollama regen instead of truncation
 *
 * Usage:
 *   DATABASE_URL=... tsx server/scripts/tighten-overflow-content.ts --dry-run
 *   DATABASE_URL=... tsx server/scripts/tighten-overflow-content.ts --regenerate --max-rows=3
 *   DATABASE_URL=... tsx server/scripts/tighten-overflow-content.ts --regenerate
 */

import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { contentItems, createDb } from "@paperclipai/db";
import { smartTruncate } from "../src/services/char-limit.js";
import { contentService } from "../src/services/content.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const regenerate = args.includes("--regenerate");
const platformArg = args.find((a) => a.startsWith("--platform="))?.split("=")[1] ?? "bluesky";
const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
const maxRowsArg = args.find((a) => a.startsWith("--max-rows="))?.split("=")[1];
const explicitLimit = limitArg ? parseInt(limitArg, 10) : null;
const maxRows = maxRowsArg ? parseInt(maxRowsArg, 10) : null;

const PLATFORM_DEFAULTS: Record<string, number> = {
  bluesky: 300,
  twitter: 280,
  linkedin: 3000,
  reddit: 10000,
  discord: 2000,
};

const fallbackLimit = explicitLimit ?? PLATFORM_DEFAULTS[platformArg];
if (!fallbackLimit) {
  console.error(`No char limit known for platform=${platformArg}. Pass --limit=<n>.`);
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL!);
const svc = contentService(db);

const rows = await db
  .select({
    id: contentItems.id,
    content: contentItems.content,
    charCount: contentItems.charCount,
    charLimit: contentItems.charLimit,
    reviewStatus: contentItems.reviewStatus,
    status: contentItems.status,
    personalityId: contentItems.personalityId,
    contentType: contentItems.contentType,
    topic: contentItems.topic,
    brand: contentItems.brand,
    createdAt: contentItems.createdAt,
  })
  .from(contentItems)
  .where(
    and(
      eq(contentItems.platform, platformArg),
      sql`${contentItems.status} != 'published'`,
      or(
        gt(contentItems.charCount, fallbackLimit),
        and(
          isNull(contentItems.charCount),
          sql`length(${contentItems.content}) > ${fallbackLimit}`,
        ),
      ),
    ),
  );

const targetRows = maxRows ? rows.slice(0, maxRows) : rows;

console.log(`\n=== ${platformArg} overflow cleanup ===`);
console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "LIVE"} | Method: ${regenerate ? "REGENERATE via Ollama" : "smartTruncate"}`);
console.log(`Total over-limit: ${rows.length} | Processing: ${targetRows.length} (limit=${fallbackLimit}).\n`);

let processed = 0;
let failed = 0;
const examples: Array<{ id: string; before: number; after: number; before_text?: string; after_text?: string }> = [];

for (const row of targetRows) {
  const itemLimit = row.charLimit && row.charLimit > 0 ? row.charLimit : fallbackLimit;
  const beforeLen = row.content.length;
  if (beforeLen <= itemLimit) continue;

  try {
    let afterText: string;
    let afterLen: number;

    if (regenerate) {
      if (dryRun) {
        // For dry-run with regenerate, still call Ollama so user can see actual quality,
        // but don't write to DB. Run produceText path by calling the service then rolling back is hard,
        // so we just skip the DB write by manually calling the same pipeline.
        // Simpler: do a real regen without dry-run guard for first 3 rows of a small max-rows test.
        // For dry-run, use the truncation preview instead.
        afterText = smartTruncate(row.content, itemLimit);
        afterLen = afterText.length;
      } else {
        const result = await svc.regenerateContent(row.id);
        afterLen = result.after;
        // Re-fetch the new content for the example log
        const [updated] = await db.select({ content: contentItems.content }).from(contentItems).where(eq(contentItems.id, row.id));
        afterText = updated?.content ?? "";
      }
    } else {
      afterText = smartTruncate(row.content, itemLimit);
      afterLen = afterText.length;
      if (!dryRun) {
        await db
          .update(contentItems)
          .set({ content: afterText, charCount: afterLen })
          .where(eq(contentItems.id, row.id));
      }
    }

    if (examples.length < (regenerate ? 5 : 3)) {
      examples.push({
        id: row.id,
        before: beforeLen,
        after: afterLen,
        before_text: regenerate ? row.content : undefined,
        after_text: regenerate ? afterText : undefined,
      });
    }
    processed++;
    if (regenerate && !dryRun) {
      // Light pacing so we don't hammer Ollama
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (err) {
    failed++;
    console.error(`  [FAIL] ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`\nProcessed: ${processed}`);
if (failed > 0) console.log(`Failed: ${failed}`);

if (examples.length > 0) {
  console.log(`\nExamples:`);
  for (const e of examples) {
    if (e.before_text && e.after_text) {
      console.log(`\n  --- ${e.id} : ${e.before} -> ${e.after} chars ---`);
      console.log(`  BEFORE:`);
      console.log(`    ${e.before_text.replace(/\n/g, "\n    ")}`);
      console.log(`  AFTER:`);
      console.log(`    ${e.after_text.replace(/\n/g, "\n    ")}`);
    } else {
      console.log(`  ${e.id}: ${e.before} -> ${e.after} chars`);
    }
  }
}

if (dryRun) {
  console.log(`\nDry run complete. Re-run without --dry-run to apply.`);
}
process.exit(0);
