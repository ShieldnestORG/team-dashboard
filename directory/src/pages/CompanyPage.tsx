import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type IntelCompany, type IntelReport } from "../api";
import { SchemaMarkup, articleSchema } from "../components/SchemaMarkup";

/* ── Helpers ──────────────────────────────────── */

const CATEGORY_LABELS: Record<string, string> = {
  "l1-blockchain": "Layer 1",
  "l2-blockchain": "Layer 2",
  defi: "DeFi",
  infrastructure: "Infrastructure",
  "cosmos-ecosystem": "Cosmos",
  payments: "Payments",
  wallet: "Wallet",
  exchange: "Exchange",
  nft: "NFT",
  enterprise: "Enterprise",
  dao: "DAO",
  data: "Data",
};

function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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

const REPORT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  news: { label: "News", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  price: { label: "Price", color: "bg-green-500/20 text-green-300 border-green-500/30" },
  twitter: { label: "Twitter", color: "bg-sky-500/20 text-sky-300 border-sky-500/30" },
  github: { label: "GitHub", color: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  reddit: { label: "Reddit", color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
};

function reportTypeConfig(type: string) {
  return REPORT_TYPE_CONFIG[type] ?? { label: type, color: "bg-gray-500/20 text-gray-300 border-gray-500/30" };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/* ── Page meta helper ────────────────────────── */

function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", description);
  }, [title, description]);
}

/* ── Component ────────────────────────────────── */

export function CompanyPage() {
  const { slug } = useParams<{ slug: string }>();
  const [company, setCompany] = useState<IntelCompany | null>(null);
  const [reports, setReports] = useState<IntelReport[]>([]);
  const [reportCount, setReportCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string>("all");

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    api
      .company(slug)
      .then((res) => {
        setCompany(res.company);
        setReports(res.latest_reports);
        setReportCount(res.report_count);
      })
      .catch(() => setError("Company not found"))
      .finally(() => setLoading(false));
  }, [slug]);

  usePageMeta(
    company ? `${company.name} — Blockchain Directory` : "Loading...",
    company
      ? `${company.name}: ${company.description.slice(0, 155)}`
      : "Loading company data..."
  );

  // Group reports by type
  const reportTypes = useMemo(() => {
    const types = new Set<string>();
    for (const r of reports) types.add(r.report_type);
    return Array.from(types).sort();
  }, [reports]);

  const filteredReports = useMemo(
    () => (activeType === "all" ? reports : reports.filter((r) => r.report_type === activeType)),
    [reports, activeType]
  );

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <div className="w-8 h-8 border-2 border-[var(--gold)]/40 border-t-[var(--gold)] rounded-full animate-spin mx-auto" />
      </main>
    );
  }

  if (error || !company) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <h1 className="text-3xl font-bold text-[var(--heading-white)] mb-4">
          Company Not Found
        </h1>
        <p className="text-[var(--slate)] mb-6">
          The project you are looking for does not exist in our directory.
        </p>
        <Link
          to="/"
          className="inline-block px-6 py-3 rounded-lg bg-[var(--gold)] text-[var(--black)] font-semibold hover:bg-[var(--gold-light)] transition-colors"
        >
          Back to Directory
        </Link>
      </main>
    );
  }

  const catClass =
    CATEGORY_COLORS[company.category] ?? "bg-gray-500/15 text-gray-400 border-gray-500/30";

  const companyUrl = `https://directory.coherencedaddy.com/company/${company.slug}`;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Schema.org Article structured data */}
      <SchemaMarkup
        type="Article"
        data={articleSchema({
          headline: `${company.name} — Blockchain Intelligence`,
          description: company.description,
          url: companyUrl,
        })}
      />

      {/* Back link */}
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--gold)] hover:text-[var(--gold-light)] mb-8 transition-colors"
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="8" x2="4" y2="8" />
          <polyline points="8,4 4,8 8,12" />
        </svg>
        Back to directory
      </Link>

      {/* ── Company Header ───────────────── */}
      <section className="mb-10">
        <div className="flex flex-wrap items-start gap-4 mb-4">
          <h1 className="text-3xl sm:text-4xl font-bold text-[var(--heading-white)]">
            {company.name}
          </h1>
          <span className={`text-sm px-3 py-1 rounded-full font-medium border ${catClass}`}>
            {categoryLabel(company.category)}
          </span>
        </div>
        <p className="text-lg text-[var(--slate)] max-w-3xl mb-6">{company.description}</p>

        {/* External links */}
        <div className="flex flex-wrap gap-3">
          <ExternalLink href={company.website} label="Website" />
          {company.github_org && (
            <ExternalLink
              href={`https://github.com/${company.github_org}`}
              label="GitHub"
            />
          )}
          {company.twitter_handle && (
            <ExternalLink
              href={`https://x.com/${company.twitter_handle}`}
              label="Twitter"
            />
          )}
          {company.subreddit && (
            <ExternalLink
              href={`https://reddit.com/r/${company.subreddit}`}
              label="Reddit"
            />
          )}
        </div>
      </section>

      {/* ── Intel Feed ───────────────────── */}
      <section>
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <h2 className="text-2xl font-semibold text-[var(--heading-white)]">
            Intel Feed
          </h2>
          <span className="text-sm text-[var(--slate)]">
            {reportCount} report{reportCount !== 1 ? "s" : ""} total
          </span>
        </div>

        {/* Type filter pills */}
        {reportTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => setActiveType("all")}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer border ${
                activeType === "all"
                  ? "bg-[var(--gold)] text-[var(--black)] border-[var(--gold)]"
                  : "bg-[var(--warm-gray)] text-[var(--white)] border-[var(--muted)]/40 hover:border-[var(--gold)]/50"
              }`}
            >
              All
            </button>
            {reportTypes.map((type) => {
              const cfg = reportTypeConfig(type);
              const active = activeType === type;
              return (
                <button
                  key={type}
                  onClick={() => setActiveType(type)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer border ${
                    active
                      ? "bg-[var(--gold)] text-[var(--black)] border-[var(--gold)]"
                      : `${cfg.color} border hover:opacity-80`
                  }`}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Reports list */}
        {filteredReports.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[var(--slate)]">No intel reports yet for this project.</p>
            <p className="text-sm text-[var(--muted)] mt-2">
              Data is collected every 2-8 hours. Check back soon.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReports.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

/* ── Sub-components ─────────────────────────── */

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--warm-gray)] border border-[var(--muted)]/40 text-sm text-[var(--white)] hover:border-[var(--gold)]/50 hover:text-[var(--gold)] transition-all"
    >
      {label}
      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M5 1h6v6" />
        <path d="M11 1 5 7" />
      </svg>
    </a>
  );
}

function ReportCard({ report }: { report: IntelReport }) {
  const cfg = reportTypeConfig(report.report_type);

  return (
    <article className="bg-[var(--warm-gray)] border border-[var(--muted)]/30 rounded-xl p-5 hover:border-[var(--muted)]/60 transition-colors">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span
          className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${cfg.color}`}
        >
          {cfg.label}
        </span>
        <span className="text-xs text-[var(--muted)] ml-auto">
          {timeAgo(report.captured_at)}
        </span>
      </div>
      <h3 className="text-[var(--heading-white)] font-medium mb-2">
        {report.headline}
      </h3>
      <p className="text-sm text-[var(--slate)] line-clamp-3 whitespace-pre-line">
        {report.body}
      </p>
      {report.source_url && (
        <a
          href={report.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-3 text-xs text-[var(--gold)] hover:text-[var(--gold-light)] transition-colors"
        >
          View source
          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 1h5v5" />
            <path d="M9 1 3 7" />
          </svg>
        </a>
      )}
    </article>
  );
}
