import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const BASE_URL = process.env.PAPERCLIP_PUBLIC_URL || "https://31.220.61.12:3200";
const CD_URL = "https://coherencedaddy.com";

interface CompanyRow {
  slug: string;
  created_at: string;
}

interface ReelItem {
  id: string;
  status: string;
  reviewStatus: string;
  assets: unknown[];
  publishedAt?: string;
  updatedAt?: string;
}

export function sitemapRoutes(db: Db) {
  const router = Router();

  // --- Sitemap Index ---
  router.get("/sitemap.xml", (_req, res) => {
    const now = new Date().toISOString();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${BASE_URL}/sitemap-pages.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${BASE_URL}/sitemap-intel.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${BASE_URL}/sitemap-reels.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
</sitemapindex>`;
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(xml);
  });

  // --- Static pages sitemap ---
  router.get("/sitemap-pages.xml", (_req, res) => {
    const now = new Date().toISOString();
    const pages = [
      { loc: CD_URL, priority: "1.0", changefreq: "daily" },
      { loc: `${CD_URL}/directory`, priority: "0.9", changefreq: "daily" },
      { loc: `${CD_URL}/directory/ai-ml`, priority: "0.8", changefreq: "daily" },
      { loc: `${CD_URL}/directory/defi`, priority: "0.8", changefreq: "daily" },
      { loc: `${CD_URL}/directory/devtools`, priority: "0.8", changefreq: "daily" },
      { loc: `${CD_URL}/directory/crypto`, priority: "0.8", changefreq: "daily" },
      { loc: `${CD_URL}/tools`, priority: "0.8", changefreq: "weekly" },
      { loc: `${CD_URL}/blog`, priority: "0.7", changefreq: "daily" },
    ];

    const urls = pages
      .map(
        (p) => `  <url>
    <loc>${p.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`,
      )
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(xml);
  });

  // --- Intel companies sitemap (dynamic from DB) ---
  router.get("/sitemap-intel.xml", async (_req, res) => {
    try {
      const rows = (await db.execute(
        sql`SELECT slug, created_at FROM intel_companies ORDER BY name ASC`,
      )) as unknown as CompanyRow[];

      const urls = rows
        .map((r) => {
          const lastmod = r.created_at
            ? new Date(r.created_at).toISOString()
            : new Date().toISOString();
          return `  <url>
    <loc>${CD_URL}/directory/${encodeURIComponent(r.slug)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>`;
        })
        .join("\n");

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(xml);
    } catch (err) {
      res.status(500).send("<!-- sitemap generation error -->");
    }
  });

  // --- Reels sitemap (from visual content queue) ---
  router.get("/sitemap-reels.xml", (_req, res) => {
    try {
      const queuePath = join(process.cwd(), "data", "visual-content-queue.json");
      let items: ReelItem[] = [];
      if (existsSync(queuePath)) {
        items = JSON.parse(readFileSync(queuePath, "utf-8")) as ReelItem[];
      }

      const published = items.filter(
        (i) =>
          i.status === "published" &&
          i.reviewStatus === "approved" &&
          i.assets &&
          i.assets.length > 0,
      );

      const urls = published
        .map((i) => {
          const lastmod = i.publishedAt || i.updatedAt || new Date().toISOString();
          return `  <url>
    <loc>${BASE_URL}/api/reels/${encodeURIComponent(i.id)}</loc>
    <lastmod>${new Date(lastmod).toISOString()}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>`;
        })
        .join("\n");

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(xml);
    } catch {
      res.status(500).send("<!-- sitemap generation error -->");
    }
  });

  return router;
}
