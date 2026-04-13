/**
 * SEO/AEO Checklist for Partner Microsites
 *
 * Every partner site (and subdomain) MUST have these elements.
 * Used by partner-site-publisher.ts during site generation.
 */

export interface SeoChecklist {
  // Required files
  robotsTxt: boolean
  sitemapXml: boolean
  llmsTxt: boolean
  webManifest: boolean

  // Required metadata per page
  titleTag: boolean
  metaDescription: boolean
  canonicalUrl: boolean
  openGraph: boolean
  twitterCard: boolean

  // Required structured data (JSON-LD)
  organizationSchema: boolean
  webSiteSchema: boolean
  breadcrumbSchema: boolean
  localBusinessSchema: boolean // for partner businesses

  // AEO (Answer Engine Optimization)
  faqSchema: boolean
  howToSchema: boolean // if applicable

  // Technical
  mobileResponsive: boolean
  httpsEnabled: boolean
  gzip: boolean
}

export const REQUIRED_SEO_ITEMS: Array<{
  key: keyof SeoChecklist
  label: string
  description: string
  priority: "critical" | "high" | "medium"
}> = [
  // Files
  { key: "robotsTxt", label: "robots.txt", description: "Allow search engines and AI bots to crawl. Include sitemap URL.", priority: "critical" },
  { key: "sitemapXml", label: "sitemap.xml", description: "List all public pages with lastmod, changefreq, priority.", priority: "critical" },
  { key: "llmsTxt", label: "llms.txt", description: "Machine-readable description for AI crawlers (GPTBot, ClaudeBot, etc).", priority: "high" },
  { key: "webManifest", label: "site.webmanifest", description: "PWA manifest with name, description, icons, theme_color.", priority: "medium" },

  // Meta tags
  { key: "titleTag", label: "Title Tag", description: "Unique <title> per page, under 60 chars. Include brand name.", priority: "critical" },
  { key: "metaDescription", label: "Meta Description", description: "Unique description per page, 150-160 chars. Include primary keyword.", priority: "critical" },
  { key: "canonicalUrl", label: "Canonical URL", description: "Self-referencing canonical on every page to prevent duplicate content.", priority: "critical" },
  { key: "openGraph", label: "OpenGraph Tags", description: "og:title, og:description, og:url, og:type, og:image for social sharing.", priority: "high" },
  { key: "twitterCard", label: "Twitter Card", description: "twitter:card, twitter:title, twitter:description for X/Twitter sharing.", priority: "high" },

  // Structured data
  { key: "organizationSchema", label: "Organization JSON-LD", description: "Schema.org Organization with name, url, logo, sameAs links.", priority: "high" },
  { key: "webSiteSchema", label: "WebSite JSON-LD", description: "Schema.org WebSite with SearchAction if applicable.", priority: "high" },
  { key: "breadcrumbSchema", label: "BreadcrumbList JSON-LD", description: "Navigation breadcrumbs for search result rich snippets.", priority: "high" },
  { key: "localBusinessSchema", label: "LocalBusiness JSON-LD", description: "For partner businesses: address, hours, phone, geo coordinates.", priority: "high" },

  // AEO
  { key: "faqSchema", label: "FAQPage JSON-LD", description: "FAQ structured data for AI answer engines. 3-5 questions minimum.", priority: "high" },
  { key: "howToSchema", label: "HowTo JSON-LD", description: "Step-by-step instructions if applicable (services, processes).", priority: "medium" },

  // Technical
  { key: "mobileResponsive", label: "Mobile Responsive", description: "Viewport meta tag + responsive layout. Test at 375px width.", priority: "critical" },
  { key: "httpsEnabled", label: "HTTPS", description: "SSL certificate active. All resources loaded over HTTPS.", priority: "critical" },
  { key: "gzip", label: "Gzip Compression", description: "Enable gzip/brotli for HTML, CSS, JS responses.", priority: "medium" },
]

/** Generate robots.txt content for a partner site */
export function generateRobotsTxt(siteUrl: string): string {
  return `User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: GoogleOther
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
Host: ${siteUrl}
`
}

/** Generate llms.txt content for a partner site */
export function generateLlmsTxt(opts: {
  businessName: string
  description: string
  siteUrl: string
  services: string[]
  location?: string
}): string {
  const lines = [
    `# ${opts.businessName}`,
    `# ${opts.description}`,
    `# ${opts.siteUrl}`,
    `# Powered by Coherence Daddy AEO Engine`,
    "",
    "## Services",
    ...opts.services.map((s) => `- ${s}`),
  ]
  if (opts.location) {
    lines.push("", `## Location`, `- ${opts.location}`)
  }
  lines.push("", `## Powered By`, `- Coherence Daddy (https://coherencedaddy.com)`)
  return lines.join("\n") + "\n"
}

/** Generate Organization JSON-LD for a partner */
export function generateOrganizationSchema(opts: {
  name: string
  url: string
  description: string
  phone?: string
  address?: { street: string; city: string; state: string; zip: string }
  sameAs?: string[]
}) {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": opts.address ? "LocalBusiness" : "Organization",
    name: opts.name,
    url: opts.url,
    description: opts.description,
  }
  if (opts.phone) schema.telephone = opts.phone
  if (opts.address) {
    schema.address = {
      "@type": "PostalAddress",
      streetAddress: opts.address.street,
      addressLocality: opts.address.city,
      addressRegion: opts.address.state,
      postalCode: opts.address.zip,
      addressCountry: "US",
    }
  }
  if (opts.sameAs?.length) schema.sameAs = opts.sameAs
  return schema
}

/** Validate which SEO items are present */
export function validateSeoChecklist(checklist: Partial<SeoChecklist>): {
  score: number
  total: number
  missing: Array<{ key: string; label: string; priority: string }>
} {
  const total = REQUIRED_SEO_ITEMS.length
  const missing = REQUIRED_SEO_ITEMS.filter((item) => !checklist[item.key])
  return {
    score: total - missing.length,
    total,
    missing: missing.map((m) => ({ key: m.key, label: m.label, priority: m.priority })),
  }
}
