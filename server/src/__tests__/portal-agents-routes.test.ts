import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock email callback (magic link send is a no-op in tests).
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: vi.fn(async () => undefined),
}));

// Mock stripe-client (not used by agents routes, but imported transitively).
vi.mock("../services/stripe-client.js", () => ({
  stripeRequest: vi.fn(),
  stripeConfigured: () => false,
}));

import { portalRoutes } from "../routes/portal.js";
import { portalAgentsRoutes } from "../routes/portal-agents.js";
import { errorHandler } from "../middleware/index.js";
import { PORTAL_SESSION_COOKIE } from "../services/customer-portal.js";
import {
  customerAccounts,
  customerActionLog,
  customerMagicLinks,
  customerCredentials,
  creditscoreSubscriptions,
  creditscoreContentDrafts,
  creditscoreSchemaImpls,
  creditscoreCompetitorScans,
  bundleSubscriptions,
} from "@paperclipai/db";

// Browsers send an Origin header on every unsafe (non-GET) request; the portal
// CSRF guard (middleware/portal-csrf.ts) fail-closes without a trusted one.
// Must match the PORTAL_BASE_URL this suite sets in beforeAll.
const TRUSTED_ORIGIN = "https://app.test.local";

// ---------------------------------------------------------------------------
// In-memory DB stub — mirrors the pattern from portal-routes.test.ts.
// Extends it to handle the 3 agent output tables.
// ---------------------------------------------------------------------------

interface AccountRow {
  id: string;
  email: string;
  stripeCustomerId: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

interface SubRow {
  id: string;
  email: string;
  tier: string;
  status: string;
  createdAt: Date;
}

interface ContentDraftRow {
  id: string;
  subscriptionId: string;
  domain: string;
  cycleTag: string;
  cycleIndex: number;
  title: string;
  slug: string;
  targetSignal: string | null;
  htmlDraft: string;
  markdownDraft: string | null;
  status: string;
  reviewNotes: string | null;
  reviewedByUserId: string | null;
  reviewedByAgentId: string | null;
  reviewedAt: Date | null;
  publishedUrl: string | null;
  publishedAt: Date | null;
  bodyTrimmedAt: Date | null;
  promptMeta: Record<string, unknown>;
  approvedByCustomerAccountId: string | null;
  rejectedByCustomerAccountId: string | null;
  customerRejectionReason: string | null;
  customerActionedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SchemaImplRow {
  id: string;
  subscriptionId: string;
  domain: string;
  cycleTag: string;
  cycleIndex: number;
  schemaType: string;
  jsonLd: Record<string, unknown>;
  htmlSnippet: string;
  promptMeta: Record<string, unknown>;
  status: string;
  reviewNotes: string | null;
  reviewedByUserId: string | null;
  reviewedByAgentId: string | null;
  reviewedAt: Date | null;
  deliveredAt: Date | null;
  approvedByCustomerAccountId: string | null;
  rejectedByCustomerAccountId: string | null;
  customerRejectionReason: string | null;
  customerActionedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CompetitorScanRow {
  id: string;
  subscriptionId: string;
  parentReportId: string | null;
  cycleTag: string;
  customerDomain: string;
  competitorDomain: string;
  competitorScore: number | null;
  customerScore: number | null;
  auditJson: Record<string, unknown>;
  gapSummary: string | null;
  status: string;
  approvedByCustomerAccountId: string | null;
  rejectedByCustomerAccountId: string | null;
  customerRejectionReason: string | null;
  customerActionedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface State {
  links: Array<{
    token: string;
    email: string;
    expiresAt: Date;
    consumedAt: Date | null;
    createdAt: Date;
  }>;
  accounts: AccountRow[];
  actionLog: Array<{ accountId: string | null; kind: string }>;
  subs: SubRow[];
  contentDrafts: ContentDraftRow[];
  schemaImpls: SchemaImplRow[];
  competitorScans: CompetitorScanRow[];
}

function makeDb(state: State) {
  function tableKey(t: unknown): string {
    if (t === customerMagicLinks) return "links";
    if (t === customerAccounts) return "accounts";
    if (t === customerCredentials) return "credentials";
    if (t === customerActionLog) return "actionLog";
    if (t === creditscoreSubscriptions) return "subs";
    if (t === bundleSubscriptions) return "bundles";
    if (t === creditscoreContentDrafts) return "contentDrafts";
    if (t === creditscoreSchemaImpls) return "schemaImpls";
    if (t === creditscoreCompetitorScans) return "competitorScans";
    return "unknown";
  }

  function selectImpl(_proj?: unknown) {
    return {
      from(tbl: unknown) {
        const name = tableKey(tbl);
        const chain: any = {
          where: () => chain,
          leftJoin: () => chain,
          orderBy: () => chain,
          limit: () => chain,
          then(resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) {
            try {
              if (name === "links") return resolve(state.links as unknown[]);
              if (name === "accounts") return resolve(state.accounts as unknown[]);
              if (name === "subs") return resolve(state.subs as unknown[]);
              if (name === "contentDrafts") return resolve(state.contentDrafts as unknown[]);
              if (name === "schemaImpls") return resolve(state.schemaImpls as unknown[]);
              if (name === "competitorScans") return resolve(state.competitorScans as unknown[]);
              return resolve([]);
            } catch (err) {
              reject?.(err);
            }
          },
        };
        return chain;
      },
    };
  }

  function insertImpl(tbl: unknown) {
    const name = tableKey(tbl);
    return {
      values(payload: Record<string, unknown>) {
        if (name === "links") {
          state.links.push({
            token: String(payload.token),
            email: String(payload.email),
            expiresAt: payload.expiresAt as Date,
            consumedAt: null,
            createdAt: new Date(),
          });
        } else if (name === "actionLog") {
          state.actionLog.push({
            accountId: (payload.accountId as string | null) ?? null,
            kind: String(payload.kind),
          });
        }
        const handle: any = {
          returning: () => ({
            then(resolve: (v: unknown[]) => void) {
              if (name === "accounts") {
                const row: AccountRow = {
                  id: `acc-${state.accounts.length + 1}`,
                  email: String(payload.email),
                  stripeCustomerId: null,
                  createdAt: new Date(),
                  lastLoginAt: (payload.lastLoginAt as Date | null) ?? null,
                };
                state.accounts.push(row);
                return resolve([row]);
              }
              return resolve([]);
            },
          }),
          then: (resolve: () => void) => resolve(),
        };
        return handle;
      },
    };
  }

  function updateImpl(tbl: unknown) {
    const name = tableKey(tbl);
    return {
      set(patch: Record<string, unknown>) {
        return {
          where() {
            const handle: any = {
              returning: () => ({
                then(resolve: (v: unknown[]) => void) {
                  if (name === "links") {
                    const unconsumed = state.links.filter((l) => !l.consumedAt);
                    for (const l of unconsumed) {
                      l.consumedAt = (patch.consumedAt as Date) ?? new Date();
                    }
                    return resolve(unconsumed);
                  }
                  if (name === "contentDrafts") {
                    for (const d of state.contentDrafts) {
                      Object.assign(d, patch);
                    }
                    return resolve(state.contentDrafts.length ? [{ id: state.contentDrafts[0].id }] : []);
                  }
                  if (name === "schemaImpls") {
                    for (const s of state.schemaImpls) {
                      Object.assign(s, patch);
                    }
                    return resolve(state.schemaImpls.length ? [{ id: state.schemaImpls[0].id }] : []);
                  }
                  if (name === "competitorScans") {
                    for (const c of state.competitorScans) {
                      Object.assign(c, patch);
                    }
                    return resolve(state.competitorScans.length ? [{ id: state.competitorScans[0].id }] : []);
                  }
                  return resolve([]);
                },
              }),
              then(resolve: () => void) {
                if (name === "accounts") {
                  for (const a of state.accounts) {
                    if (patch.lastLoginAt) a.lastLoginAt = patch.lastLoginAt as Date;
                    if (patch.stripeCustomerId !== undefined) {
                      a.stripeCustomerId = patch.stripeCustomerId as string | null;
                    }
                  }
                }
                resolve();
              },
            };
            return handle;
          },
        };
      },
    };
  }

  return {
    select: selectImpl,
    insert: insertImpl,
    update: updateImpl,
    delete: () => ({ where: () => Promise.resolve() }),
  };
}

// Build an Express app with both the auth routes + agent routes, mirroring
// how app.ts mounts them.
function buildApp(db: ReturnType<typeof makeDb>) {
  const app = express();
  app.use(express.json());
  app.use("/api/portal", portalRoutes(db as any));
  app.use("/api/portal/agents", portalAgentsRoutes(db as any));
  app.use(errorHandler);
  return app;
}

// Helper: authenticate end-to-end and return a session cookie string.
async function login(app: ReturnType<typeof buildApp>, state: State, email: string) {
  state.links.push({
    token: `tok-${email}`,
    email,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    consumedAt: null,
    createdAt: new Date(),
  });
  const authRes = await request(app)
    .post(`/api/portal/auth?token=tok-${email}`)
    .set("Origin", TRUSTED_ORIGIN);
  const setCookieHeader = authRes.headers["set-cookie"];
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const sessionCookie = cookies
    .map((c) => (typeof c === "string" ? c.split(";")[0] : null))
    .find((c) => c && c.startsWith(`${PORTAL_SESSION_COOKIE}=`));
  return sessionCookie as string;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("portal-agents routes", () => {
  const baseEmail = "customer@example.com";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PORTAL_SESSION_SECRET =
      "test-test-test-test-test-test-test-test-test-test-secret";
    process.env.PORTAL_BASE_URL = TRUSTED_ORIGIN;
    process.env.NODE_ENV = "development";
    delete process.env.PORTAL_COOKIE_DOMAIN;
    process.env.PORTAL_COOKIE_DOMAIN = "";
  });

  // ── Auth guard ──────────────────────────────────────────────────────────
  it("GET /feed returns 401 without a session cookie", async () => {
    const state: State = {
      links: [],
      accounts: [],
      actionLog: [],
      subs: [],
      contentDrafts: [],
      schemaImpls: [],
      competitorScans: [],
    };
    const app = buildApp(makeDb(state));
    const res = await request(app).get("/api/portal/agents/feed");
    expect(res.status).toBe(401);
  });

  // ── Feed — empty when no subscriptions ─────────────────────────────────
  it("GET /feed returns empty array when customer has no subscriptions", async () => {
    const state: State = {
      links: [],
      accounts: [],
      actionLog: [],
      subs: [],
      contentDrafts: [],
      schemaImpls: [],
      competitorScans: [],
    };
    const app = buildApp(makeDb(state));
    const cookie = await login(app, state, baseEmail);

    const res = await request(app)
      .get("/api/portal/agents/feed")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  // ── Feed — returns merged items across kinds ────────────────────────────
  it("GET /feed returns items when customer has an active subscription with agent outputs", async () => {
    const subId = "sub-001";
    const state: State = {
      links: [],
      accounts: [],
      actionLog: [],
      subs: [
        {
          id: subId,
          email: baseEmail,
          tier: "growth",
          status: "active",
          createdAt: new Date(),
        },
      ],
      contentDrafts: [
        {
          id: "draft-001",
          subscriptionId: subId,
          domain: "example.com",
          cycleTag: "2026-05",
          cycleIndex: 0,
          title: "My Draft Page",
          slug: "my-draft-page",
          targetSignal: "AEO",
          htmlDraft: "<p>draft</p>",
          markdownDraft: null,
          status: "pending_review",
          reviewNotes: null,
          reviewedByUserId: null,
          reviewedByAgentId: null,
          reviewedAt: null,
          publishedUrl: null,
          publishedAt: null,
          bodyTrimmedAt: null,
          promptMeta: {},
          approvedByCustomerAccountId: null,
          rejectedByCustomerAccountId: null,
          customerRejectionReason: null,
          customerActionedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      schemaImpls: [],
      competitorScans: [],
    };
    const app = buildApp(makeDb(state));
    const cookie = await login(app, state, baseEmail);

    const res = await request(app)
      .get("/api/portal/agents/feed?limit=50")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].kind).toBe("content_draft");
    expect(res.body.items[0].title).toBe("My Draft Page");
    expect(res.body.items[0].status).toBe("pending_review");
  });

  // ── GET /items/:kind/:id — full body ────────────────────────────────────
  it("GET /items/content_draft/:id returns full draft body", async () => {
    const subId = "sub-002";
    const state: State = {
      links: [],
      accounts: [],
      actionLog: [],
      subs: [{ id: subId, email: baseEmail, tier: "growth", status: "active", createdAt: new Date() }],
      contentDrafts: [
        {
          id: "draft-002",
          subscriptionId: subId,
          domain: "example.com",
          cycleTag: "2026-05",
          cycleIndex: 1,
          title: "Full Draft",
          slug: "full-draft",
          targetSignal: null,
          htmlDraft: "<h1>Hello</h1>",
          markdownDraft: "# Hello",
          status: "pending_review",
          reviewNotes: null,
          reviewedByUserId: null,
          reviewedByAgentId: null,
          reviewedAt: null,
          publishedUrl: null,
          publishedAt: null,
          bodyTrimmedAt: null,
          promptMeta: {},
          approvedByCustomerAccountId: null,
          rejectedByCustomerAccountId: null,
          customerRejectionReason: null,
          customerActionedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      schemaImpls: [],
      competitorScans: [],
    };
    const app = buildApp(makeDb(state));
    const cookie = await login(app, state, baseEmail);

    const res = await request(app)
      .get("/api/portal/agents/items/content_draft/draft-002")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.htmlDraft).toBe("<h1>Hello</h1>");
    expect(res.body.markdownDraft).toBe("# Hello");
    expect(res.body.kind).toBe("content_draft");
  });

  // ── POST /items/:kind/:id/approve ───────────────────────────────────────
  it("POST /items/content_draft/:id/approve sets status to approved", async () => {
    const subId = "sub-003";
    const state: State = {
      links: [],
      accounts: [],
      actionLog: [],
      subs: [{ id: subId, email: baseEmail, tier: "growth", status: "active", createdAt: new Date() }],
      contentDrafts: [
        {
          id: "draft-003",
          subscriptionId: subId,
          domain: "example.com",
          cycleTag: "2026-05",
          cycleIndex: 2,
          title: "To Approve",
          slug: "to-approve",
          targetSignal: null,
          htmlDraft: "<p>approve me</p>",
          markdownDraft: null,
          status: "pending_review",
          reviewNotes: null,
          reviewedByUserId: null,
          reviewedByAgentId: null,
          reviewedAt: null,
          publishedUrl: null,
          publishedAt: null,
          bodyTrimmedAt: null,
          promptMeta: {},
          approvedByCustomerAccountId: null,
          rejectedByCustomerAccountId: null,
          customerRejectionReason: null,
          customerActionedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      schemaImpls: [],
      competitorScans: [],
    };
    const app = buildApp(makeDb(state));
    const cookie = await login(app, state, baseEmail);

    const res = await request(app)
      .post("/api/portal/agents/items/content_draft/draft-003/approve")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(state.contentDrafts[0].status).toBe("approved");
    expect(state.contentDrafts[0].approvedByCustomerAccountId).toBeTruthy();
  });

  // ── POST /items/:kind/:id/reject ────────────────────────────────────────
  it("POST /items/schema_impl/:id/reject sets status to rejected with reason", async () => {
    const subId = "sub-004";
    const state: State = {
      links: [],
      accounts: [],
      actionLog: [],
      subs: [{ id: subId, email: baseEmail, tier: "growth", status: "active", createdAt: new Date() }],
      contentDrafts: [],
      schemaImpls: [
        {
          id: "schema-001",
          subscriptionId: subId,
          domain: "example.com",
          cycleTag: "2026-W20",
          cycleIndex: 0,
          schemaType: "Organization",
          jsonLd: { "@context": "https://schema.org" },
          htmlSnippet: "<script>...</script>",
          promptMeta: {},
          status: "pending_review",
          reviewNotes: null,
          reviewedByUserId: null,
          reviewedByAgentId: null,
          reviewedAt: null,
          deliveredAt: null,
          approvedByCustomerAccountId: null,
          rejectedByCustomerAccountId: null,
          customerRejectionReason: null,
          customerActionedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      competitorScans: [],
    };
    const app = buildApp(makeDb(state));
    const cookie = await login(app, state, baseEmail);

    const res = await request(app)
      .post("/api/portal/agents/items/schema_impl/schema-001/reject")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", cookie)
      .send({ reason: "Incorrect schema type" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(state.schemaImpls[0].status).toBe("rejected");
    expect(state.schemaImpls[0].customerRejectionReason).toBe("Incorrect schema type");
    expect(state.schemaImpls[0].rejectedByCustomerAccountId).toBeTruthy();
  });

  // ── GET /items — invalid kind ────────────────────────────────────────────
  it("GET /items/invalid_kind/:id returns 400", async () => {
    const subId = "sub-005";
    const state: State = {
      links: [],
      accounts: [],
      actionLog: [],
      subs: [{ id: subId, email: baseEmail, tier: "growth", status: "active", createdAt: new Date() }],
      contentDrafts: [],
      schemaImpls: [],
      competitorScans: [],
    };
    const app = buildApp(makeDb(state));
    const cookie = await login(app, state, baseEmail);

    const res = await request(app)
      .get("/api/portal/agents/items/invalid_kind/some-id")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });
});
