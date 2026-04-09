import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Blog Publisher — shared utilities for publishing to coherencedaddy.com blog
// Used by seo-engine.ts (signal-based) and content-crons.ts (Ollama content queue)
// ---------------------------------------------------------------------------

const OLLAMA_URL = process.env.OLLAMA_URL || "http://168.231.127.180:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";
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

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  category: "ai-agents" | "crypto" | "tools" | "ecosystem" | "lifestyle";
  keywords: string[];
  content: string;
  reading_time: number;
}

// ---------------------------------------------------------------------------
// Slug generator
// ---------------------------------------------------------------------------

export function makeSlug(title: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base}-${date}`;
}

// ---------------------------------------------------------------------------
// Ollama — primary LLM for blog generation (free, self-hosted on VPS)
// ---------------------------------------------------------------------------

export async function callOllamaBlog(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`Ollama error (${res.status}): ${errorText}`);
  }

  const data = (await res.json()) as { response: string };
  return data.response.trim();
}

// ---------------------------------------------------------------------------
// Generate a full BlogPost via Ollama from a signal topic
// ---------------------------------------------------------------------------

export async function generateBlogPostOllama(signal: {
  type: "crypto" | "ai-agents" | "tools" | "lifestyle";
  topic: string;
  details: string;
}): Promise<BlogPost> {
  const category = signal.type;
  const relatedTools = TOOL_LINKS[category] || TOOL_LINKS.tools!;
  const toolLinksStr = relatedTools
    .slice(0, 4)
    .map((t) => `- <a href="https://freetools.coherencedaddy.com/${t.slug}">${t.name}</a>`)
    .join("\n");

  const prompt = `You are a content writer for Coherence Daddy, a faith-driven technology ecosystem. Write an SEO-optimized blog post about crypto, AI, tech tools, personal finance, self-help, wellness, faith, and entrepreneurship. Always include internal links to free tools on freetools.coherencedaddy.com. Write in HTML format (h2, p, a, ul, li tags only). No markdown.

Write a blog post (600-800 words) about: "${signal.topic}"

Details: ${signal.details}

Category: ${category}

Include these internal tool links naturally in the content:
${toolLinksStr}

Return ONLY a JSON object with these fields (no markdown fences, no extra text):
{
  "title": "catchy SEO title under 70 chars",
  "description": "SEO description under 160 chars",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "content": "<h2>...</h2><p>...</p>..."
}`;

  const raw = await callOllamaBlog(prompt);

  // Parse JSON — handle markdown fences Ollama sometimes adds
  const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();

  // Find JSON object bounds in case Ollama adds extra text
  const start = jsonStr.indexOf("{");
  const end = jsonStr.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Ollama did not return valid JSON. Raw: ${raw.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonStr.slice(start, end + 1)) as {
    title: string;
    description: string;
    keywords: string[];
    content: string;
  };

  const wordCount = parsed.content.replace(/<[^>]+>/g, "").split(/\s+/).length;

  return {
    slug: makeSlug(parsed.title),
    title: parsed.title,
    description: parsed.description,
    category,
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    content: parsed.content,
    reading_time: Math.ceil(wordCount / 200) || 1,
  };
}

// ---------------------------------------------------------------------------
// Format raw HTML content + topic into a BlogPost for publishing
// Used by content-crons.ts after Ollama generates blog_post content
// ---------------------------------------------------------------------------

export function buildBlogPostFromContent(
  htmlContent: string,
  topic: string,
  category: BlogPost["category"] = "ecosystem",
): BlogPost {
  // Extract title from first h1 or h2 tag
  const titleMatch = htmlContent.match(/<h[12][^>]*>(.*?)<\/h[12]>/is);
  const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : topic;
  const title = rawTitle.slice(0, 100);

  // Description: first 160 chars of topic (or first paragraph text)
  const paraMatch = htmlContent.match(/<p[^>]*>(.*?)<\/p>/is);
  const paraText = paraMatch ? paraMatch[1].replace(/<[^>]+>/g, "").trim() : "";
  const description = (paraText || topic).slice(0, 160);

  // Keywords from topic words (filter short words)
  const keywords = topic
    .split(/[\s,]+/)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 3)
    .slice(0, 6);

  const wordCount = htmlContent.replace(/<[^>]+>/g, "").split(/\s+/).filter(Boolean).length;

  return {
    slug: makeSlug(title),
    title,
    description,
    category,
    keywords,
    content: htmlContent,
    reading_time: Math.ceil(wordCount / 200) || 1,
  };
}

// ---------------------------------------------------------------------------
// Publish BlogPost to coherencedaddy.com blog API
// ---------------------------------------------------------------------------

export async function publishPost(post: BlogPost): Promise<{ success: boolean; error?: string }> {
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

  const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error: string };

  // Duplicate slug — retry with timestamp suffix
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
// IndexNow ping — notify search engines of new content
// ---------------------------------------------------------------------------

export async function pingIndexNow(urls: string[]): Promise<void> {
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
// publishBlogFromContent — high-level helper for content-crons
// Takes raw HTML content + topic, formats, publishes, pings IndexNow
// ---------------------------------------------------------------------------

export async function publishBlogFromContent(
  htmlContent: string,
  topic: string,
  category: BlogPost["category"] = "ecosystem",
): Promise<{ success: boolean; slug?: string; title?: string; error?: string }> {
  const post = buildBlogPostFromContent(htmlContent, topic, category);
  const result = await publishPost(post);

  if (result.success) {
    await pingIndexNow([`https://coherencedaddy.com/blog/${post.slug}`]);
    return { success: true, slug: post.slug, title: post.title };
  }

  return { success: false, error: result.error };
}
