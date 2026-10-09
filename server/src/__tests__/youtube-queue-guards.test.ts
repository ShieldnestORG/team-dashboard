// ---------------------------------------------------------------------------
// Publish Now must never re-upload a row that already went out (or failed):
// the approval flow (pending_review -> scheduled) reuses these entry points.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";

const isConfigured = vi.fn(() => false);
vi.mock("../services/platform-publishers/youtube.js", () => ({ youtubePublisher: { isConfigured, publish: vi.fn() } }));

const { forcePublish, PUBLISHABLE_QUEUE_STATUSES } = await import("../services/youtube/publish-queue.js");

/** Minimal stand-in for db.select().from().where().limit() returning one queue row. */
function fakeDb(row: Record<string, unknown>) {
  const chain = { from: () => chain, where: () => chain, limit: async () => [row] };
  return { select: () => chain } as unknown as Parameters<typeof forcePublish>[0];
}

describe("forcePublish status guard", () => {
  it.each(["published", "publishing", "failed"])("refuses a %s row before touching the publisher", async (status) => {
    isConfigured.mockClear();
    await expect(forcePublish(fakeDb({ id: "q1", status }), "q1")).rejects.toThrow(/only pending_review\/scheduled\/paused/);
    expect(isConfigured).not.toHaveBeenCalled();
  });

  it.each(PUBLISHABLE_QUEUE_STATUSES)("lets a %s row through to the publisher", async (status) => {
    isConfigured.mockClear();
    // The guard passed when the next step (publisher configuration) is reached.
    await expect(forcePublish(fakeDb({ id: "q2", status }), "q2")).rejects.toThrow(/credentials not configured/);
    expect(isConfigured).toHaveBeenCalledTimes(1);
  });
});
