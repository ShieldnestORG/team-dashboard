import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { partnerCompanies } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Blog Publisher — multi-target publishing to coherencedaddy.com + shieldnest.io
// Used by seo-engine.ts (signal-based) and content-crons.ts (Ollama content queue)
// ---------------------------------------------------------------------------

import { callOllamaGenerate, OLLAMA_MODEL } from "./ollama-client.js";
const BLOG_API_URL = process.env.CD_BLOG_API_URL || "https://coherencedaddy.com/api/blog/posts";
const BLOG_API_KEY = process.env.CD_BLOG_API_KEY || "";
const SN_BLOG_API_URL = process.env.SN_BLOG_API_URL || "";
const SN_BLOG_API_KEY = process.env.SN_BLOG_API_KEY || "";
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || "";

export type PublishTarget = "cd" | "sn" | "all";

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
  category: "ai-agents" | "crypto" | "tools" | "ecosystem" | "lifestyle" | "xrp" | "comparison";
  keywords: string[];
  content: string;
  reading_time: number;
}

// tokns.fi / TX ecosystem links — injected into crypto, ecosystem, xrp, comparison posts
const TOKNS_LINKS: Array<{ name: string; url: string }> = [
  { name: "tokns.fi Dashboard", url: "https://app.tokns.fi" },
  { name: "Stake TX Tokens", url: "https://app.tokns.fi/staking" },
  { name: "TX NFT Marketplace", url: "https://app.tokns.fi/nfts" },
  { name: "Token Swaps", url: "https://app.tokns.fi/swap" },
  { name: "Multi-Wallet Tracker", url: "https://app.tokns.fi/wallets" },
  { name: "TX Blockchain", url: "https://tokns.fi" },
  { name: "TX Chain Explorer", url: "https://tx.org" },
];

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

export const callOllamaBlog = callOllamaGenerate;

// ---------------------------------------------------------------------------
// Generate a full BlogPost via Ollama from a signal topic
// ---------------------------------------------------------------------------

export async function generateBlogPostOllama(signal: {
  type: "crypto" | "ai-agents" | "tools" | "lifestyle";
  topic: string;
  details: string;
}, intelContext = ""): Promise<BlogPost> {
  const category = signal.type;
  const relatedTools = TOOL_LINKS[category] || TOOL_LINKS.tools!;
  const toolLinksStr = relatedTools
    .slice(0, 4)
    .map((t) => `- <a href="https://freetools.coherencedaddy.com/${t.slug}">${t.name}</a>`)
    .join("\n");

  const contextBlock = intelContext ? `\nUse this real-time data and analysis to make the article factual and data-backed:\n${intelContext}\n` : "";

  const prompt = `You are a content writer for Coherence Daddy, a faith-driven technology ecosystem. Write an SEO-optimized blog post about crypto, AI, tech tools, personal finance, self-help, wellness, faith, and entrepreneurship. Always include internal links to free tools on freetools.coherencedaddy.com. Write in HTML format (h2, p, a, ul, li tags only). No markdown.

Write a blog post (600-800 words) about: "${signal.topic}"

Details: ${signal.details}
${contextBlock}
Category: ${category}

Include these internal tool links naturally in the content:
${toolLinksStr}
${["crypto", "ecosystem", "xrp", "comparison"].includes(category) ? `
Also include these TX ecosystem links naturally:
${TOKNS_LINKS.slice(0, 4).map((t) => `- <a href="${t.url}">${t.name}</a>`).join("\n")}
` : ""}
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
// Publish BlogPost to ShieldNest articles API
// ---------------------------------------------------------------------------

export async function publishToShieldNest(post: BlogPost): Promise<{ success: boolean; error?: string }> {
  if (!SN_BLOG_API_URL || !SN_BLOG_API_KEY) {
    return { success: false, error: "SN_BLOG_API_URL or SN_BLOG_API_KEY not set" };
  }

  try {
    const res = await fetch(SN_BLOG_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SN_BLOG_API_KEY}`,
      },
      body: JSON.stringify(post),
    });

    if (res.ok) {
      logger.info({ slug: post.slug, target: "shieldnest" }, "Blog published to ShieldNest");
      return { success: true };
    }

    const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error: string };
    return { success: false, error: err.error };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Publish to multiple targets in parallel
// ---------------------------------------------------------------------------

interface MultiTargetResult {
  cd?: { success: boolean; error?: string };
  sn?: { success: boolean; error?: string };
}

export async function publishToTargets(
  post: BlogPost,
  target: PublishTarget = "cd",
): Promise<MultiTargetResult> {
  const results: MultiTargetResult = {};

  const promises: Promise<void>[] = [];

  if (target === "cd" || target === "all") {
    promises.push(
      publishPost(post).then((r) => { results.cd = r; }),
    );
  }

  if (target === "sn" || target === "all") {
    promises.push(
      publishToShieldNest(post).then((r) => { results.sn = r; }),
    );
  }

  await Promise.allSettled(promises);
  return results;
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
// Build a "Recommended Partners" HTML footer for blog posts
// ---------------------------------------------------------------------------

const PARTNER_COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

export async function buildPartnerFooter(db: Db, _category: string): Promise<string> {
  try {
    const partners = await db
      .select()
      .from(partnerCompanies)
      .where(
        and(
          eq(partnerCompanies.companyId, PARTNER_COMPANY_ID),
          eq(partnerCompanies.siteDeployStatus, "deployed"),
        ),
      )
      .limit(3);

    if (partners.length === 0) return "";

    const items = partners
      .map((p) => {
        const desc = p.description || p.industry || "local business";
        const loc = p.location ? ` in ${p.location}` : "";
        return `  <li><a href="https://coherencedaddy.com/go/${p.slug}?src=cd-blog">${p.name}</a> &mdash; ${desc}${loc}</li>`;
      })
      .join("\n");

    return `\n<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb">\n  <h3>Recommended Partners</h3>\n  <ul>\n${items}\n  </ul>\n</div>`;
  } catch (err) {
    logger.error({ err }, "Failed to build partner footer for blog post");
    return "";
  }
}

// ---------------------------------------------------------------------------
// publishBlogFromContent — high-level helper for content-crons
// Takes raw HTML content + topic, formats, publishes to target(s), pings IndexNow
// ---------------------------------------------------------------------------

export async function publishBlogFromContent(
  htmlContent: string,
  topic: string,
  category: BlogPost["category"] = "ecosystem",
  target: PublishTarget = "cd",
): Promise<{ success: boolean; slug?: string; title?: string; error?: string }> {
  const post = buildBlogPostFromContent(htmlContent, topic, category);
  const results = await publishToTargets(post, target);

  const anySuccess = results.cd?.success || results.sn?.success;

  if (anySuccess) {
    // Ping IndexNow for published targets
    if (results.cd?.success) {
      await pingIndexNow([`https://coherencedaddy.com/blog/${post.slug}`]);
    }
    if (results.sn?.success) {
      await pingIndexNow([`https://app.tokns.fi/chain-updates/${post.slug}`]);
    }

    const errors: string[] = [];
    if (results.cd && !results.cd.success && (target === "cd" || target === "all")) {
      errors.push(`cd: ${results.cd.error}`);
    }
    if (results.sn && !results.sn.success && (target === "sn" || target === "all")) {
      errors.push(`sn: ${results.sn.error}`);
    }

    return {
      success: true,
      slug: post.slug,
      title: post.title,
      error: errors.length > 0 ? `Partial: ${errors.join(", ")}` : undefined,
    };
  }

  const allErrors = [
    results.cd?.error && `cd: ${results.cd.error}`,
    results.sn?.error && `sn: ${results.sn.error}`,
  ].filter(Boolean).join(", ");

  return { success: false, error: allErrors || "All targets failed" };
}
