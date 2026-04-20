import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "coherencedaddy.firecrawl";
export const PLUGIN_VERSION = "0.2.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Firecrawl",
  description:
    "Web scraping, crawling, and data intelligence for agents. Scrapes URLs to markdown, crawls sites, extracts structured data, and builds a searchable competitor intelligence database. All scraped data is auto-persisted and can be queried, classified, and synced to the directory API.",
  author: "Coherence Daddy",
  categories: ["connector", "automation"],
  capabilities: [
    "agent.tools.register",
    "http.outbound",
    "secrets.read-ref",
    "plugin.state.read",
    "plugin.state.write",
    "jobs.schedule",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    required: [],
    properties: {
      apiUrl: {
        type: "string",
        title: "Self-Hosted URL",
        description:
          "URL of your self-hosted Firecrawl instance (e.g. http://localhost:3002). Set this to use open-source mode.",
        default: "",
      },
      apiKey: {
        type: "string",
        title: "Cloud API Key (optional upgrade)",
        description:
          "Firecrawl cloud API key from firecrawl.dev (format: fc-xxxxxxxx). Leave blank when using self-hosted.",
        default: "",
      },
      directoryApiUrl: {
        type: "string",
        title: "Directory API URL",
        description:
          "URL of the Coherence Daddy Directory API for syncing scraped data (e.g. http://localhost:4000).",
        default: "",
      },
      directoryApiSecret: {
        type: "string",
        title: "Directory API Secret",
        description: "Shared secret for authenticating with the Directory API sync endpoint.",
        default: "",
      },
      embeddingApiUrl: {
        type: "string",
        title: "Embedding API URL",
        description: "URL of the embedding service for vector search (e.g. http://147.79.78.251:8000).",
        default: "",
      },
      embeddingApiKey: {
        type: "string",
        title: "Embedding API Key",
        description: "API key for the embedding service.",
        default: "",
      },
      ollamaUrl: {
        type: "string",
        title: "Ollama URL",
        description: "URL of Ollama instance for local summarization (e.g. http://172.17.0.1:11434). Saves Claude tokens on bulk processing.",
        default: "",
      },
      ollamaModel: {
        type: "string",
        title: "Ollama Model",
        description: "Model to use for summarization. Defaults to gemma4:26b.",
        default: "gemma4:26b",
      },
    },
  },
  jobs: [
    {
      jobKey: "freshness-check",
      displayName: "Freshness Check",
      description: "Flags scrape results older than 7 days as stale.",
      schedule: "0 6 * * *",
    },
    {
      jobKey: "directory-sync",
      displayName: "Directory Sync",
      description: "Pushes new/updated entities to the VPS Directory API for vector search indexing.",
      schedule: "*/30 * * * *",
    },
  ],
  tools: [
    {
      name: "scrape",
      displayName: "Firecrawl: Scrape URL",
      description:
        "Scrape a single URL and return its content as clean markdown. Auto-persists the result to the data store.",
      parametersSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "The URL to scrape" },
          formats: {
            type: "array",
            items: { type: "string", enum: ["markdown", "html", "links", "screenshot"] },
            description: "Output formats. Defaults to ['markdown'].",
            default: ["markdown"],
          },
          onlyMainContent: {
            type: "boolean",
            description: "Strip boilerplate. Defaults to true.",
            default: true,
          },
        },
      },
    },
    {
      name: "crawl",
      displayName: "Firecrawl: Crawl Site",
      description:
        "Crawl an entire website and return all pages as markdown. Auto-persists each page.",
      parametersSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "The starting URL to crawl" },
          maxPages: { type: "number", description: "Max pages. Defaults to 25.", default: 25 },
          excludePaths: {
            type: "array",
            items: { type: "string" },
            description: "URL patterns to exclude (e.g. ['/blog'])",
          },
        },
      },
    },
    {
      name: "map",
      displayName: "Firecrawl: Map Site",
      description: "Discover all URLs on a website without scraping. Returns the sitemap.",
      parametersSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "The website URL to map" },
          limit: { type: "number", description: "Max URLs. Defaults to 100.", default: 100 },
          search: { type: "string", description: "Filter URLs by keyword." },
        },
      },
    },
    {
      name: "extract",
      displayName: "Firecrawl: Extract Structured Data",
      description: "Extract structured data from a URL using a prompt. Auto-persists the result.",
      parametersSchema: {
        type: "object",
        required: ["url", "prompt"],
        properties: {
          url: { type: "string", description: "The URL to extract from" },
          prompt: { type: "string", description: "What to extract (e.g. 'pricing tiers and features')" },
        },
      },
    },
    {
      name: "search",
      displayName: "Firecrawl: Web Search",
      description: "Search the web and return full page content. Auto-persists each result.",
      parametersSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Results to return. Defaults to 5.", default: 5 },
        },
      },
    },
    {
      name: "classify",
      displayName: "Firecrawl: Classify Data",
      description:
        "Tag a previously scraped URL with venture, category, and competitor info. Updates the stored entity for directory listing.",
      parametersSchema: {
        type: "object",
        required: ["url", "venture", "category"],
        properties: {
          url: { type: "string", description: "The URL to classify (must have been scraped first)" },
          venture: {
            type: "string",
            enum: ["shieldnest", "tokns", "smartnotes", "token", "brand"],
            description: "Which Coherence Daddy venture this data belongs to",
          },
          category: {
            type: "string",
            enum: ["competitor", "pricing", "feature", "market-data", "news", "tool", "docs", "community"],
            description: "What type of data this is",
          },
          competitorName: { type: "string", description: "Name of the competitor (if category is 'competitor')" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Additional tags for searchability",
          },
          summary: { type: "string", description: "Brief summary of the content" },
        },
      },
    },
    {
      name: "query",
      displayName: "Firecrawl: Query Data Store",
      description:
        "Search the persisted scrape data. Filter by entity type, venture, category, or domain. Returns structured results from the local database.",
      parametersSchema: {
        type: "object",
        required: [],
        properties: {
          entityType: {
            type: "string",
            enum: ["scrape-result", "competitor", "pricing-plan", "market-signal"],
            description: "Filter by entity type. Defaults to scrape-result.",
            default: "scrape-result",
          },
          venture: {
            type: "string",
            enum: ["shieldnest", "tokns", "smartnotes", "token", "brand"],
            description: "Filter by venture",
          },
          category: { type: "string", description: "Filter by category" },
          domain: { type: "string", description: "Filter by domain name" },
          limit: { type: "number", description: "Max results. Defaults to 20.", default: 20 },
        },
      },
    },
    {
      name: "summarize",
      displayName: "Firecrawl: Summarize (Local AI)",
      description:
        "Summarize one or more scraped URLs using local Ollama (free, no Claude tokens). Returns a concise summary for each URL. Use this for bulk processing — pass multiple URLs to summarize them all at once cheaply.",
      parametersSchema: {
        type: "object",
        required: ["urls"],
        properties: {
          urls: {
            type: "array",
            items: { type: "string" },
            description: "URLs to summarize (must have been scraped first). Max 20 per call.",
          },
          prompt: {
            type: "string",
            description: "Custom summarization prompt. Defaults to a 3-sentence summary.",
            default: "Summarize this page in exactly 3 concise sentences. Focus on what the product/service does, its key differentiators, and its target audience.",
          },
        },
      },
    },
    {
      name: "metrics",
      displayName: "Firecrawl: Usage Metrics",
      description: "Usage stats: requests, success rate, data volume, speed, cloud vs self-hosted breakdown.",
      parametersSchema: {
        type: "object",
        required: [],
        properties: {
          days: { type: "number", description: "Past days to include. Defaults to 7.", default: 7 },
        },
      },
    },
  ],
};

export default manifest;
