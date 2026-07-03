// ---------------------------------------------------------------------------
// Coherent Ones University — email engagement events + stats tests.
//
// Three layers, mirroring the code split:
//   1. verifyEmailEventsSignature / parseEmailEvent — pure functions, tested
//      directly (signature valid/invalid/missing; kind extraction from tags;
//      unknown-event clamping; timestamp validation).
//   2. POST /api/university/email-events — supertest against the real router
//      (raw-body HMAC path: 500 unconfigured, 401 bad/missing sig, 202 +
//      insert on a valid signed event).
//   3. recordEmailEvent dedupe + getUniversityEmailStats aggregation — driven
//      with the query-queue db stub pattern from university-crons.test.ts.
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  verifyEmailEventsSignature,
  parseEmailEvent,
  recordEmailEvent,
  getUniversityEmailStats,
} from "../services/university-email-events.js";
import { universityEmailEventsRouter } from "../routes/university-email-events.js";
import { universityEmailEvents } from "@paperclipai/db";
import { useLocalServer } from "./helpers/supertest-server.js";

const SECRET = "test-email-events-secret";

function sign(body: string, secret: string = SECRET): string {
  return `v1=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// db stubs (query-queue pattern from university-crons.test.ts, extended with
// groupBy — the stats chains end select().from().where().groupBy()).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function makeStatsDb(queue: Row[][]) {
  let i = 0;
  function selectChain() {
    const chain = {
      from() {
        return chain;
      },
      where() {
        return chain;
      },
      groupBy() {
        const result = queue[i] ?? [];
        i += 1;
        return Promise.resolve(result);
      },
    };
    return chain;
  }
  return {
    db: { select: () => selectChain() } as unknown as Parameters<
      typeof getUniversityEmailStats
    >[0],
    get consumed() {
      return i;
    },
  };
}

function makeInsertDb() {
  const inserts: Row[] = [];
  const conflictConfigs: Array<{ target?: unknown[] }> = [];
  return {
    db: {
      insert: () => ({
        values(row: Row) {
          inserts.push(row);
          return {
            onConflictDoNothing(cfg: { target?: unknown[] }) {
              conflictConfigs.push(cfg);
              return Promise.resolve(undefined);
            },
          };
        },
      }),
    } as unknown as Parameters<typeof recordEmailEvent>[0],
    inserts,
    conflictConfigs,
  };
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

const local = useLocalServer();

describe("verifyEmailEventsSignature", () => {
  const body = JSON.stringify({ email: "a@x.test", event: "opened" });

  it("accepts a valid v1 signature over the exact raw body", () => {
    expect(verifyEmailEventsSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a signature computed with a different secret", () => {
    expect(
      verifyEmailEventsSignature(body, sign(body, "wrong-secret"), SECRET),
    ).toBe(false);
  });

  it("rejects when the body was tampered with after signing", () => {
    const tampered = body.replace("opened", "clicked");
    expect(verifyEmailEventsSignature(tampered, sign(body), SECRET)).toBe(
      false,
    );
  });

  it("rejects a missing header", () => {
    expect(verifyEmailEventsSignature(body, undefined, SECRET)).toBe(false);
  });

  it("rejects a header of a different length without throwing", () => {
    expect(verifyEmailEventsSignature(body, "v1=deadbeef", SECRET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Payload parsing (kind extraction + clamping)
// ---------------------------------------------------------------------------

describe("parseEmailEvent", () => {
  const base = {
    messageId: "msg-1",
    email: "Member@X.Test",
    event: "opened",
    url: null,
    tags: ["campaign", "university_reengage_d7", "university_other"],
    at: "2026-06-19T12:00:00.000Z",
  };

  it("extracts the FIRST university_* tag as kind and lowercases the email", () => {
    const evt = parseEmailEvent(base);
    expect(evt).not.toBeNull();
    expect(evt?.kind).toBe("university_reengage_d7");
    expect(evt?.email).toBe("member@x.test");
    expect(evt?.messageId).toBe("msg-1");
    expect(evt?.event).toBe("opened");
    expect(evt?.occurredAt.toISOString()).toBe("2026-06-19T12:00:00.000Z");
  });

  it("yields kind=null when no tag starts with university_", () => {
    const evt = parseEmailEvent({ ...base, tags: ["campaign", "misc"] });
    expect(evt?.kind).toBeNull();
  });

  it("yields kind=null when tags are missing entirely", () => {
    const { tags: _tags, ...noTags } = base;
    expect(parseEmailEvent(noTags)?.kind).toBeNull();
  });

  it("clamps an unknown event name to 'other'", () => {
    const evt = parseEmailEvent({ ...base, event: "proxy_opened" });
    expect(evt?.event).toBe("other");
  });

  it("nulls messageId/url when absent, keeps url when present", () => {
    const evt = parseEmailEvent({
      ...base,
      messageId: null,
      event: "clicked",
      url: "https://coherencedaddy.com/university",
    });
    expect(evt?.messageId).toBeNull();
    expect(evt?.url).toBe("https://coherencedaddy.com/university");
  });

  it("rejects a missing email, missing event, or unparseable timestamp", () => {
    expect(parseEmailEvent({ ...base, email: "" })).toBeNull();
    expect(parseEmailEvent({ ...base, event: "" })).toBeNull();
    expect(parseEmailEvent({ ...base, at: "not-a-date" })).toBeNull();
    expect(parseEmailEvent(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /api/university/email-events (raw-body HMAC route)
// ---------------------------------------------------------------------------

describe("POST /api/university/email-events", () => {
  const validPayload = JSON.stringify({
    messageId: "msg-42",
    email: "Member@X.Test",
    event: "clicked",
    url: "https://coherencedaddy.com/university",
    tags: ["university_reengage_d7"],
    at: "2026-06-19T12:00:00.000Z",
  });

  function makeApp(db: Parameters<typeof universityEmailEventsRouter>[0]) {
    const app = express();
    app.use("/api/university", universityEmailEventsRouter(db));
    return app;
  }

  beforeEach(() => {
    process.env.EMAIL_EVENTS_KEY = SECRET;
  });
  afterEach(() => {
    delete process.env.EMAIL_EVENTS_KEY;
  });

  it("500s (fail closed) when EMAIL_EVENTS_KEY is not configured", async () => {
    delete process.env.EMAIL_EVENTS_KEY;
    const { db, inserts } = makeInsertDb();
    const res = await request(local.via(makeApp(db)))
      .post("/api/university/email-events")
      .set("Content-Type", "application/json")
      .set("X-Email-Events-Signature", sign(validPayload))
      .send(validPayload);
    expect(res.status).toBe(500);
    expect(inserts).toHaveLength(0);
  });

  it("401s on a missing signature header", async () => {
    const { db, inserts } = makeInsertDb();
    const res = await request(local.via(makeApp(db)))
      .post("/api/university/email-events")
      .set("Content-Type", "application/json")
      .send(validPayload);
    expect(res.status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it("401s on an invalid signature", async () => {
    const { db, inserts } = makeInsertDb();
    const res = await request(local.via(makeApp(db)))
      .post("/api/university/email-events")
      .set("Content-Type", "application/json")
      .set("X-Email-Events-Signature", sign(validPayload, "wrong-secret"))
      .send(validPayload);
    expect(res.status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it("accepts a validly signed event: 202 + insert with kind from tags", async () => {
    const { db, inserts } = makeInsertDb();
    const res = await request(local.via(makeApp(db)))
      .post("/api/university/email-events")
      .set("Content-Type", "application/json")
      .set("X-Email-Events-Signature", sign(validPayload))
      .send(validPayload);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
    expect(inserts).toEqual([
      {
        messageId: "msg-42",
        email: "member@x.test",
        kind: "university_reengage_d7",
        event: "clicked",
        url: "https://coherencedaddy.com/university",
        occurredAt: new Date("2026-06-19T12:00:00.000Z"),
      },
    ]);
  });

  it("400s on a signed but malformed payload (no insert)", async () => {
    const bad = JSON.stringify({ event: "opened", at: "2026-06-19T12:00:00Z" });
    const { db, inserts } = makeInsertDb();
    const res = await request(local.via(makeApp(db)))
      .post("/api/university/email-events")
      .set("Content-Type", "application/json")
      .set("X-Email-Events-Signature", sign(bad))
      .send(bad);
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dedupe (ON CONFLICT DO NOTHING on the (message_id, event, occurred_at) uq)
// ---------------------------------------------------------------------------

describe("recordEmailEvent", () => {
  it("inserts with onConflictDoNothing targeting (messageId, event, occurredAt)", async () => {
    const { db, inserts, conflictConfigs } = makeInsertDb();
    await recordEmailEvent(db, {
      messageId: "msg-1",
      email: "a@x.test",
      kind: "university_reengage_d7",
      event: "opened",
      url: null,
      occurredAt: new Date("2026-06-19T12:00:00.000Z"),
    });
    expect(inserts).toHaveLength(1);
    expect(conflictConfigs).toHaveLength(1);
    const target = conflictConfigs[0].target ?? [];
    expect(target).toHaveLength(3);
    expect(target[0]).toBe(universityEmailEvents.messageId);
    expect(target[1]).toBe(universityEmailEvents.event);
    expect(target[2]).toBe(universityEmailEvents.occurredAt);
  });
});

// ---------------------------------------------------------------------------
// Stats aggregation. Query order: (1) sent per kind from the send log,
// (2) distinct-email counts per (kind, event), (3) clicked-url counts.
// ---------------------------------------------------------------------------

describe("getUniversityEmailStats", () => {
  it("computes counts, rates over delivered, and sorted/limited top URLs", async () => {
    const sentRows: Row[] = [
      { kind: "university_reengage_d7", sent: 10 },
      { kind: "university_streak_nudge", sent: 4 },
    ];
    const eventRows: Row[] = [
      { kind: "university_reengage_d7", event: "delivered", emails: 8 },
      { kind: "university_reengage_d7", event: "opened", emails: 4 },
      { kind: "university_reengage_d7", event: "clicked", emails: 2 },
      { kind: "university_reengage_d7", event: "bounced", emails: 1 },
      { kind: "university_reengage_d7", event: "unsubscribed", emails: 1 },
    ];
    // 12 distinct URLs — the rollup must keep only the top 10 by clicks.
    const urlRows: Row[] = Array.from({ length: 12 }, (_, n) => ({
      kind: "university_reengage_d7",
      url: `https://x.test/${n}`,
      clicks: n + 1, // /11 has 12 clicks … /0 has 1 click
    }));
    const { db, consumed: _c } = makeStatsDb([sentRows, eventRows, urlRows]);

    const stats = await getUniversityEmailStats(db);

    expect(stats).toHaveLength(2);
    // Highest-volume kind first.
    const [d7, nudge] = stats;
    expect(d7.kind).toBe("university_reengage_d7");
    expect(d7).toMatchObject({
      sent: 10,
      delivered: 8,
      opened: 4,
      clicked: 2,
      bounced: 1,
      unsubscribed: 1,
      openRate: 0.5, // 4 / 8 delivered
      clickRate: 0.25, // 2 / 8 delivered
    });
    expect(d7.topClickedUrls).toHaveLength(10);
    expect(d7.topClickedUrls[0]).toEqual({
      url: "https://x.test/11",
      clicks: 12,
    });
    expect(d7.topClickedUrls[9]).toEqual({
      url: "https://x.test/2",
      clicks: 3,
    });

    // A kind with sends but zero events: all-zero counters, 0 rates (no
    // divide-by-zero).
    expect(nudge).toMatchObject({
      kind: "university_streak_nudge",
      sent: 4,
      delivered: 0,
      opened: 0,
      clicked: 0,
      openRate: 0,
      clickRate: 0,
      topClickedUrls: [],
    });
  });

  it("surfaces a kind that only has events (no send-log rows yet)", async () => {
    const eventRows: Row[] = [
      { kind: "university_winback", event: "delivered", emails: 3 },
      { kind: "university_winback", event: "opened", emails: 3 },
    ];
    const { db } = makeStatsDb([[], eventRows, []]);

    const stats = await getUniversityEmailStats(db);

    expect(stats).toEqual([
      {
        kind: "university_winback",
        sent: 0,
        delivered: 3,
        opened: 3,
        clicked: 0,
        bounced: 0,
        unsubscribed: 0,
        openRate: 1,
        clickRate: 0,
        topClickedUrls: [],
      },
    ]);
  });
});
