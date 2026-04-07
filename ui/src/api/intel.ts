import { api } from "./client.js";

export interface IntelCompany {
  slug: string;
  name: string;
  category: string;
  description?: string;
  website?: string;
  directory: string;
  dataSources?: string[];
  lastUpdated?: string;
}

export interface IntelIngestionHealth {
  last_ingested: string;
  count_last_24h: number;
}

export interface IntelDirectoryStat {
  companies: number;
  reports: number;
  fresh_companies: number;
}

export interface IntelStats {
  total_reports: number;
  reports_last_24h: number;
  by_type: Record<string, number>;
  last_ingested: Record<string, string>;
  top_companies: { slug: string; name: string; count: number }[];
  coverage: {
    total_companies: number;
    companies_with_data: number;
    sources: {
      twitter: number;
      github: number;
      reddit: number;
      rss: number;
      coingecko: number;
    };
  };
  reports_by_window: {
    last_hour: number;
    last_24h: number;
    last_7d: number;
    last_30d: number;
  };
  storage_estimate: {
    total_characters: number;
    approx_mb: number;
  };
  freshness: {
    companies_with_recent_data: number;
    total_companies: number;
    freshness_pct: number;
  };
  ingestion_health: Record<string, IntelIngestionHealth>;
  directories: Record<string, IntelDirectoryStat>;
  generated_at: string;
}

export const intelApi = {
  listCompanies: (directory?: string) => {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : "";
    return api.get<IntelCompany[]>(`/intel/companies${query}`);
  },
  getStats: () => api.get<IntelStats>(`/intel/stats`),
  getCompany: (slug: string) =>
    api.get<IntelCompany>(`/intel/company/${encodeURIComponent(slug)}`),
};
