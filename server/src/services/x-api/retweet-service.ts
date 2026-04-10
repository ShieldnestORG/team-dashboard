import type { Db } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { XApiClient } from "./client.js";
import { canUseDailyBudget } from "./rate-limiter.js";
import { logger } from "../../middleware/logger.js";

// ---------------------------------------------------------------------------
// Smart Retweet Service
// Single-query polling: "from:account1 OR from:account2" covers all targets
// in ONE search read ($0.005). Saves tweet data for intel context.
// ---------------------------------------------------------------------------

const DEFAULT_COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

// Accounts to auto-retweet — own ecosystem accounts
const OWN_ACCOUNTS = ["txEcosystem", "tokns_fi", "txDevHub"];

// Partner accounts — extensible, add more as ecosystem grows
const PARTNER_ACCOUNTS: string[] = [];

const MAX_RETWEETS_PER_CYCLE = 3;
const MAX_RETWEETS_PER_DAY = 10;

// In-memory state — persists across cycles within the same process
let sinceId: string | undefined;
let retweetedToday = new Set<string>();
let retweetCountToday = 0;
let lastResetDate = "";

function resetDailyIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (lastResetDate !== today) {
    retweetedToday = new Set();
    retweetCountToday = 0;
    lastResetDate = today;
  }
}

// ---------------------------------------------------------------------------
// Save tweet data to intel_reports for content context
// ---------------------------------------------------------------------------

// Map Twitter handles to intel_companies slugs
const HANDLE_TO_SLUG: Record<string, string> = {
  txecosystem: "txhuman",
  tokns_fi: "txhuman",
  txdevhub: "txhuman",
  ripple: "xrpl-ripple",
};

async function saveTweetAsIntel(
  db: Db,
  tweet: { id: string; text: string; author_username?: string; created_at?: string },
): Promise<void> {
  try {
    const handle = tweet.author_username?.toLowerCase() || "unknown";
    const companySlug = HANDLE_TO_SLUG[handle] || "txhuman";
    await db.execute(sql`
      INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, captured_at)
      VALUES (
        ${companySlug},
        'twitter',
        ${`@${tweet.author_username}: ${tweet.text.slice(0, 120)}`},
        ${JSON.stringify({ text: tweet.text, author: tweet.author_username, tweet_id: tweet.id })},
        ${`https://x.com/${tweet.author_username}/status/${tweet.id}`},
        ${tweet.created_at ? new Date(tweet.created_at) : new Date()}
      )
      ON CONFLICT DO NOTHING
    `);
  } catch (err) {
    logger.warn({ err, tweetId: tweet.id }, "retweet-service: failed to save tweet as intel (non-critical)");
  }
}

// ---------------------------------------------------------------------------
// Run one retweet cycle
// ---------------------------------------------------------------------------

export async function runRetweetCycle(db: Db): Promise<{
  searched: boolean;
  found: number;
  retweeted: number;
  saved: number;
}> {
  resetDailyIfNeeded();

  // Check daily cap
  if (retweetCountToday >= MAX_RETWEETS_PER_DAY) {
    logger.info({ retweetCountToday, max: MAX_RETWEETS_PER_DAY }, "retweet-service: daily cap reached");
    return { searched: false, found: 0, retweeted: 0, saved: 0 };
  }

  // Check API budget
  const budget = canUseDailyBudget("post");
  if (!budget.allowed) {
    logger.info({ remaining: budget.remaining }, "retweet-service: X API budget exhausted");
    return { searched: false, found: 0, retweeted: 0, saved: 0 };
  }

  // Build single query for all accounts
  const allAccounts = [...OWN_ACCOUNTS, ...PARTNER_ACCOUNTS];
  if (allAccounts.length === 0) {
    return { searched: false, found: 0, retweeted: 0, saved: 0 };
  }

  const query = allAccounts.map((a) => `from:${a}`).join(" OR ");

  const client = new XApiClient(db, DEFAULT_COMPANY_ID);

  try {
    // One search = one read = $0.005
    const searchResult = await client.searchRecent(query, {
      maxResults: 25,
      sinceId,
    });

    const tweets = searchResult.data || [];
    const users = searchResult.includes?.users || [];

    // Build username lookup
    const userMap = new Map<string, string>();
    for (const u of users) {
      userMap.set(u.id, u.username);
    }

    if (tweets.length === 0) {
      logger.info({ query, sinceId }, "retweet-service: no new tweets found");
      return { searched: true, found: 0, retweeted: 0, saved: 0 };
    }

    // Update sinceId to the newest tweet
    const newestId = tweets.reduce((max, t) => (t.id > max ? t.id : max), sinceId || "0");
    sinceId = newestId;

    let retweeted = 0;
    let saved = 0;

    for (const tweet of tweets) {
      // Save ALL found tweets as intel data (even if not retweeted)
      const authorUsername = userMap.get(tweet.author_id || "") || "unknown";
      await saveTweetAsIntel(db, {
        id: tweet.id,
        text: tweet.text,
        author_username: authorUsername,
        created_at: tweet.created_at,
      });
      saved++;

      // Skip if already retweeted this tweet
      if (retweetedToday.has(tweet.id)) continue;

      // Skip if we've hit per-cycle or per-day limit
      if (retweeted >= MAX_RETWEETS_PER_CYCLE) continue;
      if (retweetCountToday >= MAX_RETWEETS_PER_DAY) continue;

      // Check budget again before each retweet
      const rtBudget = canUseDailyBudget("post");
      if (!rtBudget.allowed) break;

      // Filter: only retweet tweets less than 24 hours old
      if (tweet.created_at) {
        const tweetAge = Date.now() - new Date(tweet.created_at).getTime();
        if (tweetAge > 24 * 60 * 60 * 1000) continue;
      }

      try {
        await client.retweet(tweet.id);
        retweetedToday.add(tweet.id);
        retweetCountToday++;
        retweeted++;

        logger.info(
          { tweetId: tweet.id, author: authorUsername, retweetCountToday, text: tweet.text.slice(0, 80) },
          "retweet-service: retweeted",
        );
      } catch (err) {
        // 327 = "You have already retweeted this Tweet" — not an error
        const errStr = String(err);
        if (errStr.includes("327") || errStr.includes("already")) {
          retweetedToday.add(tweet.id);
          logger.info({ tweetId: tweet.id }, "retweet-service: already retweeted, skipping");
        } else {
          logger.warn({ err, tweetId: tweet.id }, "retweet-service: retweet failed");
        }
      }
    }

    logger.info(
      { found: tweets.length, retweeted, saved, retweetCountToday },
      "retweet-service: cycle completed",
    );

    return { searched: true, found: tweets.length, retweeted, saved };
  } catch (err) {
    logger.error({ err }, "retweet-service: cycle failed");
    return { searched: true, found: 0, retweeted: 0, saved: 0 };
  }
}
