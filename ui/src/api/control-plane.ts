import { api } from "./client";

export interface RepoEntry {
  key: string;
  name: string;
  remote: string;
  org: string;
  localPath: string;
  role: "full-clone" | "worktree" | "non-git";
  branch: string;
  deployTarget: string;
  coupled: boolean;
  controlBase?: string;
  notes?: string;
}

export interface ReposResponse {
  repos: RepoEntry[];
  counts: {
    total: number;
    coupled: number;
    byOrg: Record<string, number>;
  };
}

export interface PingResult {
  key: string;
  controlBase: string;
  ok: boolean;
  status?: number;
  ms?: number;
}

export const controlPlaneApi = {
  listRepos: () => api.get<ReposResponse>("/control-plane/repos"),
  getRepo: (key: string) =>
    api.get<RepoEntry>(`/control-plane/repos/${encodeURIComponent(key)}`),
  pingRepo: (key: string) =>
    api.post<PingResult>(`/control-plane/repos/${encodeURIComponent(key)}/ping`, {}),
};
