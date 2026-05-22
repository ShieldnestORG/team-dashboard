import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Auto-reply — graceful skip when no X OAuth tokens are connected.
//
// Regression test for the prod log-spam where every cron tick logged
//   [ERROR] Auto-reply search poll failed
//     Error: No X OAuth tokens found for account 'primary' — connect your X account first
// because the up-front token check used the wrong account slug and the real
// throw happened inside searchRecent on each query iteration.
// ---------------------------------------------------------------------------

const loadTokensMock = vi.hoisted(() =>
  vi.fn<
    (
      _db: unknown,
      _companyId: string,
      _slug?: string,
    ) => Promise<null | { accessToken: string; refreshToken: string; expiresAt: Date; scope: string; xUserId: string; xUsername: string }>
  >(),
);

vi.mock("../services/x-api/oauth.js", () => ({
  loadTokens: loadTokensMock,
  // Other exports are not used by AutoReplyService.pollViaSearch, but the
  // module is imported in the production file — stub minimally to satisfy
  // ESM module resolution.
  getValidToken: vi.fn(),
  saveTokens: vi.fn(),
  refreshAccessToken: vi.fn(),
  deleteTokens: vi.fn(),
  revokeTokens: vi.fn(),
}));

// Don't let the rate-limiter touch real budget state or panic globals.
vi.mock("../services/x-api/rate-limiter.js", () => ({
  canUseDailyBudget: vi.fn().mockReturnValue({ allowed: true }),
  canAffordRead: vi.fn().mockReturnValue(true),
  recordReadCost: vi.fn(),
  updateBudgetConfig: vi.fn(),
  canMakeRequest: vi.fn().mockReturnValue({ allowed: true }),
  recordRequest: vi.fn(),
  incrementDailyUsage: vi.fn(),
  enablePanicMode: vi.fn(),
}));

vi.mock("../services/live-events.js", () => ({
  publishGlobalLiveEvent: vi.fn(),
}));

vi.mock("../services/cron-registry.js", () => ({
  registerCronJob: vi.fn(),
}));

vi.mock("../services/ollama-client.js", () => ({
  callOllamaGenerate: vi.fn(),
}));

// Import after mocks register.
import { AutoReplyService } from "../services/auto-reply.js";

type ConfigRow = {
  id: string;
  companyId: string;
  targetType: string;
  targetXUserId: string | null;
  targetXUsername: string;
  enabled: boolean;
  replyMode: string;
  replyTemplates: string[] | null;
  aiPrompt: string | null;
  maxRepliesPerDay: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  xAccountSlug: string | null;
};

function makeDbWithConfigs(rows: ConfigRow[]) {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  return {
    select: vi.fn().mockReturnValue(selectChain),
  } as unknown as Parameters<typeof AutoReplyService.prototype.loadConfigs>[0] extends never
    ? object
    : object;
}

describe("auto-reply — graceful skip when no OAuth tokens", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    loadTokensMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns early without throwing and never calls X API when primary tokens are missing", async () => {
    // One account-type config so buildSearchQueries() returns a non-empty query.
    const row: ConfigRow = {
      id: "cfg-1",
      companyId: "co-1",
      targetType: "account",
      targetXUserId: null,
      targetXUsername: "bobrasx",
      enabled: true,
      replyMode: "template",
      replyTemplates: ["hi {author}"],
      aiPrompt: null,
      maxRepliesPerDay: 5,
      minDelaySeconds: 0,
      maxDelaySeconds: 0,
      xAccountSlug: "primary",
    };
    const db = makeDbWithConfigs([row]);

    // Token lookup returns null — simulating the unconnected `primary` account.
    loadTokensMock.mockResolvedValue(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new AutoReplyService(db as any);
    // Bypass loadConfigs/loadSettings so we don't need the full DB mock surface.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).allConfigs = [row];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).configsByUsername = new Map([[row.targetXUsername.toLowerCase(), row]]);

    const result = await svc.pollViaSearch();

    expect(result).toEqual({ checked: 0, found: 0, newReplies: 0 });
    // The poll should ask for tokens under the `primary` slug specifically.
    expect(loadTokensMock).toHaveBeenCalledWith(expect.anything(), expect.any(String), "primary");
    // No outbound X API request should ever go out when tokens are missing.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not throw if loadTokens itself rejects (catch → null)", async () => {
    const row: ConfigRow = {
      id: "cfg-2",
      companyId: "co-1",
      targetType: "account",
      targetXUserId: null,
      targetXUsername: "txDevHub",
      enabled: true,
      replyMode: "template",
      replyTemplates: ["hi"],
      aiPrompt: null,
      maxRepliesPerDay: 5,
      minDelaySeconds: 0,
      maxDelaySeconds: 0,
      xAccountSlug: "primary",
    };
    const db = makeDbWithConfigs([row]);
    loadTokensMock.mockRejectedValue(new Error("DB unreachable"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new AutoReplyService(db as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).allConfigs = [row];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).configsByUsername = new Map([[row.targetXUsername.toLowerCase(), row]]);

    await expect(svc.pollViaSearch()).resolves.toEqual({ checked: 0, found: 0, newReplies: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
