// ---------------------------------------------------------------------------
// Trends-digest store + Rule-7 approval gate — runs against embedded Postgres
// with the FULL migration chain (so this also validates migration 0138). Proves
// a pending digest is never served, that approve/send gate correctly, and that
// a rebuild can't clobber an approved/sent row.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startNoPgvectorTestDatabase } from "./helpers/embedded-postgres-no-pgvector.js";
import { trendsDigestStore } from "../services/trends-digest/store.js";
import type { TrendDigest } from "../services/trends-digest/types.js";

let handle: Awaited<ReturnType<typeof startNoPgvectorTestDatabase>>;
let store: ReturnType<typeof trendsDigestStore>;

beforeAll(async () => {
  handle = await startNoPgvectorTestDatabase("trends-digest-store-");
  store = trendsDigestStore(handle.db);
}, 180_000);

afterAll(async () => {
  await handle?.cleanup();
});

function makeDigest(date: string): TrendDigest {
  return {
    digestDate: date,
    generatedAt: `${date}T12:00:00.000Z`,
    status: "pending",
    items: [],
    adFriendlyItemIds: ["item-a"],
  };
}

describe("trendsDigestStore — Rule 7 lifecycle", () => {
  it("a pending digest is stored but never served as published", async () => {
    await store.savePending(makeDigest("2026-06-25"));
    expect(await store.latestPublished()).toBeNull();
    const pending = await store.latestPending();
    expect(pending?.digestDate).toBe("2026-06-25");
    expect(pending?.status).toBe("pending");
    expect(pending?.adFriendlyIds).toEqual(["item-a"]);
  });

  it("approve flips pending → approved and now it IS served", async () => {
    expect(await store.approve("2026-06-25", "tester")).toBe(true);
    const published = await store.latestPublished();
    expect(published?.digestDate).toBe("2026-06-25");
    expect(published?.status).toBe("approved");
    expect(published?.approvedBy).toBe("tester");
    // A second approve is a no-op (nothing pending for that date).
    expect(await store.approve("2026-06-25", "tester")).toBe(false);
  });

  it("send requires approved; markSent flips approved → sent", async () => {
    expect(await store.markSent("2026-06-25")).toBe(true);
    const row = await store.getByDate("2026-06-25");
    expect(row?.status).toBe("sent");
    expect(row?.sentAt).toBeTruthy();
    // Cannot mark sent again (no longer approved).
    expect(await store.markSent("2026-06-25")).toBe(false);
  });

  it("a rebuild cannot clobber an approved/sent digest for the same date", async () => {
    await store.savePending(makeDigest("2026-06-25")); // would-be overwrite
    const row = await store.getByDate("2026-06-25");
    expect(row?.status).toBe("sent"); // untouched
  });

  it("reject discards a pending digest without publishing it", async () => {
    await store.savePending(makeDigest("2026-06-26"));
    expect(await store.reject("2026-06-26")).toBe(true);
    const row = await store.getByDate("2026-06-26");
    expect(row?.status).toBe("rejected");
    // latestPublished still points at the older sent digest, not the rejected one.
    const published = await store.latestPublished();
    expect(published?.digestDate).toBe("2026-06-25");
  });
});
