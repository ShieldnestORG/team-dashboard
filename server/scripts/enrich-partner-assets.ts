/**
 * Enrich Partner Assets — 2026-04-24
 *
 * Pulls logoUrl + brandColors.primary + location for the 7 freshly-seeded
 * partners by re-scraping each home page with Firecrawl (markdown + html),
 * parsing HTML for og:image / apple-touch-icon / theme-color, and asking
 * the LLM for location with a tighter prompt.
 *
 * Usage:
 *   cd server && npx tsx scripts/enrich-partner-assets.ts
 */

import { eq, and, inArray } from "drizzle-orm";
import { partnerCompanies, createDb } from "@paperclipai/db";
import { JSDOM } from "jsdom";
import { callOllamaGenerate } from "../src/services/ollama-client.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ??
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

const FIRECRAWL_URL =
  process.env.FIRECRAWL_URL || "https://firecrawl.coherencedaddy.com";

const SLUGS = [
  "sacred-wild",
  "artisan-metal-works",
  "tokns",
  "mark-joseph-jr-co",
  "house-of-exegesis",
  "exegesis-ventures",
  "get-probed",
];

interface ScrapeResult {
  markdown: string;
  html: string;
  metadata: Record<string, unknown>;
}

async function firecrawlScrapeFull(url: string): Promise<ScrapeResult> {
  const res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer self-hosted",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "rawHtml"],
      timeout: 30000,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Firecrawl ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    success: boolean;
    data?: {
      markdown?: string;
      rawHtml?: string;
      metadata?: Record<string, unknown>;
    };
  };
  if (!json.success || !json.data) throw new Error("Firecrawl no data");
  return {
    markdown: (json.data.markdown ?? "").slice(0, 50_000),
    html: json.data.rawHtml ?? "",
    metadata: json.data.metadata ?? {},
  };
}

function absolutize(base: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, base).href;
  } catch {
    return maybeRelative;
  }
}

function extractAssets(scrape: ScrapeResult, baseUrl: string) {
  // 1) Try Firecrawl's own metadata first
  const m = scrape.metadata as Record<string, unknown>;
  const ogImage = (m.ogImage ?? m["og:image"]) as string | undefined;

  // 2) Parse the HTML for richer signals
  let parsedLogo: string | undefined;
  let appleTouchIcon: string | undefined;
  let themeColor: string | undefined;
  let manifestHref: string | undefined;
  try {
    const dom = new JSDOM(scrape.html);
    const doc = dom.window.document;

    const og = doc.querySelector('meta[property="og:image"]')?.getAttribute("content")
      ?? doc.querySelector('meta[name="og:image"]')?.getAttribute("content")
      ?? doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content");
    if (og) parsedLogo = og;

    const ati =
      doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href")
      ?? doc.querySelector('link[rel="apple-touch-icon-precomposed"]')?.getAttribute("href")
      ?? doc.querySelector('link[rel="icon"][sizes]')?.getAttribute("href")
      ?? doc.querySelector('link[rel="icon"]')?.getAttribute("href")
      ?? doc.querySelector('link[rel="shortcut icon"]')?.getAttribute("href");
    if (ati) appleTouchIcon = ati;

    const tc = doc.querySelector('meta[name="theme-color"]')?.getAttribute("content");
    if (tc) themeColor = tc;

    const mh = doc.querySelector('link[rel="manifest"]')?.getAttribute("href");
    if (mh) manifestHref = mh;
  } catch (err) {
    console.warn(`  (jsdom parse failed: ${(err as Error).message})`);
  }

  // Reject obvious junk: data: URIs (often 1x1 placeholders), Vite/CRA
  // default scaffold icons, anything under ~200 bytes when base64.
  const isJunk = (raw: string | undefined): boolean => {
    if (!raw) return true;
    if (/^data:/i.test(raw)) return true;
    if (/(vite|react|next|nuxt)\.svg$/i.test(raw)) return true;
    if (/logo-default|placeholder|default-og/i.test(raw)) return true;
    return false;
  };

  const candidates = [parsedLogo, ogImage, appleTouchIcon].filter(
    (c): c is string => !!c && !isJunk(c),
  );

  const logoUrl =
    (candidates[0] && absolutize(baseUrl, candidates[0])) ||
    `${new URL(baseUrl).origin}/favicon.ico`;

  return { logoUrl, themeColor, manifestHref };
}

async function fetchManifestColor(
  manifestUrl: string,
): Promise<string | undefined> {
  try {
    const res = await fetch(manifestUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return undefined;
    const json = (await res.json()) as Record<string, unknown>;
    const color = (json.theme_color ?? json.background_color) as string | undefined;
    return color;
  } catch {
    return undefined;
  }
}

async function extractLocation(
  markdown: string,
  name: string,
): Promise<string | null> {
  const tail = markdown.slice(-8000); // footer is typically near the end
  const prompt = `From the website content below for "${name}", extract the business location as "City, State" (US) or "City, Country" (international). Look in footer, contact, address sections. If no specific city is mentioned, return null.

Content:
---
${tail}
---

Return ONLY a JSON object: { "location": "City, State" | "City, Country" | null }`;
  try {
    const raw = await callOllamaGenerate(prompt);
    const m = raw.match(/\{[\s\S]*?\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { location?: string | null };
    if (!parsed.location || parsed.location === "null") return null;
    if (parsed.location.length > 80) return null;
    return parsed.location;
  } catch (err) {
    console.warn(`  (location LLM failed: ${(err as Error).message})`);
    return null;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const db = createDb(process.env.DATABASE_URL);

  const rows = await db
    .select()
    .from(partnerCompanies)
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        inArray(partnerCompanies.slug, SLUGS),
      ),
    );

  for (const partner of rows) {
    if (!partner.website) {
      console.log(`[skip] ${partner.slug} — no website`);
      continue;
    }
    console.log(`\n=== ${partner.slug} ===`);
    console.log(`  scraping ${partner.website}…`);

    let scrape: ScrapeResult;
    try {
      scrape = await firecrawlScrapeFull(partner.website);
    } catch (err) {
      console.error(`  ✗ scrape failed: ${(err as Error).message}`);
      continue;
    }

    const { logoUrl, themeColor, manifestHref } = extractAssets(
      scrape,
      partner.website,
    );

    let primary = themeColor;
    if (!primary && manifestHref) {
      const abs = absolutize(partner.website, manifestHref);
      primary = await fetchManifestColor(abs);
    }

    const brandColors = primary
      ? { primary, secondary: primary, accent: primary }
      : null;

    const location = await extractLocation(scrape.markdown, partner.name);

    const updates: Record<string, unknown> = {
      logoUrl,
      updatedAt: new Date(),
    };
    if (brandColors) updates.brandColors = brandColors;
    if (location && !partner.location) updates.location = location;

    console.log(`  logoUrl: ${logoUrl}`);
    console.log(`  brandColors: ${brandColors ? primary : "—"}`);
    console.log(`  location: ${location ?? "—"}`);

    await db
      .update(partnerCompanies)
      .set(updates)
      .where(eq(partnerCompanies.id, partner.id));
    console.log(`  ✓ updated`);
  }

  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
