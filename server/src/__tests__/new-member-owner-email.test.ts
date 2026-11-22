// ---------------------------------------------------------------------------
// Owner notice for every new paying University member (university-stripe-handler
// sends it through Brevo). The builder is pure so it can be checked here.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { buildNewMemberOwnerEmail } from "../services/university-email.js";
import { POSTAL_LINE } from "../services/email-theme.js";
import { expectBrandHeader, expectKitPaletteOnly, expectPngImagesOnly } from "./helpers/email-assert.js";

const base = {
  email: "member@example.com",
  displayName: "Sam Carter",
  plan: "Monthly",
  chargedDisplay: "$50.00",
  whenIso: "2026-11-21T20:00:00.000Z",
};

describe("buildNewMemberOwnerEmail", () => {
  it("keeps the subject the owner already filters on", () => {
    expect(buildNewMemberOwnerEmail(base).subject).toBe("💸 New $50.00 member: member@example.com");
  });

  it("uses the light branded frame (no address, no unsubscribe) and keeps every fact", () => {
    const { html, text } = buildNewMemberOwnerEmail(base);
    expectBrandHeader(html);
    expectKitPaletteOnly(html);
    expectPngImagesOnly(html);
    expect(html.replace(/&nbsp;/g, " ")).not.toContain(POSTAL_LINE);
    expect(html).not.toMatch(/unsubscribe/i);
    for (const fact of ["member@example.com", "Sam Carter", "Monthly", "2026-11-21T20:00:00.000Z"]) {
      expect(html).toContain(fact);
      expect(text).toContain(fact);
    }
    expect(text).toMatch(/Email: member@example\.com/);
    expect(text).toMatch(/Plan: Monthly/);
  });

  it("escapes the member's email and name, and shows a dash when there is no name", () => {
    const evil = buildNewMemberOwnerEmail({ ...base, email: "a<b>@x.test", displayName: "<i>Sam</i>" });
    expect(evil.html).toContain("a&lt;b&gt;@x.test");
    expect(evil.html).toContain("&lt;i&gt;Sam&lt;/i&gt;");
    expect(evil.html).not.toContain("<i>Sam</i>");
    expect(buildNewMemberOwnerEmail({ ...base, displayName: null }).text).toMatch(/Name: —/);
  });
});
