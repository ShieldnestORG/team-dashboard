import { logger } from "../middleware/logger.js";

export interface TrendSignals {
  timestamp: string;
  crypto_movers: Array<{ coin: string; change_24h: number; price: number; volume: number }>;
  trending_tech: Array<{ title: string; score: number; category: string; url: string; comments: number }>;
}

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=dogecoin,shiba-inu,pepe,dogwifhat,bonk,floki,brett,turbo,mog-coin,popcat,book-of-meme,cat-in-a-dogs-world,neiro,ponke,bitcoin,ethereum,solana&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d";

const HN_TOP_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";

function categorize(title: string): string {
  const t = title.toLowerCase();
  if (/\b(ai|llm|gpt|claude|gemini|machine.?learn|neural|transformer|diffusion|openai|anthropic|model)\b/.test(t)) return "AI/ML";
  if (/\b(crypto|bitcoin|btc|ethereum|eth|solana|blockchain|defi|nft|token|web3)\b/.test(t)) return "Crypto";
  if (/\b(rust|go|python|typescript|react|node|api|database|sql|devops|docker|kubernetes)\b/.test(t)) return "Programming";
  if (/\b(startup|vc|funding|ipo|acquisition|revenue|saas|b2b)\b/.test(t)) return "Business";
  return "Technology";
}

export function trendScannerService() {
  return {
    async scan(): Promise<TrendSignals> {
      const [crypto, tech] = await Promise.allSettled([
        this.scanCrypto(),
        this.scanTech(),
      ]);

      const signals: TrendSignals = {
        timestamp: new Date().toISOString(),
        crypto_movers: crypto.status === "fulfilled" ? crypto.value : [],
        trending_tech: tech.status === "fulfilled" ? tech.value : [],
      };

      logger.info(
        { crypto_movers: signals.crypto_movers.length, trending_tech: signals.trending_tech.length },
        "Trend scan completed",
      );

      return signals;
    },

    async scanCrypto(): Promise<TrendSignals["crypto_movers"]> {
      const res = await fetch(COINGECKO_URL);
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
  };
}
