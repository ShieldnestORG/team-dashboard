import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Watchtower admin — typed client for the /api/watchtower-admin surface
// (board-only). Mirrors the route handlers in
// server/src/routes/watchtower-admin.ts.
// ---------------------------------------------------------------------------

export interface WatchtowerAdminCustomerRow {
  subscriptionId: string;
  email: string | null;
  brandName: string;
  domain: string | null;
  plan: string;
  status: string;
  signupAt: string;
  stripeCustomerId: string | null;
  lastRunAt: string | null;
  lastMentionCount: number | null;
}

export interface WatchtowerAdminSubscription {
  id: string;
  email: string | null;
  accountId: string | null;
  brandName: string;
  domain: string | null;
  plan: string;
  status: string;
  frequency: string;
  promptCap: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
}

export interface WatchtowerAdminRunRow {
  id: string;
  runAt: string;
  engines: string[];
  totalPrompts: number;
  mentionCount: number;
  errorCount: number;
  summary: unknown;
}

export interface WatchtowerAdminActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface WatchtowerAdminCustomerDetail {
  subscription: WatchtowerAdminSubscription;
  prompts: string[];
  runs: WatchtowerAdminRunRow[];
  activityLog: WatchtowerAdminActivityEntry[];
}

export interface WatchtowerAdminAggregate {
  totalCustomers: number;
  activeCustomers: number;
  mrrCents: number;
  runsLast7d: number;
  runsLast30d: number;
  enginesWithErrorsLast7d: string[];
  totalMentionsLast30d: number;
}

export const watchtowerAdminApi = {
  listCustomers: () =>
    api.get<{ customers: WatchtowerAdminCustomerRow[] }>(
      "/watchtower-admin/customers",
    ),
  getCustomer: (subscriptionId: string) =>
    api.get<WatchtowerAdminCustomerDetail>(
      `/watchtower-admin/customers/${subscriptionId}`,
    ),
  aggregate: () =>
    api.get<WatchtowerAdminAggregate>("/watchtower-admin/aggregate"),
};
