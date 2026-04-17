export interface AdminAffiliate {
  id: string;
  name: string;
  email: string;
  status: string;          // "pending" | "active" | "suspended"
  commissionRate: string;  // e.g. "0.10"
  prospectCount: number;
  convertedCount: number;
  createdAt: string;
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/affiliates/admin${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const affiliatesAdminApi = {
  list: () =>
    adminRequest<{ affiliates: AdminAffiliate[] }>("/"),
  updateStatus: (id: string, status: "active" | "pending" | "suspended") =>
    adminRequest<{ ok: boolean }>(`/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }),
};
