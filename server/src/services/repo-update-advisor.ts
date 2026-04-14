/**
 * Repo Update Advisor.
 *
 * Converts SEO audit failures into concrete, human-reviewable suggestion rows
 * in `repo_update_suggestions`. Each suggestion includes a proposed patch
 * snippet keyed off a small library of known fixes — these are the exact
 * patterns we just shipped into `coherencedaddy-landing` during Part A.
 *
 * The advisor NEVER writes to a repo. It only persists suggestions for the
 * admin to approve / reject / reply to via the /repo-updates dashboard page.
 */

import type { Db } from "@paperclipai/db";
import { repoUpdateSuggestions } from "@paperclipai/db";
import { eq, and } from "drizzle-orm";
import type { SeoAuditResult } from "./seo-audit.js";
import { logger } from "../middleware/logger.js";
import { callOllamaGenerate } from "./ollama-client.js";

// ---------------------------------------------------------------------------
// Site context hints — fed into the Ollama prompt to produce site-specific
// rationales instead of generic boilerplate.
// ---------------------------------------------------------------------------

const SITE_CONTEXT_HINTS: Record<string, string> = {
  "coherencedaddy.com":
    "508(c)(1)(A) faith-driven ecosystem: private self-help, 523+ free tools, AI agents, project directory",
  "token.coherencedaddy.com":
    "Daddy Token migration from Roll to TX Blockchain (Cosmos SDK)",
  "directory.coherencedaddy.com":
    "532+ project directory with real-time intel from CoinGecko/GitHub/Twitter/Reddit",
  "law.coherencedaddy.com":
    "Coherence Law — auditable AI for fiduciary intelligence (trustees, legal)",
  "optimize-me.coherencedaddy.com":
    "Optimize Me — private self-help app, no data leaves device",
  "freetools.coherencedaddy.com":
    "523+ free browser-based AI and crypto tools, no signup",
  "app.tokns.fi":
    "TOKNS — TX blockchain portfolio, swap, RWA tokenization, NFT marketplace",
  "shieldnest.org":
    "ShieldNest — privacy-first dev company building the Coherence Daddy ecosystem",
};

function hintFor(siteUrl: string): string {
  try {
    const host = new URL(siteUrl).hostname;
    return SITE_CONTEXT_HINTS[host] ?? "(no context hint)";
  } catch {
    return "(no context hint)";
  }
}

// ---------------------------------------------------------------------------
// Tiny concurrency limiter (cap parallel Ollama calls)
// ---------------------------------------------------------------------------

function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= max) return;
    const fn = queue.shift();
    if (!fn) return;
    active++;
    fn();
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      queue.push(run);
      next();
    });
  };
}

const ollamaLimiter = createLimiter(3);

// ---------------------------------------------------------------------------
// Ollama-backed rationale enrichment (with timeout + fallback)
// ---------------------------------------------------------------------------

interface EnrichOpts {
  siteUrl: string;
  checklistItem: string;
  label: string;
  detail: string;
  fallback: string;
}

async function enrichRationale(opts: EnrichOpts): Promise<string> {
  const { siteUrl, checklistItem, label, detail, fallback } = opts;
  const hint = hintFor(siteUrl);

  const prompt = [
    "You are co-authoring a short SEO/AEO fix note. Voice: technical but warm —",
    "think Cipher (technical deep-diver) + Forge (AEO comparison architect).",
    "",
    `Site: ${siteUrl}`,
    `Site context: ${hint}`,
    `Checklist item: ${checklistItem} (${label})`,
    `Audit failure: ${detail}`,
    "",
    "Write a 2-3 sentence rationale tailored to this specific site and failure.",
    "MUST reference the checklist item and the site explicitly. Be concrete and",
    "actionable. No preamble, no headings, no markdown — just the rationale text.",
  ].join("\n");

  const timeout = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error("ollama timeout")), 10_000),
  );

  try {
    const result = await ollamaLimiter(() =>
      Promise.race([callOllamaGenerate(prompt), timeout]),
    );
    const text = (result || "").trim();
    if (!text) return fallback;
    return text;
  } catch (err) {
    logger.debug(
      { err: (err as Error).message, siteUrl, checklistItem },
      "enrichRationale fell back to static library",
    );
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Site → repo mapping
// ---------------------------------------------------------------------------

interface SiteMeta {
  repo: string;
  rootLayoutPath: string;
}

const SITE_REPO_MAP: Record<string, SiteMeta> = {
  "coherencedaddy.com": {
    repo: "ShieldnestORG/coherencedaddy",
    rootLayoutPath: "app/layout.tsx",
  },
  "freetools.coherencedaddy.com": {
    repo: "ShieldnestORG/coherencedaddy",
    rootLayoutPath: "app/(tools)/layout.tsx",
  },
  "token.coherencedaddy.com": {
    repo: "ShieldnestORG/coherencedaddy",
    rootLayoutPath: "app/token-home/layout.tsx",
  },
  "directory.coherencedaddy.com": {
    repo: "ShieldnestORG/coherencedaddy",
    rootLayoutPath: "app/directory-home/layout.tsx",
  },
  "law.coherencedaddy.com": {
    repo: "ShieldnestORG/coherencedaddy",
    rootLayoutPath: "app/law-home/layout.tsx",
  },
  "optimize-me.coherencedaddy.com": {
    repo: "ShieldnestORG/coherencedaddy",
    rootLayoutPath: "app/optimize-me-home/layout.tsx",
  },
  "app.tokns.fi": {
    repo: "ShieldnestORG/v1_shieldnest_org",
    rootLayoutPath: "app/layout.tsx",
  },
  "shieldnest.org": {
    repo: "ShieldnestORG/shieldnest_landing_page",
    rootLayoutPath: "app/layout.tsx",
  },
};

function resolveSite(url: string): SiteMeta {
  try {
    const host = new URL(url).hostname;
    return (
      SITE_REPO_MAP[host] ?? {
        repo: `unknown (${host})`,
        rootLayoutPath: "app/layout.tsx",
      }
    );
  } catch {
    return { repo: "unknown", rootLayoutPath: "app/layout.tsx" };
  }
}

// ---------------------------------------------------------------------------
// Fix library — keyed by checklist item
// ---------------------------------------------------------------------------

const FIX_LIBRARY: Record<
  string,
  { rationale: string; patch: string; language: string }
> = {
  openGraph: {
    rationale:
      "The og:image is missing or fails to resolve. Next.js metadata merging REPLACES nested objects, so any child layout that defines its own openGraph block without `images` drops the root image. Re-include the helper in every child layout.",
    language: "typescript",
    patch: `// In app/<section>/layout.tsx, import the shared helper and spread the images.
import { OG_IMAGES, TWITTER_IMAGES } from "@/utils/seo/metadata"

export const metadata: Metadata = {
  // ...existing fields...
  openGraph: {
    // ...existing openGraph fields...
    images: OG_IMAGES.root,
  },
  twitter: {
    // ...existing twitter fields...
    images: TWITTER_IMAGES.root,
  },
}`,
  },
  twitterCard: {
    rationale:
      "No twitter:image tag found. Twitter/X card crawlers will fall back to the small summary card instead of the large rich card. Add a twitter block with images in the affected layout.",
    language: "typescript",
    patch: `twitter: {
  card: "summary_large_image",
  title: "<page title>",
  description: "<page description>",
  images: TWITTER_IMAGES.root,
},`,
  },
  faqSchema: {
    rationale:
      "No FAQPage JSON-LD block. This is the single highest-leverage AEO fix: ChatGPT, Perplexity, and Google AI Overviews ingest FAQPage schema directly as answer-engine candidates.",
    language: "typescript",
    patch: `// Add to the root layout's JSON-LD block
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is <Brand>?",
      acceptedAnswer: { "@type": "Answer", text: "<One-sentence mission statement.>" },
    },
    // …add 5-6 Q&As covering the most common questions about the brand
  ],
}`,
  },
  organizationSchema: {
    rationale:
      "No Organization or LocalBusiness JSON-LD block found. Required for Google Knowledge Graph eligibility and AI engine entity recognition.",
    language: "typescript",
    patch: `{
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "<site-url>/#organization",
  name: "<Brand>",
  url: "<site-url>",
  logo: { "@type": "ImageObject", url: "<site-url>/opengraph-image" },
  sameAs: ["<social links>"],
}`,
  },
  webSiteSchema: {
    rationale:
      "No WebSite JSON-LD block. Add one to enable Google Sitelinks Search Box and establish the site entity for AI engines.",
    language: "typescript",
    patch: `{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": "<site-url>/#website",
  url: "<site-url>",
  name: "<Brand>",
  publisher: { "@id": "<site-url>/#organization" },
}`,
  },
  canonicalUrl: {
    rationale:
      "No canonical link found. Add one to prevent duplicate content penalties — every page should self-canonicalize.",
    language: "typescript",
    patch: `alternates: { canonical: "<absolute URL of this page>" },`,
  },
  sitemapXml: {
    rationale:
      "`/sitemap.xml` did not return 200. Create `app/sitemap.ts` exporting a `MetadataRoute.Sitemap` array.",
    language: "typescript",
    patch: `import type { MetadataRoute } from "next"
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "<site-url>", lastModified: new Date(), changeFrequency: "weekly", priority: 1.0 },
    // add every public route
  ]
}`,
  },
  robotsTxt: {
    rationale:
      "`/robots.txt` did not return 200. Create `app/robots.ts` to allow crawlers and expose your sitemap.",
    language: "typescript",
    patch: `import type { MetadataRoute } from "next"
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "<site-url>/sitemap.xml",
  }
}`,
  },
  metaDescription: {
    rationale:
      "Meta description is missing or shorter than 50 characters. Write a unique 150–160 char description for every page.",
    language: "typescript",
    patch: `description: "<unique 150-160 character description that includes the primary keyword>",`,
  },
  titleTag: {
    rationale:
      "Title is missing or too long. Keep titles ≤ 70 chars to avoid truncation in SERPs.",
    language: "typescript",
    patch: `title: "<Primary Keyword — Brand>"  // ≤ 70 chars`,
  },
};

function fallbackFix(checklistItem: string, label: string, detail: string) {
  return {
    rationale: `${label} failed the audit: ${detail}. Consult docs/guides/seo-aeo-checklist.md for the authoritative rule.`,
    language: "text",
    patch: `// TODO: Fix "${label}" on the affected page.\n// Failure detail: ${detail}`,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface CreatedSuggestion {
  id: string;
  repo: string;
  siteUrl: string;
  filePath: string | null;
  checklistItem: string;
  severity: string;
  issue: string;
  rationale: string | null;
  proposedPatch: string | null;
  language: string;
  status: string;
}

/**
 * Take an audit result and persist one pending suggestion per failure.
 * Deduplicates: if a pending suggestion for the same (siteUrl, checklistItem)
 * already exists, it is left alone. Returns all newly-created rows.
 */
export async function persistAuditFailures(
  db: Db,
  audit: SeoAuditResult,
  auditRunId: string,
): Promise<CreatedSuggestion[]> {
  if (!audit.failures.length) return [];

  const { repo, rootLayoutPath } = resolveSite(audit.url);
  const created: CreatedSuggestion[] = [];

  for (const failure of audit.failures) {
    // Skip low-signal items that aren't really actionable advisories
    if (failure.key === "gzip") continue;

    // Dedup: same siteUrl + checklistItem still pending?
    const existing = await db
      .select({ id: repoUpdateSuggestions.id })
      .from(repoUpdateSuggestions)
      .where(
        and(
          eq(repoUpdateSuggestions.siteUrl, audit.url),
          eq(repoUpdateSuggestions.checklistItem, failure.key),
          eq(repoUpdateSuggestions.status, "pending"),
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;

    const fix =
      FIX_LIBRARY[failure.key] ??
      fallbackFix(failure.key, failure.label, failure.detail);

    const enrichedRationale = await enrichRationale({
      siteUrl: audit.url,
      checklistItem: failure.key,
      label: failure.label,
      detail: failure.detail,
      fallback: fix.rationale,
    });

    const [row] = await db
      .insert(repoUpdateSuggestions)
      .values({
        repo,
        siteUrl: audit.url,
        filePath: rootLayoutPath,
        checklistItem: failure.key,
        severity: failure.priority,
        issue: failure.detail,
        rationale: enrichedRationale,
        proposedPatch: fix.patch,
        language: fix.language,
        status: "pending",
        auditRunId,
      })
      .returning();

    if (row) {
      created.push({
        id: row.id,
        repo: row.repo,
        siteUrl: row.siteUrl,
        filePath: row.filePath,
        checklistItem: row.checklistItem,
        severity: row.severity,
        issue: row.issue,
        rationale: row.rationale,
        proposedPatch: row.proposedPatch,
        language: row.language,
        status: row.status,
      });
    }
  }

  logger.info(
    { url: audit.url, created: created.length, auditRunId },
    "Advisor persisted audit failures",
  );

  return created;
}

/**
 * Generate a human-readable email digest summarizing a batch of new suggestions.
 */
export function formatDigest(batches: Array<{ url: string; created: CreatedSuggestion[] }>): string {
  const lines: string[] = [];
  lines.push("Weekly SEO/AEO Audit — New Suggestions");
  lines.push("");
  let total = 0;
  for (const batch of batches) {
    if (!batch.created.length) continue;
    total += batch.created.length;
    lines.push(`Site: ${batch.url}`);
    for (const s of batch.created) {
      lines.push(`  [${s.severity}] ${s.checklistItem} — ${s.issue}`);
    }
    lines.push("");
  }
  if (total === 0) {
    lines.push("All monitored sites passed the audit. Nothing to review.");
  } else {
    lines.push(`Total: ${total} new suggestions. Review at /repo-updates in the dashboard.`);
  }
  return lines.join("\n");
}
