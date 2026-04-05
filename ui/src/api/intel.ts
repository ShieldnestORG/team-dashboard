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

export interface IntelStats {
  totalCompanies: number;
  totalReports: number;
  directories: Record<string, number>;
  lastIngestion?: string;
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
