import { logger } from "../middleware/logger.js";
import { getLatestSignals } from "./trend-crons.js";
import type { TrendSignals } from "./trend-scanner.js";

// ---------------------------------------------------------------------------
// SEO Content Engine — generates blog posts from trend signals and publishes
// to coherencedaddy.com via the blog API
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const BLOG_API_URL = process.env.CD_BLOG_API_URL || "https://coherencedaddy.com/api/blog/posts";
const BLOG_API_KEY = process.env.CD_BLOG_API_KEY || "";
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || "";

// Tool slugs grouped by category for internal linking
const TOOL_LINKS: Record<string, Array<{ name: string; slug: string }>> = {
  crypto: [
    { name: "Meme Coin Tracker", slug: "meme-coin-tracker" },
    { name: "Crypto Sentiment", slug: "crypto-sentiment" },
    { name: "Crypto ROI Calculator", slug: "crypto-roi-calculator" },
    { name: "Yield Farming Calculator", slug: "yield-farming-calculator" },
    { name: "Wei to Ether Converter", slug: "wei-to-ether-converter" },
  ],
  "ai-agents": [
    { name: "Agent Comparison", slug: "agent-comparison" },
    { name: "Agent Cost Calculator", slug: "agent-cost-calculator" },
    { name: "Token Counter", slug: "token-counter" },
    { name: "Prompt Template Builder", slug: "prompt-template-builder" },
    { name: "AI Readiness Quiz", slug: "readiness-quiz" },
  ],
  tools: [
    { name: "JSON Formatter", slug: "json-formatter" },
    { name: "JWT Decoder", slug: "jwt-decoder" },
    { name: "Regex Tester", slug: "regex-tester" },
    { name: "Base64 Encoder", slug: "base64-encoder" },
    { name: "Markdown Preview", slug: "markdown-preview" },
  ],
  lifestyle: [
    { name: "Budget Planner", slug: "budget-planner" },
    { name: "Habit Tracker", slug: "habit-tracker" },
    { name: "Goal Setter", slug: "goal-setter" },
    { name: "Journaling Prompt", slug: "journaling-prompt" },
    { name: "Readiness Quiz", slug: "readiness-quiz" },
  ],
};

interface BlogPost {
  slug: string;
  title: string;
  description: string;
  category: "ai-agents" | "crypto" | "tools" | "ecosystem" | "lifestyle";
  keywords: string[];
  content: string;
  reading_time: number;
}

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

async function callClaude(system: string, prompt: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown");
    throw new Error(`Claude API error (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
  return data.content[0]?.text || "";
}

// ---------------------------------------------------------------------------
// Blog post generation
// ---------------------------------------------------------------------------

type SignalType = "crypto" | "ai-agents" | "tools" | "lifestyle";

const LIFESTYLE_CATEGORIES = ["Personal Finance", "Self-Help", "Wellness", "Faith", "Entrepreneurship"];

function categoryToSignalType(category: string): SignalType {
  if (category === "Crypto") return "crypto";
  if (category === "AI/ML") return "ai-agents";
  if (LIFESTYLE_CATEGORIES.includes(category)) return "lifestyle";
  return "tools";
}

function pickSignal(signals: TrendSignals): { type: SignalType; topic: string; details: string } | null {
  // Priority 1: crypto mover with >15% change
  const bigMover = signals.crypto_movers.find((c: TrendSignals["crypto_movers"][number]) => Math.abs(c.change_24h) > 15);
  if (bigMover) {
    return {
      type: "crypto",
      topic: `${bigMover.coin} ${bigMover.change_24h > 0 ? "surges" : "drops"} ${Math.abs(bigMover.change_24h).toFixed(1)}%`,
      details: `Price: $${bigMover.price}, Volume: $${bigMover.volume.toLocaleString()}`,
    };
  }

  // Priority 2: Google Trends keyword with high traffic
  const gtHigh = (signals.google_trends || []).find((g) => {
    const trafficNum = parseInt(g.traffic.replace(/[^0-9]/g, ""), 10) || 0;
    return trafficNum >= 50000;
  });
  if (gtHigh) {
    const kw = gtHigh.keyword.toLowerCase();
    const isCrypto = /crypto|bitcoin|btc|ethereum|blockchain/i.test(kw);
    const isLifestyle = /passive.?income|invest|finance|budget|self.?help|wellness|faith|spiritual|meditation|productivity|entrepreneur|side.?hustle/i.test(kw);
    return {
      type: isCrypto ? "crypto" : isLifestyle ? "lifestyle" : "ai-agents",
      topic: `${gtHigh.keyword} trending on Google (${gtHigh.traffic} searches)`,
      details: `Related: ${gtHigh.related.slice(0, 2).join(", ")}`,
    };
  }

  // Priority 3: AI/ML trending story with >200 score
  const aiStory = signals.trending_tech.find((s: TrendSignals["trending_tech"][number]) => s.category === "AI/ML" && s.score > 200);
  if (aiStory) {
    return { type: "ai-agents", topic: aiStory.title, details: `Score: ${aiStory.score}, ${aiStory.comments} comments` };
  }

  // Priority 4: Lifestyle/finance trending story with >100 score
  const lifestyleStory = signals.trending_tech.find((s: TrendSignals["trending_tech"][number]) => LIFESTYLE_CATEGORIES.includes(s.category) && s.score > 100);
  if (lifestyleStory) {
    return { type: "lifestyle", topic: lifestyleStory.title, details: `Score: ${lifestyleStory.score}, Category: ${lifestyleStory.category}` };
  }

  // Priority 5: Bing News headline
  const bingHit = (signals.bing_news || []).find((b) =>
    b.category === "Crypto" || b.category === "AI/ML" || LIFESTYLE_CATEGORIES.includes(b.category),
  );
  if (bingHit) {
    return {
      type: categoryToSignalType(bingHit.category),
      topic: bingHit.title,
      details: `Source: ${bingHit.provider}, Published: ${bingHit.datePublished.slice(0, 10)}`,
    };
  }

  // Priority 6: Any crypto mover
  if (signals.crypto_movers.length > 0) {
    const top = signals.crypto_movers[0]!;
    return {
      type: "crypto",
      topic: `${top.coin} moves ${Math.abs(top.change_24h).toFixed(1)}%`,
      details: `Price: $${top.price}`,
    };
  }

  // Priority 7: Any tech trend
  const techStory = signals.trending_tech[0];
  if (techStory) {
    return { type: categoryToSignalType(techStory.category), topic: techStory.title, details: `Score: ${techStory.score}` };
  }

  return null;
}

function makeSlug(title: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base}-${date}`;
}

async function generateBlogPost(signal: NonNullable<ReturnType<typeof pickSignal>>): Promise<BlogPost> {
  const category = signal.type;
  const relatedTools = TOOL_LINKS[category] || TOOL_LINKS.tools!;
  const toolLinksStr = relatedTools
    .slice(0, 4)
    .map((t) => `- <a href="https://freetools.coherencedaddy.com/${t.slug}">${t.name}</a>`)
    .join("\n");

  const system = `You are a content writer for Coherence Daddy, a 508(c)(1)(A) faith-driven technology ecosystem. Write engaging, SEO-optimized blog posts about crypto, AI, tech tools, personal finance, passive income, self-help, wellness, faith, and entrepreneurship. Always include internal links to free tools on freetools.coherencedaddy.com. Write in HTML format (h2, p, a, ul, li tags). No markdown.`;

  const prompt = `Write a blog post (600-800 words) about: "${signal.topic}"

Details: ${signal.details}

Category: ${category}

Include these internal tool links naturally in the content:
${toolLinksStr}

Return ONLY a JSON object with these fields (no markdown fences):
{
  "title": "catchy SEO title under 70 chars",
  "description": "SEO description under 160 chars",
  "keywords": ["keyword1", "keyword2", ...],
  "content": "<h2>...</h2><p>...</p>..."
}`;

  const raw = await callClaude(system, prompt);

  // Parse JSON from response (handle potential markdown fences)
  const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(jsonStr) as { title: string; description: string; keywords: string[]; content: string };

  const wordCount = parsed.content.replace(/<[^>]+>/g, "").split(/\s+/).length;

  return {
    slug: makeSlug(parsed.title),
    title: parsed.title,
    description: parsed.description,
    category,
    keywords: parsed.keywords,
    content: parsed.content,
    reading_time: Math.ceil(wordCount / 200),
  };
}

// ---------------------------------------------------------------------------
// Publish to coherencedaddy blog API
// ---------------------------------------------------------------------------

async function publishPost(post: BlogPost): Promise<{ success: boolean; error?: string }> {
  if (!BLOG_API_KEY) {
    return { success: false, error: "CD_BLOG_API_KEY not set" };
  }

  const res = await fetch(BLOG_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BLOG_API_KEY}`,
    },
    body: JSON.stringify(post),
  });

  if (res.ok) {
    return { success: true };
  }

  const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error: string };

  // If duplicate slug, append timestamp
  if (res.status === 409) {
    post.slug = `${post.slug}-${Date.now()}`;
    const retry = await fetch(BLOG_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BLOG_API_KEY}`,
      },
      body: JSON.stringify(post),
    });
    return { success: retry.ok, error: retry.ok ? undefined : `Retry failed: ${retry.status}` };
  }

  return { success: false, error: err.error };
}

// ---------------------------------------------------------------------------
// IndexNow ping
// ---------------------------------------------------------------------------

async function pingIndexNow(urls: string[]): Promise<void> {
  if (urls.length === 0 || !INDEXNOW_KEY) return;

  try {
    const host = new URL(urls[0]!).host;
    await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `https://${host}/${INDEXNOW_KEY}.txt`,
        urlList: urls,
      }),
    });
    logger.info({ urls }, "IndexNow pinged");
  } catch (err) {
    logger.warn({ err }, "IndexNow ping failed (non-critical)");
  }
}

// ---------------------------------------------------------------------------
// Main engine run
// ---------------------------------------------------------------------------

export function seoEngineService() {
  return {
    async run(): Promise<{ posted: boolean; title?: string; slug?: string; error?: string }> {
      // 1. Get latest signals
      const signals = getLatestSignals() as TrendSignals | null;
      if (!signals) {
        logger.info("No signals available, skipping SEO engine run");
        return { posted: false, error: "No signals" };
      }

      // 2. Pick strongest signal
      const signal = pickSignal(signals);
      if (!signal) {
        logger.info("No actionable signals found");
        return { posted: false, error: "No actionable signals" };
      }

      logger.info({ signal: signal.topic, type: signal.type }, "SEO engine: generating post");

      // 3. Generate blog post via Claude
      const post = await generateBlogPost(signal);

      // 4. Publish to coherencedaddy
      const result = await publishPost(post);

      if (result.success) {
        logger.info({ title: post.title, slug: post.slug }, "SEO engine: post published");

        // 5. Ping IndexNow
        await pingIndexNow([`https://coherencedaddy.com/blog/${post.slug}`]);

        return { posted: true, title: post.title, slug: post.slug };
      }

      logger.error({ error: result.error }, "SEO engine: failed to publish");
      return { posted: false, error: result.error };
    },
  };
}
