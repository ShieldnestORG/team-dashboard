export interface HouseAd {
  id: string;
  companyId: string;
  title: string;
  imageAssetId: string;
  imageAlt: string;
  clickUrl: string;
  slot: string;
  weight: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  impressions: number;
  clicks: number;
  createdAt: string;
  updatedAt: string;
}

export interface HouseAdPayload {
  title: string;
  imageAssetId: string;
  imageAlt?: string;
  clickUrl: string;
  slot: string;
  weight?: number;
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

async function houseAdsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/house-ads${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const houseAdsApi = {
  list: () => houseAdsRequest<{ ads: HouseAd[] }>("/"),

  create: (payload: HouseAdPayload) =>
    houseAdsRequest<{ ad: HouseAd }>("/", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  update: (id: string, payload: Partial<HouseAdPayload>) =>
    houseAdsRequest<{ ad: HouseAd }>(`/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  remove: (id: string) =>
    houseAdsRequest<{ ok: boolean }>(`/${id}`, { method: "DELETE" }),
};
