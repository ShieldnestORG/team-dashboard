// ---------------------------------------------------------------------------
// Directory Listings — public self-serve enrollment API client
// ---------------------------------------------------------------------------

const BASE = "/api/directory-listings";

export type DirectoryTier = "featured" | "verified" | "boosted";

export interface EnrollRequest {
  companySlug: string;
  email: string;
  tier: DirectoryTier;
  contactName: string;
}

export interface EnrollResponse {
  checkoutUrl: string;
  sessionId: number;
}

export const directoryListingsApi = {
  async enroll(body: EnrollRequest): Promise<EnrollResponse> {
    const res = await fetch(`${BASE}/public/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json() as { checkoutUrl?: string; sessionId?: number; error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? `Request failed: ${res.status}`);
    }
    return data as EnrollResponse;
  },
};
