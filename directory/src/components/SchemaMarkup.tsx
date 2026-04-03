// ── SchemaMarkup — Reusable JSON-LD structured data injection ──────────────
//
// Renders a <script type="application/ld+json"> tag for any schema.org type.
// Also exports pre-built schema generators for the directory's key page types.

interface SchemaMarkupProps {
  type: "WebSite" | "Organization" | "ItemList" | "Article";
  data: Record<string, unknown>;
}

export function SchemaMarkup({ type, data }: SchemaMarkupProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": type,
    ...data,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

// ── Pre-built schema generators ────────────────────────────────────────────

const ECOSYSTEM_PROPERTIES = [
  "https://coherencedaddy.com",
  "https://tokns.fi",
  "https://app.tokns.fi",
  "https://shieldnest.org",
  "https://tx.org",
  "https://freetools.coherencedaddy.com",
  "https://directory.coherencedaddy.com",
  "https://yourarchi.com",
];

/** Organization schema for Coherence Daddy with sameAs cross-property links */
export function organizationSchema(): Record<string, unknown> {
  return {
    name: "Coherence Daddy",
    url: "https://coherencedaddy.com",
    logo: "https://coherencedaddy.com/logo.png",
    description:
      "Free tools, blockchain intelligence, and community products. Part of the ShieldNest ecosystem.",
    sameAs: ECOSYSTEM_PROPERTIES,
    foundingDate: "2024",
    parentOrganization: {
      "@type": "Organization",
      name: "ShieldNest",
      url: "https://shieldnest.org",
    },
  };
}

/** WebSite schema for directory.coherencedaddy.com */
export function websiteSchema(): Record<string, unknown> {
  return {
    name: "Coherence Daddy Blockchain Directory",
    url: "https://directory.coherencedaddy.com",
    description:
      "Real-time blockchain intelligence directory. Prices, news, GitHub activity, and social sentiment for 114+ projects.",
    publisher: {
      "@type": "Organization",
      name: "Coherence Daddy",
      url: "https://coherencedaddy.com",
      sameAs: ECOSYSTEM_PROPERTIES,
    },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate:
          "https://directory.coherencedaddy.com/?q={search_term_string}",
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * ItemList schema for the company listing page.
 * Pass an array of { name, url, position } for each listed company.
 */
export function itemListSchema(
  items: { name: string; url: string; position: number }[]
): Record<string, unknown> {
  return {
    name: "Blockchain Projects Directory",
    description:
      "Comprehensive listing of blockchain and cryptocurrency projects with real-time intelligence data.",
    numberOfItems: items.length,
    itemListElement: items.map((item) => ({
      "@type": "ListItem",
      position: item.position,
      name: item.name,
      url: item.url,
    })),
  };
}

/**
 * Article schema for individual company intel pages.
 * Pass company-specific details to generate the schema.
 */
export function articleSchema(params: {
  headline: string;
  description: string;
  url: string;
  datePublished?: string;
  dateModified?: string;
  image?: string;
}): Record<string, unknown> {
  return {
    headline: params.headline,
    description: params.description,
    url: params.url,
    datePublished: params.datePublished ?? new Date().toISOString(),
    dateModified: params.dateModified ?? new Date().toISOString(),
    image: params.image,
    author: {
      "@type": "Organization",
      name: "Coherence Daddy",
      url: "https://coherencedaddy.com",
      sameAs: ECOSYSTEM_PROPERTIES,
    },
    publisher: {
      "@type": "Organization",
      name: "Coherence Daddy",
      url: "https://coherencedaddy.com",
      logo: {
        "@type": "ImageObject",
        url: "https://coherencedaddy.com/logo.png",
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": params.url,
    },
    isPartOf: {
      "@type": "WebSite",
      name: "Coherence Daddy Blockchain Directory",
      url: "https://directory.coherencedaddy.com",
    },
  };
}
