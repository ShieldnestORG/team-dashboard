// ---------------------------------------------------------------------------
// sendAlert — per-key cooldown + HTML-safe email body.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sent: Array<{ subject: string; html: string; text?: string }> = [];
vi.mock("./brevo.js", () => ({
  brevoConfigured: () => true,
  sendMailBrevoFirst: vi.fn(async (mail: { subject: string; html: string; text?: string }) => {
    sent.push(mail);
    return true;
  }),
}));
import { sendAlert, getRecentAlerts } from "./alerting.js";
import { MONOGRAM_URL, CORAL_RULE_URL, POSTAL_LINE } from "./email-theme.js";

const env = { to: process.env.ALERT_EMAIL_TO, from: process.env.ALERT_EMAIL_FROM };
beforeAll(() => {
  process.env.ALERT_EMAIL_TO = "ops@example.test";
  process.env.ALERT_EMAIL_FROM = "alerts@example.test";
});
afterAll(() => {
  process.env.ALERT_EMAIL_TO = env.to;
  process.env.ALERT_EMAIL_FROM = env.from;
});

describe("sendAlert cooldownKey", () => {
  it("keeps one type's alerts for different keys apart, and still cools down per key", async () => {
    await sendAlert("blog_publish_failing", "Blog publish failing: cd", "x", { cooldownKey: "test:cd" });
    await sendAlert("blog_publish_failing", "Blog publish failing: sn", "y", { cooldownKey: "test:sn" });
    await sendAlert("blog_publish_failing", "Blog publish failing: cd", "again", { cooldownKey: "test:cd" });

    const subjects = getRecentAlerts().map((a) => a.subject);
    expect(subjects.filter((s) => s === "Blog publish failing: cd")).toHaveLength(1);
    expect(subjects.filter((s) => s === "Blog publish failing: sn")).toHaveLength(1);
  });
});

describe("sendAlert email body", () => {
  it("escapes HTML in the subject and body", async () => {
    await sendAlert("backup_failed", "a <b> & c", "<html><script>x</script> 401");
    const mail = sent.find((m) => m.subject.includes("a <b> & c"));
    expect(mail?.html).toContain("a &lt;b&gt; &amp; c");
    expect(mail?.html).toContain("&lt;html&gt;&lt;script&gt;x&lt;/script&gt; 401");
    expect(mail?.html).not.toContain("<script>");
  });
});

describe("sendAlert email frame", () => {
  it("wraps the alert in the light Coherence Daddy frame and sends a plain-text part", async () => {
    await sendAlert("service_down", "Ollama is down", "Health check failed 2 times.\nLast error: ECONNREFUSED", {
      cooldownKey: "test:frame",
    });
    const mail = sent.find((m) => m.subject === "[Team Dashboard] Ollama is down");
    expect(mail, "alert mail was sent with the unchanged subject").toBeDefined();
    expect(mail!.html).toContain(`src="${MONOGRAM_URL}"`);
    expect(mail!.html).toContain(`src="${CORAL_RULE_URL}"`);
    // old look is gone: no red heading, no grey slab
    expect(mail!.html).not.toMatch(/#ef4444|#f8f8f8|#666|#999/i);
    // owner-only: no postal address, no unsubscribe
    expect(mail!.html.replace(/&nbsp;/g, " ")).not.toContain(POSTAL_LINE);
    expect(mail!.html).not.toMatch(/unsubscribe/i);
    // still quick to scan: type + the full body are in both parts
    expect(mail!.html).toContain("Alert type: service_down");
    // the timestamp must not split across lines on a phone
    expect(mail!.html).toMatch(/<span style="white-space:nowrap;">\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/span>/);
    expect(mail!.text).toContain("Ollama is down");
    expect(mail!.text).toContain("Alert type: service_down");
    expect(mail!.text).toContain("Last error: ECONNREFUSED");
  });

  it("keeps the body's line breaks in the plain-text part and escapes nothing twice", async () => {
    await sendAlert("backup_failed", "R&D <db>", "a & b\nc < d", { cooldownKey: "test:text" });
    const mail = sent.find((m) => m.subject.includes("R&D <db>"));
    expect(mail?.text).toContain("a & b\nc < d");
    expect(mail?.html).toContain("a &amp; b");
  });
});
