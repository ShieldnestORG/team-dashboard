# SEO/AEO Checklist for All Properties & Partner Microsites

Every subdomain, microsite, and partner site in the Coherence Daddy ecosystem MUST have the following SEO and AEO infrastructure. This checklist is enforced programmatically via `server/src/services/partner-seo-checklist.ts`.

## Required Files

| File | Purpose | Priority |
|------|---------|----------|
| `robots.txt` | Allow search engines + AI bots (GPTBot, ClaudeBot, PerplexityBot). Include sitemap URL. | Critical |
| `sitemap.xml` | All public pages with lastmod, changefreq, priority | Critical |
| `llms.txt` | Machine-readable site description for AI crawlers | High |
| `site.webmanifest` | PWA manifest with name, short_name, description, icons | Medium |

## Required Meta Tags (per page)

| Tag | Example | Priority |
|-----|---------|----------|
| `<title>` | Under 60 chars, include brand | Critical |
| `<meta name="description">` | 150-160 chars, include primary keyword | Critical |
| `<link rel="canonical">` | Self-referencing canonical URL | Critical |
| OpenGraph (`og:title`, `og:description`, `og:url`, `og:type`) | For social sharing | High |
| Twitter Card (`twitter:card`, `twitter:title`, `twitter:description`) | For X/Twitter | High |

## Required Structured Data (JSON-LD)

| Schema | When | Priority |
|--------|------|----------|
| `Organization` or `LocalBusiness` | Every site root | High |
| `WebSite` with `SearchAction` | If site has search | High |
| `BreadcrumbList` | Every page with navigation depth > 1 | High |
| `FAQPage` | Landing pages with FAQ content | High |
| `SoftwareApplication` | Product/app pages | High |
| `Dataset` | Data-heavy pages (directory, API) | Medium |
| `HowTo` | Service/process pages | Medium |

## AEO-Specific Requirements

Answer Engine Optimization ensures AI assistants (ChatGPT, Claude, Perplexity) can find and cite your content:

1. **Allow AI bots in robots.txt** — GPTBot, ClaudeBot, PerplexityBot, Applebot-Extended
2. **Provide llms.txt** — machine-readable site summary at `/llms.txt`
3. **Use FAQPage schema** — AI engines prioritize FAQ structured data
4. **Use clear, factual headings** — AI engines extract H1-H3 content
5. **Include DataCatalog/Dataset schema** — for data-rich pages

## Per-Subdomain Status

| Property | robots | sitemap | JSON-LD | OG/Twitter | llms.txt | Canonical |
|----------|:------:|:-------:|:-------:|:----------:|:--------:|:---------:|
| coherencedaddy.com | Yes | Yes | Org+WebSite+FAQ | Yes | Yes | Yes |
| freetools.* | Yes | Yes | WebSite+Collection+Breadcrumb | Yes | Yes | Yes |
| directory.* | Yes | Yes | DataCatalog+WebSite+FAQ+Dataset | Yes | Yes | Yes |
| token.* | Yes | Yes | WebPage+Breadcrumb | Yes | Yes | Yes |
| law.* | Yes | Yes | WebSite+SoftwareApp+Breadcrumb | Yes | Yes | Yes |
| optimize-me.* | Yes | Yes | WebSite+SoftwareApp+Breadcrumb | Yes | Yes | Yes |

## Partner Microsites

When creating partner microsites, use the helper functions in `partner-seo-checklist.ts`:
- `generateRobotsTxt(siteUrl)` — creates robots.txt with AI bot rules
- `generateLlmsTxt({...})` — creates llms.txt from business info
- `generateOrganizationSchema({...})` — creates LocalBusiness JSON-LD
- `validateSeoChecklist({...})` — checks completion score

Run `validateSeoChecklist()` before publishing any partner site. Score must be 100% for critical items.
