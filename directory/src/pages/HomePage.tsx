import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type IntelCompany, type IntelStats, type SearchResult } from "../api";

/* ── Category config ────────────────────────── */

const CATEGORIES = [
  { slug: "all", label: "All" },
  { slug: "l1-blockchain", label: "Layer 1" },
  { slug: "l2-blockchain", label: "Layer 2" },
  { slug: "defi", label: "DeFi" },
  { slug: "infrastructure", label: "Infrastructure" },
  { slug: "cosmos-ecosystem", label: "Cosmos" },
  { slug: "payments", label: "Payments" },
  { slug: "wallet", label: "Wallet" },
  { slug: "exchange", label: "Exchange" },
  { slug: "nft", label: "NFT" },
  { slug: "enterprise", label: "Enterprise" },
  { slug: "dao", label: "DAO" },
  { slug: "data", label: "Data" },
] as const;

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c.label])
);

function categoryLabel(slug: string): string {
  return CATEGORY_LABEL[slug] ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Category badge colors ────────────────────── */

const CATEGORY_COLORS: Record<string, string> = {
  "l1-blockchain": "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "l2-blockchain": "bg-violet-500/15 text-violet-400 border-violet-500/30",
  defi: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  infrastructure: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "cosmos-ecosystem": "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  payments: "bg-green-500/15 text-green-400 border-green-500/30",
  wallet: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  exchange: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  nft: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  enterprise: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  dao: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  data: "bg-teal-500/15 text-teal-400 border-teal-500/30",
};

function categoryBadgeClass(cat: string): string {
  return CATEGORY_COLORS[cat] ?? "bg-gray-500/15 text-gray-400 border-gray-500/30";
}

/* ── Report type badge colors ────────────────── */

const REPORT_TYPE_COLORS: Record<string, string> = {
  news: "bg-blue-500/20 text-blue-300",
  price: "bg-green-500/20 text-green-300",
  twitter: "bg-sky-500/20 text-sky-300",
  github: "bg-purple-500/20 text-purple-300",
  reddit: "bg-orange-500/20 text-orange-300",
};

function reportBadgeClass(type: string): string {
  return REPORT_TYPE_COLORS[type] ?? "bg-gray-500/20 text-gray-300";
}

/* ── Page meta ────────────────────────────────── */

function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", description);
  }, [title, description]);
}

/* ── Component ────────────────────────────────── */

export function HomePage() {
  usePageMeta(
    "Blockchain Directory — Coherence Daddy",
    "Explore 114+ blockchain projects with real-time intelligence. Prices, news, GitHub activity, social sentiment — all in one directory."
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [companies, setCompanies] = useState<IntelCompany[]>([]);
  const [stats, setStats] = useState<IntelStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(initialQuery);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [category, setCategory] = useState("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load companies and stats
  useEffect(() => {
    Promise.all([api.companies(), api.stats()])
      .then(([compRes, statsRes]) => {
        setCompanies(compRes.companies.sort((a, b) => a.name.localeCompare(b.name)));
        setStats(statsRes);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Debounced search
  const doSearch = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!q.trim()) {
        setSearchResults(null);
        setSearchParams({});
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setSearching(true);
        setSearchParams({ q });
        try {
          const res = await api.search(q);
          setSearchResults(res.results);
        } catch (e) {
          console.error(e);
          setSearchResults([]);
        } finally {
          setSearching(false);
        }
      }, 300);
    },
    [setSearchParams]
  );

  // Search on initial load if query param present
  useEffect(() => {
    if (initialQuery) doSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    doSearch(val);
  };

  // Filtered companies
  const filtered = useMemo(
    () =>
      category === "all"
        ? companies
        : companies.filter((c) => c.category === category),
    [companies, category]
  );

  // Count companies per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: companies.length };
    for (const c of companies) {
      counts[c.category] = (counts[c.category] ?? 0) + 1;
    }
    return counts;
  }, [companies]);

  return (
    <main>
      {/* ── Hero Section ───────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--gold)]/5 to-transparent pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-12 relative">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[var(--heading-white)] text-center mb-4">
            Blockchain Directory
          </h1>
          <p className="text-lg sm:text-xl text-[var(--slate)] text-center mb-10 max-w-2xl mx-auto">
            Explore 114+ blockchain projects with real-time intelligence from
            prices, news, GitHub, Twitter, and Reddit.
          </p>

          {/* Search */}
          <div className="max-w-2xl mx-auto mb-10">
            <div className="relative">
              <svg
                className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--slate)]"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="9" cy="9" r="7" />
                <line x1="14" y1="14" x2="19" y2="19" />
              </svg>
              <input
                id="directory-search"
                type="text"
                value={query}
                onChange={handleQueryChange}
                placeholder="Search projects, reports, or topics..."
                className="w-full pl-12 pr-4 py-4 rounded-xl bg-[var(--warm-gray)] border border-[var(--muted)]/50 text-[var(--white)] placeholder-[var(--slate)] text-lg focus:outline-none focus:border-[var(--gold)]/60 focus:ring-1 focus:ring-[var(--gold)]/30 transition-all"
              />
              {searching && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <div className="w-5 h-5 border-2 border-[var(--gold)]/40 border-t-[var(--gold)] rounded-full animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* Stats row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
              <StatCard
                label="Projects"
                value={stats.coverage.total_companies.toLocaleString()}
              />
              <StatCard
                label="Intel Reports"
                value={stats.total_reports.toLocaleString()}
              />
              <StatCard
                label="Last 24h"
                value={stats.reports_last_24h.toLocaleString()}
              />
              <StatCard
                label="Data Sources"
                value={Object.keys(stats.coverage.sources).length.toString()}
              />
            </div>
          )}
        </div>
      </section>

      {/* ── Search Results ────────────────── */}
      {searchResults !== null && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <h2 className="text-xl font-semibold text-[var(--heading-white)] mb-4">
            {searchResults.length > 0
              ? `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} for "${query}"`
              : `No results for "${query}"`}
          </h2>
          <div className="space-y-3">
            {searchResults.map((r, i) => (
              <article
                key={`${r.company_slug}-${i}`}
                className="bg-[var(--warm-gray)] border border-[var(--muted)]/30 rounded-xl p-5 hover:border-[var(--gold)]/30 transition-colors"
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Link
                    to={`/company/${r.company_slug}`}
                    className="font-semibold text-[var(--heading-white)] hover:text-[var(--gold)] transition-colors"
                  >
                    {r.company_name}
                  </Link>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${reportBadgeClass(r.report_type)}`}
                  >
                    {r.report_type}
                  </span>
                  <span className="text-xs text-[var(--muted)] ml-auto">
                    {(r.similarity * 100).toFixed(0)}% match
                  </span>
                </div>
                <p className="text-sm text-[var(--white)] mb-1 font-medium">
                  {r.headline}
                </p>
                <p className="text-sm text-[var(--slate)] line-clamp-2">
                  {r.body}
                </p>
                {r.source_url && (
                  <a
                    href={r.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-xs text-[var(--gold)] hover:text-[var(--gold-light)]"
                  >
                    View source &rarr;
                  </a>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ── Category Filter ──────────────── */}
      {searchResults === null && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => {
              const count = categoryCounts[cat.slug] ?? 0;
              const active = category === cat.slug;
              return (
                <button
                  key={cat.slug}
                  onClick={() => setCategory(cat.slug)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all cursor-pointer border ${
                    active
                      ? "bg-[var(--gold)] text-[var(--black)] border-[var(--gold)]"
                      : "bg-[var(--warm-gray)] text-[var(--white)] border-[var(--muted)]/40 hover:border-[var(--gold)]/50"
                  }`}
                >
                  {cat.label}
                  {cat.slug !== "all" && count > 0 && (
                    <span
                      className={`ml-1.5 text-xs ${
                        active ? "text-[var(--black)]/70" : "text-[var(--slate)]"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Company Grid ─────────────────── */}
      {searchResults === null && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-2 border-[var(--gold)]/40 border-t-[var(--gold)] rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-[var(--slate)] py-12">
              No companies in this category.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((company) => (
                <CompanyCard key={company.slug} company={company} />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

/* ── Sub-components ─────────────────────────── */

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center p-4 rounded-xl bg-[var(--warm-gray)] border border-[var(--muted)]/30">
      <p className="text-2xl sm:text-3xl font-bold text-[var(--gold)]">{value}</p>
      <p className="text-xs text-[var(--slate)] mt-1 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function CompanyCard({ company }: { company: IntelCompany }) {
  return (
    <Link
      to={`/company/${company.slug}`}
      className="block group"
    >
      <article className="bg-[var(--warm-gray)] border border-[var(--muted)]/30 rounded-xl p-5 h-full hover:border-[var(--gold)]/40 transition-all hover:shadow-lg hover:shadow-[var(--gold)]/5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-lg font-semibold text-[var(--heading-white)] group-hover:text-[var(--gold)] transition-colors">
            {company.name}
          </h3>
          <span
            className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium border ${categoryBadgeClass(company.category)}`}
          >
            {categoryLabel(company.category)}
          </span>
        </div>
        <p className="text-sm text-[var(--slate)] line-clamp-3 mb-4">
          {company.description}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">
            {company.website.replace(/^https?:\/\//, "")}
          </span>
          <span className="text-xs text-[var(--gold)] opacity-0 group-hover:opacity-100 transition-opacity">
            View intel &rarr;
          </span>
        </div>
      </article>
    </Link>
  );
}
