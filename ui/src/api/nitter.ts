import { api } from "./client";
import { ApiError } from "./client";

export interface NitterInstance {
  url: string;
  addedAt: string;
  lastCheckedAt: string | null;
  alive: boolean | null;
  consecutiveFailures: number;
}

async function deleteWithBody<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new ApiError(
      (errorBody as { error?: string } | null)?.error ?? `Request failed: ${res.status}`,
      res.status,
      errorBody,
    );
  }
  return res.json();
}

export const nitterApi = {
  list: () => api.get<{ instances: NitterInstance[] }>("/intel/nitter/instances"),
  add: (url: string) => api.post<{ ok: boolean; instance: NitterInstance }>("/intel/nitter/instances", { url }),
  remove: (url: string) => deleteWithBody<{ ok: boolean }>("/intel/nitter/instances", { url }),
  check: () => api.post<{ checked: number; alive: number; dead: number; instances: NitterInstance[] }>("/intel/nitter/check", {}),
};
