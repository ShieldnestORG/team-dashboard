import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";

// ---------------------------------------------------------------------------
// Topic picker for the content bridge
// Extracted from content-crons.ts pickTopic to avoid circular imports
// ---------------------------------------------------------------------------

const FALLBACK_TOPICS = [
  "blockchain ecosystem updates",
  "DeFi protocol innovations",
  "cryptocurrency market trends",
  "Web3 developer tools",
  "layer 2 scaling solutions",
  "AI model breakthroughs",
  "developer tooling advances",
];

export async function pickTopicForBridge(db: Db): Promise<string> {
  try {
    const rows = (await db.execute(sql`
      SELECT
        r.headline,
        r.report_type,
        c.directory,
        r.captured_at,
        EXP(-EXTRACT(EPOCH FROM (NOW() - r.captured_at)) / 43200.0) AS recency_score
      FROM intel_reports r
      JOIN intel_companies c ON c.slug = r.company_slug
      WHERE r.captured_at > NOW() - INTERVAL '48 hours'
        AND r.report_type != 'discovery'
      ORDER BY EXP(-EXTRACT(EPOCH FROM (NOW() - r.captured_at)) / 43200.0) DESC
      LIMIT 30
    `)) as unknown as Array<{ headline: string; report_type: string; directory: string; recency_score: number }>;

    if (rows.length > 0) {
      const byDirectory = new Map<string, typeof rows>();
      for (const row of rows) {
        const dirRows = byDirectory.get(row.directory) ?? [];
        dirRows.push(row);
        byDirectory.set(row.directory, dirRows);
      }

      const diverse: typeof rows = [];
      for (const dirRows of byDirectory.values()) {
        if (dirRows.length > 0) diverse.push(dirRows[0]!);
      }

      if (diverse.length > 0) {
        const totalWeight = diverse.reduce((sum, r) => sum + Number(r.recency_score), 0);
        let rand = Math.random() * totalWeight;
        for (const row of diverse) {
          rand -= Number(row.recency_score);
          if (rand <= 0) return row.headline;
        }
        return diverse[0]!.headline;
      }
    }
  } catch (err) {
    logger.warn({ err }, "content-bridge-topics: failed to pick topic from intel, using fallback");
  }

  return FALLBACK_TOPICS[Math.floor(Math.random() * FALLBACK_TOPICS.length)]!;
}
