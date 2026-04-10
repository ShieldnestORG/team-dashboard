import FirecrawlApp from "@mendable/firecrawl-js";
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { ToolRunContext, ToolResult, PluginContext, PluginJobContext } from "@paperclipai/plugin-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Types ─────────────────────────────────────────────────────────────────────

type FirecrawlConfig = {
  apiKey?: string;
  apiUrl?: string;
  directoryApiUrl?: string;
  directoryApiSecret?: string;
  embeddingApiUrl?: string;
  embeddingApiKey?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
};

type MetricEntry = {
  ts: number;
  tool: string;
  mode: "cloud" | "self-hosted";
  target: string;
  durationMs: number;
  charsReturned: number;
  success: boolean;
  error?: string;
};

type ScrapeEntityData = {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  venture?: string;
  category?: string;
  competitorName?: string;
  tags: string[];
  summary?: string;
  charCount: number;
  linkCount: number;
  scrapedAt: string;
  classifiedAt?: string;
  staleSince?: string;
  source: "scrape" | "crawl" | "search" | "extract";
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

const METRICS_FILE = path.join(
  os.homedir(), ".paperclip", "instances", "default", "firecrawl-metrics.jsonl"
);

function logMetric(entry: MetricEntry): void {
  try {
    fs.mkdirSync(path.dirname(METRICS_FILE), { recursive: true });
    fs.appendFileSync(METRICS_FILE, JSON.stringify(entry) + "\n");
  } catch { /* non-fatal */ }
}

function getMode(config: FirecrawlConfig): "cloud" | "self-hosted" {
  return config.apiUrl ? "self-hosted" : "cloud";
}

function getClient(config: FirecrawlConfig): FirecrawlApp {
  if (!config.apiUrl && !config.apiKey) {
    throw new Error(
      "Firecrawl not configured. Set Self-Hosted URL or Cloud API Key in Settings -> Plugins -> Firecrawl."
    );
  }
  const apiKey = config.apiKey || (config.apiUrl ? "self-hosted" : "");
  return new FirecrawlApp({ apiKey, apiUrl: config.apiUrl || undefined });
}

function truncate(text: string, maxChars = 50000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n\n[...truncated at ${maxChars} chars]`;
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    // Remove trailing slash for consistency
    let s = u.toString();
    if (s.endsWith("/") && u.pathname === "/") s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ─── Persistence helpers ───────────────────────────────────────────────────────

async function persistScrapeResult(
  ctx: PluginContext,
  url: string,
  markdown: string,
  links: string[],
  metadata: Record<string, unknown>,
  source: ScrapeEntityData["source"],
): Promise<void> {
  const normalized = normalizeUrl(url);
  const domain = extractDomain(url);
  const title = (metadata.title as string) || undefined;
  const description = (metadata.description as string) || undefined;

  // 1. Upsert the structured entity
  const entityData: ScrapeEntityData = {
    url: normalized,
    domain,
    title,
    description,
    tags: [],
    charCount: markdown.length,
    linkCount: links.length,
    scrapedAt: new Date().toISOString(),
    source,
  };

  await ctx.entities.upsert({
    entityType: "scrape-result",
    scopeKind: "instance",
    externalId: normalized,
    title: title || domain,
    status: "active",
    data: entityData as unknown as Record<string, unknown>,
  });

  // 2. Store full markdown content separately (large blob)
  await ctx.state.set(
    { scopeKind: "instance", namespace: "scrape-content", stateKey: normalized },
    { markdown: truncate(markdown, 100000), links: links.slice(0, 200), scrapedAt: entityData.scrapedAt },
  );
}

// ─── Plugin definition ─────────────────────────────────────────────────────────

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Firecrawl plugin v0.2.0 ready — auto-persist enabled");

    // ── scrape ────────────────────────────────────────────────────────────────
    ctx.tools.register(
      "scrape",
      {
        displayName: "Firecrawl: Scrape URL",
        description: "Scrape a single URL to markdown. Auto-persists.",
        parametersSchema: {
          type: "object", required: ["url"],
          properties: {
            url: { type: "string" },
            formats: { type: "array", items: { type: "string" } },
            onlyMainContent: { type: "boolean" },
          },
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { url: string; formats?: string[]; onlyMainContent?: boolean };
        const config = (await ctx.config.get()) as FirecrawlConfig;
        const client = getClient(config);
        const start = Date.now();

        try {
          const result = await client.scrapeUrl(p.url, {
            formats: (p.formats ?? ["markdown"]) as ("markdown" | "html" | "links" | "screenshot")[],
            onlyMainContent: p.onlyMainContent ?? true,
          });

          if (!result.success) {
            const err = (result as { error?: string }).error ?? "unknown error";
            logMetric({ ts: Date.now(), tool: "scrape", mode: getMode(config), target: p.url, durationMs: Date.now() - start, charsReturned: 0, success: false, error: err });
            return { error: `Firecrawl scrape failed: ${err}` };
          }

          const markdown = result.markdown ?? "";
          const links = result.links ?? [];
          logMetric({ ts: Date.now(), tool: "scrape", mode: getMode(config), target: p.url, durationMs: Date.now() - start, charsReturned: markdown.length, success: true });

          // Auto-persist
          await persistScrapeResult(ctx, p.url, markdown, links, result.metadata ?? {}, "scrape");

          return {
            content: `Scraped & stored: ${p.url}\nLength: ${markdown.length} chars${links.length ? `\nLinks: ${links.length}` : ""}\n\n${truncate(markdown)}`,
            data: { url: p.url, markdown: truncate(markdown), links: links.slice(0, 50), metadata: result.metadata ?? {}, persisted: true },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logMetric({ ts: Date.now(), tool: "scrape", mode: getMode(config), target: p.url, durationMs: Date.now() - start, charsReturned: 0, success: false, error: msg });
          return { error: `Scrape error: ${msg}` };
        }
      }
    );

    // ── crawl ─────────────────────────────────────────────────────────────────
    ctx.tools.register(
      "crawl",
      {
        displayName: "Firecrawl: Crawl Site",
        description: "Crawl a website, return all pages as markdown. Auto-persists each page.",
        parametersSchema: {
          type: "object", required: ["url"],
          properties: {
            url: { type: "string" },
            maxPages: { type: "number" },
            excludePaths: { type: "array", items: { type: "string" } },
          },
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { url: string; maxPages?: number; excludePaths?: string[] };
        const config = (await ctx.config.get()) as FirecrawlConfig;
        const client = getClient(config);
        const start = Date.now();

        try {
          const result = await client.crawlUrl(p.url, {
            limit: p.maxPages ?? 25,
            excludePaths: p.excludePaths ?? [],
            scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
          });

          if (!result.success) {
            const err = (result as { error?: string }).error ?? "unknown error";
            logMetric({ ts: Date.now(), tool: "crawl", mode: getMode(config), target: p.url, durationMs: Date.now() - start, charsReturned: 0, success: false, error: err });
            return { error: `Crawl failed: ${err}` };
          }

          const pages = result.data ?? [];
          const combined = pages
            .map((page) => `## ${page.metadata?.title ?? page.metadata?.sourceURL ?? "Page"}\n\n${page.markdown ?? ""}`)
            .join("\n\n---\n\n");
          const totalChars = combined.length;
          logMetric({ ts: Date.now(), tool: "crawl", mode: getMode(config), target: p.url, durationMs: Date.now() - start, charsReturned: totalChars, success: true });

          // Auto-persist each page
          let persisted = 0;
          for (const page of pages) {
            const pageUrl = (page.metadata?.sourceURL as string) ?? p.url;
            const md = page.markdown ?? "";
            if (md.length > 50) {
              await persistScrapeResult(ctx, pageUrl, md, [], page.metadata ?? {}, "crawl");
              persisted++;
            }
          }

          return {
            content: `Crawled ${pages.length} pages from ${p.url} (${persisted} stored)\n\n${truncate(combined, 80000)}`,
            data: {
              url: p.url, pageCount: pages.length, persisted,
              pages: pages.map((page) => ({
                url: page.metadata?.sourceURL,
                title: page.metadata?.title,
                markdown: truncate(page.markdown ?? "", 5000),
              })),
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logMetric({ ts: Date.now(), tool: "crawl", mode: getMode(config), target: p.url, durationMs: Date.now() - start, charsReturned: 0, success: false, error: msg });
          return { error: `Crawl error: ${msg}` };
        }
      }
    );

    // ── map ───────────────────────────────────────────────────────────────────
    ctx.tools.register(
      "map",
      {
        displayName: "Firecrawl: Map Site",
        description: "Discover all URLs on a website.",
        parametersSchema: {
          type: "object", required: ["url"],
          properties: { url: { type: "string" }, limit: { type: "number" }, search: { type: "string" } },
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { url: string; limit?: number; search?: string };
        const config = (await ctx.config.get()) as FirecrawlConfig;
        const client = getClient(config);
        const start = Date.now();

        try {
          const result = await client.mapUrl(p.url, { limit: p.limit ?? 100, search: p.search });
          if (!result.success) {
            const err = (result as { error?: string }).error ?? "unknown error";
            logMetric({ ts: Date.now(), tool: "map", mode: getMode(config), target: p.url, durationMs: Date.now() - start, charsReturned: 0, success: false, error: err });
            return { error: `Map failed: ${err}` };
          }

          const urls = result.links ?? [];
          const content = `Found ${urls.length} URLs on ${p.url}\n\n${urls.join("\n")}`;
          logMetric({ ts: Date.now(), tool: "map", mode: getMode(config), target: p.url, durationMs: Date.now() - start, charsReturned: content.length, success: true });

          return { content, data: { url: p.url, urlCount: urls.length, urls } };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logMetric({ ts: Date.now(), tool: "map", mode: getMode(config), target: p.url, durationMs: Date.now() - start, charsReturned: 0, success: false, error: msg });
          return { error: `Map error: ${msg}` };
        }
      }
    );

    // ── extract ───────────────────────────────────────────────────────────────
    ctx.tools.register(
      "extract",
      {
        displayName: "Firecrawl: Extract Structured Data",
        description: "Extract structured data from a URL using a prompt. Auto-persists.",
        parametersSchema: {
          type: "object", required: ["url", "prompt"],
          properties: { url: { type: "string" }, prompt: { type: "string" } },
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { url: string; prompt: string };
        const config = (await ctx.config.get()) as FirecrawlConfig;
        const client = getClient(config);
        const start = Date.now();

        try {
          const scrapeResult = await client.scrapeUrl(p.url, { formats: ["markdown"], onlyMainContent: true });
          if (!scrapeResult.success) {
            const err = (scrapeResult as { error?: string }).error ?? "unknown";
            logMetric({ ts: Date.now(), tool: "extract", mode: getMode(config), target: p.url, durationMs: Date.now() - start, charsReturned: 0, success: false, error: err });
            return { error: `Could not fetch page: ${err}` };
          }

          const markdown = scrapeResult.markdown ?? "";
          logMetric({ ts: Date.now(), tool: "extract", mode: getMode(config), target: p.url, durationMs: Date.now() - start, charsReturned: markdown.length, success: true });

          // Auto-persist
          await persistScrapeResult(ctx, p.url, markdown, [], scrapeResult.metadata ?? {}, "extract");

          return {
            content: `Fetched & stored ${p.url} for extraction.\n\nPrompt: ${p.prompt}\n\n${truncate(markdown, 30000)}`,
            data: { url: p.url, extractionPrompt: p.prompt, rawMarkdown: truncate(markdown, 30000), metadata: scrapeResult.metadata ?? {}, persisted: true },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logMetric({ ts: Date.now(), tool: "extract", mode: getMode(config), target: p.url, durationMs: Date.now() - start, charsReturned: 0, success: false, error: msg });
          return { error: `Extract error: ${msg}` };
        }
      }
    );

    // ── search ────────────────────────────────────────────────────────────────
    ctx.tools.register(
      "search",
      {
        displayName: "Firecrawl: Web Search",
        description: "Search the web, return content for each result. Auto-persists.",
        parametersSchema: {
          type: "object", required: ["query"],
          properties: { query: { type: "string" }, limit: { type: "number" } },
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { query: string; limit?: number };
        const config = (await ctx.config.get()) as FirecrawlConfig;
        const client = getClient(config);
        const start = Date.now();

        try {
          const result = await client.search(p.query, { limit: p.limit ?? 5 });
          if (!result.success) {
            const err = (result as { error?: string }).error ?? "unknown error";
            logMetric({ ts: Date.now(), tool: "search", mode: getMode(config), target: p.query, durationMs: Date.now() - start, charsReturned: 0, success: false, error: err });
            return { error: `Search failed: ${err}` };
          }

          const results = result.data ?? [];
          const formatted = results
            .map((r, i) => `### Result ${i + 1}: ${r.title ?? r.url}\nURL: ${r.url}\n\n${truncate(r.markdown ?? r.description ?? "", 3000)}`)
            .join("\n\n---\n\n");
          const totalChars = formatted.length;
          logMetric({ ts: Date.now(), tool: "search", mode: getMode(config), target: p.query, durationMs: Date.now() - start, charsReturned: totalChars, success: true });

          // Auto-persist each result
          let persisted = 0;
          for (const r of results) {
            if (r.url && (r.markdown ?? "").length > 50) {
              await persistScrapeResult(
                ctx, r.url, r.markdown ?? "", [],
                { title: r.title, description: r.description, sourceURL: r.url },
                "search"
              );
              persisted++;
            }
          }

          return {
            content: `Search: "${p.query}"\nResults: ${results.length} (${persisted} stored)\n\n${formatted}`,
            data: {
              query: p.query, resultCount: results.length, persisted,
              results: results.map((r) => ({ url: r.url, title: r.title, description: r.description, markdown: truncate(r.markdown ?? "", 3000) })),
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logMetric({ ts: Date.now(), tool: "search", mode: getMode(config), target: p.query, durationMs: Date.now() - start, charsReturned: 0, success: false, error: msg });
          return { error: `Search error: ${msg}` };
        }
      }
    );

    // ── classify ──────────────────────────────────────────────────────────────
    ctx.tools.register(
      "classify",
      {
        displayName: "Firecrawl: Classify Data",
        description: "Tag a scraped URL with venture, category, and competitor info.",
        parametersSchema: {
          type: "object", required: ["url", "venture", "category"],
          properties: {
            url: { type: "string" },
            venture: { type: "string" },
            category: { type: "string" },
            competitorName: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            summary: { type: "string" },
          },
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as {
          url: string; venture: string; category: string;
          competitorName?: string; tags?: string[]; summary?: string;
        };
        const normalized = normalizeUrl(p.url);

        // Find existing entity
        const existing = await ctx.entities.list({ entityType: "scrape-result", externalId: normalized, limit: 1 });
        if (existing.length === 0) {
          return { error: `No scrape result found for URL: ${p.url}. Scrape it first with firecrawl:scrape.` };
        }

        const entity = existing[0]!;
        const data = entity.data as unknown as ScrapeEntityData;

        // Update with classification
        data.venture = p.venture;
        data.category = p.category;
        data.competitorName = p.competitorName;
        data.tags = [...(data.tags ?? []), ...(p.tags ?? [])];
        data.summary = p.summary || data.summary;
        data.classifiedAt = new Date().toISOString();

        await ctx.entities.upsert({
          entityType: "scrape-result",
          scopeKind: "instance",
          externalId: normalized,
          title: data.competitorName || data.title || data.domain,
          status: "classified",
          data: data as unknown as Record<string, unknown>,
        });

        // If it's a competitor, also upsert a competitor entity
        if (p.category === "competitor" && p.competitorName) {
          const domain = data.domain;
          await ctx.entities.upsert({
            entityType: "competitor",
            scopeKind: "instance",
            externalId: domain,
            title: p.competitorName,
            status: "active",
            data: {
              name: p.competitorName,
              domain,
              venture: p.venture,
              tags: p.tags ?? [],
              summary: p.summary,
              scrapedPages: [normalized],
              updatedAt: new Date().toISOString(),
            },
          });
        }

        return {
          content: `Classified: ${p.url}\n  Venture: ${p.venture}\n  Category: ${p.category}${p.competitorName ? `\n  Competitor: ${p.competitorName}` : ""}${p.tags?.length ? `\n  Tags: ${p.tags.join(", ")}` : ""}`,
          data: { url: normalized, venture: p.venture, category: p.category, competitorName: p.competitorName },
        };
      }
    );

    // ── query ─────────────────────────────────────────────────────────────────
    ctx.tools.register(
      "query",
      {
        displayName: "Firecrawl: Query Data Store",
        description: "Search stored scrape data by entity type, venture, category, or domain.",
        parametersSchema: {
          type: "object", required: [],
          properties: {
            entityType: { type: "string" },
            venture: { type: "string" },
            category: { type: "string" },
            domain: { type: "string" },
            limit: { type: "number" },
          },
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { entityType?: string; venture?: string; category?: string; domain?: string; limit?: number };
        const entityType = p.entityType || "scrape-result";
        const limit = p.limit ?? 20;

        const all = await ctx.entities.list({ entityType, scopeKind: "instance", limit: 200 });

        // Client-side filtering (SDK doesn't support JSONB field filtering)
        let filtered = all;
        if (p.venture) {
          filtered = filtered.filter((e) => (e.data as Record<string, unknown>).venture === p.venture);
        }
        if (p.category) {
          filtered = filtered.filter((e) => (e.data as Record<string, unknown>).category === p.category);
        }
        if (p.domain) {
          filtered = filtered.filter((e) => (e.data as Record<string, unknown>).domain === p.domain);
        }

        const results = filtered.slice(0, limit);
        const summary = results.map((e) => {
          const d = e.data as Record<string, unknown>;
          return `- ${e.title || d.url || e.externalId} [${d.venture || "unclassified"}/${d.category || "raw"}] (${d.charCount || 0} chars, scraped ${d.scrapedAt || "unknown"})`;
        }).join("\n");

        return {
          content: `Found ${filtered.length} results (showing ${results.length}):\n\n${summary || "No results found."}`,
          data: {
            total: filtered.length,
            results: results.map((e) => ({ id: e.id, externalId: e.externalId, title: e.title, status: e.status, data: e.data })),
          },
        };
      }
    );

    // ── summarize (local Ollama) ─────────────────────────────────────────────
    ctx.tools.register(
      "summarize",
      {
        displayName: "Firecrawl: Summarize (Local AI)",
        description: "Summarize scraped URLs using local Ollama (free, no Claude tokens).",
        parametersSchema: {
          type: "object", required: ["urls"],
          properties: {
            urls: { type: "array", items: { type: "string" } },
            prompt: { type: "string" },
          },
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { urls: string[]; prompt?: string };
        const config = (await ctx.config.get()) as FirecrawlConfig;

        if (!config.ollamaUrl) {
          return { error: "Ollama not configured. Set Ollama URL in Settings -> Plugins -> Firecrawl." };
        }

        const model = config.ollamaModel || "gemma4:26b";
        const defaultPrompt = "Summarize this page in exactly 3 concise sentences. Focus on what the product/service does, its key differentiators, and its target audience.";
        const summaryPrompt = p.prompt || defaultPrompt;
        const urls = p.urls.slice(0, 20); // cap at 20

        const summaries: Array<{ url: string; summary: string; error?: string }> = [];

        for (const rawUrl of urls) {
          const normalized = normalizeUrl(rawUrl);

          // Get stored markdown content
          const stored = await ctx.state.get({
            scopeKind: "instance", namespace: "scrape-content", stateKey: normalized,
          }) as { markdown?: string } | null;

          if (!stored?.markdown) {
            summaries.push({ url: rawUrl, summary: "", error: "Not scraped yet — run firecrawl:scrape first" });
            continue;
          }

          // Truncate markdown for Ollama context window (small model ~4k tokens)
          const content = stored.markdown.slice(0, 6000);

          try {
            const response = await ctx.http.fetch(`${config.ollamaUrl}/api/generate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model,
                prompt: `${summaryPrompt}\n\n---\n\n${content}`,
                stream: false,
                options: { temperature: 0.3, num_predict: 200 },
              }),
            });

            const result = await response.json() as { response?: string; error?: string };
            if (result.error) {
              summaries.push({ url: rawUrl, summary: "", error: result.error });
            } else {
              const summary = (result.response ?? "").trim();
              summaries.push({ url: rawUrl, summary });

              // Auto-update the entity with the summary
              const existing = await ctx.entities.list({ entityType: "scrape-result", externalId: normalized, limit: 1 });
              if (existing.length > 0) {
                const entity = existing[0]!;
                const data = entity.data as Record<string, unknown>;
                data.summary = summary;
                await ctx.entities.upsert({
                  entityType: "scrape-result",
                  scopeKind: "instance",
                  externalId: normalized,
                  title: entity.title || undefined,
                  status: entity.status || "active",
                  data,
                });
              }
            }
          } catch (err) {
            summaries.push({ url: rawUrl, summary: "", error: err instanceof Error ? err.message : String(err) });
          }
        }

        const successCount = summaries.filter((s) => s.summary).length;
        const formatted = summaries.map((s) => {
          if (s.error) return `**${s.url}**: ERROR — ${s.error}`;
          return `**${s.url}**:\n${s.summary}`;
        }).join("\n\n");

        return {
          content: `Summarized ${successCount}/${urls.length} URLs (via Ollama ${model}, zero Claude tokens):\n\n${formatted}`,
          data: { summarized: successCount, total: urls.length, model, summaries },
        };
      }
    );

    // ── metrics ───────────────────────────────────────────────────────────────
    ctx.tools.register(
      "metrics",
      {
        displayName: "Firecrawl: Usage Metrics",
        description: "Usage stats, success rate, data volume.",
        parametersSchema: {
          type: "object", required: [],
          properties: { days: { type: "number" } },
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { days?: number };
        const days = p.days ?? 7;
        const since = Date.now() - days * 24 * 60 * 60 * 1000;

        try {
          if (!fs.existsSync(METRICS_FILE)) {
            return { content: "No metrics recorded yet.", data: {} };
          }

          const lines = fs.readFileSync(METRICS_FILE, "utf-8").trim().split("\n").filter(Boolean);
          const entries: MetricEntry[] = lines
            .map((l) => { try { return JSON.parse(l) as MetricEntry; } catch { return null; } })
            .filter((e): e is MetricEntry => e !== null && e.ts >= since);

          if (entries.length === 0) {
            return { content: `No metrics in the last ${days} days.`, data: {} };
          }

          const total = entries.length;
          const successes = entries.filter((e) => e.success).length;
          const successRate = ((successes / total) * 100).toFixed(1);
          const totalChars = entries.reduce((s, e) => s + e.charsReturned, 0);
          const avgDuration = Math.round(entries.reduce((s, e) => s + e.durationMs, 0) / total);

          const byTool: Record<string, number> = {};
          const byMode: Record<string, number> = {};
          for (const e of entries) {
            byTool[e.tool] = (byTool[e.tool] ?? 0) + 1;
            byMode[e.mode] = (byMode[e.mode] ?? 0) + 1;
          }

          // Also count stored entities
          const storedResults = await ctx.entities.list({ entityType: "scrape-result", scopeKind: "instance", limit: 1 });
          const storedCompetitors = await ctx.entities.list({ entityType: "competitor", scopeKind: "instance", limit: 1 });

          const summary = [
            `## Firecrawl Metrics -- Last ${days} days`,
            ``,
            `**Total requests:** ${total}`,
            `**Success rate:** ${successRate}%`,
            `**Data returned:** ${(totalChars / 1000).toFixed(0)}k chars`,
            `**Avg duration:** ${avgDuration}ms`,
            ``,
            `**By tool:** ${Object.entries(byTool).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
            `**By mode:** ${Object.entries(byMode).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
            ``,
            `**Data store:** scrape results stored, competitors tracked`,
          ].join("\n");

          return { content: summary, data: { total, successes, successRate, totalChars, avgDurationMs: avgDuration, byTool, byMode } };
        } catch (err) {
          return { error: `Metrics error: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
    );

    // ── freshness-check job ───────────────────────────────────────────────────
    ctx.jobs.register("freshness-check", async (_job: PluginJobContext) => {
      ctx.logger.info("Running freshness check...");

      const entities = await ctx.entities.list({ entityType: "scrape-result", scopeKind: "instance", limit: 500 });
      const now = Date.now();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      let staleCount = 0;

      for (const entity of entities) {
        const data = entity.data as Record<string, unknown>;
        const scrapedAt = data.scrapedAt as string | undefined;
        if (!scrapedAt) continue;

        const age = now - new Date(scrapedAt).getTime();
        if (age > sevenDaysMs && entity.status !== "stale") {
          data.staleSince = new Date().toISOString();
          await ctx.entities.upsert({
            entityType: "scrape-result",
            scopeKind: "instance",
            externalId: entity.externalId || undefined,
            title: entity.title || undefined,
            status: "stale",
            data,
          });
          staleCount++;
        }
      }

      ctx.logger.info(`Freshness check complete: ${staleCount} entries marked stale out of ${entities.length}`);
    });

    // ── directory-sync job ────────────────────────────────────────────────────
    ctx.jobs.register("directory-sync", async (_job: PluginJobContext) => {
      const config = (await ctx.config.get()) as FirecrawlConfig;
      if (!config.directoryApiUrl || !config.directoryApiSecret) {
        ctx.logger.info("Directory sync skipped — no directoryApiUrl/directoryApiSecret configured");
        return;
      }

      ctx.logger.info("Running directory sync...");

      // Read sync cursor
      const cursorData = await ctx.state.get({
        scopeKind: "instance", namespace: "sync-cursor", stateKey: "vps-sync",
      }) as { lastSyncedAt?: string } | null;
      const lastSyncedAt = cursorData?.lastSyncedAt || "1970-01-01T00:00:00Z";

      // Fetch all classified entities (status != "active" means they were classified or are stale)
      const scrapeResults = await ctx.entities.list({
        entityType: "scrape-result", scopeKind: "instance", limit: 200,
      });
      const competitors = await ctx.entities.list({
        entityType: "competitor", scopeKind: "instance", limit: 200,
      });

      // Filter to entities updated since last sync
      const toSync = [...scrapeResults, ...competitors].filter((e) => {
        return new Date(e.updatedAt) > new Date(lastSyncedAt);
      });

      if (toSync.length === 0) {
        ctx.logger.info("Directory sync: no new entities to push");
        return;
      }

      // Push to Directory API
      const payload = JSON.stringify({
        entities: toSync.map((e) => ({
          id: e.id,
          entityType: e.entityType,
          externalId: e.externalId,
          title: e.title,
          status: e.status,
          data: e.data,
        })),
      });

      const response = await ctx.http.fetch(`${config.directoryApiUrl}/v1/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.directoryApiSecret}`,
        },
        body: payload,
      });

      const result = await response.json() as { ingested?: number; errors?: number };
      ctx.logger.info(`Directory sync complete: ${result.ingested ?? 0} ingested, ${result.errors ?? 0} errors out of ${toSync.length}`);

      // Update cursor
      await ctx.state.set(
        { scopeKind: "instance", namespace: "sync-cursor", stateKey: "vps-sync" },
        { lastSyncedAt: new Date().toISOString() },
      );
    });
  },

  async onHealth() {
    return { status: "ok", message: "Firecrawl plugin v0.2.0 ready" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
