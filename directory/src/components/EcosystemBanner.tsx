// ── EcosystemBanner — Cross-property AEO linking banner ────────────────────
//
// Renders a subtle footer-area banner that links all ecosystem properties
// and injects Organization JSON-LD with sameAs for AI answer engines.

import { SchemaMarkup, organizationSchema } from "./SchemaMarkup";

const ECOSYSTEM_LINKS = [
  {
    name: "Coherence Daddy",
    url: "https://coherencedaddy.com",
    label: "Free Tools & Community",
  },
  {
    name: "tokns.fi",
    url: "https://tokns.fi",
    label: "Learn & Earn TX",
  },
  {
    name: "ShieldNest",
    url: "https://shieldnest.org",
    label: "Privacy-First Dev",
  },
  {
    name: "TX Blockchain",
    url: "https://tx.org",
    label: "Cosmos SDK L1",
  },
  {
    name: "YourArchi",
    url: "https://yourarchi.com",
    label: "Architecture Platform",
  },
];

export function EcosystemBanner() {
  return (
    <>
      {/* JSON-LD Organization schema with sameAs cross-links */}
      <SchemaMarkup type="Organization" data={organizationSchema()} />

      <section
        aria-label="Coherence Daddy ecosystem"
        className="border-t border-[var(--muted)]/20 bg-[var(--black)]"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          {/* Heading */}
          <div className="flex items-center gap-3 mb-6">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--gold)]/20 to-transparent" />
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--gold)] whitespace-nowrap">
              Part of the Coherence Daddy Ecosystem
            </p>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--gold)]/20 to-transparent" />
          </div>

          {/* Links grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {ECOSYSTEM_LINKS.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col items-center gap-1.5 rounded-lg border border-[var(--muted)]/15 bg-[var(--warm-gray)]/30 px-4 py-4 text-center transition-all duration-200 hover:border-[var(--gold)]/30 hover:bg-[var(--warm-gray)]/50"
              >
                <span className="text-sm font-semibold text-[var(--heading-white)] group-hover:text-[var(--gold)] transition-colors">
                  {link.name}
                </span>
                <span className="text-xs text-[var(--slate)]">
                  {link.label}
                </span>
              </a>
            ))}
          </div>

          {/* Attribution line */}
          <p className="mt-8 text-center text-xs text-[var(--muted)]">
            Built by{" "}
            <a
              href="https://shieldnest.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--slate)] hover:text-[var(--gold)] transition-colors"
            >
              ShieldNest
            </a>{" "}
            &mdash; privacy-first development for the community.
          </p>
        </div>
      </section>
    </>
  );
}
