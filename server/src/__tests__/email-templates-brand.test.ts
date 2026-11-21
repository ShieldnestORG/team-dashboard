// ---------------------------------------------------------------------------
// Every team-dashboard Coherence Daddy email goes out in the house look.
//
// Drives all 21 sendTransactional templates plus the two SMTP-only senders
// (dashboard password reset, shop-sharer welcome) through the real builders
// with the transports mocked, so no mail can leave this test.
// ---------------------------------------------------------------------------

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Sent = { to: unknown; subject: string; html: string; text?: string; attachments?: Array<{ cid?: string }> };
const brevoSent: Sent[] = [];
const smtpSent: Sent[] = [];

vi.mock("../services/brevo.js", () => ({
  brevoConfigured: () => true,
  sendMailBrevoFirst: vi.fn(async (mail: Sent) => {
    brevoSent.push(mail);
    return true;
  }),
}));
vi.mock("nodemailer", () => ({
  createTransport: () => ({
    sendMail: async (m: Sent) => {
      smtpSent.push(m);
    },
  }),
}));

import {
  sendTransactional,
  sendPasswordResetEmail,
  sendSharerWelcomeEmail,
  type EmailTemplate,
  type EmailVars,
} from "../services/email-templates.js";
import { POSTAL_LINE, UNSUBSCRIBE_HREF } from "../services/email-theme.js";
import {
  expectBrandHeader,
  expectInkOnCoral,
  expectInkUnderlinedLinks,
  expectKitPaletteOnly,
  expectPngImagesOnly,
} from "./helpers/email-assert.js";

const VARS: EmailVars = {
  recipientName: "Alex Rivera",
  recipientEmail: "alex@example.com",
  companyName: "Northwind Labs",
  listingTier: "Featured",
  directoryUrl: "https://directory.coherencedaddy.com/northwind",
  dashboardUrl: "https://coherencedaddy.com/intel",
  partnerDashboardUrl: "https://coherencedaddy.com/partner-dashboard",
  partnerToken: "ptk_8f3a1c9d2e7b4a60",
  apiKey: "cd_live_9a8b7c6d5e4f3a2b1c0d",
  planName: "Pro",
  docsUrl: "https://coherencedaddy.com/intel/docs",
  checkoutUrl: "https://coherencedaddy.com/checkout/abc123",
  tierName: "Pro plan",
  renewalDate: "December 14, 2026",
  subscriptionName: "Intel Pro",
  manageUrl: "https://coherencedaddy.com/intel/billing",
  affiliateName: "Jordan Lee",
  affiliateDashboardUrl: "https://affiliates.coherencedaddy.com/dashboard",
  adminAffiliatesUrl: "https://teamdashboard.coherencedaddy.com",
  resetToken: "rst_12345abcde",
  supportEmail: "info@coherencedaddy.com",
  leadName: "Acme Robotics",
  amountCents: 12500,
  totalCents: 48000,
  count: 3,
  type: "recurring",
  commissionCount: 3,
  method: "manual_ach",
  externalId: "ACH-2026-11-0042",
  reason: "Tax form missing",
  statusLabel: "Won",
  toStatus: "won",
  leadUrl: "https://affiliates.coherencedaddy.com/leads/42",
  fromTier: "bronze",
  toTier: "silver",
  newRate: "25%",
  ruleCode: "undisclosed_affiliate_link",
  severity: "warning",
  evidenceExcerpt: "Use my link for the best deal",
  campaignName: "November Giveaway",
  prize: "A Coherence Daddy hoodie",
  trackingNumber: "1Z999AA10123456784",
  merchItem: "Coherence Daddy hoodie",
  daysInactive: 45,
  suspensionReason: "repeated policy violations",
};

const ALL: EmailTemplate[] = [
  "directory-welcome", "partner-welcome", "intel-welcome", "checkout-reminder", "renewal-reminder",
  "affiliate-application", "affiliate-approved", "affiliate-reset-password", "affiliate-pending-digest",
  "affiliate-commission-created", "affiliate-commission-approved", "affiliate-payout-sent",
  "affiliate-payout-held", "affiliate-lock-expired", "affiliate-lead-status-change",
  "affiliate-tier-upgraded", "affiliate-violation-warning", "affiliate-suspended",
  "affiliate-giveaway-winner", "affiliate-reengagement", "affiliate-merch-shipped",
];
// Promotional/nudge mails get an unsubscribe link; everything else is
// transactional. Owner-only mails get the light frame without address/unsubscribe.
const COMMERCIAL: EmailTemplate[] = ["checkout-reminder", "affiliate-reengagement", "affiliate-giveaway-winner"];
const OWNER_ONLY: EmailTemplate[] = ["affiliate-application", "affiliate-violation-warning"];

beforeAll(() => {
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_USER = "u";
  process.env.SMTP_PASS = "p";
  process.env.ALERT_EMAIL_FROM = "noreply@example.test";
});
beforeEach(() => {
  brevoSent.length = 0;
  smtpSent.length = 0;
});

async function render(t: EmailTemplate, vars: EmailVars = VARS): Promise<Sent> {
  await sendTransactional(t, "alex@example.com", vars);
  expect(brevoSent).toHaveLength(1);
  return brevoSent[0];
}

describe("sendTransactional: every template is in the house look", () => {
  it.each(ALL)("%s", async (t) => {
    const mail = await render(t);
    expect(mail.subject).toBeTruthy();
    expectBrandHeader(mail.html);
    expectKitPaletteOnly(mail.html);
    expectPngImagesOnly(mail.html);
    expectInkOnCoral(mail.html);
    expectInkUnderlinedLinks(mail.html);
    // The old shell's tells are gone.
    expect(mail.html).not.toMatch(/#FF876D|#4ECDC4|#f5f5f5/i);
    expect(mail.subject).not.toMatch(/&[a-z#0-9]+;/i);
    // Plain-text part on every send, readable and markup-free.
    expect(mail.text, "plain-text part").toBeTruthy();
    expect(mail.text).not.toMatch(/<[a-z!/]/i);
    expect(mail.text).not.toMatch(/&[a-z#0-9]+;/i);
  });

  it.each(ALL.filter((t) => !OWNER_ONLY.includes(t)))("%s carries the postal address", async (t) => {
    const mail = await render(t);
    expect(mail.html.replace(/&nbsp;/g, " ")).toContain(POSTAL_LINE);
    expect(mail.text).toContain(POSTAL_LINE);
  });

  it.each(COMMERCIAL)("%s (commercial) has an unsubscribe link in html and text", async (t) => {
    const mail = await render(t);
    expect(mail.html).toContain(`href="${UNSUBSCRIBE_HREF}"`);
    expect(mail.text).toContain(UNSUBSCRIBE_HREF);
  });

  it.each(ALL.filter((t) => !COMMERCIAL.includes(t)))("%s (not commercial) has no unsubscribe link", async (t) => {
    const mail = await render(t);
    expect(mail.html).not.toMatch(/unsubscribe/i);
  });

  it.each(OWNER_ONLY)("%s (owner-only) uses the light frame: no address, no unsubscribe", async (t) => {
    const mail = await render(t);
    expect(mail.html.replace(/&nbsp;/g, " ")).not.toContain(POSTAL_LINE);
    expect(mail.html).not.toMatch(/unsubscribe/i);
  });

  it("keeps the call to action in the plain-text part", async () => {
    const mail = await render("intel-welcome");
    expect(mail.text).toContain("https://coherencedaddy.com/intel/docs");
    expect(mail.text).toContain("cd_live_9a8b7c6d5e4f3a2b1c0d");
  });

  it("escapes values that came from outside (names, company names, titles)", async () => {
    const evil = `<img src=x onerror=alert(1)>`;
    const mail = await render("directory-welcome", { ...VARS, companyName: evil, listingTier: `T&C"` });
    expect(mail.html).not.toContain(evil);
    // (headings join their last two words with a non-breaking space)
    expect(mail.html.replace(/\u00A0/g, " ")).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(mail.html).toContain("T&amp;C&quot;");
    // the <title> mirrors the subject and is escaped too
    expect(mail.html).toMatch(/<title>[^<]*T&amp;C&quot;[^<]*<\/title>/);
  });

  it("fixes subjects that carried raw HTML entities", async () => {
    expect((await render("affiliate-tier-upgraded")).subject).toBe("You're now a Silver affiliate");
    brevoSent.length = 0;
    expect((await render("affiliate-reengagement")).subject).toBe("We've missed you — easy lead wins waiting");
  });

  it("does not change who gets the mail or what it is called", async () => {
    const mail = await render("renewal-reminder");
    expect(mail.subject).toBe("Your Intel Pro renews on December 14, 2026");
    expect(mail.to).toBe("alex@example.com");
  });
});

describe("SMTP-only senders", () => {
  it("dashboard password reset is branded, has a text part, and keeps the exact link", async () => {
    const url = "https://teamdashboard.coherencedaddy.com/reset?token=abc&x=1";
    await sendPasswordResetEmail("alex@example.com", url);
    expect(smtpSent).toHaveLength(1);
    const m = smtpSent[0];
    expect(m.subject).toBe("Reset your team dashboard password");
    expectBrandHeader(m.html);
    expectKitPaletteOnly(m.html);
    expectInkOnCoral(m.html);
    expect(m.html).toContain(`href="https://teamdashboard.coherencedaddy.com/reset?token=abc&amp;x=1"`);
    expect(m.html.replace(/&nbsp;/g, " ")).toContain(POSTAL_LINE);
    expect(m.text).toContain(url);
    expect(m.text).toContain("If you didn't request a reset");
  });

  it("shop-sharer welcome is branded with an unsubscribe, keeps the QR attachment, has a text part", async () => {
    await sendSharerWelcomeEmail({
      to: "alex@example.com",
      shareUrl: "https://coherencedaddy.com/s/alex42",
      referralCode: "alex42",
      shareLandingUrl: "https://coherencedaddy.com/shop/share?code=alex42",
      qrPng: Buffer.from("png"),
    });
    expect(smtpSent).toHaveLength(1);
    const m = smtpSent[0];
    expect(m.subject).toBe("You're in. Your share link is live.");
    expectBrandHeader(m.html);
    expectKitPaletteOnly(m.html);
    expectPngImagesOnly(m.html);
    expectInkOnCoral(m.html);
    expectInkUnderlinedLinks(m.html);
    expect(m.html).toContain("cid:sharer-qr");
    // The QR chip must fit a 375px card (border-box, or its padding pushes it past the edge).
    expect(m.html).toMatch(/<img src="cid:sharer-qr"[^>]*box-sizing:border-box[^>]*max-width:300px/);
    expect(m.html.replace(/&nbsp;/g, " ")).toContain(POSTAL_LINE);
    expect(m.html).toContain(`href="${UNSUBSCRIBE_HREF}"`);
    expect(m.attachments?.[0]?.cid).toBe("sharer-qr");
    expect(m.text).toContain("https://coherencedaddy.com/s/alex42");
    expect(m.text).toContain("alex42");
  });
});
