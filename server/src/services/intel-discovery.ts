import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { intelCompanies } from "@paperclipai/db";
import { getEmbedding } from "./intel-embeddings.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Intel Discovery Service
// Finds new companies/projects trending across multiple sources and either
// auto-adds high-confidence ones or queues them for review.
// ---------------------------------------------------------------------------

interface DiscoveryCandidate {
  slug: string;
  name: string;
  category: string;
  directory: string;
  description: string;
  website: string;
  coingecko_id: string | null;
  github_org: string | null;
  subreddit: string | null;
  twitter_handle: string | null;
  rss_feeds: string[];
  score: number;
  sources: string[];
}

interface DiscoveryResult {
  discovered: number;
  autoAdded: number;
  queued: number;
  errors: string[];
}

// Minimum score to auto-add (must have at least 2 verifiable data sources)
const AUTO_ADD_THRESHOLD = 3;

export function intelDiscoveryService(db: Db) {

  async function rawQuery<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
    const result = await db.execute(query);
    return result as unknown as T[];
  }

  // ------ Source: CoinGecko Trending ------

  async function fetchCoinGeckoTrending(): Promise<DiscoveryCandidate[]> {
    const candidates: DiscoveryCandidate[] = [];
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/search/trending", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return candidates;
      const data = await res.json() as { coins?: Array<{ item: { id: string; name: string; symbol: string; slug?: string; large?: string } }> };

      for (const { item } of data.coins ?? []) {
        candidates.push({
          slug: item.id,
          name: item.name,
          category: "crypto-trending",
          directory: "crypto",
          description: `${item.name} (${item.symbol}) — trending on CoinGecko`,
          website: `https://www.coingecko.com/en/coins/${item.id}`,
          coingecko_id: item.id,
          github_org: null,
          subreddit: null,
          twitter_handle: null,
          rss_feeds: [],
          score: 1,
          sources: ["coingecko-trending"],
        });
      }
    } catch (err) {
      logger.warn({ err }, "Discovery: CoinGecko trending fetch failed");
    }
    return candidates;
  }

  // ------ Source: GitHub Trending ------

  async function fetchGitHubTrending(): Promise<DiscoveryCandidate[]> {
    const candidates: DiscoveryCandidate[] = [];
    try {
      // Use GitHub search API for recently created popular repos
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "CoherenceDaddy/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (process.env.GITHUB_TOKEN) {
        headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const queries = [
        `created:>${weekAgo} stars:>50 topic:blockchain`,
        `created:>${weekAgo} stars:>50 topic:ai`,
        `created:>${weekAgo} stars:>50 topic:defi`,
        `created:>${weekAgo} stars:>100 topic:developer-tools`,
      ];

      for (const q of queries) {
        try {
          const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=10`;
          const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const data = await res.json() as { items?: Array<{ full_name: string; name: string; description: string; html_url: string; owner: { login: string } }> };

          for (const repo of data.items ?? []) {
            const slug = repo.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
            const directory = q.includes("blockchain") || q.includes("defi") ? "crypto"
              : q.includes("ai") ? "ai-ml" : "devtools";
            candidates.push({
              slug,
              name: repo.name,
              category: `${directory}-trending`,
              directory,
              description: repo.description || `${repo.name} — trending on GitHub`,
              website: repo.html_url,
              coingecko_id: null,
              github_org: repo.owner.login,
              subreddit: null,
              twitter_handle: null,
              rss_feeds: [],
              score: 1,
              sources: ["github-trending"],
            });
          }
        } catch {
          // individual query failed, continue
        }
      }
    } catch (err) {
      logger.warn({ err }, "Discovery: GitHub trending fetch failed");
    }
    return candidates;
  }

  // ------ Main Discovery ------

  async function discoverNewProjects(): Promise<DiscoveryResult> {
    const errors: string[] = [];
    let discovered = 0;
    let autoAdded = 0;
    let queued = 0;

    // Get existing slugs to filter out already-tracked companies
    const existing = await rawQuery<{ slug: string }>(
      sql`SELECT slug FROM intel_companies`,
    );
    const existingSlugs = new Set(existing.map((r) => r.slug));

    // Fetch candidates from all sources
    const [cgCandidates, ghCandidates] = await Promise.all([
      fetchCoinGeckoTrending(),
      fetchGitHubTrending(),
    ]);

    // Merge and score — candidates appearing in multiple sources get higher scores
    const candidateMap = new Map<string, DiscoveryCandidate>();
    for (const c of [...cgCandidates, ...ghCandidates]) {
      if (existingSlugs.has(c.slug)) continue;

      const existing = candidateMap.get(c.slug);
      if (existing) {
        existing.score += c.score;
        existing.sources.push(...c.sources);
        // Merge data sources
        if (c.coingecko_id && !existing.coingecko_id) existing.coingecko_id = c.coingecko_id;
        if (c.github_org && !existing.github_org) existing.github_org = c.github_org;
      } else {
        candidateMap.set(c.slug, { ...c });
      }
    }

    // Score bonus for having verifiable data sources
    for (const candidate of candidateMap.values()) {
      if (candidate.coingecko_id) candidate.score += 1;
      if (candidate.github_org) candidate.score += 1;
    }

    // Process candidates
    for (const candidate of candidateMap.values()) {
      discovered++;

      try {
        if (candidate.score >= AUTO_ADD_THRESHOLD) {
          // Auto-add high-confidence discoveries
          await db.execute(sql`
            INSERT INTO intel_companies (slug, name, category, directory, description, website, coingecko_id, github_org, subreddit, twitter_handle, rss_feeds)
            VALUES (
              ${candidate.slug},
              ${candidate.name},
              ${candidate.category},
              ${candidate.directory},
              ${candidate.description},
              ${candidate.website},
              ${candidate.coingecko_id},
              ${candidate.github_org},
              ${candidate.subreddit},
              ${candidate.twitter_handle},
              ${JSON.stringify(candidate.rss_feeds)}::jsonb
            )
            ON CONFLICT (slug) DO NOTHING
          `);
          autoAdded++;

          logger.info(
            { slug: candidate.slug, score: candidate.score, sources: candidate.sources },
            "Discovery: auto-added new company",
          );
        } else {
          // Queue as discovery report for review
          const headline = `Discovered trending project: ${candidate.name}`;
          const body = JSON.stringify({
            name: candidate.name,
            slug: candidate.slug,
            directory: candidate.directory,
            category: candidate.category,
            description: candidate.description,
            website: candidate.website,
            score: candidate.score,
            sources: candidate.sources,
            data_sources: {
              coingecko_id: candidate.coingecko_id,
              github_org: candidate.github_org,
            },
          });

          const embedding = await getEmbedding(`${headline} ${candidate.description}`);
          const embeddingStr = `[${embedding.join(",")}]`;

          await db.execute(sql`
            INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
            VALUES (${"_discovery"}, 'discovery', ${headline}, ${body}, ${candidate.website}, ${embeddingStr}::vector)
            ON CONFLICT DO NOTHING
          `);
          queued++;
        }
      } catch (err) {
        errors.push(`${candidate.slug}: ${String(err)}`);
      }
    }

    logger.info({ discovered, autoAdded, queued, errors: errors.length }, "Discovery cycle completed");
    return { discovered, autoAdded, queued, errors };
  }

  // ------ List pending discoveries ------

  async function listDiscoveries() {
    return rawQuery(sql`
      SELECT id, headline, body, source_url, captured_at
      FROM intel_reports
      WHERE report_type = 'discovery'
      ORDER BY captured_at DESC
      LIMIT 50
    `);
  }

  // ------ Approve a discovery ------

  async function approveDiscovery(reportId: number) {
    const rows = await rawQuery<{ body: string; id: number }>(
      sql`SELECT id, body FROM intel_reports WHERE id = ${reportId} AND report_type = 'discovery' LIMIT 1`,
    );
    if (rows.length === 0) return { success: false, error: "Discovery not found" };

    const data = JSON.parse(rows[0]!.body);

    await db.execute(sql`
      INSERT INTO intel_companies (slug, name, category, directory, description, website, coingecko_id, github_org, subreddit, twitter_handle, rss_feeds)
      VALUES (
        ${data.slug},
        ${data.name},
        ${data.category},
        ${data.directory},
        ${data.description},
        ${data.website},
        ${data.data_sources?.coingecko_id ?? null},
        ${data.data_sources?.github_org ?? null},
        ${null},
        ${null},
        '[]'::jsonb
      )
      ON CONFLICT (slug) DO NOTHING
    `);

    // Remove the discovery report
    await db.execute(sql`DELETE FROM intel_reports WHERE id = ${reportId}`);

    return { success: true, slug: data.slug };
  }

  // ------ Reject a discovery ------

  async function rejectDiscovery(reportId: number) {
    await db.execute(sql`DELETE FROM intel_reports WHERE id = ${reportId}`);
    return { success: true };
  }

  return {
    discoverNewProjects,
    listDiscoveries,
    approveDiscovery,
    rejectDiscovery,
  };
}
