import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  validateZernioAutomationInput,
  verifyZernioSignature,
  ZERNIO_ANALYTICS_PATHS,
  type ZernioAutomationInput,
} from "../services/platform-publishers/zernio.js";
import {
  extractEmail,
  extractLeadFromZernioEvent,
} from "../services/socials/zernio-lead-capture.js";

const SECRET = "test-webhook-secret";

function sign(body: string, encoding: "hex" | "base64"): string {
  return createHmac("sha256", SECRET).update(Buffer.from(body)).digest(encoding);
}

describe("verifyZernioSignature", () => {
  const body = JSON.stringify({ id: "evt_1", event: "comment.received" });
  const raw = Buffer.from(body);

  it("accepts a hex digest", () => {
    expect(verifyZernioSignature(raw, sign(body, "hex"), SECRET)).toBe(true);
  });

  it("accepts an sha256=-prefixed hex digest", () => {
    expect(verifyZernioSignature(raw, `sha256=${sign(body, "hex")}`, SECRET)).toBe(true);
  });

  it("accepts a base64 digest", () => {
    expect(verifyZernioSignature(raw, sign(body, "base64"), SECRET)).toBe(true);
  });

  it("rejects a digest computed with the wrong secret", () => {
    const wrong = createHmac("sha256", "other-secret").update(raw).digest("hex");
    expect(verifyZernioSignature(raw, wrong, SECRET)).toBe(false);
  });

  it("rejects a digest for a different body (tamper)", () => {
    const other = sign(JSON.stringify({ id: "evt_2" }), "hex");
    expect(verifyZernioSignature(raw, other, SECRET)).toBe(false);
  });

  it("rejects missing header or missing secret", () => {
    expect(verifyZernioSignature(raw, undefined, SECRET)).toBe(false);
    expect(verifyZernioSignature(raw, sign(body, "hex"), "")).toBe(false);
  });
});

describe("validateZernioAutomationInput", () => {
  const valid: ZernioAutomationInput = {
    zernioAccountId: "6a2f0e515f7d1751abb350cf",
    name: "ROOM -> University LP",
    keywords: ["ROOM"],
    dmMessage: "the honest version, $50 flat, cancel in two clicks.",
    buttons: [{ type: "url", title: "See the room", url: "https://jointhecoherent.com?src=ig-room" }],
    clickTag: "ig-room",
  };

  it("passes a well-formed funnel", () => {
    expect(validateZernioAutomationInput(valid)).toEqual([]);
  });

  it("rejects a dmMessage over 640 chars", () => {
    const problems = validateZernioAutomationInput({ ...valid, dmMessage: "x".repeat(641) });
    expect(problems.some((p) => p.includes("max 640"))).toBe(true);
  });

  it("rejects empty keywords (fire-on-any-comment is a ToS hazard)", () => {
    const problems = validateZernioAutomationInput({ ...valid, keywords: [] });
    expect(problems.some((p) => p.includes("keyword"))).toBe(true);
  });

  it("rejects more than 3 buttons and long titles", () => {
    const btn = { type: "url" as const, title: "ok", url: "https://x.dev" };
    expect(
      validateZernioAutomationInput({ ...valid, buttons: [btn, btn, btn, btn] }).some((p) =>
        p.includes("3 buttons"),
      ),
    ).toBe(true);
    expect(
      validateZernioAutomationInput({
        ...valid,
        buttons: [{ ...btn, title: "this title is way over twenty chars" }],
      }).some((p) => p.includes("20 chars")),
    ).toBe(true);
  });

  it("rejects unknown triggers (no drip/broadcast surfaces exist here)", () => {
    const problems = validateZernioAutomationInput({
      ...valid,
      trigger: "broadcast" as unknown as "comment",
    });
    expect(problems.some((p) => p.includes("trigger"))).toBe(true);
  });
});

describe("extractLeadFromZernioEvent", () => {
  it("captures a commenter with author identity", () => {
    const lead = extractLeadFromZernioEvent("comment.received", {
      id: "evt_1",
      event: "comment.received",
      comment: {
        id: "c1",
        platformPostId: "p1",
        platform: "instagram",
        text: "ROOM",
        author: { id: "igsid-123", username: "someone", name: "Some One" },
      },
      account: { id: "6a2f0e515f7d1751abb350cf", platform: "instagram", username: "coherencedaddy" },
    });
    expect(lead).toMatchObject({
      captureKind: "comment",
      platform: "instagram",
      zernioAccountId: "6a2f0e515f7d1751abb350cf",
      platformUserId: "igsid-123",
      handle: "someone",
    });
  });

  it("skips outgoing messages (our own DMs are not leads)", () => {
    const lead = extractLeadFromZernioEvent("message.received", {
      message: { direction: "outgoing", sender: { id: "us" } },
      account: { id: "z1" },
    });
    expect(lead).toBeNull();
  });

  it("pulls a typed email out of an inbound DM", () => {
    const lead = extractLeadFromZernioEvent("message.received", {
      message: {
        direction: "incoming",
        platform: "instagram",
        text: "sure — Jane.Doe+ig@example.com",
        sender: { id: "igsid-9", username: "jane" },
      },
      account: { id: "z1" },
    });
    expect(lead?.email).toBe("jane.doe+ig@example.com");
    expect(lead?.captureKind).toBe("dm");
  });

  it("maps a lead form submission with email + name fields", () => {
    const lead = extractLeadFromZernioEvent("lead.received", {
      lead: {
        id: "l1",
        leadgenId: "lg-42",
        formId: "f1",
        fields: { full_name: "Jane Doe", work_email: "jane@example.com" },
        isOrganic: true,
      },
      account: { id: "z2", platform: "facebook" },
    });
    expect(lead).toMatchObject({
      captureKind: "lead_form",
      platformUserId: "leadgen:lg-42",
      email: "jane@example.com",
      displayName: "Jane Doe",
    });
  });

  it("returns null for post lifecycle events", () => {
    expect(extractLeadFromZernioEvent("post.published", { post: {} })).toBeNull();
    expect(extractLeadFromZernioEvent("account.disconnected", { account: { id: "z" } })).toBeNull();
  });
});

describe("extractEmail", () => {
  it("lowercases and extracts the first address", () => {
    expect(extractEmail("Hit me at Foo.Bar@Example.COM thanks")).toBe("foo.bar@example.com");
    expect(extractEmail("no address here")).toBeNull();
    expect(extractEmail(null)).toBeNull();
  });
});

describe("ZERNIO_ANALYTICS_PATHS", () => {
  it("covers the 26 /v1/analytics paths plus follower/health/usage meta", () => {
    const analyticsPaths = Object.values(ZERNIO_ANALYTICS_PATHS).filter((p) =>
      p.startsWith("/analytics"),
    );
    expect(analyticsPaths).toHaveLength(25); // + inbox-conversation param path = 26 surfaces
    expect(ZERNIO_ANALYTICS_PATHS["follower-stats"]).toBe("/accounts/follower-stats");
  });
});
