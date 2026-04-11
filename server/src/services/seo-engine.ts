import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { getLatestSignals } from "./trend-crons.js";
import type { TrendSignals } from "./trend-scanner.js";
import {
  type BlogPost,
  makeSlug,
  publishPost,
  publishToTargets,
  pingIndexNow,
  callOllamaBlog,
  generateBlogPostOllama,
} from "./blog-publisher.js";
import { embedPublishedContent } from "./content-embedder.js";
import { fetchQualityContext } from "./intel-quality.js";

// ---------------------------------------------------------------------------
// SEO Content Engine — generates blog posts from trend signals and publishes
// to coherencedaddy.com via the blog API.
//
// LLM strategy: Ollama (free, VPS) is tried first. Falls back to Claude if
// Ollama fails and ANTHROPIC_API_KEY is set.
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

// ---------------------------------------------------------------------------
// Claude API call — fallback when Ollama is unavailable
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
// Blog post generation — signal-based prompt (same for Ollama and Claude)
// ---------------------------------------------------------------------------

type SignalType = "crypto" | "ai-agents" | "tools" | "lifestyle";

const LIFESTYLE_CATEGORIES = ["Personal Finance", "Self-Help", "Wellness", "Faith", "Entrepreneurship"];

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

function categoryToSignalType(category: string): SignalType {
  if (category === "Crypto") return "crypto";
  if (category === "AI/ML") return "ai-agents";
  if (LIFESTYLE_CATEGORIES.includes(category)) return "lifestyle";
  return "tools";
}

function pickSignal(signals: TrendSignals): { type: SignalType; topic: string; details: string } | null {
  // Priority 1: crypto mover with >5% change
  const bigMover = signals.crypto_movers.find((c: TrendSignals["crypto_movers"][number]) => Math.abs(c.change_24h) > 5);
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
    return trafficNum >= 10000;
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

  // Priority 3: AI/ML trending story with >50 score
  const aiStory = signals.trending_tech.find((s: TrendSignals["trending_tech"][number]) => s.category === "AI/ML" && s.score > 50);
  if (aiStory) {
    return { type: "ai-agents", topic: aiStory.title, details: `Score: ${aiStory.score}, ${aiStory.comments} comments` };
  }

  // Priority 4: Lifestyle/finance trending story with >30 score
  const lifestyleStory = signals.trending_tech.find((s: TrendSignals["trending_tech"][number]) => LIFESTYLE_CATEGORIES.includes(s.category) && s.score > 30);
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

// Claude-based blog post generation (fallback)
async function generateBlogPostClaude(signal: NonNullable<ReturnType<typeof pickSignal>>, intelContext = ""): Promise<BlogPost> {
  const category = signal.type;
  const relatedTools = TOOL_LINKS[category] || TOOL_LINKS.tools!;
  const toolLinksStr = relatedTools
    .slice(0, 4)
    .map((t) => `- <a href="https://freetools.coherencedaddy.com/${t.slug}">${t.name}</a>`)
    .join("\n");

  const system = `You are a content writer for Coherence Daddy, a 508(c)(1)(A) faith-driven technology ecosystem. Write engaging, SEO-optimized blog posts about crypto, AI, tech tools, personal finance, passive income, self-help, wellness, faith, and entrepreneurship. Always include internal links to free tools on freetools.coherencedaddy.com. Write in HTML format (h2, p, a, ul, li tags). No markdown.`;

  const contextBlock = intelContext ? `\n\nUse this real-time data and analysis to make the article factual and data-backed:\n${intelContext}\n` : "";

  const prompt = `Write a blog post (600-800 words) about: "${signal.topic}"

Details: ${signal.details}
${contextBlock}
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

// Primary generator: try Ollama (free), fall back to Claude
async function generateBlogPost(signal: NonNullable<ReturnType<typeof pickSignal>>, intelContext = ""): Promise<BlogPost> {
  try {
    const post = await generateBlogPostOllama(signal, intelContext);
    logger.info({ backend: "ollama", title: post.title, hasContext: !!intelContext }, "SEO engine: blog post generated via Ollama");
    return post;
  } catch (ollamaErr) {
    logger.warn({ err: ollamaErr }, "SEO engine: Ollama generation failed, trying Claude fallback");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("Ollama failed and ANTHROPIC_API_KEY not set — no LLM available");
    }

    const post = await generateBlogPostClaude(signal, intelContext);
    logger.info({ backend: "claude", title: post.title, hasContext: !!intelContext }, "SEO engine: blog post generated via Claude");
    return post;
  }
}

// ---------------------------------------------------------------------------
// Main engine run
// ---------------------------------------------------------------------------

export function seoEngineService(db?: Db) {
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

      // 2b. Fetch intel context for richer content (if db available)
      let intelContext = "";
      if (db) {
        try {
          intelContext = await fetchQualityContext(db, signal.topic, 5);
        } catch (err) {
          logger.warn({ err }, "SEO engine: intel context fetch failed, generating without context");
        }
      }

      // 3. Generate blog post (Ollama first, Claude fallback)
      const post = await generateBlogPost(signal, intelContext);

      // 4. Publish to coherencedaddy + app.tokns.fi
      const results = await publishToTargets(post, "all");
      const anySuccess = results.cd?.success || results.sn?.success;

      if (anySuccess) {
        logger.info({ title: post.title, slug: post.slug, cd: results.cd?.success, sn: results.sn?.success }, "SEO engine: post published");

        // 5. Ping IndexNow (CD only — public, search-indexed)
        if (results.cd?.success) {
          await pingIndexNow([`https://coherencedaddy.com/blog/${post.slug}`]);
        }

        // 6. Embed published content back into intel for future enrichment
        if (db) {
          await embedPublishedContent(db, {
            title: post.title,
            content: post.content,
            slug: post.slug,
            category: signal.type,
          });
        }

        return { posted: true, title: post.title, slug: post.slug };
      }

      const allErrors = [
        results.cd?.error && `cd: ${results.cd.error}`,
        results.sn?.error && `sn: ${results.sn.error}`,
      ].filter(Boolean).join(", ");
      logger.error({ error: allErrors }, "SEO engine: failed to publish");
      return { posted: false, error: allErrors };
    },
  };
}

// Re-export shared types for any callers that imported them from here
export type { BlogPost };
export { makeSlug, publishPost, pingIndexNow, callOllamaBlog };
