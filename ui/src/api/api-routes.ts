import { api } from "./client";

export interface ApiRouteGroup {
  name: string;
  prefix: string;
  endpointCount: number;
  description: string;
  authType: "public" | "authenticated" | "content-key" | "ingest-key";
  category: "core" | "content" | "intel" | "integrations" | "public" | "system" | "plugins";
  pingUrl: string;
  liveStatus?: {
    status: "up" | "down" | "degraded";
    latencyMs: number;
    checkedAt: string;
  };
}

export interface ApiRoutesResponse {
  routes: ApiRouteGroup[];
  stats: {
    totalGroups: number;
    totalEndpoints: number;
    upCount: number;
    publicCount: number;
    authCount: number;
    contentKeyCount: number;
    ingestKeyCount: number;
  };
}

export interface PingResult {
  prefix: string;
  status: "up" | "down" | "degraded";
  latencyMs: number;
  checkedAt: string;
}

export const apiRoutesApi = {
  list: (ping = false) =>
    api.get<ApiRoutesResponse>(`/system-health/api-routes${ping ? "?ping=true" : ""}`),
  ping: (prefix: string) =>
    api.post<PingResult>("/system-health/api-routes/ping", { prefix }),
};
