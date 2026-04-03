const API_BASE = "/api/intel";

export interface IntelCompany {
  slug: string;
  name: string;
  category: string;
  description: string;
  website: string;
  coingecko_id: string | null;
  github_org: string | null;
  subreddit: string | null;
  rss_feeds: string[];
  twitter_handle: string | null;
}

export interface IntelReport {
  id: string;
  company_slug: string;
  report_type: string;
  headline: string;
  body: string;
  source_url: string | null;
  captured_at: string;
}

export interface SearchResult {
  company_slug: string;
  company_name: string;
  report_type: string;
  headline: string;
  body: string;
  source_url: string | null;
  captured_at: string;
  similarity: number;
}

export interface IntelStats {
  total_reports: number;
  reports_last_24h: number;
  by_type: Record<string, number>;
  last_ingested: Record<string, string>;
  top_companies: Array<{ slug: string; name: string; count: number }>;
  coverage: { total_companies: number; companies_with_data: number; sources: Record<string, number> };
  generated_at: string;
}

async function get<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

export const api = {
  companies: () => get<{ companies: IntelCompany[] }>("/companies"),
  company: (slug: string) => get<{ company: IntelCompany; latest_reports: IntelReport[]; report_count: number }>(`/company/${slug}`),
  search: (q: string, limit = 20) => get<{ results: SearchResult[]; query: string }>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  stats: () => get<IntelStats>("/stats"),
};
