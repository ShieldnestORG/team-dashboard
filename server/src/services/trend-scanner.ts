import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

export interface TrendSignals {
  timestamp: string;
  crypto_movers: Array<{ coin: string; change_24h: number; price: number; volume: number }>;
  trending_tech: Array<{ title: string; score: number; category: string; url: string; comments: number }>;
  google_trends?: Array<{ keyword: string; traffic: string; related: string[]; region: string }>;
  bing_news?: Array<{ title: string; url: string; description: string; provider: string; category: string; datePublished: string }>;
}

// Fallback coins if DB is unavailable
const FALLBACK_COIN_IDS = "dogecoin,shiba-inu,pepe,dogwifhat,bonk,floki,brett,turbo,mog-coin,popcat,book-of-meme,cat-in-a-dogs-world,neiro,ponke,bitcoin,ethereum,solana";

const HN_TOP_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";

const GOOGLE_TRENDS_RSS_URL = "https://trends.google.com/trending/rss?geo=US";
const BING_NEWS_API_URL = "https://api.bing.microsoft.com/v7.0/news/search";
const BING_NEWS_KEY = process.env.BING_NEWS_KEY || "";

const CRYPTO_TECH_KEYWORDS = /\b(crypto|bitcoin|btc|ethereum|eth|solana|blockchain|defi|nft|token|web3|ai|artificial.?intelligence|llm|gpt|machine.?learn|neural|deep.?learn|openai|anthropic|chatbot|agent)\b/i;

function categorize(title: string): string {
  const t = title.toLowerCase();
  if (/\b(ai|llm|gpt|claude|gemini|machine.?learn|neural|transformer|diffusion|openai|anthropic|model)\b/.test(t)) return "AI/ML";
  if (/\b(crypto|bitcoin|btc|ethereum|eth|solana|blockchain|defi|nft|token|web3)\b/.test(t)) return "Crypto";
  if (/\b(rust|go|python|typescript|react|node|api|database|sql|devops|docker|kubernetes)\b/.test(t)) return "Programming";
  if (/\b(startup|vc|funding|ipo|acquisition|revenue|saas|b2b)\b/.test(t)) return "Business";
  return "Technology";
}

export function trendScannerService(db?: Db) {
  // Build dynamic CoinGecko URL from intel_companies
  async function getCoinGeckoUrl(): Promise<string> {
    if (db) {
      try {
        const rows = await db.execute(
          sql`SELECT coingecko_id FROM intel_companies WHERE coingecko_id IS NOT NULL`,
        ) as unknown as Array<{ coingecko_id: string }>;

        if (rows.length > 0) {
          // CoinGecko allows up to 250 ids per request
          const ids = rows.map((r) => r.coingecko_id).slice(0, 250).join(",");
          logger.info({ count: rows.length }, "Trend scanner: loaded coin IDs from DB");
          return `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d&per_page=250`;
        }
      } catch (err) {
        logger.warn({ err }, "Trend scanner: failed to load coin IDs from DB, using fallback");
      }
    }

    return `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${FALLBACK_COIN_IDS}&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d`;
  }

  return {
    async scan(): Promise<TrendSignals> {
      const [crypto, tech, gtrends, bing] = await Promise.allSettled([
        this.scanCrypto(),
        this.scanTech(),
        this.scanGoogleTrends(),
        this.scanBingNews(),
      ]);

      const signals: TrendSignals = {
        timestamp: new Date().toISOString(),
        crypto_movers: crypto.status === "fulfilled" ? crypto.value : [],
        trending_tech: tech.status === "fulfilled" ? tech.value : [],
        google_trends: gtrends.status === "fulfilled" ? gtrends.value : [],
        bing_news: bing.status === "fulfilled" ? bing.value : [],
      };

      logger.info(
        {
          crypto_movers: signals.crypto_movers.length,
          trending_tech: signals.trending_tech.length,
          google_trends: (signals.google_trends || []).length,
          bing_news: (signals.bing_news || []).length,
        },
        "Trend scan completed",
      );

      return signals;
    },

    async scanCrypto(): Promise<TrendSignals["crypto_movers"]> {
      const url = await getCoinGeckoUrl();
      const res = await fetch(url);
      if (!res.ok) {
        logger.warn({ status: res.status }, "CoinGecko request failed");
        return [];
      }
      const coins: any[] = await res.json();
      return coins
        .filter((c) => Math.abs(c.price_change_percentage_24h) > 5)
        .map((c) => ({
          coin: c.id,
          change_24h: c.price_change_percentage_24h,
          price: c.current_price,
          volume: c.total_volume,
        }))
        .sort((a, b) => Math.abs(b.change_24h) - Math.abs(a.change_24h));
    },

    async scanTech(): Promise<TrendSignals["trending_tech"]> {
      const res = await fetch(HN_TOP_URL);
      if (!res.ok) return [];
      const ids: number[] = await res.json();
      const top20 = ids.slice(0, 20);

      const stories = await Promise.all(
        top20.map(async (id) => {
          const r = await fetch(`${HN_ITEM_URL}/${id}.json`);
          return r.ok ? r.json() : null;
        }),
      );

      return stories
        .filter((s): s is any => s && s.score > 50)
        .map((s) => ({
          title: s.title,
          score: s.score,
          category: categorize(s.title),
          url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
          comments: s.descendants || 0,
        }))
        .filter((s) => ["AI/ML", "Crypto", "Programming"].includes(s.category))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    },

    async scanGoogleTrends(): Promise<NonNullable<TrendSignals["google_trends"]>> {
      try {
        const res = await fetch(GOOGLE_TRENDS_RSS_URL);
        if (!res.ok) {
          logger.warn({ status: res.status }, "Google Trends RSS request failed");
          return [];
        }
        const xml = await res.text();

        // Parse <item> blocks from RSS XML using regex (no new deps)
        const items: NonNullable<TrendSignals["google_trends"]> = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match: RegExpExecArray | null;
        while ((match = itemRegex.exec(xml)) !== null) {
          const block = match[1]!;
          const title = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || "";
          const traffic = block.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/)?.[1] || "";
          const newsItems = block.match(/<ht:news_item_title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/ht:news_item_title>/g) || [];
          const related = newsItems
            .map((n) => n.replace(/<\/?ht:news_item_title>|<!\[CDATA\[|\]\]>/g, ""))
            .slice(0, 3);

          // Only keep items relevant to crypto/tech/AI
          const combined = `${title} ${related.join(" ")}`;
          if (CRYPTO_TECH_KEYWORDS.test(combined)) {
            items.push({ keyword: title, traffic, related, region: "US" });
          }
        }

        return items.slice(0, 10);
      } catch (err) {
        logger.warn({ err }, "Google Trends scan failed (non-critical)");
        return [];
      }
    },

    async scanBingNews(): Promise<NonNullable<TrendSignals["bing_news"]>> {
      if (!BING_NEWS_KEY) return [];

      try {
        const queries = ["cryptocurrency blockchain", "artificial intelligence"];
        const allResults: NonNullable<TrendSignals["bing_news"]> = [];

        for (const q of queries) {
          const url = `${BING_NEWS_API_URL}?q=${encodeURIComponent(q)}&count=10&freshness=Day&mkt=en-US`;
          const res = await fetch(url, {
            headers: { "Ocp-Apim-Subscription-Key": BING_NEWS_KEY },
          });
          if (!res.ok) {
            logger.warn({ status: res.status, query: q }, "Bing News request failed");
            continue;
          }
          const data = (await res.json()) as {
            value: Array<{
              name: string;
              url: string;
              description: string;
              provider: Array<{ name: string }>;
              category?: string;
              datePublished: string;
            }>;
          };

          for (const article of data.value || []) {
            allResults.push({
              title: article.name,
              url: article.url,
              description: article.description,
              provider: article.provider?.[0]?.name || "Unknown",
              category: article.category || (q.includes("crypto") ? "Crypto" : "AI/ML"),
              datePublished: article.datePublished,
            });
          }
        }

        return allResults.slice(0, 15);
      } catch (err) {
        logger.warn({ err }, "Bing News scan failed (non-critical)");
        return [];
      }
    },
  };
}
